/**
 * @file biostar-ws.service.ts
 * @description Servicio de escucha WebSocket hacia BioStar 2 para "burn-after-use" de QR.
 *
 * Se conecta a wss://[IP_BIOSTAR]/wsapi y escucha eventos de acceso en tiempo real.
 * Cuando detecta un ACCESS_GRANTED para un visitante con QR activo, ejecuta el
 * "quemado" de credencial: revoca el QR en Redis y lo desvincula del usuario en BioStar.
 *
 * El servicio maneja reconexión automática con backoff exponencial y falla
 * silenciosamente cuando BioStar no está disponible (offline-tolerante).
 *
 * @module modules/visitors
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import Redis from 'ioredis';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { AccessCredential, CredentialType, Tenant, Visit, VisitStatus, Visitor } from '../../database/entities';
import { SupremaApiConnection } from '../../database/entities/suprema-api-connection.entity';
import { QrEngineService } from '../qr-engine/qr-engine.service';
import { CredentialSyncStatus } from '../../database/entities/access-credential.entity';
import { EventsGateway } from '../events/events.gateway';
import { EnrollerDevicesService } from '../settings/enroller-devices.service';
import { VisitorsService } from './visitors.service';
import { EncryptionService } from '../../core/crypto/encryption.service';
import { AutoCheckoutService } from './auto-checkout.service';
import { ExitLinksService } from './exit-links.service';
import { NotificationsService } from '../notifications/notifications.service';
import * as https from 'https';
import * as fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WebSocketLib = require('ws');

/** Clave de caché Redis para el bs-session-id, compartida con enroller-devices.service.ts */
const SESSION_CACHE_KEY = (connectionId: string) => `bv:bsession:conn:${connectionId}`;
const SESSION_CACHE_TTL_SECONDS = 1500;

const ACCESS_GRANTED_CODES = new Set([
  'ACCESS_GRANTED',
  'ACCESS_GRANTED_NO_ENTRY_POINT',
  0,
  1,
]);

@Injectable()
export class BiostarWsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BiostarWsService.name);
  private ws: any = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private destroyed = false;
  private retryDelay = 5000;
  private readonly MAX_RETRY_DELAY = 60_000;
  /** TenantId de la conexión BioStar activa (para broadcast en tiempo real) */
  private currentTenantId: string | null = null;
  /** Contador de intentos fallidos consecutivos, para reducir ruido en el log */
  private consecutiveFailures = 0;
  /** Sólo se emite log completo cada N intentos fallidos tras el primero */
  private readonly LOG_EVERY_N_FAILURES = 10;
  /** Poller de respaldo por API REST (independiente del WS) */
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 5000;
  private pollInFlight = false;
  /** Evita programar múltiples checkouts automáticos para la misma visita
   *  cuando llegan varios eventos "granted" (ej. 3 pasadas de tarjeta) dentro
   *  de la ventana de retraso configurada — sin esto se disparan checkouts y
   *  correos de encuesta duplicados para el mismo visitante. */
  private readonly exitCheckoutScheduled = new Set<string>();

  constructor(
    @InjectRepository(SupremaApiConnection)
    private readonly connectionRepo: Repository<SupremaApiConnection>,
    @InjectRepository(AccessCredential)
    private readonly credentialRepo: Repository<AccessCredential>,
    @InjectRepository(Visit)
    private readonly visitRepo: Repository<Visit>,
    @InjectRepository(Visitor)
    private readonly visitorRepo: Repository<Visitor>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly qrEngine: QrEngineService,
    private readonly eventsGateway: EventsGateway,
    private readonly enrollerDevicesService: EnrollerDevicesService,
    private readonly visitorsService: VisitorsService,
    private readonly httpService: HttpService,
    private readonly encryptionService: EncryptionService,
    private readonly autoCheckoutService: AutoCheckoutService,
    private readonly exitLinksService: ExitLinksService,
    private readonly notificationsService: NotificationsService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async onModuleInit() {
    await this.tryConnect();
    this.pollTimer = setInterval(() => this.pollExitDeviceEvents(), this.POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.ws?.close();
  }

  /**
   * Poller de respaldo por API REST: consulta `GET /api/events?device_id=...`
   * para cada dispositivo de salida configurado, cada `POLL_INTERVAL_MS`.
   *
   * Se ejecuta EN PARALELO al listener por WebSocket (`/wsapi`). Es necesario
   * porque el WS de BioStar puede no entregar eventos cuando el backend está
   * fuera de la LAN del servidor BioStar (mismo tipo de restricción que
   * `/api/monitoring/*`, ver memoria `biostar-monitoring-lan-restriction`) —
   * en ese caso el WS abre y se mantiene conectado, pero jamás recibe
   * mensajes, y este polling es el único mecanismo confiable para detectar
   * la autenticación del visitante en el dispositivo de salida.
   *
   * Deduplica eventos ya procesados con un set en Redis (TTL corto) usando
   * el `eventId` de BioStar, para no disparar checkout duplicado.
   */
  private async pollExitDeviceEvents(): Promise<void> {
    if (this.pollInFlight || this.destroyed) return;
    this.pollInFlight = true;

    try {
      const connection = await this.connectionRepo
        .findOne({ where: { isActive: true } })
        .catch(() => null);
      if (!connection?.apiUrl) return;

      const tenantId = connection.tenantId ?? this.currentTenantId;
      if (!tenantId) return;

      const exitDevices = await this.enrollerDevicesService.getExitDevices(tenantId);
      if (!exitDevices.length) return;

      for (const device of exitDevices) {
        const events = await this.enrollerDevicesService.getRecentAccessEvents(
          tenantId,
          device.deviceId,
          10,
        );

        for (const event of events) {
          if (!event.isGranted || !event.supremaUserId) continue;

          const dedupeKey = `bv:exitevent:seen:${event.eventId}`;
          const alreadySeen = await this.redis.set(dedupeKey, '1', 'EX', 600, 'NX').catch(() => null);
          if (!alreadySeen) continue; // ya procesado (por WS o por un poll anterior)

          this.logger.log(
            `🚪 [POLL] Acceso concedido detectado vía API en dispositivo de salida ${device.deviceId} para supremaUserId=${event.supremaUserId}`,
          );

          await this.burnQrForUser(event.supremaUserId).catch(() => null);
          await this.checkoutOnExitDevice(event.supremaUserId, device.deviceId, tenantId);
        }
      }
    } catch (err: any) {
      this.logger.debug(`Poller de eventos de salida: ${err?.message}`);
    } finally {
      this.pollInFlight = false;
    }
  }

  private async tryConnect() {
    if (this.destroyed) return;

    const connection = await this.connectionRepo.findOne({
      where: { isActive: true },
    }).catch(() => null);

    if (!connection?.apiUrl) {
      this.logger.log('🔌 BioStar WS: sin conexión activa configurada, sin escucha de eventos.');
      return;
    }

    this.currentTenantId = connection.tenantId ?? null;

    const wsUrl = connection.apiUrl
      .replace(/^https?:\/\//, (m) => (m.startsWith('https') ? 'wss://' : 'ws://'))
      .replace(/\/$/, '') + '/wsapi';

    const shouldLog = this.consecutiveFailures % this.LOG_EVERY_N_FAILURES === 0;

    const agent = new https.Agent({
      rejectUnauthorized: !!connection.caCertPath,
      ca:
        connection.caCertPath && fs.existsSync(connection.caCertPath)
          ? fs.readFileSync(connection.caCertPath)
          : undefined,
    });

    // BioStar exige una sesión autenticada (bs-session-id) para emitir eventos
    // por el WebSocket /wsapi — sin ella, la conexión abre pero nunca recibe mensajes.
    let sessionId: string;
    try {
      sessionId = await this.getSessionId(connection, agent);
    } catch (err: any) {
      this.logger.warn(`BioStar WS: no se pudo autenticar con BioStar — ${err.message}`);
      this.registerFailureAndReconnect();
      return;
    }

    if (shouldLog) {
      this.logger.log(`📡 BioStar WS: conectando a ${wsUrl}…`);
    }

    try {
      this.ws = new WebSocketLib(wsUrl, {
        agent,
        headers: { Cookie: `bs-session-id=${sessionId}` },
      } as any);
    } catch (err: any) {
      this.logger.warn(`BioStar WS: error al crear socket — ${err.message}`);
      this.registerFailureAndReconnect();
      return;
    }

    this.ws.on('open', () => {
      if (this.consecutiveFailures > 0) {
        this.logger.log('✅ BioStar WS: conexión restablecida tras interrupción.');
      } else {
        this.logger.log('✅ BioStar WS: conectado y escuchando eventos de acceso.');
      }
      this.retryDelay = 5000;
      this.consecutiveFailures = 0;
    });

    this.ws.on('message', (raw: any) => this.handleMessage(raw));

    this.ws.on('unexpected-response', async (_req: any, res: any) => {
      // 401/403 suele indicar que el bs-session-id cacheado expiró o es inválido.
      if (res?.statusCode === 401 || res?.statusCode === 403) {
        await this.invalidateSessionCache(connection.id).catch(() => null);
      }
    });

    this.ws.on('close', () => {
      if (shouldLog) {
        this.logger.warn(
          `BioStar WS: conexión cerrada, reintentando… (${this.consecutiveFailures + 1} intentos fallidos, próximos avisos silenciados)`,
        );
      }
      this.registerFailureAndReconnect();
    });

    this.ws.on('error', (err: Error) => {
      if (shouldLog) {
        this.logger.warn(`BioStar WS: error — ${err.message}`);
      }
    });
  }

  /**
   * Obtiene el bs-session-id autenticado con BioStar, usando la misma caché Redis
   * (`bv:bsession:conn:{connId}`, TTL 25min) compartida con `enroller-devices.service.ts`.
   */
  private async getSessionId(
    connection: SupremaApiConnection,
    httpsAgent: https.Agent,
  ): Promise<string> {
    const cacheKey = SESSION_CACHE_KEY(connection.id);
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return cached;

    const loginId = this.encryptionService.decrypt(connection.loginIdEncrypted);
    const password = this.encryptionService.decrypt(connection.passwordEncrypted);

    const response = await firstValueFrom(
      this.httpService.post(
        `${connection.apiUrl}/api/login`,
        { User: { login_id: loginId, password } },
        { httpsAgent, timeout: 15000, validateStatus: (s) => s < 500 },
      ),
    );

    const sessionId: string | undefined =
      response.headers['bs-session-id'] || response.data?.sessionId;

    if (response.status !== 200 || !sessionId) {
      const msg =
        response.data?.Response?.message ||
        response.data?.message ||
        `HTTP ${response.status}`;
      throw new Error(`Autenticación BioStar fallida: ${msg}`);
    }

    await this.redis.setex(cacheKey, SESSION_CACHE_TTL_SECONDS, sessionId).catch(() => null);
    return sessionId;
  }

  private async invalidateSessionCache(connectionId: string): Promise<void> {
    await this.redis.del(SESSION_CACHE_KEY(connectionId));
  }

  private registerFailureAndReconnect() {
    this.consecutiveFailures++;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.retryDelay = Math.min(this.retryDelay * 2, this.MAX_RETRY_DELAY);
      this.tryConnect();
    }, this.retryDelay);
  }

  private async handleMessage(raw: any) {
    let event: any;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const isGranted =
      ACCESS_GRANTED_CODES.has(event?.event_type) ||
      ACCESS_GRANTED_CODES.has(event?.EventLog?.event_type) ||
      event?.result === 'ACCESS_GRANTED';

    // ---- Broadcast every event to the connected frontend clients in real-time ----
    if (this.currentTenantId) {
      const liveEvent = {
        userId:     event?.user_id || event?.EventLog?.user_id || '',
        eventType:  event?.event_type || event?.EventLog?.event_type || 'UNKNOWN',
        deviceName: event?.device_name || event?.EventLog?.device_name || 'Desconocido',
        datetime:   new Date().toISOString(),
        isGranted,
      };
      try {
        this.eventsGateway.broadcastToTenant(this.currentTenantId, 'access.event', liveEvent);
      } catch {
        /* EventsGateway can fail silently — never block the WS handler */
      }
    }

    if (!isGranted) return;

    const supremaUserId: string | undefined =
      event?.user_id?.user_id ||
      event?.user_id ||
      event?.EventLog?.user_id?.user_id ||
      event?.EventLog?.user_id;

    if (!supremaUserId) return;

    this.logger.log(`🚪 BioStar WS: acceso concedido para supremaUserId=${supremaUserId}`);

    await this.burnQrForUser(supremaUserId);

    const deviceId: string | undefined =
      event?.device_id?.id?.toString() ||
      (typeof event?.device_id === 'string' || typeof event?.device_id === 'number'
        ? String(event.device_id)
        : undefined) ||
      event?.EventLog?.device_id?.id?.toString();

    if (deviceId && this.currentTenantId) {
      await this.checkoutOnExitDevice(supremaUserId, deviceId, this.currentTenantId);
    }
  }

  /**
   * Si el dispositivo donde ocurrió el ACCESS_GRANTED está marcado como
   * "dispositivo de salida" para el tenant, y el visitante tiene el
   * auto-checkout habilitado para su visita, interpreta el evento como la
   * "última salida" del visitante y dispara el checkout automático de su
   * visita activa (opcionalmente tras un retraso configurable en segundos).
   */
  private async checkoutOnExitDevice(
    supremaUserId: string,
    deviceId: string,
    tenantId: string,
  ): Promise<void> {
    let visitIdForCleanup: string | null = null;
    try {
      const isExit = await this.enrollerDevicesService.isExitDevice(tenantId, deviceId);
      if (!isExit) return;

      const visit = await this.visitRepo.findOne({
        where: { supremaUserRefId: supremaUserId, tenantId },
      }).catch(() => null);

      if (!visit || visit.status !== VisitStatus.CHECKED_IN) return;

      if (!visit.autoCheckoutEnabled) {
        this.logger.debug(
          `Evento en dispositivo de salida (${deviceId}) para visita ${visit.id}, pero autoCheckoutEnabled=false — se ignora.`,
        );
        return;
      }

      if (this.exitCheckoutScheduled.has(visit.id)) {
        this.logger.debug(
          `Ya hay un checkout automático programado/en curso para visita ${visit.id} — se ignora evento duplicado.`,
        );
        return;
      }
      this.exitCheckoutScheduled.add(visit.id);
      visitIdForCleanup = visit.id;

      const delaySeconds = await this.enrollerDevicesService.getExitCheckoutDelaySeconds(tenantId);

      this.logger.log(
        `🚪 Evento de salida detectado en dispositivo ${deviceId} para visita ${visit.id}` +
          (delaySeconds > 0 ? ` — checkout programado en ${delaySeconds}s` : ' — checkout inmediato'),
      );

      const runCheckout = async () => {
        try {
          const freshVisit = await this.visitRepo.findOne({ where: { id: visit.id } });
          if (!freshVisit || freshVisit.status !== VisitStatus.CHECKED_IN) {
            this.logger.debug(
              `Visita ${visit.id} ya no está CHECKED_IN al cumplirse el retraso — se omite checkout automático.`,
            );
            return;
          }

          await this.visitorsService.checkoutVisit(
            visit.id,
            tenantId,
            'system',
            'Auto-Checkout (Dispositivo de Salida)',
          );

          this.logger.log(
            `✅ Auto-checkout por dispositivo de salida (${deviceId}) aplicado para visita ${visit.id}`,
          );

          await this.sendExitSurveyEmailIfEnabled(visit.id, tenantId);
        } catch (err: any) {
          this.logger.warn(
            `No se pudo aplicar auto-checkout por dispositivo de salida: ${err?.message}`,
          );
        } finally {
          this.exitCheckoutScheduled.delete(visit.id);
        }
      };

      if (delaySeconds > 0) {
        setTimeout(() => {
          runCheckout();
        }, delaySeconds * 1000);
      } else {
        await runCheckout();
      }
    } catch (err: any) {
      if (visitIdForCleanup) this.exitCheckoutScheduled.delete(visitIdForCleanup);
      this.logger.warn(
        `No se pudo procesar auto-checkout por dispositivo de salida: ${err?.message}`,
      );
    }
  }

  /**
   * Tras un auto-checkout por dispositivo de salida, envía (si está habilitado
   * en la configuración del tenant) el correo de encuesta de satisfacción +
   * aviso de "reportar falsa salida" al visitante, siempre que tenga email.
   */
  private async sendExitSurveyEmailIfEnabled(visitId: string, tenantId: string): Promise<void> {
    try {
      const { enabled } = await this.autoCheckoutService.getExitSurveyConfig(tenantId);
      if (!enabled) return;

      const visit = await this.visitRepo.findOne({ where: { id: visitId, tenantId } });
      if (!visit) return;

      const visitor = await this.visitorRepo.findOne({ where: { id: visit.visitorId } });
      if (!visitor?.email) return;

      const [surveyToken, falseExitToken] = await Promise.all([
        Promise.resolve(this.exitLinksService.generateSurveyToken(visit.id, tenantId)),
        this.exitLinksService.generateFalseExitToken(visit.id, tenantId),
      ]);

      const visitorName = `${visitor.firstName} ${visitor.lastName}`.trim();

      const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } }).catch(() => null);
      const timeZone = tenant?.timezone || 'America/Bogota';

      await this.notificationsService.sendExitSurvey(visitor.email, {
        visitorName,
        checkedOutAt: visit.checkedOutAt || new Date(),
        surveyToken,
        falseExitToken,
        timeZone,
      });

      this.logger.log(
        `📧 Correo de encuesta + aviso de falsa salida enviado a ${visitor.email} (visita ${visit.id})`,
      );
    } catch (err: any) {
      this.logger.warn(
        `No se pudo enviar el correo de encuesta de salida (visita ${visitId}): ${err?.message}`,
      );
    }
  }

  /**
   * "Quema" (revoca) el QR de un visitante identificado por su supremaUserRefId.
   * Se llama en milisegundos tras el evento ACCESS_GRANTED de BioStar.
   */
  private async burnQrForUser(supremaUserId: string) {
    const visit = await this.visitRepo.findOne({
      where: { supremaUserRefId: supremaUserId },
    }).catch(() => null);

    if (!visit) return;

    const credentials = await this.credentialRepo.find({
      where: { visitId: visit.id, type: CredentialType.QR_JWT, isRevoked: false },
    });

    if (!credentials.length) return;

    for (const cred of credentials) {
      if (cred.tokenHash) {
        await this.qrEngine.revokeQr(cred.tokenHash).catch(() => null);
      }
      await this.credentialRepo.update(cred.id, {
        isRevoked: true,
        syncStatus: CredentialSyncStatus.SYNCED,
        revokeReason: 'ACCESS_GRANTED — burn-after-use',
      }).catch(() => null);
    }

    this.logger.log(
      `🔥 QR quemado (burn-after-use) para visita ${visit.id} tras ACCESS_GRANTED en BioStar`,
    );
  }
}
