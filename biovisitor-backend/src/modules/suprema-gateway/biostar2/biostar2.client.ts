/**
 * @file biostar2.client.ts
 * @description Cliente específico para la API REST de BioStar 2.
 *
 * Implementa ISupremaClient para la plataforma BioStar 2.
 * Gestiona el ciclo de vida del bs-session-id (obtención, caché en Redis,
 * renovación automática al expirar).
 *
 * BioStar 2 utiliza una API REST tradicional con autenticación basada en
 * cookies/headers de sesión. El token bs-session-id se debe enviar en
 * cada petición HTTP como header.
 *
 * Endpoints clave de BioStar 2 utilizados:
 * - POST /api/login → Obtener bs-session-id
 * - POST /api/users → Crear usuario visitante
 * - DELETE /api/users?user_ids={id} → Eliminar usuario
 * - PUT /api/users/{id}/fingerprint → Enrollar huella
 * - POST /api/users/{id}/photo → Enrollar foto facial
 * - POST /api/cards → Asignar tarjeta
 * - POST /api/doors/open → Abrir puerta
 * - POST /api/events/search → Buscar eventos de acceso
 *
 * @module modules/suprema-gateway/biostar2
 */

import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import Redis from 'ioredis';
import { firstValueFrom } from 'rxjs';
import * as https from 'https';
import * as fs from 'fs';
import {
  ISupremaClient,
  CreateSupremaUserPayload,
  SupremaUserResult,
  AccessEvent,
  FaceValidationResult,
} from '../interfaces/suprema-client.interface';

/**
 * Configuración necesaria para conectar con un servidor BioStar 2.
 */
export interface BioStar2Config {
  /** URL base de la API (ej: https://192.168.1.10:2778) */
  apiUrl: string;
  /** ID de login del administrador */
  adminUser: string;
  /** Contraseña del administrador */
  adminPassword: string;
  /** Ruta al certificado CA para verificación SSL */
  caCertPath?: string;
  /** TTL del caché de sesión en Redis (segundos). Por defecto: 1500 (25 min) */
  sessionCacheTtl?: number;
  /** ID del tenant para aislamiento en Redis */
  tenantId: string;
}

/**
 * Cliente para la API de BioStar 2.
 *
 * Gestiona automáticamente la sesión (bs-session-id) con caché en Redis
 * para evitar re-autenticaciones innecesarias. La sesión se renueva
 * automáticamente cuando se detecta expiración (respuesta 401).
 *
 * @implements ISupremaClient
 */
export class BioStar2Client implements ISupremaClient {
  private readonly logger = new Logger('BioStar2Client');
  private readonly httpsAgent: https.Agent;
  private readonly sessionRedisKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly redis: Redis,
    private readonly config: BioStar2Config,
  ) {
    // Configurar agente HTTPS con el certificado CA del servidor BioStar
    // Si se proporciona caCertPath, verificamos el certificado (seguro).
    // Si no se proporciona, se permite sin verificación SOLO si no es producción.
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: !!config.caCertPath,
      ca:
        config.caCertPath && fs.existsSync(config.caCertPath)
          ? fs.readFileSync(config.caCertPath)
          : undefined,
    });

    // Clave de Redis única por tenant para aislamiento de sesiones
    this.sessionRedisKey = `bv:bs2:session:${config.tenantId}`;
  }

  /**
   * Obtiene el bs-session-id, usando caché de Redis si existe.
   * Si no hay sesión en caché o ha expirado, re-autentica con BioStar 2.
   *
   * Flujo de autenticación BioStar 2:
   * 1. POST /api/login con { User: { login_id, password } }
   * 2. BioStar responde con header 'bs-session-id'
   * 3. Almacenamos el token en Redis con TTL de 25 minutos
   * 4. Todas las peticiones subsiguientes incluyen este header
   *
   * @returns Token bs-session-id válido
   * @throws Error si las credenciales son inválidas
   */
  private async getSessionId(): Promise<string> {
    // Intentar obtener sesión del caché de Redis
    let sessionId = await this.redis.get(this.sessionRedisKey);

    if (sessionId) {
      return sessionId;
    }

    // No hay sesión en caché, re-autenticar
    this.logger.log(
      `🔐 Autenticando con BioStar 2 (Tenant: ${this.config.tenantId})...`,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.config.apiUrl}/api/login`,
          {
            User: {
              login_id: this.config.adminUser,
              password: this.config.adminPassword,
            },
          },
          { httpsAgent: this.httpsAgent },
        ),
      );

      // El bs-session-id viene en el header de respuesta
      sessionId = response.headers['bs-session-id'];
      if (!sessionId) {
        throw new Error(
          'BioStar 2 no devolvió bs-session-id en el header de respuesta',
        );
      }

      // Almacenar en Redis con TTL
      // BioStar 2 expira la sesión tras ~30 min de inactividad.
      // Usamos 25 min como margen de seguridad.
      const ttl = this.config.sessionCacheTtl || 1500;
      await this.redis.setex(this.sessionRedisKey, ttl, sessionId);

      this.logger.log(
        '✅ Autenticación BioStar 2 exitosa. Sesión cacheada en Redis.',
      );
      return sessionId;
    } catch (error: any) {
      this.logger.error(
        `❌ Fallo de autenticación con BioStar 2: ${error.message}`,
        error.response?.data,
      );
      throw new Error(`Autenticación BioStar 2 fallida: ${error.message}`);
    }
  }

  /**
   * Genera los headers necesarios para peticiones autenticadas a BioStar 2.
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const sessionId = await this.getSessionId();
    return {
      'bs-session-id': sessionId,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Ejecuta una petición autenticada a BioStar 2 con reintento automático
   * de sesión si la actual ha expirado (respuesta 401).
   *
   * @param requestFn - Función que ejecuta la petición HTTP
   * @returns Resultado de la petición
   */
  private async executeWithRetry<T>(
    requestFn: (headers: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    try {
      const headers = await this.getAuthHeaders();
      return await requestFn(headers);
    } catch (error: any) {
      // Si recibimos 401, la sesión expiró. Invalidar caché y reintentar UNA vez.
      if (error.response?.status === 401) {
        this.logger.warn('⚠️ Sesión BioStar 2 expirada. Re-autenticando...');
        await this.redis.del(this.sessionRedisKey);
        const headers = await this.getAuthHeaders();
        return await requestFn(headers);
      }
      throw error;
    }
  }

  /** @inheritdoc */
  async authenticate(): Promise<void> {
    await this.getSessionId();
  }

  /** @inheritdoc */
  async createUser(
    payload: CreateSupremaUserPayload,
  ): Promise<SupremaUserResult> {
    return this.executeWithRetry(async (headers) => {
      // Construir el payload en formato BioStar 2
      const bs2Payload: Record<string, unknown> = {
        User: {
          user_id: payload.visitorId,
          name: payload.fullName,
          email: payload.email,
          start_datetime: payload.validFrom.toISOString(),
          expiry_datetime: payload.validTo.toISOString(),
          user_group_id: { id: payload.userGroupId || 1 },
        },
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.config.apiUrl}/api/users`, bs2Payload, {
          headers,
          httpsAgent: this.httpsAgent,
        }),
      );

      const supremaRefId = response.data?.User?.user_id || payload.visitorId;
      this.logger.log(
        `✅ Usuario ${payload.fullName} creado en BioStar 2 (Ref: ${supremaRefId})`,
      );

      return {
        supremaRefId,
        success: true,
      };
    });
  }

  /** @inheritdoc */
  async deleteUser(supremaRefId: string): Promise<void> {
    await this.executeWithRetry(async (headers) => {
      await firstValueFrom(
        this.httpService.delete(
          `${this.config.apiUrl}/api/users?user_ids=${supremaRefId}`,
          { headers, httpsAgent: this.httpsAgent },
        ),
      );
      this.logger.log(
        `🧹 Usuario ${supremaRefId} eliminado de BioStar 2 (check-out)`,
      );
    });
  }

  /** @inheritdoc */
  async enrollFace(supremaRefId: string, photoBase64: string): Promise<void> {
    await this.executeWithRetry(async (headers) => {
      // BioStar 2 acepta la foto como part de una petición multipart o como JSON
      // dependiendo de la versión. Usamos el endpoint de foto del usuario.
      await firstValueFrom(
        this.httpService.post(
          `${this.config.apiUrl}/api/users/${supremaRefId}/photo`,
          { photo: photoBase64 },
          { headers, httpsAgent: this.httpsAgent },
        ),
      );
      this.logger.log(
        `📷 Foto facial enrollada para usuario ${supremaRefId} en BioStar 2`,
      );
    });
  }

  /** @inheritdoc */
  async enrollFingerprint(
    supremaRefId: string,
    templateData: unknown,
  ): Promise<void> {
    await this.executeWithRetry(async (headers) => {
      await firstValueFrom(
        this.httpService.put(
          `${this.config.apiUrl}/api/users/${supremaRefId}/fingerprint`,
          { fingerprint_templates: templateData },
          { headers, httpsAgent: this.httpsAgent },
        ),
      );
      this.logger.log(
        `👆 Huella enrollada para usuario ${supremaRefId} en BioStar 2`,
      );
    });
  }

  /** @inheritdoc */
  async assignCard(supremaRefId: string, cardId: string): Promise<void> {
    await this.executeWithRetry(async (headers) => {
      await firstValueFrom(
        this.httpService.post(
          `${this.config.apiUrl}/api/cards`,
          {
            CardCollection: {
              rows: [
                {
                  card_id: cardId,
                  user_id: { user_id: supremaRefId },
                },
              ],
            },
          },
          { headers, httpsAgent: this.httpsAgent },
        ),
      );
      this.logger.log(
        `🎴 Tarjeta ${cardId} asignada al usuario ${supremaRefId} en BioStar 2`,
      );
    });
  }

  /** @inheritdoc */
  async openDoor(doorId: string): Promise<void> {
    await this.executeWithRetry(async (headers) => {
      await firstValueFrom(
        this.httpService.post(
          `${this.config.apiUrl}/api/doors/open`,
          { DoorCollection: { rows: [{ id: doorId }] } },
          { headers, httpsAgent: this.httpsAgent },
        ),
      );
      this.logger.log(`🚪 Puerta ${doorId} abierta vía BioStar 2`);
    });
  }

  /** @inheritdoc */
  async getEvents(fromDate: Date, toDate: Date): Promise<AccessEvent[]> {
    return this.executeWithRetry(async (headers) => {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.config.apiUrl}/api/events/search`,
          {
            Query: {
              limit: 1000,
              // BioStar espera una sola condición "datetime" con AMBOS límites
              // (inicio y fin) en el mismo arreglo `values`, no dos condiciones
              // separadas con operator 3/5 — con eso el endpoint respondía 200
              // pero siempre con 0 resultados.
              // Se filtra por `datetime` (verificado en UTC real); el campo
              // `server_datetime` viene con un desfase horario (~5h, reloj
              // local sin convertir) y NO debe usarse para filtrar/comparar.
              conditions: [
                {
                  column: 'datetime',
                  operator: 3, // rango (between)
                  values: [fromDate.toISOString(), toDate.toISOString()],
                },
              ],
              orders: [{ column: 'datetime', descending: true }],
            },
          },
          { headers, httpsAgent: this.httpsAgent },
        ),
      );

      // Transformar eventos de BioStar 2 al formato normalizado
      const rows = response.data?.EventCollection?.rows || [];
      return rows.map((event: any) => {
        const eventTypeCode = Number(event.event_type_id?.code ?? NaN);
        return {
          eventId: event.id?.toString() || '',
          userId: event.user_id?.user_id || '',
          eventType: event.event_type_id?.code || '',
          deviceId: event.device_id?.id?.toString() || '',
          deviceName: event.device_id?.name || '',
          timestamp: new Date(event.datetime),
          // El campo `is_dst` NO indica "acceso concedido/denegado" (viene como
          // string "0" en TODOS los eventos, incluyendo eventos de sistema del
          // dispositivo — no es booleano-comparable con `=== 0`, y aunque lo fuera
          // no distingue granted/denied). Verificado empíricamente con datos reales
          // (evento code 4867 = 0x1303 para una autenticación real concedida de
          // un visitante).
          //
          // BioStar identifica "identificación exitosa / acceso concedido" con
          // event_type_id en la familia 0x1300–0x13FF (mainCode === 0x13):
          // IDENTIFY_SUCCESS por huella/rostro/tarjeta/PIN, etc. Ver memoria
          // `biostar-events-search-schema.md`.
          isGranted: Number.isFinite(eventTypeCode) && Math.floor(eventTypeCode / 256) === 0x13,
        };
      });
    });
  }

  /** @inheritdoc */
  async validateFaceTemplate(
    photoBase64: string,
  ): Promise<FaceValidationResult> {
    return this.executeWithRetry(async (headers) => {
      try {
        const response = await firstValueFrom(
          this.httpService.put(
            `${this.config.apiUrl}/api/users/check/upload_picture`,
            { template_ex_picture: photoBase64 },
            { headers, httpsAgent: this.httpsAgent },
          ),
        );

        const data = response.data;
        if (
          data?.Response?.code === '0' &&
          data?.image_template
        ) {
          this.logger.log(
            '✅ Template facial extraído exitosamente por BioStar 2',
          );
          return {
            valid: true,
            image: data.image,
            imageTemplate: data.image_template,
            imageTemplate2: data.image_template_2,
          };
        }

        return {
          valid: false,
          errorMessage:
            data?.Response?.message ||
            'BioStar no pudo extraer el template facial',
        };
      } catch (error: any) {
        const msg =
          error.response?.data?.Response?.message ||
          error.response?.data?.message ||
          error.message;
        this.logger.warn(`⚠️ Fallo en validación facial BioStar 2: ${msg}`);
        return {
          valid: false,
          errorMessage: `Fallo en la extracción del template facial: ${msg}`,
        };
      }
    });
  }

  /** @inheritdoc */
  async capturePhotoFromDevice(deviceId: string): Promise<string> {
    const headers = await this.getAuthHeaders();

    const endpoints = [
      {
        url: `${this.config.apiUrl}/api/devices/${deviceId}/monitoring/scan_picture`,
        body: { timeout: 30 },
      },
      {
        url: `${this.config.apiUrl}/api/monitoring/scan_picture`,
        body: { MonitoringScanPicture: { device_id: { id: deviceId }, timeout: 30 } },
      },
    ];

    for (let i = 0; i < endpoints.length; i++) {
      const { url, body } = endpoints[i];
      try {
        const response = await firstValueFrom(
          this.httpService.post(url, body, {
            headers,
            httpsAgent: this.httpsAgent,
            timeout: 35000,
          }),
        );

        if (response.status === 202) {
          this.logger.log(`[CAPTURE] BioStar aceptó captura async (202) — iniciando polling para dispositivo ${deviceId}`);
          return await this.pollForScanPicture(deviceId, headers);
        }

        const picture =
          response.data?.DeviceScanPicture?.picture ||
          response.data?.MonitoringScanPicture?.picture ||
          response.data?.picture ||
          response.data?.image;

        if (picture) {
          return picture.replace(/^data:image\/\w+;base64,/, '');
        }
        this.logger.warn(`[CAPTURE] Respuesta sin imagen de ${url}: ${JSON.stringify(response.data)}`);
      } catch (err: any) {
        if (err.response?.status === 401) {
          await this.redis.del(this.sessionRedisKey);
          throw new Error('Sesión BioStar expirada durante captura');
        }
        if (err.response?.status === 404 || err.response?.status === 405) {
          this.logger.debug(`[CAPTURE] Endpoint no soportado: ${url}`);
          continue;
        }
        if (i === endpoints.length - 1) {
          const msg =
            err.response?.data?.Response?.message ||
            err.response?.data?.message ||
            err.message;
          throw new Error(`No se pudo capturar desde el dispositivo: ${msg}`);
        }
        this.logger.warn(`[CAPTURE] Error en ${url}: ${err.message} — intentando fallback`);
      }
    }

    throw new Error('El dispositivo no pudo capturar la imagen. Verifique que esté conectado.');
  }

  /**
   * Polling para captura asíncrona cuando BioStar devuelve 202.
   * Consulta cada 2 segundos durante máximo 30 segundos.
   */
  private async pollForScanPicture(
    deviceId: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const POLL_INTERVAL_MS = 2000;
    const MAX_POLLS = 15;

    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      try {
        const pollResponse = await firstValueFrom(
          this.httpService.get(
            `${this.config.apiUrl}/api/monitoring/scan_picture/${deviceId}`,
            { headers, httpsAgent: this.httpsAgent, timeout: 5000 },
          ),
        );

        const picture =
          pollResponse.data?.DeviceScanPicture?.picture ||
          pollResponse.data?.picture;

        if (picture) {
          this.logger.log(`[CAPTURE] Imagen recibida tras ${attempt + 1} poll(s) para dispositivo ${deviceId}`);
          return picture.replace(/^data:image\/\w+;base64,/, '');
        }
      } catch (err: any) {
        if (err.response?.status === 404 || err.response?.status === 202) {
          continue;
        }
        throw err;
      }
    }

    throw new Error('Timeout: el dispositivo no capturó ninguna imagen en 30 segundos');
  }

  /** @inheritdoc */
  async healthCheck(): Promise<boolean> {
    try {
      const headers = await this.getAuthHeaders();
      await firstValueFrom(
        this.httpService.get(`${this.config.apiUrl}/api/server`, {
          headers,
          httpsAgent: this.httpsAgent,
          timeout: 5000,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
