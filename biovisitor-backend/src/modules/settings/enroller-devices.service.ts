/**
 * @file enroller-devices.service.ts
 * @description Servicio para gestión de dispositivos Suprema como enroladores
 * y listado de dispositivos BioStar disponibles.
 *
 * Responsabilidades:
 * 1. Listar dispositivos del servidor BioStar activo (caché Redis 5min).
 * 2. CRUD de enroladores configurados (almacenados en Redis).
 * 3. Disparar captura de foto facial desde un dispositivo BioStar.
 *
 * @module modules/settings
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { firstValueFrom } from 'rxjs';
import * as https from 'https';
import * as fs from 'fs';
import Redis from 'ioredis';

import { SupremaApiConnection } from '../../database/entities/suprema-api-connection.entity';
import { EncryptionService } from '../../core/crypto/encryption.service';
import { StructuredLoggerService } from '../../core/logging/structured-logger.service';

export interface BioStarDevice {
  id: string;
  name: string;
  typeName: string;
  ipAddress: string;
  status: 'connected' | 'disconnected' | 'unknown';
  faceSupported: boolean;
  fingerprintSupported: boolean;
  cardSupported: boolean;
}

export interface EnrollerDevice {
  deviceId: string;
  deviceName: string;
  typeName: string;
  type: 'face' | 'fingerprint' | 'card';
  addedAt: string;
}

export interface ExitDevice {
  deviceId: string;
  deviceName: string;
  typeName: string;
  addedAt: string;
}

const DEVICES_CACHE_KEY = (tenantId: string) => `bv:devices:${tenantId}`;
const ENROLLERS_KEY = (tenantId: string) => `enrollers:${tenantId}`;
const EXIT_DEVICES_KEY = (tenantId: string) => `exitdevices:${tenantId}`;
const EXIT_DELAY_KEY = (tenantId: string) => `exitdelay:${tenantId}`;
const DEVICES_TTL = 300;
const DEFAULT_EXIT_DELAY_SECONDS = 0;
const MAX_EXIT_DELAY_SECONDS = 3600;


@Injectable()
export class EnrollerDevicesService {
  private readonly logger = new Logger(EnrollerDevicesService.name);

  constructor(
    @InjectRepository(SupremaApiConnection)
    private readonly connRepo: Repository<SupremaApiConnection>,
    private readonly encryptionService: EncryptionService,
    private readonly httpService: HttpService,
    private readonly structuredLogger: StructuredLoggerService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * Obtiene la primera conexión BioStar activa para el tenant.
   */
  private async getActiveConnection(
    tenantId: string,
  ): Promise<SupremaApiConnection> {
    const connections = await this.connRepo.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    const tenantConn = connections.find((c) => c.tenantId === tenantId);
    const globalConn = connections.find((c) => c.tenantId === null);
    const conn = tenantConn || globalConn;

    if (!conn) {
      throw new NotFoundException(
        'No hay una conexión BioStar activa configurada',
      );
    }
    return conn;
  }

  /**
   * Obtiene el agente HTTPS para una conexión.
   */
  private buildHttpsAgent(conn: SupremaApiConnection): https.Agent {
    return new https.Agent({
      rejectUnauthorized: !!conn.caCertPath,
      ca:
        conn.caCertPath && fs.existsSync(conn.caCertPath)
          ? fs.readFileSync(conn.caCertPath)
          : undefined,
    });
  }

  /**
   * Autentica con BioStar y retorna el sessionId.
   * Usa caché Redis de 25min.
   */
  private async getSession(
    conn: SupremaApiConnection,
    httpsAgent: https.Agent,
  ): Promise<string> {
    const sessionKey = `bv:bsession:conn:${conn.id}`;
    const cached = await this.redis.get(sessionKey);
    if (cached) return cached;

    const loginId = this.encryptionService.decrypt(conn.loginIdEncrypted);
    const password = this.encryptionService.decrypt(conn.passwordEncrypted);

    const response = await firstValueFrom(
      this.httpService.post(
        `${conn.apiUrl}/api/login`,
        { User: { login_id: loginId, password } },
        { httpsAgent },
      ),
    );

    const sessionId =
      response.headers['bs-session-id'] || response.data?.sessionId;
    if (!sessionId) {
      throw new ServiceUnavailableException(
        'BioStar no devolvió token de sesión',
      );
    }

    await this.redis.setex(sessionKey, 1500, sessionId);
    return sessionId;
  }

  /**
   * Invalida la sesión cacheada de una conexión.
   */
  private async invalidateSession(connId: string): Promise<void> {
    await this.redis.del(`bv:bsession:conn:${connId}`);
  }

  /**
   * Lista dispositivos BioStar disponibles, con caché Redis de 5 min.
   */
  async listDevices(tenantId: string): Promise<BioStarDevice[]> {
    const cacheKey = DEVICES_CACHE_KEY(tenantId);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Dispositivos desde caché para tenant ${tenantId}`);
      return JSON.parse(cached);
    }

    const conn = await this.getActiveConnection(tenantId);
    const httpsAgent = this.buildHttpsAgent(conn);

    let sessionId: string;
    try {
      sessionId = await this.getSession(conn, httpsAgent);
    } catch (err: any) {
      this.logger.warn(`No se pudo autenticar con BioStar: ${err.message}`);
      throw new ServiceUnavailableException(
        `No se pudo conectar con BioStar: ${err.message}`,
      );
    }

    const headers = {
      'bs-session-id': sessionId,
      'Content-Type': 'application/json',
    };

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${conn.apiUrl}/api/devices`, {
          headers,
          httpsAgent,
        }),
      );

      const rows: any[] =
        response.data?.DeviceCollection?.rows ||
        response.data?.rows ||
        [];

      const devices: BioStarDevice[] = rows.map((d: any) => {
        const typeName: string =
          d.type_id?.name || d.type?.name || d.device_type || 'Desconocido';

        const statusFlags = d.status_flags || d.status || {};
        let status: BioStarDevice['status'] = 'unknown';
        if (typeof statusFlags === 'object') {
          const connected =
            statusFlags.connected === true ||
            statusFlags.connected === 'true' ||
            statusFlags === 'connected';
          status = connected ? 'connected' : 'disconnected';
        }

        // Usar mapa preciso por nombre de tipo.
        // Si type_id.name no está disponible (BioStar lo omite en algunos builds),
        // usar el nombre del dispositivo como fuente de tipo: el nombre comienza
        // con el modelo (ej. "BioStation 3 538155116 (192.168.10.10)" → "biostation 3").
        const deviceNameForType = d.name || '';
        const typeSource =
          typeName !== 'Desconocido' && typeName ? typeName : deviceNameForType;
        const caps = this.getCapFromTypeName(typeSource);

        return {
          id: String(d.id),
          name: d.name || `Dispositivo ${d.id}`,
          typeName,
          ipAddress: d.ip_addr || d.ip_address || '',
          status,
          faceSupported: caps.face,
          fingerprintSupported: caps.fingerprint,
          cardSupported: caps.card,
        };
      });

      await this.redis.setex(cacheKey, DEVICES_TTL, JSON.stringify(devices));
      this.logger.log(
        `📡 ${devices.length} dispositivos listados para tenant ${tenantId}`,
      );
      return devices;
    } catch (err: any) {
      if (err.response?.status === 401) {
        await this.invalidateSession(conn.id);
      }
      this.logger.error(`Error listando dispositivos: ${err.message}`);
      throw new ServiceUnavailableException(
        'No se pudieron obtener los dispositivos de BioStar',
      );
    }
  }

  /**
   * Consulta las capacidades de un dispositivo BioStar vía el endpoint
   * `POST /api/devices/capability`.
   *
   * Body enviado a BioStar:
   *   { "DeviceCollection": { "rows": [{ "id": "<deviceId>" }] } }
   *
   * Resultado normalizado: { face, fingerprint, card, qr, deviceId, deviceName }
   * Caché Redis: `bv:devcap:{tenantId}:{deviceId}` con TTL de 10 min.
   */
  /**
   * Mapa preciso de capacidades por nombre de modelo Suprema.
   * Clave: prefijo del nombre de tipo en minúsculas (más específico primero).
   * BioStar devuelve el tipo exacto en type_id.name (ej. "BioStation 3", "FaceStation F2").
   */
  private static readonly DEVICE_CAP_MAP: Array<{
    prefix: string;
    face: boolean;
    fingerprint: boolean;
    card: boolean;
  }> = [
    // FaceStation — cara sí, huella no, tarjeta sí (lector RFID integrado)
    { prefix: 'facestation f2', face: true,  fingerprint: false, card: true  },
    { prefix: 'facestation 2', face: true,  fingerprint: false, card: true  },
    { prefix: 'facestation',   face: true,  fingerprint: false, card: true  },
    // XStation con cara
    { prefix: 'xstation 2 qd', face: true,  fingerprint: false, card: true  },
    { prefix: 'xstation 2',    face: true,  fingerprint: true,  card: true  },
    { prefix: 'xstation',      face: true,  fingerprint: true,  card: true  },
    // BioStation 3 — cara sí, huella NO, tarjeta sí (incluye variante CR)
    { prefix: 'biostation 3',  face: true,  fingerprint: false, card: true  },
    // BioStation L/A/2 — huella sí, cara no, tarjeta sí
    { prefix: 'biostation l2', face: false, fingerprint: true,  card: true  },
    { prefix: 'biostation a2', face: false, fingerprint: true,  card: true  },
    { prefix: 'biostation 2',  face: false, fingerprint: true,  card: true  },
    // catch-all BioStation (modelos antiguos) — huella sí, tarjeta sí
    { prefix: 'biostation',    face: false, fingerprint: true,  card: true  },
    // BioLite — lector multimodal con tarjeta
    { prefix: 'biolite n2',    face: false, fingerprint: true,  card: true  },
    { prefix: 'biolite',       face: false, fingerprint: true,  card: true  },
    // BioEntry — lector de tarjeta/huella dedicado
    { prefix: 'bioentry',      face: false, fingerprint: true,  card: true  },
    // BioMini — scanner USB externo de huella, SIN lector de tarjeta
    { prefix: 'biomini',       face: false, fingerprint: true,  card: false },
    // CoreStation — controlador con interfaces de tarjeta
    { prefix: 'corestation',   face: false, fingerprint: true,  card: true  },
    // BioSlim — lector de tarjeta/huella
    { prefix: 'bioslim',       face: false, fingerprint: true,  card: true  },
    // Wiegand Reader — lector de tarjeta Wiegand puro
    { prefix: 'wiegand',       face: false, fingerprint: false, card: true  },
    // XPass — lector de tarjeta RFID/QR compacto (sin cara, sin huella)
    { prefix: 'xpass q2',      face: false, fingerprint: false, card: true  },
    { prefix: 'xpass',         face: false, fingerprint: false, card: true  },
  ];

  /** Devuelve las capacidades biométricas para un nombre de tipo de dispositivo. */
  private getCapFromTypeName(typeName: string): {
    face: boolean;
    fingerprint: boolean;
    card: boolean;
  } {
    // Normalizar: minúsculas, colapsar guiones y espacios múltiples
    // ("X-Station 2" → "xstation 2", "Bio-Station L2" → "biostation l2")
    const normalized = typeName.trim().toLowerCase().replace(/-/g, '').replace(/\s+/g, ' ');
    for (const entry of EnrollerDevicesService.DEVICE_CAP_MAP) {
      if (normalized.startsWith(entry.prefix)) {
        return { face: entry.face, fingerprint: entry.fingerprint, card: entry.card };
      }
    }
    // Desconocido — conservador: asume tarjeta sí, biometría no
    return { face: false, fingerprint: false, card: true };
  }

  /**
   * Búsqueda recursiva de un campo (insensible a mayúsculas) en cualquier
   * nivel del objeto. Solo acepta valores boolean/number/string-bool como resultado.
   */
  private deepFindBool(
    obj: any,
    keys: string[],
    depth = 0,
  ): boolean | undefined {
    if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
    for (const k of Object.keys(obj)) {
      if (keys.includes(k.toLowerCase())) {
        const v = obj[k];
        if (
          typeof v === 'boolean' ||
          v === 1 || v === 0 ||
          v === '1' || v === '0' ||
          v === 'true' || v === 'false'
        ) {
          return v === true || v === 1 || v === '1' || v === 'true';
        }
      }
    }
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'object' && obj[k] !== null) {
        const found = this.deepFindBool(obj[k], keys, depth + 1);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  async getDeviceCapabilities(
    tenantId: string,
    deviceId: string,
  ): Promise<{
    deviceId: string;
    deviceName: string;
    face: boolean;
    fingerprint: boolean;
    card: boolean;
    qr: boolean;
  }> {
    const cacheKey = `bv:devcap:${tenantId}:${deviceId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`[CAPABILITY] Cache hit para dispositivo ${deviceId}`);
      return JSON.parse(cached);
    }

    const conn = await this.getActiveConnection(tenantId);
    const httpsAgent = this.buildHttpsAgent(conn);

    let sessionId: string;
    try {
      sessionId = await this.getSession(conn, httpsAgent);
    } catch (err: any) {
      throw new ServiceUnavailableException(
        `No se pudo conectar con BioStar: ${err.message}`,
      );
    }

    const headers = {
      'bs-session-id': sessionId,
      'Content-Type': 'application/json',
    };

    this.logger.log(
      `🔍 Consultando capacidades del dispositivo ${deviceId} via GET /api/devices/${deviceId}`,
    );

    let deviceName = `Dispositivo ${deviceId}`;
    let face = false;
    let fingerprint = false;
    let card = true;
    let qr = false;
    let resolvedFromApi = false;

    // ─── Estrategia 1: GET /api/devices/{id} ────────────────────────────────
    // Endpoint de dispositivo individual — devuelve el objeto completo con
    // todos los campos (type_id, name, face_operand, fingerprint_operand, etc.)
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${conn.apiUrl}/api/devices/${deviceId}`,
          { headers, httpsAgent, timeout: 10000 },
        ),
      );
      const rawData = response.data;
      this.logger.warn(
        `[DEVICE_RAW] ${deviceId}: ${JSON.stringify(rawData).substring(0, 3000)}`,
      );

      // BioStar puede envolver el objeto en DeviceInfo, Device, o la raíz
      const deviceData =
        rawData?.DeviceInfo ||
        rawData?.Device ||
        rawData?.DeviceCollection?.rows?.[0] ||
        rawData || {};

      // Extraer nombre
      const rawName = deviceData.name || deviceData.Name || '';
      if (rawName) deviceName = rawName;

      // Extraer tipo para el mapa de fallback
      const typeName: string =
        deviceData.type_id?.name ||
        deviceData.type?.name ||
        deviceData.device_type ||
        '';

      // Buscar flags de capacidad en el objeto completo (deepFindBool)
      const faceRaw = this.deepFindBool(deviceData, [
        'face', 'face_operand', 'visual_face', 'face_ex', 'face_detection',
      ]);
      const fingerRaw = this.deepFindBool(deviceData, [
        'finger', 'fingerprint', 'fingerprint_operand', 'finger_print',
      ]);
      const cardRaw = this.deepFindBool(deviceData, [
        'card', 'card_operand', 'wiegand_card', 'csn_card', 'card_detection',
      ]);
      const qrRaw = this.deepFindBool(deviceData, [
        'qr', 'qr_operand', 'barcode', 'mobile_id',
      ]);

      this.logger.warn(
        `[CAPABILITY_FIELDS] ${deviceId} type="${typeName}": ` +
        `face=${faceRaw} finger=${fingerRaw} card=${cardRaw} qr=${qrRaw}`,
      );

      if (faceRaw !== undefined || fingerRaw !== undefined) {
        // La API devolvió campos explícitos — usarlos directamente
        face = faceRaw ?? false;
        fingerprint = fingerRaw ?? false;
        card = cardRaw ?? true;
        qr = qrRaw ?? false;
        resolvedFromApi = true;
        this.logger.log(
          `✅ [CAPABILITY] ${deviceId} resuelto por API: face=${face} finger=${fingerprint}`,
        );
      } else {
        // La API no devolvió campos explícitos.
        // Intentar mapa por typeName; si es "Desconocido"/vacío usar deviceName
        // (el nombre del dispositivo comienza con el modelo, ej. "BioStation 3 538155116 (192.168.10.10)")
        const typeSource =
          typeName && typeName !== 'Desconocido' ? typeName : deviceName;
        if (typeSource && typeSource !== `Dispositivo ${deviceId}`) {
          const caps = this.getCapFromTypeName(typeSource);
          face = caps.face;
          fingerprint = caps.fingerprint;
          card = cardRaw ?? true;
          qr = qrRaw ?? false;
          resolvedFromApi = true;
          this.logger.log(
            `✅ [CAPABILITY] ${deviceId} resuelto por nombre "${typeSource}": face=${face} finger=${fingerprint}`,
          );
        }
      }
    } catch (err: any) {
      if (err.response?.status === 401) await this.invalidateSession(conn.id);
      this.logger.warn(
        `[CAPABILITY] GET /api/devices/${deviceId} falló: ${err.message}`,
      );
    }

    // ─── Estrategia 2: POST /api/devices/capability (sin filtro) ────────────
    // Algunos servidores BioStar devuelven capacidades de TODOS los dispositivos
    // cuando se llama sin body o con body vacío.
    if (!resolvedFromApi) {
      try {
        const response = await firstValueFrom(
          this.httpService.post(
            `${conn.apiUrl}/api/devices/capability`,
            {},
            { headers, httpsAgent, timeout: 10000 },
          ),
        );
        const rawData = response.data;
        this.logger.warn(
          `[CAPABILITY_ALL_RAW] ${JSON.stringify(rawData).substring(0, 2000)}`,
        );

        // Buscar la fila correspondiente al deviceId
        const rows: any[] =
          rawData?.DeviceCapabilityCollection?.rows ||
          rawData?.DeviceCapability?.rows ||
          rawData?.rows ||
          (Array.isArray(rawData) ? rawData : []);

        const row = rows.find((r: any) => {
          const rowId =
            String(r.device_id?.id ?? r.device_id ?? r.id ?? '');
          return rowId === String(deviceId);
        });

        if (row) {
          const typeName =
            row.device_id?.name || row.name || row.Name || '';
          if (typeName && (!deviceName || deviceName === `Dispositivo ${deviceId}`)) {
            deviceName = typeName;
          }

          const faceRaw = this.deepFindBool(row, ['face', 'face_operand', 'visual_face']);
          const fingerRaw = this.deepFindBool(row, ['finger', 'fingerprint', 'fingerprint_operand']);
          const cardRaw = this.deepFindBool(row, ['card', 'card_operand']);
          const qrRaw = this.deepFindBool(row, ['qr', 'qr_operand', 'barcode']);

          if (faceRaw !== undefined || fingerRaw !== undefined) {
            face = faceRaw ?? false;
            fingerprint = fingerRaw ?? false;
            card = cardRaw ?? true;
            qr = qrRaw ?? false;
            resolvedFromApi = true;
            this.logger.log(
              `✅ [CAPABILITY] ${deviceId} resuelto por capability endpoint: face=${face} finger=${fingerprint}`,
            );
          }
        }
      } catch (err: any) {
        if (err.response?.status === 401) await this.invalidateSession(conn.id);
        this.logger.warn(
          `[CAPABILITY] POST /api/devices/capability falló: ${err.message}`,
        );
      }
    }

    // ─── Estrategia 3: Mapa por tipo desde listDevices ───────────────────────
    if (!resolvedFromApi) {
      try {
        const devices = await this.listDevices(tenantId);
        const found = devices.find((d) => d.id === String(deviceId));
        if (found) {
          if (!deviceName || deviceName === `Dispositivo ${deviceId}`) {
            deviceName = found.name;
          }
          // Usar mapa por tipo; si type es "Desconocido"/vacío usar el nombre del dispositivo
          // (el nombre comienza con el modelo, ej. "BioStation 3 538155116 (192.168.10.10)")
          const rawTypeName = found.typeName || '';
          const typeSource =
            rawTypeName && rawTypeName !== 'Desconocido'
              ? rawTypeName
              : (found.name || '');
          const caps = this.getCapFromTypeName(typeSource);
          face = caps.face;
          fingerprint = caps.fingerprint;
          this.logger.log(
            `✅ [CAPABILITY] ${deviceId} resuelto por listDevices fuente="${typeSource}": face=${face} finger=${fingerprint}`,
          );
        }
      } catch (err: any) {
        this.logger.warn(
          `[CAPABILITY] listDevices falló: ${err.message}`,
        );
      }
    }

    if (!deviceName || deviceName === `Dispositivo ${deviceId}`) {
      // Último recurso: enriquecer nombre desde listDevices
      try {
        const devices = await this.listDevices(tenantId);
        const found = devices.find((d) => d.id === String(deviceId));
        if (found?.name) deviceName = found.name;
      } catch { /* ignorar */ }
    }

    const result = {
      deviceId: String(deviceId),
      deviceName,
      face,
      fingerprint,
      card,
      qr,
    };

    await this.redis.setex(cacheKey, 600, JSON.stringify(result));
    this.logger.log(
      `📋 [CAPABILITY] ${deviceId} final: face=${face} finger=${fingerprint} card=${card} qr=${qr} name="${deviceName}"`,
    );
    return result;
  }

  /**
   * Obtiene los enroladores configurados para el tenant.
   */
  async getEnrollers(
    tenantId: string,
    type?: string,
  ): Promise<EnrollerDevice[]> {
    const raw = await this.redis.get(ENROLLERS_KEY(tenantId));
    const all: EnrollerDevice[] = raw ? JSON.parse(raw) : [];
    if (type) return all.filter((e) => e.type === type);
    return all;
  }

  /**
   * Agrega un dispositivo como enrolador.
   */
  async addEnroller(
    tenantId: string,
    deviceId: string,
    type: 'face' | 'fingerprint' | 'card',
  ): Promise<EnrollerDevice[]> {
    const raw = await this.redis.get(ENROLLERS_KEY(tenantId));
    const all: EnrollerDevice[] = raw ? JSON.parse(raw) : [];

    if (all.find((e) => e.deviceId === deviceId && e.type === type)) {
      throw new BadRequestException(
        `El dispositivo ${deviceId} ya está registrado como enrolador de tipo ${type}`,
      );
    }

    let deviceName = `Dispositivo ${deviceId}`;
    let typeName = 'Desconocido';

    try {
      const devices = await this.listDevices(tenantId);
      const found = devices.find((d) => d.id === deviceId);
      if (found) {
        deviceName = found.name;
        typeName = found.typeName;
        if (type === 'face' && !found.faceSupported) {
          throw new BadRequestException(
            `El dispositivo "${found.name}" no soporta captura facial`,
          );
        }
        if (type === 'fingerprint' && !found.fingerprintSupported) {
          throw new BadRequestException(
            `El dispositivo "${found.name}" no soporta captura de huella dactilar`,
          );
        }
        if (type === 'card' && !found.cardSupported) {
          throw new BadRequestException(
            `El dispositivo "${found.name}" no soporta lectura de tarjeta`,
          );
        }
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(
        `No se pudo verificar dispositivo en BioStar: ${err.message}`,
      );
    }

    const newEnroller: EnrollerDevice = {
      deviceId,
      deviceName,
      typeName,
      type,
      addedAt: new Date().toISOString(),
    };

    all.push(newEnroller);
    await this.redis.set(ENROLLERS_KEY(tenantId), JSON.stringify(all));

    this.structuredLogger.logAuditEvent(
      'settings.enroller.added',
      'system',
      { deviceId, deviceName, type },
      tenantId,
    );

    this.logger.log(
      `✅ Enrolador agregado: ${deviceName} (${type}) para tenant ${tenantId}`,
    );
    return all;
  }

  /**
   * Elimina un enrolador por deviceId y tipo.
   */
  async removeEnroller(
    tenantId: string,
    deviceId: string,
    type?: string,
  ): Promise<EnrollerDevice[]> {
    const raw = await this.redis.get(ENROLLERS_KEY(tenantId));
    const all: EnrollerDevice[] = raw ? JSON.parse(raw) : [];

    const filtered = type
      ? all.filter((e) => !(e.deviceId === deviceId && e.type === type))
      : all.filter((e) => e.deviceId !== deviceId);

    await this.redis.set(ENROLLERS_KEY(tenantId), JSON.stringify(filtered));

    this.structuredLogger.logAuditEvent(
      'settings.enroller.removed',
      'system',
      { deviceId, type },
      tenantId,
    );

    this.logger.log(
      `🧹 Enrolador ${deviceId} removido para tenant ${tenantId}`,
    );
    return filtered;
  }

  // ── Dispositivos de Salida (Exit Devices) ────────────────────────────────────

  /**
   * Obtiene los dispositivos configurados como "de salida" para el tenant.
   * Cuando BioStar reporta un ACCESS_GRANTED en uno de estos dispositivos,
   * BioVisitor lo interpreta como la "última salida" del visitante y
   * dispara el checkout automático de la visita.
   */
  async getExitDevices(tenantId: string): Promise<ExitDevice[]> {
    const raw = await this.redis.get(EXIT_DEVICES_KEY(tenantId));
    return raw ? JSON.parse(raw) : [];
  }

  /**
   * Determina si un dispositivo (por su deviceId de BioStar) está marcado
   * como dispositivo de salida para el tenant. Usado por BiostarWsService.
   */
  async isExitDevice(tenantId: string, deviceId: string): Promise<boolean> {
    const devices = await this.getExitDevices(tenantId);
    return devices.some((d) => d.deviceId === String(deviceId));
  }

  /**
   * Consulta los eventos de acceso recientes de un dispositivo vía API REST
   * (`POST /api/events/search`), como alternativa/complemento al push por
   * WebSocket (`/wsapi`). Se usa porque el WS de BioStar puede no entregar
   * eventos cuando el backend está fuera de la LAN (ver `bv:monitoring` LAN
   * restriction) — a diferencia de `/api/monitoring/*`, este endpoint de
   * consulta histórica de eventos (el mismo usado por `getEvents()` en
   * biostar2.client.ts / biostarx.client.ts) SÍ funciona remotamente.
   * Nota: `GET /api/events?device_id=...` no existe en BioStar (devuelve 400);
   * el endpoint real de consulta es siempre `POST /api/events/search`.
   */
  async getRecentAccessEvents(
    tenantId: string,
    deviceId: string,
    limit = 10,
  ): Promise<
    Array<{
      eventId: string;
      supremaUserId: string;
      eventTypeCode: string;
      datetime: string;
      isGranted: boolean;
    }>
  > {
    let conn: SupremaApiConnection;
    try {
      conn = await this.getActiveConnection(tenantId);
    } catch {
      return [];
    }

    const httpsAgent = this.buildHttpsAgent(conn);

    let sessionId: string;
    try {
      sessionId = await this.getSession(conn, httpsAgent);
    } catch {
      return [];
    }

    const headers = {
      'bs-session-id': sessionId,
      'Content-Type': 'application/json',
    };

    // Ventana de búsqueda: últimos 5 minutos.
    const fromDate = new Date(Date.now() - 5 * 60 * 1000);
    const toDate = new Date();

    try {
      // IMPORTANTE: BioStar espera UNA sola condición "datetime" con AMBOS
      // límites (inicio y fin) en el mismo arreglo `values` (operator 3 = rango
      // "between"), NO dos condiciones separadas con operator 3 y 5. Ver
      // especificación original del proyecto. Con dos condiciones separadas
      // el endpoint respondía 200 pero con 0 resultados siempre.
      //
      // NOTA sobre `datetime` vs `server_datetime`: se comprobó (log de
      // diagnóstico) que `datetime` SÍ está en UTC real y coincide con la
      // hora actual (ej. evento a las 15:31:35Z detectado a las 15:35Z, ~4
      // min de diferencia — consistente). `server_datetime`, en cambio,
      // viene con un desfase de ~5h (reloj local de Colombia sin convertir,
      // mal etiquetado con sufijo "Z"), por lo que NO debe usarse para
      // filtrar ni comparar contra `fromDate`/`toDate` (que sí son UTC real).
      // Por eso se filtra y ordena por `datetime`, no por `server_datetime`.
      const response = await firstValueFrom(
        this.httpService.post(
          `${conn.apiUrl}/api/events/search`,
          {
            Query: {
              limit: Math.max(limit, 50),
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
          { headers, httpsAgent, timeout: 8000 },
        ),
      );

      const allRows: any[] = response.data?.EventCollection?.rows || [];

      const rows: any[] = allRows.filter((r) => {
        const rowDeviceId =
          r.device_id?.id?.toString() || r.device_id?.toString() || '';
        return rowDeviceId === String(deviceId);
      });

      this.logger.debug(
        `[EXIT_POLL] POST /api/events/search (device ${deviceId}) → ${rows.length} evento(s) de ${allRows.length} totales`,
      );

      return rows.map((row) => {
        const eventTypeCode =
          row.event_type_id?.code?.toString() ||
          row.event_type?.toString() ||
          '';
        const eventTypeCodeNum = Number(eventTypeCode);
        return {
          eventId:
            row.id?.toString() ||
            `${row.datetime}-${row.user_id?.user_id || row.user_id}`,
          supremaUserId: row.user_id?.user_id || row.user_id || '',
          eventTypeCode,
          datetime: row.datetime,
          // El campo `is_dst` NO indica "acceso concedido/denegado" (viene como
          // string "0" en TODOS los eventos, incluyendo eventos de sistema del
          // dispositivo — no es booleano-comparable con `=== 0`). Verificado
          // empíricamente con datos reales de BioStar: para una autenticación
          // real y concedida de un visitante en el FaceStation F2, el evento
          // vino con code 4867 (0x1303) y `is_dst: "0"` — mismo valor que
          // eventos de sistema del dispositivo sin usuario real asociado.
          //
          // BioStar identifica "acceso concedido" con event_type_id en DOS
          // familias distintas según el modo de autenticación:
          //  - 0x1300–0x13FF (mainCode 0x13): IDENTIFY_SUCCESS (1:N, ej. rostro
          //    en FaceStation F2 sin ID previo). Confirmado con code 4867 (0x1303).
          //  - 0x1000–0x10FF (mainCode 0x10): VERIFY_SUCCESS (1:1, ej. tarjeta
          //    RFID/QR que ya trae el ID y solo se verifica). Confirmado con
          //    code 4102 (0x1006) en 3 pasadas reales de tarjeta en BioStation 3.
          // Sin el rango 0x10, los checkouts automáticos por tarjeta en el
          // dispositivo de salida nunca se detectan. Ver memoria
          // `biostar-events-search-schema.md`.
          isGranted:
            Number.isFinite(eventTypeCodeNum) &&
            (Math.floor(eventTypeCodeNum / 256) === 0x13 ||
              Math.floor(eventTypeCodeNum / 256) === 0x10),
        };
      });
    } catch (err: any) {
      this.logger.warn(
        `[EXIT_POLL] Falló POST /api/events/search (device ${deviceId}): ${err?.response?.status || ''} ${err?.message}`,
      );
      if (err?.response?.status === 401) {
        await this.invalidateSession(conn.id).catch(() => null);
      }
      return [];
    }
  }

  /**
   * Marca un dispositivo BioStar como "dispositivo de salida".
   */
  async addExitDevice(tenantId: string, deviceId: string): Promise<ExitDevice[]> {
    const all = await this.getExitDevices(tenantId);

    if (all.find((d) => d.deviceId === deviceId)) {
      throw new BadRequestException(
        `El dispositivo ${deviceId} ya está marcado como dispositivo de salida`,
      );
    }

    let deviceName = `Dispositivo ${deviceId}`;
    let typeName = 'Desconocido';

    try {
      const devices = await this.listDevices(tenantId);
      const found = devices.find((d) => d.id === deviceId);
      if (found) {
        deviceName = found.name;
        typeName = found.typeName;
      }
    } catch (err: any) {
      this.logger.warn(
        `No se pudo verificar dispositivo en BioStar: ${err.message}`,
      );
    }

    const newExitDevice: ExitDevice = {
      deviceId,
      deviceName,
      typeName,
      addedAt: new Date().toISOString(),
    };

    all.push(newExitDevice);
    await this.redis.set(EXIT_DEVICES_KEY(tenantId), JSON.stringify(all));

    this.structuredLogger.logAuditEvent(
      'settings.exit_device.added',
      'system',
      { deviceId, deviceName },
      tenantId,
    );

    this.logger.log(
      `🚪 Dispositivo de salida agregado: ${deviceName} (${deviceId}) para tenant ${tenantId}`,
    );
    return all;
  }

  /**
   * Elimina un dispositivo de la lista de "dispositivos de salida".
   */
  async removeExitDevice(tenantId: string, deviceId: string): Promise<ExitDevice[]> {
    const all = await this.getExitDevices(tenantId);
    const filtered = all.filter((d) => d.deviceId !== deviceId);
    await this.redis.set(EXIT_DEVICES_KEY(tenantId), JSON.stringify(filtered));

    this.structuredLogger.logAuditEvent(
      'settings.exit_device.removed',
      'system',
      { deviceId },
      tenantId,
    );

    this.logger.log(
      `🧹 Dispositivo de salida ${deviceId} removido para tenant ${tenantId}`,
    );
    return filtered;
  }

  /**
   * Obtiene el retraso (en segundos) que debe esperarse tras detectar un
   * evento de autenticación en un dispositivo de salida antes de aplicar el
   * checkout automático de la visita. Por defecto 0 (inmediato).
   */
  async getExitCheckoutDelaySeconds(tenantId: string): Promise<number> {
    const raw = await this.redis.get(EXIT_DELAY_KEY(tenantId));
    if (raw === null || raw === undefined) return DEFAULT_EXIT_DELAY_SECONDS;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_EXIT_DELAY_SECONDS;
  }

  /**
   * Configura el retraso (en segundos) del checkout automático por
   * dispositivo de salida. Solo ADMIN.
   */
  async setExitCheckoutDelaySeconds(tenantId: string, seconds: number): Promise<number> {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_EXIT_DELAY_SECONDS) {
      throw new BadRequestException(
        `El retraso debe ser un número entre 0 y ${MAX_EXIT_DELAY_SECONDS} segundos`,
      );
    }
    const normalized = Math.round(seconds);
    await this.redis.set(EXIT_DELAY_KEY(tenantId), String(normalized));

    this.structuredLogger.logAuditEvent(
      'settings.exit_device.delay_updated',
      'system',
      { delaySeconds: normalized },
      tenantId,
    );

    this.logger.log(
      `⏱️ Retraso de checkout por dispositivo de salida configurado a ${normalized}s para tenant ${tenantId}`,
    );
    return normalized;
  }

  /**
   * Dispara la captura de foto facial desde un dispositivo BioStar.
   * Retorna la imagen en base64 (sin data URI prefix).
   *
   * BioStar 2: POST /api/devices/{id}/monitoring/scan_picture
   * BioStar X: mismo endpoint (misma arquitectura REST)
   */
  async captureFaceFromDevice(
    tenantId: string,
    deviceId: string,
  ): Promise<{ imageBase64: string; quality?: number }> {
    const conn = await this.getActiveConnection(tenantId);
    const httpsAgent = this.buildHttpsAgent(conn);

    let sessionId: string;
    try {
      sessionId = await this.getSession(conn, httpsAgent);
    } catch (err: any) {
      throw new ServiceUnavailableException(
        `No se pudo conectar con BioStar: ${err.message}`,
      );
    }

    const headers = {
      'bs-session-id': sessionId,
      'Content-Type': 'application/json',
    };

    this.logger.log(
      `📷 Iniciando captura facial en dispositivo ${deviceId} (${conn.apiUrl})`,
    );

    const endpointVariants: Array<{ url: string; body: Record<string, unknown> }> = [
      {
        url: `${conn.apiUrl}/api/devices/${deviceId}/monitoring/scan_picture`,
        body: { timeout: 30 },
      },
      {
        url: `${conn.apiUrl}/api/monitoring/scan_picture`,
        body: { MonitoringScanPicture: { device_id: { id: String(deviceId) }, timeout: 30 } },
      },
      {
        url: `${conn.apiUrl}/api/monitoring/scan_picture`,
        body: { device_id: String(deviceId), timeout: 30 },
      },
      {
        url: `${conn.apiUrl}/api/devices/${deviceId}/scan_picture`,
        body: { timeout: 30 },
      },
    ];

    for (let i = 0; i < endpointVariants.length; i++) {
      const { url: endpoint, body } = endpointVariants[i];
      try {

        const response = await firstValueFrom(
          this.httpService.post(endpoint, body, {
            headers,
            httpsAgent,
            timeout: 35000,
          }),
        );

        if (response.status === 202) {
          this.logger.log(
            `[CAPTURE] BioStar aceptó captura async (202) — polling para dispositivo ${deviceId}`,
          );
          const picture = await this.pollScanPicture(
            conn.apiUrl,
            deviceId,
            headers,
            httpsAgent,
          );
          const cleanBase64 = picture.replace(/^data:image\/\w+;base64,/, '');
          this.structuredLogger.logAuditEvent(
            'device.face_captured',
            'system',
            { deviceId, method: 'poll' },
            tenantId,
          );
          return { imageBase64: cleanBase64 };
        }

        const data = response.data;
        const picture =
          data?.DeviceScanPicture?.picture ||
          data?.MonitoringScanPicture?.picture ||
          data?.picture ||
          data?.image;

        const quality =
          data?.DeviceScanPicture?.quality ||
          data?.MonitoringScanPicture?.quality;

        if (!picture) {
          this.logger.warn(
            `Respuesta sin imagen de ${endpoint}: ${JSON.stringify(data)}`,
          );
          continue;
        }

        const cleanBase64 = picture.replace(/^data:image\/\w+;base64,/, '');

        this.logger.log(
          `✅ Foto capturada desde dispositivo ${deviceId} (calidad: ${quality ?? 'N/A'})`,
        );

        this.structuredLogger.logAuditEvent(
          'device.face_captured',
          'system',
          { deviceId, quality },
          tenantId,
        );

        return { imageBase64: cleanBase64, quality };
      } catch (err: any) {
        const status = err.response?.status;
        const respBody = err.response?.data;
        const respMsg =
          respBody?.Response?.message ||
          respBody?.message ||
          respBody?.error ||
          err.message;

        this.logger.warn(
          `[CAPTURE] Intento ${i + 1}/${endpointVariants.length} — ${endpoint} → HTTP ${status ?? 'N/A'} "${respMsg}" body:${JSON.stringify(respBody)}`,
        );

        if (status === 401) {
          await this.invalidateSession(conn.id);
          throw new ServiceUnavailableException('Sesión BioStar expirada. Intente de nuevo.');
        }

        if (status === 403) {
          this.logger.debug(`[CAPTURE] 403 en variante ${i + 1} — probando siguiente variante`);
          continue;
        }

        if (status === 404 || status === 405 || status === 400 || status === 501) {
          this.logger.debug(`[CAPTURE] Endpoint no soportado (${status}), probando siguiente`);
          continue;
        }

        if (i === endpointVariants.length - 1) {
          throw new ServiceUnavailableException(
            `No se pudo capturar desde el dispositivo tras ${endpointVariants.length} intentos. Último error: ${respMsg}`,
          );
        }
      }
    }

    // Todas las variantes de scan_picture fallaron (LAN bloqueado, endpoint no soportado, etc.).
    // Fallback automático: polling de eventos de acceso (funciona en remoto/ngrok).
    // El visitante debe pararse frente al dispositivo para generar un evento con foto.
    this.logger.warn(
      `[CAPTURE] scan_picture agotado (${endpointVariants.length} variantes). ` +
      `Usando captura por eventos para dispositivo ${deviceId}.`,
    );
    return this.captureFaceViaEvents(tenantId, deviceId);
  }

  /**
   * Polling para captura asíncrona cuando BioStar devuelve 202.
   * Consulta cada 2 segundos durante máximo 30 segundos.
   */
  private async pollScanPicture(
    apiUrl: string,
    deviceId: string,
    headers: Record<string, string>,
    httpsAgent: https.Agent,
  ): Promise<string> {
    const POLL_INTERVAL_MS = 2000;
    const MAX_POLLS = 15;

    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      try {
        const pollResponse = await firstValueFrom(
          this.httpService.get(
            `${apiUrl}/api/monitoring/scan_picture/${deviceId}`,
            { headers, httpsAgent, timeout: 5000 },
          ),
        );
        const picture =
          pollResponse.data?.DeviceScanPicture?.picture ||
          pollResponse.data?.picture;
        if (picture) {
          this.logger.log(
            `[CAPTURE] Imagen recibida tras ${attempt + 1} poll(s) para dispositivo ${deviceId}`,
          );
          return picture;
        }
      } catch (err: any) {
        if (err.response?.status === 404 || err.response?.status === 202) continue;
        throw err;
      }
    }

    throw new ServiceUnavailableException(
      'Timeout: el dispositivo no capturó ninguna imagen en 30 segundos',
    );
  }

  /**
   * Obtiene la foto más reciente capturada por un dispositivo BioStar consultando
   * los eventos de monitoreo. Operación rápida (timeout 5s) para polling desde el frontend
   * mientras el operador espera la captura.
   *
   * BioStar 2: GET /api/monitoring/events?device_id={id}&limit=1
   * BioStar X: misma ruta
   *
   * @returns photoBase64 (sin prefijo data:URI) y capturedAt ISO si existe, null si no hay foto reciente.
   */
  async getLatestDeviceEventPhoto(
    tenantId: string,
    deviceId: string,
  ): Promise<{ photoBase64: string | null; capturedAt: string | null }> {
    let conn: SupremaApiConnection;
    try {
      conn = await this.getActiveConnection(tenantId);
    } catch {
      return { photoBase64: null, capturedAt: null };
    }

    const httpsAgent = this.buildHttpsAgent(conn);

    let sessionId: string;
    try {
      sessionId = await this.getSession(conn, httpsAgent);
    } catch {
      return { photoBase64: null, capturedAt: null };
    }

    const headers = {
      'bs-session-id': sessionId,
      'Content-Type': 'application/json',
    };

    const endpoints = [
      `${conn.apiUrl}/api/monitoring/events?device_id=${deviceId}&limit=5`,
      `${conn.apiUrl}/api/events?device_id=${deviceId}&limit=5`,
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await firstValueFrom(
          this.httpService.get(endpoint, {
            headers,
            httpsAgent,
            timeout: 5000,
          }),
        );

        const rows: any[] =
          response.data?.EventCollection?.rows ||
          response.data?.rows ||
          [];

        for (const row of rows) {
          const photo =
            row.image ||
            row.photo ||
            row.picture ||
            row.DeviceScanPicture?.picture;

          if (photo) {
            const cleanBase64 = (photo as string).replace(
              /^data:image\/\w+;base64,/,
              '',
            );
            const capturedAt: string | null =
              row.datetime ||
              row.date_time ||
              row.event_datetime ||
              null;

            this.logger.debug(
              `[LIVE_PREVIEW] Foto de evento encontrada para dispositivo ${deviceId}`,
            );
            return { photoBase64: cleanBase64, capturedAt };
          }
        }

        return { photoBase64: null, capturedAt: null };
      } catch (err: any) {
        if (err.response?.status === 404 || err.response?.status === 405) {
          continue;
        }
        this.logger.debug(
          `[LIVE_PREVIEW] No se pudo obtener eventos de ${endpoint}: ${err.message}`,
        );
        return { photoBase64: null, capturedAt: null };
      }
    }

    return { photoBase64: null, capturedAt: null };
  }

  /**
   * Dispara la captura de huella dactilar desde un dispositivo BioStar.
   * Retorna la plantilla en base64 y la calidad del escaneo.
   *
   * BioStar 2: POST /api/devices/{id}/monitoring/scan_fingerprint
   * BioStar X: mismo endpoint
   *
   * @param fingerIndex Índice del dedo (0-9, estándar Suprema SDK). Opcional; BioStar puede ignorarlo.
   * @returns { templateBase64, quality } o lanza ServiceUnavailableException
   */
  async captureFingerprintFromDevice(
    tenantId: string,
    deviceId: string,
    fingerIndex?: number,
  ): Promise<{ templateBase64: string; quality: number }> {
    const conn = await this.getActiveConnection(tenantId);
    const httpsAgent = this.buildHttpsAgent(conn);

    let sessionId: string;
    try {
      sessionId = await this.getSession(conn, httpsAgent);
    } catch (err: any) {
      throw new ServiceUnavailableException(
        `No se pudo conectar con BioStar: ${err.message}`,
      );
    }

    const headers = {
      'bs-session-id': sessionId,
      'Content-Type': 'application/json',
    };

    this.logger.log(
      `🖐️ Iniciando captura de huella en dispositivo ${deviceId} (${conn.apiUrl}), dedo ${fingerIndex ?? 'auto'}`,
    );

    const body: Record<string, any> = { timeout: 30 };
    if (fingerIndex !== undefined && fingerIndex !== null) {
      body.finger_index = fingerIndex;
    }

    const endpoints = [
      `${conn.apiUrl}/api/devices/${deviceId}/monitoring/scan_fingerprint`,
      `${conn.apiUrl}/api/monitoring/scan_fingerprint`,
    ];

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i];
      try {
        const requestBody =
          !endpoint.includes(`/${deviceId}/`)
            ? {
                MonitoringScanFingerprint: {
                  device_id: { id: deviceId },
                  timeout: 30,
                  ...(fingerIndex !== undefined ? { finger_index: fingerIndex } : {}),
                },
              }
            : body;

        const response = await firstValueFrom(
          this.httpService.post(endpoint, requestBody, {
            headers,
            httpsAgent,
            timeout: 35000,
          }),
        );

        const data = response.data;

        const templateBase64: string | undefined =
          data?.DeviceScanFingerprint?.template ||
          data?.MonitoringScanFingerprint?.template ||
          data?.template ||
          data?.fingerprint_template;

        const quality: number =
          data?.DeviceScanFingerprint?.quality ||
          data?.MonitoringScanFingerprint?.quality ||
          data?.quality ||
          0;

        if (!templateBase64) {
          this.logger.warn(
            `Respuesta sin plantilla de huella de ${endpoint}: ${JSON.stringify(data)}`,
          );
          continue;
        }

        this.logger.log(
          `✅ Huella capturada desde dispositivo ${deviceId} (calidad: ${quality})`,
        );

        this.structuredLogger.logAuditEvent(
          'device.fingerprint_captured',
          'system',
          { deviceId, fingerIndex, quality },
          tenantId,
        );

        return { templateBase64, quality };
      } catch (err: any) {
        if (err.response?.status === 401) {
          await this.invalidateSession(conn.id);
          throw new ServiceUnavailableException(
            'Sesión BioStar expirada. Intente de nuevo.',
          );
        }
        if (err.response?.status === 404 || err.response?.status === 405) {
          this.logger.debug(`Endpoint no disponible: ${endpoint}`);
          continue;
        }
        const msg =
          err.response?.data?.Response?.message ||
          err.response?.data?.message ||
          err.message;
        this.logger.warn(`Error en endpoint ${endpoint}: ${msg}`);

        if (i === endpoints.length - 1) {
          throw new ServiceUnavailableException(
            `No se pudo capturar huella desde el dispositivo: ${msg}`,
          );
        }
      }
    }

    throw new ServiceUnavailableException(
      'El dispositivo no pudo capturar la huella. Verifique que esté conectado y en modo de espera.',
    );
  }

  /**
   * Invalida el caché de dispositivos Y el de capacidades por dispositivo
   * para forzar recarga completa.
   *
   * Claves eliminadas:
   *   - `bv:devices:{tenantId}`          — listado de dispositivos (5 min TTL)
   *   - `bv:devcap:{tenantId}:*`         — capacidades por dispositivo (10 min TTL)
   *
   * Se usa SCAN en lugar de KEYS para no bloquear Redis en producción.
   */
  async invalidateDevicesCache(tenantId: string): Promise<void> {
    const keysToDelete: string[] = [DEVICES_CACHE_KEY(tenantId)];

    // Scan all capability cache keys for this tenant
    const pattern = `bv:devcap:${tenantId}:*`;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      keysToDelete.push(...keys);
    } while (cursor !== '0');

    if (keysToDelete.length > 0) {
      await this.redis.del(...keysToDelete);
      this.logger.log(
        `🧹 Caché invalidado para tenant ${tenantId}: ${keysToDelete.length} clave(s) eliminadas (dispositivos + capacidades)`,
      );
    }
  }

  // ── Escaneo de credenciales desde dispositivo ─────────────────────────────

  /**
   * Escanea una tarjeta RFID/Smart Card desde un dispositivo BioStar.
   * Endpoint BioStar: POST /api/devices/:id/scan_card
   * Timeout: 35s (espera que el usuario pase la tarjeta al lector).
   * @returns { cardId, cardType? }
   */
  async scanCardFromDevice(
    tenantId: string,
    deviceId: string,
  ): Promise<{ cardId: string; cardType?: string }> {
    const conn = await this.getActiveConnection(tenantId);
    const httpsAgent = this.buildHttpsAgent(conn);
    const sessionId = await this.getSession(conn, httpsAgent);
    const headers = { 'bs-session-id': sessionId, 'Content-Type': 'application/json' };

    this.logger.log(`💳 Esperando tarjeta en dispositivo ${deviceId} (${conn.apiUrl})`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${conn.apiUrl}/api/devices/${deviceId}/scan_card`,
          { timeout: 30 },
          { headers, httpsAgent, timeout: 35000 },
        ),
      );

      const data = response.data;
      // BioStar 2 / BioStar X pueden devolver la tarjeta en distintas estructuras:
      //   - data.Card.card_type.card_id       ← FaceStation F2 / BioStation 3 (BioStar 2)
      //   - data.DeviceCardScan.card_id        ← BioStar X (algunos modelos)
      //   - data.CardScan.card_id              ← variante legacy
      //   - data.card_id / data.cardId         ← estructura plana
      const cardTypeNode =
        data?.Card?.card_type ||
        data?.DeviceCardScan?.card_type ||
        data?.CardScan?.card_type ||
        data?.card_type;

      const cardId: string | undefined =
        data?.Card?.card_id ||
        data?.Card?.display_card_id ||
        cardTypeNode?.card_id ||
        cardTypeNode?.display_card_id ||
        data?.Card?.card_type?.card_id ||
        data?.DeviceCardScan?.card_id ||
        data?.CardScan?.card_id ||
        data?.card_id ||
        data?.cardId;

      const cardType: string | undefined =
        cardTypeNode?.type ||
        data?.card_type?.type;

      if (!cardId) {
        throw new ServiceUnavailableException(
          `BioStar no devolvió un ID de tarjeta. Respuesta: ${JSON.stringify(data).substring(0, 300)}`,
        );
      }

      this.logger.log(`✅ Tarjeta escaneada en dispositivo ${deviceId}: ${cardId}`);
      this.structuredLogger.logAuditEvent(
        'device.card_scanned', 'system', { deviceId, cardId }, tenantId,
      );
      return { cardId, cardType };
    } catch (err: any) {
      if (err.response?.status === 401) await this.invalidateSession(conn.id);
      if (err instanceof ServiceUnavailableException) throw err;
      const msg =
        err.response?.data?.Response?.message ||
        err.response?.data?.message ||
        err.message;
      throw new ServiceUnavailableException(`No se pudo escanear la tarjeta: ${msg}`);
    }
  }

  /**
   * Captura templates de credencial facial desde un dispositivo BioStar.
   * Endpoint BioStar: GET /api/devices/:id/credentials/face?pose_sensitivity=4
   * Timeout: 35s (espera que el usuario se posicione frente al sensor).
   * @returns Objeto con los campos de template devueltos por BioStar
   */
  async scanFaceCredentialFromDevice(
    tenantId: string,
    deviceId: string,
  ): Promise<Record<string, unknown>> {
    const conn = await this.getActiveConnection(tenantId);
    const httpsAgent = this.buildHttpsAgent(conn);
    const sessionId = await this.getSession(conn, httpsAgent);
    const headers = { 'bs-session-id': sessionId, 'Content-Type': 'application/json' };

    this.logger.log(`👤 Capturando credencial facial desde dispositivo ${deviceId} (${conn.apiUrl})`);

    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${conn.apiUrl}/api/devices/${deviceId}/credentials/face?pose_sensitivity=4`,
          { headers, httpsAgent, timeout: 35000 },
        ),
      );

      const data = response.data;
      // BioStar puede envolver los templates en distintas rutas según versión/modelo:
      //   - FaceCredentialCollection.rows  (BioStar X estándar)
      //   - FaceCollection.rows            (BioStar 2 antiguo)
      //   - credentials.faces              (FaceStation F2 / BioStar 2 ≥ 2.9 confirmado)
      //   - rows                           (respuesta sin envolver)
      const rowSource =
        data?.FaceCredentialCollection?.rows ||
        data?.FaceCollection?.rows ||
        data?.credentials?.faces ||
        data?.rows;

      const resolvedPath = data?.FaceCredentialCollection?.rows
        ? 'FaceCredentialCollection.rows'
        : data?.FaceCollection?.rows
          ? 'FaceCollection.rows'
          : data?.credentials?.faces
            ? 'credentials.faces'
            : data?.rows
              ? 'rows'
              : 'root';

      const rows: any[] = rowSource || [];
      this.logger.log(
        `[FACE_CRED] Respuesta de ${deviceId} — ruta usada: "${resolvedPath}", filas: ${rows.length}`,
      );

      const row = rows[0] ?? data;

      const hasTemplate =
        row.template_ex_normalized_image ||
        row.templates?.length ||
        row.template ||
        row.image;

      if (!hasTemplate) {
        throw new ServiceUnavailableException(
          `BioStar no devolvió templates de rostro. Respuesta: ${JSON.stringify(data).substring(0, 300)}`,
        );
      }

      const result: Record<string, unknown> = {};
      if (row.template_ex_normalized_image) result.template_ex_normalized_image = row.template_ex_normalized_image;
      if (row.templates) result.templates = row.templates;
      if (row.template) result.template = row.template;
      if (row.image) result.image = row.image;

      this.logger.log(`✅ Template facial capturado desde dispositivo ${deviceId}`);
      this.structuredLogger.logAuditEvent(
        'device.face_credential_scanned', 'system', { deviceId }, tenantId,
      );
      return result;
    } catch (err: any) {
      if (err.response?.status === 401) await this.invalidateSession(conn.id);
      if (err instanceof ServiceUnavailableException) throw err;
      const msg =
        err.response?.data?.Response?.message ||
        err.response?.data?.message ||
        err.message;
      throw new ServiceUnavailableException(`No se pudo capturar el rostro desde el dispositivo: ${msg}`);
    }
  }

  /**
   * Captura template de huella dactilar desde un dispositivo BioStar.
   * Endpoint BioStar: POST /api/devices/:dev_id/scan_fingerprint
   * Timeout: 35s (espera que el usuario posicione el dedo en el sensor).
   * @returns { template, quality? }
   */
  async scanFingerprintCredential(
    tenantId: string,
    deviceId: string,
  ): Promise<{ template: string; quality?: number }> {
    const conn = await this.getActiveConnection(tenantId);
    const httpsAgent = this.buildHttpsAgent(conn);
    const sessionId = await this.getSession(conn, httpsAgent);
    const headers = { 'bs-session-id': sessionId, 'Content-Type': 'application/json' };

    this.logger.log(`🖐️ Capturando huella para credencial en dispositivo ${deviceId} (${conn.apiUrl})`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${conn.apiUrl}/api/devices/${deviceId}/scan_fingerprint`,
          { timeout: 30 },
          { headers, httpsAgent, timeout: 35000 },
        ),
      );

      const data = response.data;
      const template: string | undefined =
        data?.DeviceFingerprintScan?.template ||
        data?.FingerprintScan?.template ||
        data?.template ||
        data?.fingerprint_template;

      const quality: number | undefined =
        data?.DeviceFingerprintScan?.quality ||
        data?.FingerprintScan?.quality ||
        data?.quality;

      if (!template) {
        throw new ServiceUnavailableException(
          `BioStar no devolvió template de huella. Respuesta: ${JSON.stringify(data).substring(0, 300)}`,
        );
      }

      this.logger.log(`✅ Huella capturada en dispositivo ${deviceId} (calidad: ${quality ?? 'N/A'})`);
      this.structuredLogger.logAuditEvent(
        'device.fingerprint_credential_scanned', 'system', { deviceId, quality }, tenantId,
      );
      return { template, quality };
    } catch (err: any) {
      if (err.response?.status === 401) await this.invalidateSession(conn.id);
      if (err instanceof ServiceUnavailableException) throw err;
      const msg =
        err.response?.data?.Response?.message ||
        err.response?.data?.message ||
        err.message;
      throw new ServiceUnavailableException(`No se pudo capturar la huella desde el dispositivo: ${msg}`);
    }
  }

  /**
   * Captura la foto facial de un visitante esperando a que un nuevo evento
   * con foto aparezca en la Events API de BioStar para el dispositivo dado.
   *
   * Estrategia: polling de `POST /api/events/search` — el mismo endpoint que
   * usa el exit-poll (confirmado funcional sobre ngrok/internet). Registra la
   * hora de inicio y busca eventos con foto posteriores a ese momento.
   * La API de monitoreo (`scan_picture`) NO se usa aquí porque requiere LAN.
   *
   * El visitante simplemente mira la cámara del FaceStation F2 y el dispositivo
   * genera un evento de acceso que incluye la foto facial en el campo `image`.
   *
   * @param tenantId  Tenant del operador
   * @param deviceId  ID del dispositivo BioStar (ej. "543721717")
   * @returns { imageBase64 } — base64 sin prefijo data-URI, listo para guardar
   * @throws ServiceUnavailableException si no se captura ningún evento con foto en 30s
   */
  async captureFaceViaEvents(
    tenantId: string,
    deviceId: string,
  ): Promise<{ imageBase64: string }> {
    const conn = await this.getActiveConnection(tenantId);
    const httpsAgent = this.buildHttpsAgent(conn);

    let sessionId: string;
    try {
      sessionId = await this.getSession(conn, httpsAgent);
    } catch (err: any) {
      throw new ServiceUnavailableException(
        `No se pudo conectar con BioStar: ${err.message}`,
      );
    }

    const headers = {
      'bs-session-id': sessionId,
      'Content-Type': 'application/json',
    };

    // Marca temporal: solo se consideran eventos POSTERIORES a este momento.
    // Se resta 3s de margen para absorber pequeños desfases de reloj del servidor.
    const startTime = new Date(Date.now() - 3000);
    const TIMEOUT_MS = 30_000;
    const POLL_INTERVAL_MS = 2_000;
    const deadline = Date.now() + TIMEOUT_MS;

    this.logger.log(
      `📸 [FACE_EVENTS] Iniciando captura facial por eventos en dispositivo ${deviceId} ` +
      `(desde ${startTime.toISOString()}, timeout ${TIMEOUT_MS / 1000}s)`,
    );

    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const now = new Date();

      try {
        const response = await firstValueFrom(
          this.httpService.post(
            `${conn.apiUrl}/api/events/search`,
            {
              Query: {
                limit: 30,
                conditions: [
                  {
                    column: 'datetime',
                    operator: 3,
                    values: [startTime.toISOString(), now.toISOString()],
                  },
                ],
                orders: [{ column: 'datetime', descending: true }],
              },
            },
            { headers, httpsAgent, timeout: 6000 },
          ),
        );

        const allRows: any[] = response.data?.EventCollection?.rows || [];

        // Filtrar solo los eventos del dispositivo objetivo
        const deviceRows = allRows.filter((r) => {
          const rowDeviceId =
            r.device_id?.id?.toString() ||
            r.device_id?.toString() ||
            '';
          return rowDeviceId === String(deviceId);
        });

        this.logger.debug(
          `[FACE_EVENTS] ${deviceRows.length} evento(s) en dispositivo ${deviceId} ` +
          `de ${allRows.length} totales`,
        );

        for (const row of deviceRows) {
          // BioStar puede incluir la foto en distintos campos según el modelo y versión
          const photo: string | undefined =
            row.image ||
            row.photo ||
            row.picture ||
            row.user_image ||
            row.DeviceScanPicture?.picture;

          if (photo && typeof photo === 'string' && photo.length > 100) {
            const cleanBase64 = photo.replace(/^data:image\/\w+;base64,/, '');
            const eventCode =
              row.event_type_id?.code?.toString() ||
              row.event_type?.toString() ||
              'N/A';

            this.logger.log(
              `✅ [FACE_EVENTS] Foto capturada desde evento en dispositivo ${deviceId} ` +
              `(event_code=${eventCode}, datetime=${row.datetime}, bytes≈${cleanBase64.length})`,
            );

            this.structuredLogger.logAuditEvent(
              'device.face_captured_via_events',
              'system',
              { deviceId, eventCode, eventDatetime: row.datetime },
              tenantId,
            );

            return { imageBase64: cleanBase64 };
          }
        }
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 401) {
          await this.invalidateSession(conn.id).catch(() => null);
          throw new ServiceUnavailableException(
            'Sesión BioStar expirada. Intente de nuevo.',
          );
        }
        this.logger.debug(
          `[FACE_EVENTS] Error consultando eventos: ${status ?? ''} ${err.message}`,
        );
        // No relanzar — seguir intentando hasta el deadline
      }
    }

    throw new ServiceUnavailableException(
      'No se detectó ningún rostro en el dispositivo en 30 segundos. ' +
      'Pida al visitante que mire directamente a la cámara e intente de nuevo.',
    );
  }
}
