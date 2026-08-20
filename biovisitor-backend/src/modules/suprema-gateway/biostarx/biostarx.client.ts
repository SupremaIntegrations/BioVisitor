/**
 * @file biostarx.client.ts
 * @description Cliente específico para la API de BioStar X.
 *
 * BioStar X utiliza una arquitectura de microservicios diferente a BioStar 2:
 * - Autenticación basada en API keys o OAuth2 (según versión)
 * - Endpoints REST con estructura diferente
 * - Soporte nativo para WebSocket (eventos en tiempo real)
 * - Escalabilidad: hasta 1,000 dispositivos por servidor, 3,000 en distribuido
 *
 * Esta implementación sigue la misma interfaz ISupremaClient que BioStar 2,
 * permitiendo al gateway ser completamente agnóstico.
 *
 * NOTA: Los endpoints exactos de BioStar X pueden variar según la versión.
 * Esta implementación está basada en la documentación API disponible y
 * deberá ajustarse según el servidor de pruebas del cliente.
 *
 * @module modules/suprema-gateway/biostarx
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
 * Configuración para conectar con un servidor BioStar X.
 */
export interface BioStarXConfig {
  /** URL base de la API de BioStar X */
  apiUrl: string;
  /** Credenciales de autenticación */
  adminUser: string;
  adminPassword: string;
  /** Ruta al certificado CA para verificación SSL */
  caCertPath?: string;
  /** ID del tenant para aislamiento */
  tenantId: string;
}

/**
 * Cliente para la API de BioStar X.
 *
 * BioStar X tiene una arquitectura de microservicios, por lo que
 * la autenticación y gestión de sesiones es diferente a BS2.
 * Utiliza un flujo basado en tokens de sesión similar pero con
 * endpoints y estructura de datos propios.
 *
 * @implements ISupremaClient
 */
export class BioStarXClient implements ISupremaClient {
  private readonly logger = new Logger('BioStarXClient');
  private readonly httpsAgent: https.Agent;
  private readonly sessionRedisKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly redis: Redis,
    private readonly config: BioStarXConfig,
  ) {
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: !!config.caCertPath,
      ca:
        config.caCertPath && fs.existsSync(config.caCertPath)
          ? fs.readFileSync(config.caCertPath)
          : undefined,
    });

    this.sessionRedisKey = `bv:bsx:session:${config.tenantId}`;
    this.loginPathRedisKey = `bv:bsx:loginpath:${config.tenantId}`;
  }

  private readonly loginPathRedisKey: string;

  /**
   * Rutas de login candidatas para BioStar X, probadas en orden.
   * BS2 usa /api/login; versiones BSX más nuevas pueden usar /api/v1/login.
   */
  private readonly LOGIN_PATHS = ['/api/login', '/api/v1/login'];

  /**
   * Intenta autenticarse contra las rutas de login candidatas y devuelve
   * {sessionId, loginPath} del primer intento exitoso.
   */
  private async tryLogin(): Promise<{ sessionId: string; loginPath: string }> {
    const body = {
      User: {
        login_id: this.config.adminUser,
        password: this.config.adminPassword,
      },
    };

    // Try the previously discovered working path first (cached in Redis)
    const cachedPath = await this.redis.get(this.loginPathRedisKey);
    const pathsToTry = cachedPath
      ? [cachedPath, ...this.LOGIN_PATHS.filter((p) => p !== cachedPath)]
      : this.LOGIN_PATHS;

    for (const path of pathsToTry) {
      try {
        const response = await firstValueFrom(
          this.httpService.post(
            `${this.config.apiUrl}${path}`,
            body,
            {
              httpsAgent: this.httpsAgent,
              timeout: 15000,
              validateStatus: (s) => s < 500,
            },
          ),
        );

        if (response.status !== 200) {
          this.logger.debug(
            `🔍 Login path ${path} → HTTP ${response.status}, probando siguiente...`,
          );
          continue;
        }

        const sessionId =
          response.headers['bs-session-id'] || response.data?.sessionId;
        if (!sessionId) {
          this.logger.debug(
            `🔍 Login path ${path} → 200 pero sin bs-session-id, probando siguiente...`,
          );
          continue;
        }

        // Cache the working path for 24h so future calls skip discovery
        await this.redis.setex(this.loginPathRedisKey, 86400, path);
        this.logger.log(`✅ Login BioStar X exitoso vía ${path}`);
        return { sessionId, loginPath: path };
      } catch (err: any) {
        this.logger.debug(
          `🔍 Login path ${path} → error: ${err.message}, probando siguiente...`,
        );
      }
    }

    throw new Error(
      `Ninguna ruta de login funcionó para BioStar X (probadas: ${pathsToTry.join(', ')}). ` +
        `Verifica la URL y credenciales.`,
    );
  }

  /**
   * Obtiene o renueva el token de sesión para BioStar X.
   */
  private async getSessionId(): Promise<string> {
    let sessionId = await this.redis.get(this.sessionRedisKey);

    if (sessionId) {
      return sessionId;
    }

    this.logger.log(
      `🔐 Autenticando con BioStar X (Tenant: ${this.config.tenantId})...`,
    );

    try {
      const { sessionId: newSession } = await this.tryLogin();

      // BioStar X tiene un timeout de sesión configurable, usamos 25 min por defecto
      await this.redis.setex(this.sessionRedisKey, 1500, newSession);

      return newSession;
    } catch (error: any) {
      this.logger.error(`❌ Fallo autenticación BioStar X: ${error.message}`);
      throw new Error(`Autenticación BioStar X fallida: ${error.message}`);
    }
  }

  /**
   * Headers de autenticación para BioStar X.
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const sessionId = await this.getSessionId();
    return {
      'bs-session-id': sessionId,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Ejecuta petición con reintento automático en caso de sesión expirada.
   */
  private async executeWithRetry<T>(
    requestFn: (headers: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    try {
      const headers = await this.getAuthHeaders();
      return await requestFn(headers);
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.logger.warn('⚠️ Sesión BioStar X expirada. Re-autenticando...');
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
      // BioStar X puede usar una estructura de usuario diferente a BS2
      // Adaptamos el payload al formato esperado por BSX
      const bsxPayload = {
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
        this.httpService.post(`${this.config.apiUrl}/api/users`, bsxPayload, {
          headers,
          httpsAgent: this.httpsAgent,
        }),
      );

      const supremaRefId = response.data?.User?.user_id || payload.visitorId;
      this.logger.log(
        `✅ Usuario ${payload.fullName} creado en BioStar X (Ref: ${supremaRefId})`,
      );

      return { supremaRefId, success: true };
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
      this.logger.log(`🧹 Usuario ${supremaRefId} eliminado de BioStar X`);
    });
  }

  /** @inheritdoc */
  async enrollFace(supremaRefId: string, photoBase64: string): Promise<void> {
    await this.executeWithRetry(async (headers) => {
      await firstValueFrom(
        this.httpService.post(
          `${this.config.apiUrl}/api/users/${supremaRefId}/photo`,
          { photo: photoBase64 },
          { headers, httpsAgent: this.httpsAgent },
        ),
      );
      this.logger.log(
        `📷 Foto facial enrollada para ${supremaRefId} en BioStar X`,
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
      this.logger.log(`👆 Huella enrollada para ${supremaRefId} en BioStar X`);
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
              rows: [{ card_id: cardId, user_id: { user_id: supremaRefId } }],
            },
          },
          { headers, httpsAgent: this.httpsAgent },
        ),
      );
      this.logger.log(
        `🎴 Tarjeta ${cardId} asignada a ${supremaRefId} en BioStar X`,
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
      this.logger.log(`🚪 Puerta ${doorId} abierta vía BioStar X`);
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
                  operator: 3,
                  values: [fromDate.toISOString(), toDate.toISOString()],
                },
              ],
              orders: [{ column: 'datetime', descending: true }],
            },
          },
          { headers, httpsAgent: this.httpsAgent },
        ),
      );

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
          // dispositivo — no es booleano-comparable con `=== 0`). Verificado
          // empíricamente (evento code 4867 = 0x1303 para una autenticación real
          // concedida de un visitante). BioStar identifica "identificación
          // exitosa / acceso concedido" con event_type_id en la familia
          // 0x1300–0x13FF (mainCode === 0x13). Ver memoria
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
        if (data?.Response?.code === '0' && data?.image_template) {
          this.logger.log(
            '✅ Template facial extraído exitosamente por BioStar X',
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
            'BioStar X no pudo extraer el template facial',
        };
      } catch (error: any) {
        const msg =
          error.response?.data?.Response?.message ||
          error.response?.data?.message ||
          error.message;
        this.logger.warn(`⚠️ Fallo en validación facial BioStar X: ${msg}`);
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
          this.logger.log(`[CAPTURE] BioStar X aceptó captura async (202) — polling para dispositivo ${deviceId}`);
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
      } catch (err: any) {
        if (err.response?.status === 401) {
          throw new Error('Sesión BioStar X expirada durante captura');
        }
        if (err.response?.status === 404 || err.response?.status === 405) {
          continue;
        }
        if (i === endpoints.length - 1) {
          const msg =
            err.response?.data?.Response?.message ||
            err.response?.data?.message ||
            err.message;
          throw new Error(`No se pudo capturar desde el dispositivo: ${msg}`);
        }
      }
    }

    throw new Error('El dispositivo no pudo capturar la imagen.');
  }

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
          return picture.replace(/^data:image\/\w+;base64,/, '');
        }
      } catch (err: any) {
        if (err.response?.status === 404 || err.response?.status === 202) continue;
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
