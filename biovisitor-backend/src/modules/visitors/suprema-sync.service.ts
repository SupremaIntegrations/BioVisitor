/**
 * @file suprema-sync.service.ts
 * @description Servicio de sincronización híbrida de visitantes con Suprema BioStar.
 *
 * Implementa el patrón "Local First, Sync Later":
 * 1. El visitante SIEMPRE se registra primero en PostgreSQL local.
 * 2. Este servicio intenta sincronizarlo con BioStar de forma asíncrona.
 * 3. Si BioStar no está disponible, la App sigue funcionando (syncStatus = PENDING).
 * 4. El operador puede reintentar manualmente via el endpoint force-sync.
 *
 * Compatibilidad:
 * - BioStar 2: API REST tradicional con bs-session-id en headers.
 * - BioStar X: Mismo protocolo de autenticación, estructura de usuario similar.
 * - Conexiones múltiples: Sincroniza con TODAS las conexiones activas del tenant.
 *
 * Seguridad:
 * - Las credenciales se descifran en memoria (AES-256-GCM), nunca se loguean.
 * - Todas las llamadas son HTTPS obligatoriamente.
 * - Las sesiones BioStar se cierran explícitamente al terminar.
 *
 * @module modules/visitors
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import Redis from 'ioredis';
import { InjectRedis } from '@nestjs-modules/ioredis';

import { Visit } from '../../database/entities/visit.entity';
import { Visitor } from '../../database/entities/visitor.entity';
import {
  AccessCredential,
  CredentialType,
  CredentialSyncStatus,
} from '../../database/entities/access-credential.entity';
import {
  SupremaApiConnection,
} from '../../database/entities/suprema-api-connection.entity';
import { BioStarPlatform, Tenant } from '../../database/entities/tenant.entity';
import { EncryptionService } from '../../core/crypto/encryption.service';
import { StructuredLoggerService } from '../../core/logging/structured-logger.service';

/** Estado de sincronización de una visita con BioStar */
export const SyncStatus = {
  SYNCED: 'SYNCED',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
  OFFLINE: 'OFFLINE',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
} as const;

export type SyncStatusValue = (typeof SyncStatus)[keyof typeof SyncStatus];

/** Resultado de un intento de sincronización */
export interface SyncAttemptResult {
  success: boolean;
  supremaUserId?: string;
  connectionId?: string;
  connectionName?: string;
  error?: string;
}

/** Datos para sincronizar un visitante en BioStar */
export interface SyncPayload {
  visit: Visit;
  visitor: Visitor;
  /** JTI del QR generado para asignarlo como credencial de tarjeta (opcional) */
  qrJti?: string;
  /** Grupo de usuarios en BioStar (por defecto 1 = "All Users") */
  userGroupId?: number;
  /** Grupos de acceso físico asignados al visitante (puertas habilitadas) */
  accessGroups?: { id: number; name: string }[];
  /**
   * Si true, intenta enrolar la foto de perfil del visitante como Visual Face
   * en BioStar (FaceStation F2 / BioStation 3). Solo se activa cuando el
   * operador seleccionó explícitamente la credencial de Rostro Visual.
   */
  enrollFace?: boolean;
}

/** Grupo de acceso retornado por BioStar */
export interface BioStarAccessGroup {
  id: number;
  name: string;
}

/** Templates biométricos de rostro visual extraídos por BioStar */
interface VisualFaceData {
  /** BioStar 2: imagen normalizada devuelta por upload_picture */
  template_ex_normalized_image?: string;
  /** BioStar 2: array de templates biométricos */
  templates?: Array<{ credential_bin_type: string; template_ex: string }>;
  /** BioStar X: imagen procesada devuelta por upload_picture (campo "image") */
  image?: string;
}

@Injectable()
export class SupremaSyncService {
  private readonly logger = new Logger(SupremaSyncService.name);

  private static readonly ACCESS_GROUPS_CACHE_TTL = 3600;

  constructor(
    @InjectRepository(Visit)
    private readonly visitRepo: Repository<Visit>,
    @InjectRepository(SupremaApiConnection)
    private readonly connectionRepo: Repository<SupremaApiConnection>,
    @InjectRepository(AccessCredential)
    private readonly credentialRepo: Repository<AccessCredential>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly encryptionService: EncryptionService,
    private readonly httpService: HttpService,
    private readonly structuredLogger: StructuredLoggerService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * Resuelve las conexiones BioStar activas para un tenant.
   * Primero intenta con el tenantId exacto; si no hay, usa conexiones globales
   * (tenantId = null), igual que EnrollerDevicesService.
   */
  private async resolveConnections(tenantId: string): Promise<SupremaApiConnection[]> {
    const all = await this.connectionRepo.find({
      where: { isActive: true },
      order: { createdAt: 'ASC' },
    });
    const tenantConns = all.filter((c) => c.tenantId === tenantId);
    if (tenantConns.length > 0) return tenantConns;
    return all.filter((c) => c.tenantId === null);
  }

  /** Variante singular de resolveConnections — devuelve la primera o null. */
  private async resolveConnection(tenantId: string): Promise<SupremaApiConnection | null> {
    const conns = await this.resolveConnections(tenantId);
    return conns[0] ?? null;
  }

  /**
   * Convierte una fecha UTC al ISO local de la zona horaria del tenant
   * y lo formatea SIN sufijo Z para que BioStar lo interprete como hora local.
   * BioStar ignora la zona horaria en el string y usa el valor numérico tal cual,
   * por lo que debemos enviar la hora en la TZ del servidor BioStar (= tenant TZ).
   */
  private toTenantLocalIso(d: Date | null | undefined, fallbackMs: number, tz: string): string {
    const date = d ? new Date(d) : new Date(fallbackMs);
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year:   'numeric',
        month:  '2-digit',
        day:    '2-digit',
        hour:   '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(date);
      const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
      // Formato: YYYY-MM-DDTHH:mm:ss  (sin Z ni milisegundos — BioStar interpreta como hora local)
      return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
    } catch {
      // Si la TZ es inválida, caer a UTC sin Z para evitar el problema inverso
      return date.toISOString().replace(/\.\d{3}Z$/, '');
    }
  }

  /**
   * Punto de entrada principal para sincronización.
   *
   * Busca conexiones activas para el tenant y sincroniza con cada una.
   * Actualiza el syncStatus de la visita según el resultado.
   *
   * Este método es SEGURO para llamar sin await (fire-and-forget):
   * nunca lanza excepciones — maneja todos los errores internamente.
   */
  async syncVisit(payload: SyncPayload): Promise<void> {
    const { visit, visitor } = payload;
    const tenantId = visit.tenantId;

    try {
      const connections = await this.resolveConnections(tenantId);

      if (connections.length === 0) {
        this.logger.log(
          `📴 Sin conexiones BioStar activas para tenant ${tenantId}. Registro local únicamente.`,
        );
        await this.updateVisitSyncStatus(
          visit,
          SyncStatus.NOT_CONFIGURED,
          null,
          'Sin conexiones BioStar activas configuradas para este tenant.',
        );
        return;
      }

      this.logger.log(
        `🔄 Iniciando sincronización de visita ${visit.id} con ${connections.length} conexión(es) BioStar.`,
      );

      let lastError: string | null = null;
      let anySuccess = false;
      let supremaUserId: string | undefined;

      for (const connection of connections) {
        const result = await this.syncWithConnection(payload, connection);

        if (result.success) {
          anySuccess = true;
          supremaUserId = result.supremaUserId;
          this.logger.log(
            `✅ Visita ${visit.id} sincronizada exitosamente en "${connection.name}" (ID BioStar: ${result.supremaUserId})`,
          );
        } else {
          lastError = result.error || 'Error desconocido';
          this.logger.warn(
            `⚠️ Fallo sincronización en "${connection.name}": ${lastError}`,
          );
        }
      }

      if (anySuccess) {
        visit.supremaUserRefId = supremaUserId || visit.id;
        await this.updateVisitSyncStatus(visit, SyncStatus.SYNCED, null, null);
        this.structuredLogger.logOperational(
          'suprema_sync.success',
          { visitId: visit.id, supremaUserId },
          tenantId,
        );
      } else {
        await this.updateVisitSyncStatus(
          visit,
          SyncStatus.PENDING,
          null,
          lastError,
        );
        this.structuredLogger.logOperational(
          'suprema_sync.pending',
          { visitId: visit.id, error: lastError },
          tenantId,
        );
      }
    } catch (error: any) {
      const msg = error.message || 'Error interno en el servicio de sincronización';
      this.logger.error(`❌ Error crítico en syncVisit ${visit.id}: ${msg}`);
      await this.updateVisitSyncStatus(visit, SyncStatus.PENDING, null, msg).catch(
        () => {/* ignorar error secundario */},
      );
    }
  }

  /**
   * Reintenta la sincronización de una visita existente.
   * Se usa para el endpoint de "Forzar Sincronización".
   *
   * NOTA: Desde la versión check-in-first, la sincronización con BioStar solo
   * aplica a visitas que ya tienen check-in (CHECKED_IN). Para visitas SCHEDULED
   * se retorna un mensaje indicando que se debe realizar el check-in primero.
   */
  async forceSyncVisit(visitId: string, tenantId: string): Promise<{
    success: boolean;
    message: string;
    syncStatus: string;
  }> {
    const visit = await this.visitRepo.findOne({
      where: { id: visitId, tenantId },
      relations: ['visitor'],
    });

    if (!visit) {
      return { success: false, message: 'Visita no encontrada.', syncStatus: 'UNKNOWN' };
    }

    const visitor = visit.visitor;
    if (!visitor) {
      return { success: false, message: 'Visitante no encontrado.', syncStatus: visit.syncStatus || 'UNKNOWN' };
    }

    // Nueva lógica: solo sincronizar si la visita ya tiene check-in realizado
    if (visit.status !== 'CHECKED_IN') {
      return {
        success: false,
        message: `La sincronización con BioStar ocurre automáticamente al realizar el check-in. Estado actual: ${visit.status}.`,
        syncStatus: visit.syncStatus || 'NOT_AVAILABLE',
      };
    }

    this.logger.log(`🔁 Forzando re-sincronización de visita ${visitId}`);

    // Si la visita ya tenía un usuario en BioStar, lo eliminamos primero
    // para evitar usuarios huérfanos cuando cambia el user_id (ej. formato de documento).
    if (visit.supremaUserRefId) {
      this.logger.log(
        `🗑️ [FORCE_SYNC] Eliminando usuario BioStar anterior "${visit.supremaUserRefId}" antes de re-crear.`,
      );
      await this.deleteUserFromBioStar(visit).catch((e: any) =>
        this.logger.warn(`⚠️ [FORCE_SYNC] No se pudo eliminar usuario anterior: ${e?.message}`),
      );
      visit.supremaUserRefId = null as any;
      await this.visitRepo.save(visit);

      // Al eliminar el usuario en BioStar también se pierde la vinculación de
      // cualquier tarjeta física (RFID/SMART_CARD) que ya estuviera SYNCED —
      // el usuario recreado tendrá un ID distinto o, aunque conserve el mismo,
      // BioStar ya no tiene la tarjeta enlazada a él. Sin este reset,
      // `syncCardCredentials` las omite (solo procesa PENDING/FAILED) y la
      // tarjeta queda huérfana/"no asignada" en BioStar tras el force-sync.
      const resetResult = await this.credentialRepo.update(
        {
          visitId: visit.id,
          type: In([CredentialType.RFID, CredentialType.SMART_CARD]),
          syncStatus: CredentialSyncStatus.SYNCED,
        },
        { syncStatus: CredentialSyncStatus.PENDING, lastSyncError: null },
      );
      if (resetResult.affected) {
        this.logger.log(
          `🔁 [FORCE_SYNC] ${resetResult.affected} credencial(es) física(s) marcada(s) PENDING para re-vincular al usuario recreado.`,
        );
      }
    }

    // Recuperar credenciales activas para incluirlas en la re-sincronización
    const [qrCredential, faceCredential] = await Promise.all([
      this.credentialRepo.findOne({
        where: { visitId: visit.id, type: CredentialType.QR_JWT, isRevoked: false },
        order: { createdAt: 'DESC' },
      }),
      this.credentialRepo.findOne({
        where: { visitId: visit.id, type: CredentialType.VISUAL_FACE },
      }),
    ]);
    const qrJti = qrCredential?.tokenHash;

    await this.updateVisitSyncStatus(visit, SyncStatus.PENDING, null, null);
    await this.syncVisit({
      visit,
      visitor,
      qrJti,
      enrollFace: !!(faceCredential || visitor.photoPath),
      accessGroups: visit.accessGroups ?? undefined,
    });

    const updated = await this.visitRepo.findOne({ where: { id: visitId } });
    const status = updated?.syncStatus || SyncStatus.PENDING;

    return {
      success: status === SyncStatus.SYNCED,
      message:
        status === SyncStatus.SYNCED
          ? 'Sincronización exitosa con BioStar.'
          : `Sincronización pendiente: ${updated?.lastSyncError || 'BioStar no disponible'}`,
      syncStatus: status,
    };
  }

  /**
   * Obtiene la lista de Grupos de Acceso disponibles en BioStar para el tenant.
   *
   * - Consulta la primera conexión activa del tenant.
   * - Llama a GET /api/access_groups de BioStar 2.
   * - Cachea el resultado en Redis durante 1 hora para evitar saturar la API.
   *
   * @param tenantId - ID del tenant
   * @returns Lista de grupos de acceso { id, name }
   */
  async getAccessGroups(tenantId: string): Promise<BioStarAccessGroup[]> {
    const cacheKey = `accessgroups:${tenantId}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as BioStarAccessGroup[];
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    const connection = await this.resolveConnection(tenantId);

    if (!connection) {
      this.logger.warn(
        `[ACCESS_GROUPS] Sin conexión BioStar activa para tenant ${tenantId}`,
      );
      return [];
    }

    const httpsAgent = new https.Agent({
      rejectUnauthorized: !!connection.caCertPath,
      ca:
        connection.caCertPath && fs.existsSync(connection.caCertPath)
          ? fs.readFileSync(connection.caCertPath)
          : undefined,
    });

    let sessionId: string | null = null;
    try {
      const loginId = this.encryptionService.decrypt(connection.loginIdEncrypted);
      const password = this.encryptionService.decrypt(connection.passwordEncrypted);

      sessionId = await this.authenticateBioStar(
        connection.apiUrl,
        loginId,
        password,
        httpsAgent,
      );

      const response = await firstValueFrom(
        this.httpService.get(`${connection.apiUrl}/api/access_groups`, {
          headers: {
            'bs-session-id': sessionId,
            'Content-Type': 'application/json',
          },
          httpsAgent,
          timeout: 15000,
          validateStatus: (s) => s < 500,
        }),
      );

      const rows: any[] =
        response.data?.AccessGroupCollection?.rows ||
        response.data?.rows ||
        [];

      const groups: BioStarAccessGroup[] = rows
        .filter((r: any) => r?.id !== undefined)
        .map((r: any) => ({
          id: Number(r.id),
          name: String(r.name || `Grupo ${r.id}`),
        }));

      await this.redis.set(
        cacheKey,
        JSON.stringify(groups),
        'EX',
        SupremaSyncService.ACCESS_GROUPS_CACHE_TTL,
      );

      this.logger.log(
        `[ACCESS_GROUPS] ${groups.length} grupo(s) de acceso cargados desde BioStar "${connection.name}"`,
      );

      this.structuredLogger.logOperational(
        'access_groups.fetched',
        { count: groups.length, connectionName: connection.name },
        tenantId,
      );

      return groups;
    } catch (error: any) {
      this.logger.error(
        `[ACCESS_GROUPS] Error obteniendo grupos de acceso: ${error.message}`,
      );
      this.structuredLogger.logOperational(
        'SYNC_ERROR',
        { error: error.message, operation: 'getAccessGroups' },
        tenantId,
      );
      throw new Error(`No se pudieron obtener los grupos de acceso de BioStar: ${error.message}`);
    } finally {
      if (sessionId) {
        await this.logout(connection.apiUrl, sessionId, httpsAgent).catch(() => {});
      }
    }
  }

  /**
   * Invalida el caché de grupos de acceso de un tenant en Redis.
   * Útil cuando se modifican grupos en BioStar y se quiere forzar recarga.
   */
  async invalidateAccessGroupsCache(tenantId: string): Promise<void> {
    await this.redis.del(`accessgroups:${tenantId}`);
  }

  /**
   * Elimina un usuario de TODAS las conexiones BioStar activas del tenant por su ID directo.
   * Útil para limpiar usuarios huérfanos cuya referencia ya no está en la BD local.
   */
  async deleteUserByIdFromBioStar(tenantId: string, biostarUserId: string): Promise<void> {
    if (!biostarUserId) return;

    const connections = await this.resolveConnections(tenantId);

    if (connections.length === 0) {
      this.logger.warn(`⚠️ No hay conexiones BioStar activas para eliminar usuario "${biostarUserId}" en tenant ${tenantId}`);
      return;
    }

    this.logger.log(`🗑️ Eliminando usuario BioStar huérfano "${biostarUserId}" de ${connections.length} conexión(es) (tenant ${tenantId})`);

    for (const connection of connections) {
      let sessionId: string | null = null;
      const httpsAgent = new https.Agent({
        rejectUnauthorized: !!connection.caCertPath,
        ca: connection.caCertPath && fs.existsSync(connection.caCertPath)
          ? fs.readFileSync(connection.caCertPath)
          : undefined,
      });

      try {
        const loginId = this.encryptionService.decrypt(connection.loginIdEncrypted);
        const password = this.encryptionService.decrypt(connection.passwordEncrypted);
        sessionId = await this.authenticateBioStar(connection.apiUrl, loginId, password, httpsAgent);
        const authHeaders = { 'bs-session-id': sessionId, 'Content-Type': 'application/json' };

        const redisCardKey = `biostar:qrcard:${tenantId}:${biostarUserId}:${connection.id}`;
        await this.redis.del(redisCardKey).catch(() => {});

        const isBsX = connection.platform === BioStarPlatform.BIOSTAR_X;
        const deleteUrl = isBsX
          ? `${connection.apiUrl}/api/users/${biostarUserId}`
          : `${connection.apiUrl}/api/users?user_ids=${biostarUserId}`;
        const response = await firstValueFrom(
          this.httpService.delete(deleteUrl, { headers: authHeaders, httpsAgent, timeout: 10000, validateStatus: (s) => s < 500 }),
        );

        if (response.status === 200 || response.status === 204) {
          this.logger.log(`✅ Usuario huérfano "${biostarUserId}" eliminado de BioStar "${connection.name}"`);
        } else {
          const msg = response.data?.Response?.message || response.data?.message || `HTTP ${response.status}`;
          this.logger.warn(`⚠️ BioStar "${connection.name}" respondió ${response.status} al eliminar "${biostarUserId}": ${msg}`);
        }
      } catch (err: any) {
        this.logger.error(`❌ Error eliminando usuario huérfano "${biostarUserId}" de BioStar "${connection.name}": ${err.message}`);
      } finally {
        if (sessionId) await this.logout(connection.apiUrl, sessionId, httpsAgent).catch(() => {});
      }
    }
  }

  async deleteUserFromBioStar(visit: Visit): Promise<void> {
    const tenantId = visit.tenantId;
    const supremaUserId = visit.supremaUserRefId;
    if (!supremaUserId) return;

    try {
      const connections = await this.resolveConnections(tenantId);

      if (connections.length === 0) {
        this.logger.warn(`⚠️ No hay conexiones BioStar activas para eliminar usuario ${supremaUserId} en tenant ${tenantId}`);
        return;
      }

      this.logger.log(`🗑️ Eliminando usuario BioStar "${supremaUserId}" de ${connections.length} conexión(es) — check-out visita ${visit.id}`);

      for (const connection of connections) {
        let sessionId: string | null = null;
        const httpsAgent = new https.Agent({
          rejectUnauthorized: !!connection.caCertPath,
          ca:
            connection.caCertPath && fs.existsSync(connection.caCertPath)
              ? fs.readFileSync(connection.caCertPath)
              : undefined,
        });

        try {
          const loginId = this.encryptionService.decrypt(connection.loginIdEncrypted);
          const password = this.encryptionService.decrypt(connection.passwordEncrypted);

          sessionId = await this.authenticateBioStar(connection.apiUrl, loginId, password, httpsAgent);
          const authHeaders = { 'bs-session-id': sessionId, 'Content-Type': 'application/json' };

          // ── Limpiar tarjeta QR de Redis antes de borrar el usuario ──────────
          const redisCardKey = `biostar:qrcard:${tenantId}:${supremaUserId}:${connection.id}`;
          await this.redis.del(redisCardKey).catch(() => {});

          // ── DELETE: BioStar 2 usa query param; BioStar X usa path param ────────
          const isBsX = connection.platform === BioStarPlatform.BIOSTAR_X;
          const deleteUrl = isBsX
            ? `${connection.apiUrl}/api/users/${supremaUserId}`
            : `${connection.apiUrl}/api/users?user_ids=${supremaUserId}`;
          const response = await firstValueFrom(
            this.httpService.delete(
              deleteUrl,
              { headers: authHeaders, httpsAgent, timeout: 10000, validateStatus: (s) => s < 500 },
            ),
          );

          if (response.status === 200 || response.status === 204) {
            this.logger.log(`✅ Usuario "${supremaUserId}" eliminado de BioStar "${connection.name}"`);
          } else {
            const msg = response.data?.Response?.message || response.data?.message || `HTTP ${response.status}`;
            this.logger.warn(`⚠️ BioStar "${connection.name}" respondió ${response.status} al eliminar usuario: ${msg}`);
          }
        } catch (err: any) {
          this.logger.error(`❌ Error eliminando usuario "${supremaUserId}" de BioStar "${connection.name}": ${err.message}`);
        } finally {
          if (sessionId) {
            await this.logout(connection.apiUrl, sessionId, httpsAgent).catch(() => {});
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`❌ Error general en deleteUserFromBioStar para visita ${visit.id}: ${err.message}`);
    }
  }

  /**
   * Actualiza la credencial QR de un visitante ya sincronizado en BioStar.
   * Se llama cuando el QR se refresca y la visita está CHECKED_IN y synced.
   *
   * Enrolla el nuevo jti como tarjeta QR (2 pasos) en cada conexión activa.
   * La tarjeta anterior seguirá registrada en BioStar pero el hardware solo
   * validará el jti activo almacenado en Redis — no hay riesgo de acceso
   * duplicado. Al checkout el usuario completo es eliminado de BioStar.
   *
   * Fire-and-forget: nunca lanza excepciones.
   */
  async updateQrCredential(visit: Visit, newQrJti: string): Promise<void> {
    const tenantId = visit.tenantId;
    const supremaUserId = visit.supremaUserRefId;
    if (!supremaUserId) return;

    try {
      const connections = await this.resolveConnections(tenantId);
      if (connections.length === 0) return;

      this.logger.log(
        `🔄 [QR-DYNAMIC] Rotando credencial QR en BioStar para visita ${visit.id} (usuario ${supremaUserId})`,
      );

      for (const connection of connections) {
        const redisCardKey = `biostar:qrcard:${tenantId}:${supremaUserId}:${connection.id}`;
        let sessionId: string | null = null;
        const httpsAgent = new https.Agent({
          rejectUnauthorized: !!connection.caCertPath,
          ca:
            connection.caCertPath && fs.existsSync(connection.caCertPath)
              ? fs.readFileSync(connection.caCertPath)
              : undefined,
        });
        try {
          const loginId = this.encryptionService.decrypt(connection.loginIdEncrypted);
          const password = this.encryptionService.decrypt(connection.passwordEncrypted);
          sessionId = await this.authenticateBioStar(
            connection.apiUrl,
            loginId,
            password,
            httpsAgent,
          );
          const authHeaders = {
            'bs-session-id': sessionId,
            'Content-Type': 'application/json',
          };

          // ── Paso 0: Eliminar la tarjeta QR anterior del sistema de BioStar ─
          // Esto invalida el QR anterior a nivel de hardware, no solo a nivel
          // de asignación de usuario. El lector no podrá leerla aunque la tenga
          // en caché local.
          const oldInternalCardId = await this.redis.get(redisCardKey).catch(() => null);
          if (oldInternalCardId) {
            this.logger.log(
              `🗑️ [QR-DYNAMIC] Eliminando tarjeta anterior (BioStar ID: ${oldInternalCardId}) de "${connection.name}"`,
            );
            await this.deleteBioStarCard(connection.apiUrl, authHeaders, httpsAgent, oldInternalCardId);
            await this.redis.del(redisCardKey).catch(() => {});
          }

          // ── Pasos 1-2: Enrollar y asignar la nueva tarjeta QR ───────────────
          const newInternalCardId = await this.enrollQrCard(
            connection.apiUrl,
            authHeaders,
            httpsAgent,
            supremaUserId,
            newQrJti,
            oldInternalCardId,
          );

          // ── Paso 3: Guardar el nuevo ID interno en Redis ─────────────────────
          await this.redis.set(redisCardKey, newInternalCardId, 'EX', 30 * 24 * 3600).catch(() => {});

          this.logger.log(
            `✅ [QR-DYNAMIC] QR rotado en "${connection.name}" — nuevo ID BioStar: ${newInternalCardId}`,
          );
        } catch (err: any) {
          this.logger.warn(
            `⚠️ [QR-DYNAMIC] No se pudo rotar QR en BioStar "${connection.name}": ${err.message}`,
          );
        } finally {
          if (sessionId) {
            await this.logout(connection.apiUrl, sessionId, httpsAgent).catch(() => {});
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`❌ Error rotando credencial QR en BioStar: ${err.message}`);
    }
  }

  /**
   * Sincroniza una nueva credencial física (RFID/SMART_CARD) de una visita ACTIVA
   * con BioStar, sin recrear el usuario. Se llama cuando se agrega una credencial
   * a una visita que ya está CHECKED_IN y sincronizada.
   *
   * Fire-and-forget: nunca lanza excepciones.
   */
  async pushNewPhysicalCredential(visit: Visit): Promise<void> {
    const tenantId = visit.tenantId;
    const supremaUserId = visit.supremaUserRefId;
    if (!supremaUserId) return;

    try {
      const connections = await this.resolveConnections(tenantId);
      if (connections.length === 0) return;

      this.logger.log(
        `🔄 Sincronizando nueva credencial física en BioStar para visita ${visit.id}`,
      );

      for (const connection of connections) {
        let sessionId: string | null = null;
        const httpsAgent = new https.Agent({
          rejectUnauthorized: !!connection.caCertPath,
          ca:
            connection.caCertPath && fs.existsSync(connection.caCertPath)
              ? fs.readFileSync(connection.caCertPath)
              : undefined,
        });
        try {
          const loginId = this.encryptionService.decrypt(connection.loginIdEncrypted);
          const password = this.encryptionService.decrypt(connection.passwordEncrypted);
          sessionId = await this.authenticateBioStar(
            connection.apiUrl,
            loginId,
            password,
            httpsAgent,
          );
          const authHeaders = {
            'bs-session-id': sessionId,
            'Content-Type': 'application/json',
          };
          await this.syncCardCredentials(
            connection.apiUrl,
            authHeaders,
            httpsAgent,
            supremaUserId,
            visit.id,
            connection.platform,
          );
          this.logger.log(
            `✅ Credencial física sincronizada en BioStar "${connection.name}" para usuario ${supremaUserId}`,
          );
        } catch (err: any) {
          this.logger.warn(
            `⚠️ No se pudo sincronizar credencial en BioStar "${connection.name}": ${err.message}`,
          );
        } finally {
          if (sessionId) {
            await this.logout(connection.apiUrl, sessionId, httpsAgent).catch(() => {});
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`❌ Error sincronizando credencial física en BioStar: ${err.message}`);
    }
  }

  /**
   * Actualiza el template de rostro visual de un visitante ya sincronizado en BioStar.
   *
   * Flujo:
   *  1. Lee la foto del visitante del disco (uploads/photos/)
   *  2. Para cada conexión activa:
   *     a. Autentica en BioStar
   *     b. Extrae templates biométricos via PUT /api/users/check/upload_picture
   *     c. Actualiza el usuario via PUT /api/users/:id con visualFaces
   *     d. Cierra sesión
   *
   * Lanza excepción si falla en todas las conexiones (para que el caller marque FAILED).
   */
  /**
   * Enrola un template de rostro visual en BioStar para la visita.
   *
   * @param precomputedTemplates Si se escaneó la credencial desde un dispositivo BioStar,
   *   pasar aquí los templates ya capturados (omite la extracción desde foto del visitante).
   *   Si es undefined, extrae templates desde la foto del visitante en disco (flujo clásico).
   */
  async pushVisualFace(
    visit: Visit,
    visitor: Visitor,
    precomputedTemplates?: {
      template_ex_normalized_image?: string;
      templates?: unknown[];
      image?: string;
    },
  ): Promise<void> {
    if (!visit.supremaUserRefId) {
      throw new Error('La visita no tiene usuario sincronizado en BioStar (supremaUserRefId vacío).');
    }

    // Preparar photoBase64 solo si no hay templates precalculados
    let photoBase64: string | null = null;
    if (!precomputedTemplates) {
      if (!visitor.photoPath) {
        throw new Error('El visitante no tiene foto registrada para enrollar Visual Face.');
      }
      const photosDir = path.resolve(process.cwd(), 'uploads', 'photos');
      const photoAbsPath = path.resolve(photosDir, path.basename(visitor.photoPath));
      if (!fs.existsSync(photoAbsPath)) {
        throw new Error(`Foto no encontrada en disco: ${photoAbsPath}`);
      }
      photoBase64 = fs.readFileSync(photoAbsPath).toString('base64');
    }

    const connections = await this.resolveConnections(visit.tenantId);
    if (connections.length === 0) {
      throw new Error('Sin conexiones BioStar activas configuradas para este tenant.');
    }

    let lastError: string | null = null;
    let anySuccess = false;

    for (const connection of connections) {
      let sessionId: string | null = null;
      const httpsAgent = new https.Agent({
        rejectUnauthorized: !!connection.caCertPath,
        ca:
          connection.caCertPath && fs.existsSync(connection.caCertPath)
            ? fs.readFileSync(connection.caCertPath)
            : undefined,
      });
      try {
        const loginId = this.encryptionService.decrypt(connection.loginIdEncrypted);
        const password = this.encryptionService.decrypt(connection.passwordEncrypted);
        sessionId = await this.authenticateBioStar(connection.apiUrl, loginId, password, httpsAgent);
        const authHeaders = { 'bs-session-id': sessionId, 'Content-Type': 'application/json' };

        let vf: VisualFaceData;
        if (precomputedTemplates) {
          this.logger.log(
            `🧠 [VISUAL_FACE] Usando templates precapturados desde dispositivo para visita ${visit.id} en "${connection.name}"`,
          );
          vf = precomputedTemplates as VisualFaceData;
        } else {
          this.logger.log(
            `🧠 [VISUAL_FACE] Extrayendo templates biométricos desde foto para visita ${visit.id} en "${connection.name}"`,
          );
          vf = await this.extractVisualFaceTemplates(
            connection.apiUrl,
            authHeaders,
            httpsAgent,
            photoBase64!,
          );
        }

        const faceNode = vf.image
          ? { template_ex_picture: vf.image }
          : {
              template_ex_normalized_image: vf.template_ex_normalized_image,
              templates: vf.templates,
            };

        const updateResp = await firstValueFrom(
          this.httpService.put(
            `${connection.apiUrl}/api/users/${visit.supremaUserRefId}`,
            { User: { credentials: { visualFaces: [faceNode] } } },
            { headers: authHeaders, httpsAgent, timeout: 15000, validateStatus: () => true },
          ),
        );

        if (updateResp.status !== 200 && updateResp.status !== 201) {
          const msg =
            updateResp.data?.Response?.message ||
            updateResp.data?.message ||
            `HTTP ${updateResp.status}`;
          throw new Error(`Visual Face update fallida en BioStar: ${msg}`);
        }

        this.logger.log(
          `✅ [VISUAL_FACE] Rostro visual actualizado en BioStar "${connection.name}" (userId=${visit.supremaUserRefId})`,
        );
        anySuccess = true;
      } catch (err: any) {
        lastError = err.message;
        this.logger.warn(
          `⚠️ [VISUAL_FACE] Error en conexión "${connection.name}": ${err.message}`,
        );
      } finally {
        if (sessionId) {
          await this.logout(connection.apiUrl, sessionId, httpsAgent).catch(() => {});
        }
      }
    }

    if (!anySuccess) {
      throw new Error(lastError ?? 'Visual Face update fallida en todas las conexiones BioStar.');
    }
  }

  /**
   * Enrola un template de huella dactilar en BioStar para la visita.
   * Usa el template capturado desde un dispositivo BioStar.
   * Endpoint: PUT /api/users/:id (nodo credentials.fingerPrints)
   *
   * @param fingerprintTemplate Template devuelto por /api/devices/:id/scan_fingerprint
   */
  async pushFingerprintCredential(
    visit: Visit,
    fingerprintTemplate: { template: string; quality?: number },
  ): Promise<void> {
    if (!visit.supremaUserRefId) {
      throw new Error('La visita no tiene usuario sincronizado en BioStar (supremaUserRefId vacío).');
    }
    if (!fingerprintTemplate.template) {
      throw new Error('Template de huella vacío.');
    }

    const connections = await this.resolveConnections(visit.tenantId);
    if (connections.length === 0) {
      throw new Error('Sin conexiones BioStar activas configuradas para este tenant.');
    }

    let lastError: string | null = null;
    let anySuccess = false;

    for (const connection of connections) {
      let sessionId: string | null = null;
      const httpsAgent = new https.Agent({
        rejectUnauthorized: !!connection.caCertPath,
        ca:
          connection.caCertPath && fs.existsSync(connection.caCertPath)
            ? fs.readFileSync(connection.caCertPath)
            : undefined,
      });
      try {
        const loginId = this.encryptionService.decrypt(connection.loginIdEncrypted);
        const password = this.encryptionService.decrypt(connection.passwordEncrypted);
        sessionId = await this.authenticateBioStar(connection.apiUrl, loginId, password, httpsAgent);
        const authHeaders = { 'bs-session-id': sessionId, 'Content-Type': 'application/json' };

        this.logger.log(
          `🖐️ [FINGERPRINT_REF] Enrollando huella en BioStar "${connection.name}" (userId=${visit.supremaUserRefId})`,
        );

        // BioStar 2/X: fingerPrints con finger_index 0 (dedo índice derecho por defecto)
        // templates[] contiene la secuencia de muestras; con 1 muestra basta para registrar
        const fingerprintNode = {
          finger_index: { id: '0' },
          templates: [
            {
              template: fingerprintTemplate.template,
              quality: fingerprintTemplate.quality ?? 0,
              is_duress_fp: false,
            },
          ],
        };

        const updateResp = await firstValueFrom(
          this.httpService.put(
            `${connection.apiUrl}/api/users/${visit.supremaUserRefId}`,
            { User: { credentials: { fingerPrints: [fingerprintNode] } } },
            { headers: authHeaders, httpsAgent, timeout: 15000, validateStatus: () => true },
          ),
        );

        if (updateResp.status !== 200 && updateResp.status !== 201) {
          const msg =
            updateResp.data?.Response?.message ||
            updateResp.data?.message ||
            `HTTP ${updateResp.status}`;
          throw new Error(`Fingerprint update fallida en BioStar: ${msg}`);
        }

        this.logger.log(
          `✅ [FINGERPRINT_REF] Huella enrollada en BioStar "${connection.name}" (userId=${visit.supremaUserRefId})`,
        );
        anySuccess = true;
      } catch (err: any) {
        lastError = err.message;
        this.logger.warn(
          `⚠️ [FINGERPRINT_REF] Error en conexión "${connection.name}": ${err.message}`,
        );
      } finally {
        if (sessionId) {
          await this.logout(connection.apiUrl, sessionId, httpsAgent).catch(() => {});
        }
      }
    }

    if (!anySuccess) {
      throw new Error(lastError ?? 'Fingerprint update fallida en todas las conexiones BioStar.');
    }
  }

  /**
   * Sincroniza la visita con UNA conexión BioStar específica.
   *
   * Flujo completo:
   *  1. Login → obtener bs-session-id
   *  2. Si el visitante tiene foto: extraer templates biométricos (Visual Face)
   *  3. Crear usuario en BioStar (con templates si los hay)
   *  4. Si hay QR: enrolar tarjeta en 2 pasos (POST /api/cards → PUT /api/users/:id)
   *  5. Sincronizar credenciales físicas (RFID / Smart Card)
   *  6. Importar evento de acceso
   *  7. Logout (siempre, en bloque finally)
   */
  private async syncWithConnection(
    payload: SyncPayload,
    connection: SupremaApiConnection,
  ): Promise<SyncAttemptResult> {
    const { visit, visitor, qrJti, userGroupId = 1, accessGroups, enrollFace } = payload;
    let sessionId: string | null = null;

    const httpsAgent = new https.Agent({
      rejectUnauthorized: !!connection.caCertPath,
      ca:
        connection.caCertPath && fs.existsSync(connection.caCertPath)
          ? fs.readFileSync(connection.caCertPath)
          : undefined,
    });

    try {
      const loginId = this.encryptionService.decrypt(connection.loginIdEncrypted);
      const password = this.encryptionService.decrypt(connection.passwordEncrypted);

      sessionId = await this.authenticateBioStar(
        connection.apiUrl,
        loginId,
        password,
        httpsAgent,
      );

      const authHeaders = {
        'bs-session-id': sessionId,
        'Content-Type': 'application/json',
      };

      // ── Paso previo: extraer templates de rostro visual (solo si el operador activó el toggle) ──
      let visualFaceTemplates: VisualFaceData | undefined;
      if (enrollFace && visitor.photoPath) {
        const photosDir = path.resolve(process.cwd(), 'uploads', 'photos');
        const photoAbsPath = path.resolve(photosDir, path.basename(visitor.photoPath));

        if (
          photoAbsPath.startsWith(photosDir) &&
          fs.existsSync(photoAbsPath)
        ) {
          try {
            const photoBase64 = fs.readFileSync(photoAbsPath).toString('base64');
            visualFaceTemplates = await this.extractVisualFaceTemplates(
              connection.apiUrl,
              authHeaders,
              httpsAgent,
              photoBase64,
            );
          } catch (faceErr: any) {
            if (faceErr.name === 'VisualFaceQualityError') {
              this.logger.warn(
                `⚠️ [VISUAL_FACE] La foto del visitante ${visitor.id} no cumple los requisitos` +
                  ` de calidad de BioStar "${connection.name}": ${faceErr.message}` +
                  ` — El usuario se creará SIN credencial de rostro visual.`,
              );
            } else {
              this.logger.warn(
                `⚠️ [VISUAL_FACE] No se pudieron extraer templates biométricos` +
                  ` de BioStar "${connection.name}": ${faceErr.message}` +
                  ` — El usuario se creará SIN credencial de rostro visual.`,
              );
            }
          }
        }
      }

      const supremaUserId = await this.createBioStarUser(
        connection,
        authHeaders,
        httpsAgent,
        visit,
        visitor,
        userGroupId,
        accessGroups,
        visualFaceTemplates,
      );

      if (qrJti) {
        try {
          const internalCardId = await this.enrollQrCard(
            connection.apiUrl,
            authHeaders,
            httpsAgent,
            supremaUserId,
            qrJti,
          );
          // Persistir el ID interno de la tarjeta en Redis (TTL 30 días).
          // Se usará en el próximo refresh dinámico del QR para borrar esta
          // tarjeta de BioStar antes de enrollar la nueva — garantía de que
          // el QR anterior queda completamente muerto a nivel de hardware.
          const redisCardKey = `biostar:qrcard:${visit.tenantId}:${supremaUserId}:${connection.id}`;
          await this.redis.set(redisCardKey, internalCardId, 'EX', 30 * 24 * 3600).catch(() => {});
        } catch (err: any) {
          this.logger.warn(
            `⚠️ Usuario creado en BioStar pero falló enrolamiento QR (2 pasos): ${err.message}`,
          );
        }
      }

      // Sincronizar credenciales físicas (RFID, SMART_CARD) registradas para esta visita
      await this.syncCardCredentials(
        connection.apiUrl,
        authHeaders,
        httpsAgent,
        supremaUserId,
        visit.id,
        connection.platform,
      ).catch((err: any) => {
        this.logger.warn(
          `⚠️ Error sincronizando credenciales físicas de visita ${visit.id}: ${err.message}`,
        );
      });

      await this.importAccessEvent(
        connection.apiUrl,
        authHeaders,
        httpsAgent,
        supremaUserId,
        visit.scheduledAt || new Date(),
      ).catch((err: any) => {
        this.logger.warn(
          `⚠️ No se pudo importar evento de acceso en BioStar: ${err.message}`,
        );
      });

      return {
        success: true,
        supremaUserId,
        connectionId: connection.id,
        connectionName: connection.name,
      };
    } catch (error: any) {
      return {
        success: false,
        connectionId: connection.id,
        connectionName: connection.name,
        error: this.buildSyncError(error),
      };
    } finally {
      if (sessionId) {
        await this.logout(connection.apiUrl, sessionId, httpsAgent).catch(() => {});
      }
    }
  }

  /**
   * Autenticación con BioStar (POST /api/login).
   * Retorna el bs-session-id del header de respuesta.
   */
  private async authenticateBioStar(
    apiUrl: string,
    loginId: string,
    password: string,
    httpsAgent: https.Agent,
  ): Promise<string> {
    const response = await firstValueFrom(
      this.httpService.post(
        `${apiUrl}/api/login`,
        { User: { login_id: loginId, password } },
        { httpsAgent, timeout: 15000, validateStatus: (s) => s < 500 },
      ),
    );

    if (response.status !== 200) {
      const msg =
        response.data?.Response?.message ||
        response.data?.message ||
        `HTTP ${response.status}`;
      throw new Error(`Autenticación BioStar fallida: ${msg}`);
    }

    const sessionId = response.headers['bs-session-id'];
    if (!sessionId) {
      throw new Error(
        'BioStar respondió 200 OK pero no retornó bs-session-id en los headers.',
      );
    }

    return sessionId;
  }

  /**
   * Crea el usuario visitante en BioStar (POST /api/users).
   *
   * Nivel de cuenta: 100000 (Visitante/Guest según documentación Suprema).
   * Grupo de usuarios: configurable (por defecto 1 = "All Users").
   */
  private async createBioStarUser(
    connection: SupremaApiConnection,
    headers: Record<string, string>,
    httpsAgent: https.Agent,
    visit: Visit,
    visitor: Visitor,
    userGroupId: number,
    accessGroups?: { id: number; name: string }[],
    visualFaceTemplates?: VisualFaceData,
  ): Promise<string> {
    const fullName = `${visitor.firstName} ${visitor.lastName}`.replace(/\s+/g, ' ').trim();

    // Obtener la zona horaria del tenant para convertir UTC → hora local del servidor BioStar.
    // BioStar ignora el indicador de zona horaria (Z) en los campos start/expiry_datetime
    // y trata el valor numérico como hora local — por eso debemos enviar la hora ya convertida.
    const tenantTz = await this.tenantRepo
      .findOne({ where: { id: visit.tenantId }, select: ['timezone'] })
      .then(t => t?.timezone || 'UTC')
      .catch(() => 'UTC');

    const startDatetime  = this.toTenantLocalIso(visit.scheduledAt,  Date.now(), tenantTz);
    const expiryDatetime = this.toTenantLocalIso(visit.expectedEndAt, Date.now() + 24 * 60 * 60 * 1000, tenantTz);

    const isBioStarX = connection.platform === BioStarPlatform.BIOSTAR_X;

    // BioStar X: user_id = número de documento del visitante (ej. "8585858585").
    // IMPORTANTE: BioStar X (y hardware Suprema) pueden tratar user_id como entero interno.
    // Si el documento supera 4,294,967,295 (max uint32), se producen errores confusos.
    // Para documentos > 9 dígitos, tomamos los últimos 9 dígitos (nunca exceden 999,999,999).
    // BioStar 2: acepta strings alfanuméricos/hex hasta 32 chars (usamos el UUID truncado).
    const rawDocId = (visitor.documentNumber ?? '').trim();
    const userId = isBioStarX
      ? (rawDocId.length > 9
          ? rawDocId.slice(-9)         // últimos 9 dígitos → max 999,999,999 < 2^32
          : rawDocId || visitor.id.replace(/-/g, '').substring(0, 9))
      : visitor.id.replace(/-/g, '').substring(0, 32);

    // BioStar 2 y BioStar X comparten la mayor parte del esquema REST, pero:
    // - BioStar X no acepta los campos `permission` ni `login_enabled` de BS2.
    // - BioStar X NO acepta `credentials.visualFaces` en el POST /api/users.
    //   El rostro visual debe enrollarse en un PUT separado post-creación.
    // - BioStar 2 sí acepta credentials.visualFaces en el POST inicial.
    // ── Payload para BioStar 2 (completo) ──────────────────────────────────────────────────
    const userPayloadFull = {
      User: {
        user_id: userId,
        name: fullName.substring(0, 48),
        ...(visitor.email ? { email: visitor.email } : {}),
        ...(!isBioStarX && { login_enabled: false }),
        user_group_id: { id: isBioStarX ? userGroupId : String(userGroupId) },
        ...(!isBioStarX && { permission: { id: '100000' } }),
        start_datetime: startDatetime,
        expiry_datetime: expiryDatetime,
        ...(accessGroups?.length
          ? { access_groups: accessGroups.map((g) => ({ id: isBioStarX ? g.id : String(g.id) })) }
          : {}),
        ...(!isBioStarX && visualFaceTemplates
          ? {
              credentials: {
                visualFaces: [
                  visualFaceTemplates.image
                    ? { template_ex_picture: visualFaceTemplates.image }
                    : {
                        template_ex_normalized_image:
                          visualFaceTemplates.template_ex_normalized_image,
                        templates: visualFaceTemplates.templates,
                      },
                ],
              },
            }
          : {}),
      },
    };

    // ── Payload para BioStar X ─────────────────────────────────────────────────────────────
    // BioStar X requiere user_group_id como OBJETO {id, name}, NO como string/int.
    // Confirmado inspeccionando usuarios existentes: "user_group_id":{"id":"1","name":"All Users"}
    // "All Users" (id=1) es el único grupo en BioStar X — todos los usuarios pertenecen a él.
    // permission.id="2" = "User Operator" — el permiso estándar para usuarios no-administradores.
    const userPayloadMinimal = {
      User: {
        user_id: userId,
        name: fullName.substring(0, 48),
        ...(visitor.email ? { email: visitor.email } : {}),
        start_datetime: startDatetime,
        expiry_datetime: expiryDatetime,
        user_group_id: { id: '1', name: 'All Users' },
        permission: { id: '2' },
      },
    };

    const userPayload = isBioStarX ? userPayloadMinimal : userPayloadFull;

    this.logger.log(
      `📤 Enviando payload de usuario a BioStar ${isBioStarX ? 'X' : '2'} "${connection.name}" (userId: ${userId})`,
    );

    this.logger.log(
      `[BIOSTAR_PAYLOAD] user_id="${userId}" name="${fullName}" ` +
      `start="${startDatetime}" expiry="${expiryDatetime}" ` +
      `user_group_id="${userGroupId}" ` +
      `access_groups=${JSON.stringify((userPayload.User as any).access_groups ?? null)} ` +
      `hasVisualFace=${!!(userPayload.User as any).credentials}`,
    );
    this.logger.log(`[BIOSTAR_PAYLOAD_JSON] ${JSON.stringify(userPayload)}`);

    const response = await firstValueFrom(
      this.httpService.post(`${connection.apiUrl}/api/users`, userPayload, {
        headers,
        httpsAgent,
        timeout: 15000,
        validateStatus: (s) => s < 500,
      }),
    );

    if (response.status !== 200 && response.status !== 201) {
      const msg =
        response.data?.Response?.message ||
        response.data?.message ||
        `HTTP ${response.status}`;

      const bodyPreview = JSON.stringify(response.data).slice(0, 500);
      this.logger.error(
        `[BIOSTAR_POST_USERS] HTTP ${response.status} — ${msg} | body: ${bodyPreview}`,
      );

      // ── UPSERT: si el usuario ya existe en BioStar, actualizamos con PUT ────
      if (msg.toLowerCase().includes('already exists') || response.status === 409) {
        this.logger.warn(
          `⚠️ Usuario "${fullName}" ya existe en BioStar "${connection.name}" — actualizando con PUT /api/users/${userId}…`,
        );
        const putResponse = await firstValueFrom(
          this.httpService.put(
            `${connection.apiUrl}/api/users/${userId}`,
            userPayload,
            { headers, httpsAgent, timeout: 15000, validateStatus: (s) => s < 500 },
          ),
        );
        if (putResponse.status !== 200 && putResponse.status !== 204) {
          const putMsg =
            putResponse.data?.Response?.message ||
            putResponse.data?.message ||
            `HTTP ${putResponse.status}`;
          throw new Error(`Actualización de usuario en BioStar fallida: ${putMsg}`);
        }
        this.logger.log(
          `🔄 Usuario "${fullName}" actualizado en BioStar "${connection.name}" (ID: ${userId})`,
        );
        return userId;
      }

      // ── BioStar X: "User Group doesn't exist" — estrategia de 3 pasos ───────────────────
      // BioStar X requiere user_group_id como objeto {id, name}. Si el payload inicial
      // falla (e.g. cambio de API en versión futura), los fallbacks también usan objeto.
      if (
        isBioStarX &&
        (msg.toLowerCase().includes("user group") || msg.toLowerCase().includes("group doesn"))
      ) {
        this.logger.warn(
          `⚠️ BioStar X: user_group_id causó error. Paso 1: reintentar con permission IDs alternativos + user_group_id objeto…`,
        );

        // ── Paso 1: probar permission IDs alternativos, siempre con user_group_id como objeto ──
        const baseUser = userPayload.User as any;
        const baseWithGroup: any = {
          ...baseUser,
          user_group_id: { id: '1', name: 'All Users' },
        };
        delete baseWithGroup.permission;

        for (const permId of ['1', '2', '3', '4', '5']) {
          const p1 = { User: { ...baseWithGroup, permission: { id: permId } } };
          this.logger.log(`[BSX_RETRY_P1_PERM${permId}] ${JSON.stringify(p1)}`);
          try {
            const r1 = await firstValueFrom(
              this.httpService.post(`${connection.apiUrl}/api/users`, p1, {
                headers, httpsAgent, timeout: 15000, validateStatus: (s) => s < 500,
              }),
            );
            this.logger.log(`[BSX_RETRY_P1_RESP] perm=${permId} status=${r1.status} body=${JSON.stringify(r1.data).slice(0, 300)}`);
            if (r1.status === 200 || r1.status === 201) {
              const retId = r1.data?.User?.user_id || userId;
              this.logger.log(`👤 BSX Paso 1 OK: usuario "${fullName}" creado con permission.id=${permId} — ID: ${retId}`);
              return retId;
            }
            const m1 = r1.data?.Response?.message || r1.data?.message || `HTTP ${r1.status}`;
            this.logger.warn(`⚠️ BSX Paso 1 perm=${permId} falló: ${m1}`);
          } catch (e1: any) {
            this.logger.warn(`⚠️ BSX Paso 1 perm=${permId} excepción: ${e1.message}`);
          }
        }
        this.logger.warn(`⚠️ BSX Paso 1: todos los permission IDs fallaron. Pasando a Paso 2…`);

        // ── Paso 2: crear grupo "BioVisitor Visitors" y usarlo ───────────────────────────
        this.logger.log(`[BSX_RETRY_P2] Inspeccionando usuarios y grupos BioStar X…`);
        try {
          // ── Diagnóstico: ver formato de usuario existente ────────────────────────────
          const sampleUserResp = await firstValueFrom(
            this.httpService.get(`${connection.apiUrl}/api/users?limit=1&offset=0`, {
              headers, httpsAgent, timeout: 10000, validateStatus: () => true,
            }),
          );
          const sampleUser = sampleUserResp.data?.UserCollection?.rows?.[0];
          this.logger.log(`[BSX_SAMPLE_USER] ${JSON.stringify(sampleUser).slice(0, 300)}`);

          // ── Obtener user groups disponibles ──────────────────────────────────────────
          const ugResp = await firstValueFrom(
            this.httpService.get(`${connection.apiUrl}/api/user_groups`, {
              headers, httpsAgent, timeout: 10000, validateStatus: () => true,
            }),
          );
          this.logger.log(`[BIOSTAR_USER_GROUPS_RAW] ${JSON.stringify(ugResp.data).slice(0, 600)}`);
          const rows: any[] = ugResp.data?.UserGroupCollection?.rows || ugResp.data?.rows || [];

          // Buscar si ya existe un grupo no-sistema (distinto a "All Users" id=1)
          const existingVisitors = rows.find(
            (r: any) => r.name === 'BioVisitor Visitors' || (r.id !== '1' && r.id !== 1),
          );

          let newGroupId: string | null = existingVisitors?.id ?? null;

          if (!newGroupId) {
            // Crear grupo hijo de "All Users". Probar múltiples formatos de parent_id:
            // BioStar X puede usar user_group_id como string directa, int, u objeto.
            const rootGroupId = rows[0]?.id ?? '1';
            const parentFormats = [
              { user_group_id: Number(rootGroupId) },           // int: 1
              { user_group_id: String(rootGroupId) },           // string: "1"
              { parent_user_group_id: String(rootGroupId) },    // campo alternativo string
              { parent_user_group_id: Number(rootGroupId) },    // campo alternativo int
            ];

            for (const parentFields of parentFormats) {
              const grpBody = {
                UserGroup: {
                  name: 'BioVisitor Visitors',
                  description: 'Visitantes registrados por BioVisitor X',
                  ...parentFields,
                },
              };
              this.logger.log(`[BSX_CREATE_GROUP_TRY] ${JSON.stringify(grpBody)}`);
              const createGrpResp = await firstValueFrom(
                this.httpService.post(
                  `${connection.apiUrl}/api/user_groups`, grpBody,
                  { headers, httpsAgent, timeout: 10000, validateStatus: () => true },
                ),
              );
              this.logger.log(`[BSX_CREATE_GROUP] status=${createGrpResp.status} body=${JSON.stringify(createGrpResp.data).slice(0, 400)}`);
              const createdId =
                createGrpResp.data?.UserGroup?.id ||
                createGrpResp.data?.id ||
                null;
              if (createdId) {
                newGroupId = createdId;
                break;
              }
            }
          }

          if (newGroupId) {
            const p2 = { User: { ...baseWithGroup, user_group_id: { id: String(newGroupId), name: 'BioVisitor Visitors' }, permission: { id: '2' } } };
            this.logger.log(`[BSX_RETRY_P2_PAYLOAD] ${JSON.stringify(p2)}`);
            const r2 = await firstValueFrom(
              this.httpService.post(`${connection.apiUrl}/api/users`, p2, {
                headers, httpsAgent, timeout: 15000, validateStatus: (s) => s < 500,
              }),
            );
            this.logger.log(`[BSX_RETRY_P2_RESP] status=${r2.status} body=${JSON.stringify(r2.data).slice(0, 300)}`);
            if (r2.status === 200 || r2.status === 201) {
              const retId2 = r2.data?.User?.user_id || userId;
              this.logger.log(`👤 BSX Paso 2 OK: usuario "${fullName}" creado en grupo ${newGroupId} — ID: ${retId2}`);
              return retId2;
            }
            const m2 = r2.data?.Response?.message || r2.data?.message || `HTTP ${r2.status}`;
            throw new Error(`Creación de usuario en BioStar X fallida (paso 2, grupo ${newGroupId}): ${m2}`);
          } else {
            // ── Si no hay grupo disponible, intentar crear usuario con user_group_id del sample user ──
            const sampleGroupId = sampleUser?.user_group?.id ?? sampleUser?.user_group_id?.id ?? sampleUser?.user_group_id ?? '1';
            const sampleGroupName = sampleUser?.user_group?.name ?? sampleUser?.user_group_id?.name ?? 'All Users';
            this.logger.log(`[BSX_SAMPLE_GROUP_ID] ${JSON.stringify(sampleGroupId)}`);
            if (sampleGroupId) {
              const p3 = { User: { ...baseWithGroup, user_group_id: { id: String(sampleGroupId), name: sampleGroupName }, permission: { id: '2' } } };
              this.logger.log(`[BSX_RETRY_P3_PAYLOAD] ${JSON.stringify(p3)}`);
              const r3 = await firstValueFrom(
                this.httpService.post(`${connection.apiUrl}/api/users`, p3, {
                  headers, httpsAgent, timeout: 15000, validateStatus: (s) => s < 500,
                }),
              );
              this.logger.log(`[BSX_RETRY_P3_RESP] status=${r3.status} body=${JSON.stringify(r3.data).slice(0, 300)}`);
              if (r3.status === 200 || r3.status === 201) {
                const retId3 = r3.data?.User?.user_id || userId;
                this.logger.log(`👤 BSX Paso 3 OK: usuario "${fullName}" creado con sampleGroupId ${sampleGroupId} — ID: ${retId3}`);
                return retId3;
              }
              const m3 = r3.data?.Response?.message || r3.data?.message || `HTTP ${r3.status}`;
              throw new Error(`Creación de usuario en BioStar X fallida (paso 3 sample group ${sampleGroupId}): ${m3}`);
            }
            throw new Error(`No se pudo obtener/crear user group en BioStar X. Sample user groups: ${JSON.stringify(sampleUser?.user_group_id ?? sampleUser?.user_group)}`);
          }
        } catch (ugErr: any) {
          if (ugErr.message.includes('fallida') || ugErr.message.includes('pudo')) throw ugErr;
          this.logger.warn(`⚠️ BSX Paso 2 excepción: ${ugErr.message}`);
          throw new Error(`BioStar X: fallo al gestionar user groups: ${ugErr.message}`);
        }
      }

      throw new Error(`Creación de usuario en BioStar fallida: ${msg}`);
    }

    const createdUserId =
      response.data?.User?.user_id ||
      userId;

    this.logger.log(
      `👤 Usuario "${fullName}" creado en BioStar "${connection.name}" (ID: ${createdUserId})`,
    );

    // ── BioStar X: asignar access_groups via PUT separado post-creación ─────────────────
    // BioStar X rechaza access_groups en el POST /api/users ("Invalid Parameters").
    // Se asignan en un PUT /api/users/:id después de que el usuario existe.
    if (isBioStarX && accessGroups?.length) {
      try {
        const agResp = await firstValueFrom(
          this.httpService.put(
            `${connection.apiUrl}/api/users/${createdUserId}`,
            { User: { access_groups: accessGroups.map((g) => ({ id: g.id })) } },
            { headers, httpsAgent, timeout: 15000, validateStatus: () => true },
          ),
        );
        if (agResp.status === 200 || agResp.status === 201) {
          this.logger.log(
            `✅ [ACCESS_GROUPS] Grupos de acceso asignados en BioStar X "${connection.name}" (userId=${createdUserId})`,
          );
        } else {
          const agMsg =
            agResp.data?.Response?.message || agResp.data?.message || `HTTP ${agResp.status}`;
          this.logger.warn(
            `⚠️ [ACCESS_GROUPS] No se pudieron asignar grupos de acceso en BioStar X: ${agMsg}`,
          );
        }
      } catch (agErr: any) {
        this.logger.warn(
          `⚠️ [ACCESS_GROUPS] Error al asignar access_groups en BioStar X: ${agErr.message}`,
        );
      }
    }

    // ── BioStar X: enrollar rostro visual en PUT separado post-creación ──────────────
    // BioStar X rechaza credentials.visualFaces en el POST /api/users (Invalid Parameters).
    // La cara debe enviarse via PUT /api/users/:id después de que el usuario existe.
    if (isBioStarX && visualFaceTemplates) {
      try {
        const faceNode = visualFaceTemplates.image
          ? { template_ex_picture: visualFaceTemplates.image }
          : {
              template_ex_normalized_image: visualFaceTemplates.template_ex_normalized_image,
              templates: visualFaceTemplates.templates,
            };

        const faceResp = await firstValueFrom(
          this.httpService.put(
            `${connection.apiUrl}/api/users/${createdUserId}`,
            { User: { credentials: { visualFaces: [faceNode] } } },
            { headers, httpsAgent, timeout: 15000, validateStatus: () => true },
          ),
        );

        if (faceResp.status === 200 || faceResp.status === 201) {
          this.logger.log(
            `✅ [VISUAL_FACE] Rostro visual enrollado en BioStar X "${connection.name}" (userId=${createdUserId})`,
          );
        } else {
          const faceMsg =
            faceResp.data?.Response?.message ||
            faceResp.data?.message ||
            `HTTP ${faceResp.status}`;
          this.logger.warn(
            `⚠️ [VISUAL_FACE] No se pudo enrollar rostro en BioStar X "${connection.name}": ${faceMsg} — usuario creado sin credencial facial`,
          );
        }
      } catch (faceErr: any) {
        this.logger.warn(
          `⚠️ [VISUAL_FACE] Error al enrollar rostro en BioStar X "${connection.name}": ${faceErr.message} — usuario creado sin credencial facial`,
        );
      }
    }

    return createdUserId;
  }

  /**
   * Enrola un código QR dinámico en BioStar (2 pasos) y lo asigna al usuario.
   *
   * Paso 1 — POST /api/cards: Registra la tarjeta QR/Barcode (card_type 6).
   *   BioStar asigna un ID interno único a la tarjeta.
   * Paso 2 — PUT /api/users/:id: Asigna la tarjeta al usuario visitante
   *   reemplazando cualquier tarjeta QR anterior (el payload sustituye la lista completa).
   *
   * Retorna el ID interno de BioStar para que pueda ser persistido en Redis
   * y borrado explícitamente en el próximo refresh de QR.
   */
  private async enrollQrCard(
    apiUrl: string,
    headers: Record<string, string>,
    httpsAgent: https.Agent,
    supremaUserId: string,
    qrJti: string,
    oldQrInternalCardId?: string | null,
  ): Promise<string> {
    const cardValue = qrJti.substring(0, 32);

    // ── Paso 1: Registrar la tarjeta en el sistema de tarjetas de BioStar ───
    const enrollPayload = {
      CardCollection: {
        rows: [
          {
            card_id: cardValue,
            card_type: { id: '6', type: '6' },
          },
        ],
      },
    };

    const enrollResponse = await firstValueFrom(
      this.httpService.post(`${apiUrl}/api/cards`, enrollPayload, {
        headers,
        httpsAgent,
        timeout: 10000,
        validateStatus: (s) => s < 500,
      }),
    );

    if (enrollResponse.status !== 200 && enrollResponse.status !== 201) {
      const msg =
        enrollResponse.data?.Response?.message ||
        enrollResponse.data?.message ||
        `HTTP ${enrollResponse.status}`;
      throw new Error(`Enrolamiento QR (Paso 1) fallido: ${msg}`);
    }

    const internalCardId: string =
      String(enrollResponse.data?.CardCollection?.rows?.[0]?.id) ||
      String(enrollResponse.data?.CardCollection?.rows?.[0]?.card_id) ||
      cardValue;

    this.logger.log(
      `🃏 QR "${cardValue}" enrolado en BioStar (ID interno: ${internalCardId})`,
    );

    // ── Paso 2: Asignar la tarjeta al usuario visitante ─────────────────────
    // IMPORTANTE: BioStar REEMPLAZA por completo el array `cards` del usuario
    // con lo que se envíe aquí — nunca hace merge. Si se manda solo el QR,
    // cualquier otra credencial física (RFID/SMART_CARD) ya vinculada al
    // usuario se pierde en cada rotación de QR. Por eso se debe leer primero
    // el estado actual del usuario y conservar sus demás tarjetas, quitando
    // únicamente la entrada del QR anterior (si se indicó explícitamente).
    const currentUserResp = await firstValueFrom(
      this.httpService.get(`${apiUrl}/api/users/${supremaUserId}`, {
        headers, httpsAgent, timeout: 10000, validateStatus: () => true,
      }),
    );
    const currentCards: any[] = currentUserResp.data?.User?.cards ?? [];
    const preservedCards = currentCards.filter(
      (c: any) =>
        String(c.id ?? '') !== String(internalCardId) &&
        (!oldQrInternalCardId || String(c.id ?? '') !== String(oldQrInternalCardId)),
    );
    this.logger.debug(
      `[DEBUG_QR] Preservando ${preservedCards.length} tarjeta(s) existente(s) al asignar QR (usuario ${supremaUserId})`,
    );

    const assignPayload = {
      User: {
        cards: [...preservedCards, { id: internalCardId }],
      },
    };

    const assignResponse = await firstValueFrom(
      this.httpService.put(
        `${apiUrl}/api/users/${supremaUserId}`,
        assignPayload,
        {
          headers,
          httpsAgent,
          timeout: 10000,
          validateStatus: (s) => s < 500,
        },
      ),
    );

    if (assignResponse.status !== 200 && assignResponse.status !== 201) {
      const msg =
        assignResponse.data?.Response?.message ||
        assignResponse.data?.message ||
        `HTTP ${assignResponse.status}`;
      throw new Error(`Asignación QR al usuario (Paso 2) fallida: ${msg}`);
    }

    this.logger.log(
      `✅ QR asignado exitosamente al usuario BioStar "${supremaUserId}"`,
    );

    return internalCardId;
  }

  /**
   * Elimina físicamente una tarjeta del sistema de BioStar (DELETE /api/cards/:id).
   *
   * Se llama durante el refresh dinámico del QR para invalidar la tarjeta anterior
   * a nivel de hardware: aunque el usuario ya no la tenga asignada, borrarla del
   * sistema impide cualquier acceso residual que pueda ocurrir por caché en el lector.
   *
   * No lanza excepciones — si falla, se loguea como warning y se continúa.
   */
  private async deleteBioStarCard(
    apiUrl: string,
    headers: Record<string, string>,
    httpsAgent: https.Agent,
    internalCardId: string,
  ): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.httpService.delete(`${apiUrl}/api/cards/${internalCardId}`, {
          headers,
          httpsAgent,
          timeout: 8000,
          validateStatus: (s) => s < 500,
        }),
      );
      if (response.status === 200 || response.status === 204) {
        this.logger.log(`🗑️ Tarjeta QR anterior (ID: ${internalCardId}) eliminada de BioStar`);
      } else {
        this.logger.warn(
          `⚠️ BioStar respondió ${response.status} al eliminar tarjeta ${internalCardId} — puede que ya no existiera`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`⚠️ No se pudo eliminar tarjeta ${internalCardId} de BioStar: ${err.message}`);
    }
  }

  /**
   * Extrae los templates biométricos de rostro visual enviando la foto a BioStar.
   *
   * PUT /api/users/check/upload_picture — BioStar valida la calidad de la imagen
   * y genera los templates biométricos para FaceStation F2 / BioStation 3.
   *
   * @throws Error con name='VisualFaceQualityError' si BioStar rechaza la foto (400)
   */
  private async extractVisualFaceTemplates(
    apiUrl: string,
    headers: Record<string, string>,
    httpsAgent: https.Agent,
    photoBase64: string,
  ): Promise<VisualFaceData> {
    const cleanBase64 = photoBase64.replace(
      /^data:image\/[a-z]+;base64,/,
      '',
    );

    const response = await firstValueFrom(
      this.httpService.put(
        `${apiUrl}/api/users/check/upload_picture`,
        { template_ex_picture: cleanBase64 },
        {
          headers,
          httpsAgent,
          timeout: 20000,
          validateStatus: (s) => s < 500,
        },
      ),
    );

    if (response.status === 400) {
      const msg =
        response.data?.Response?.message ||
        response.data?.message ||
        'Calidad de foto insuficiente: BioStar no pudo detectar/validar el rostro';
      const err = new Error(`VISUAL_FACE_QUALITY: ${msg}`);
      err.name = 'VisualFaceQualityError';
      throw err;
    }

    if (response.status !== 200) {
      const msg =
        response.data?.Response?.message ||
        response.data?.message ||
        `HTTP ${response.status}`;
      throw new Error(`Extracción de templates biométricos fallida: ${msg}`);
    }

    // ── BioStar X: devuelve {"image": "base64..."} — imagen validada lista para enrollar ──
    const imageOnly: string | undefined = response.data?.image;
    if (imageOnly) {
      this.logger.log(
        `🧠 BioStar X: imagen facial procesada recibida (formato image-only)`,
      );
      return { image: imageOnly };
    }

    // ── BioStar 2: templates en la raíz ──
    const normalized: string | undefined =
      response.data?.template_ex_normalized_image;
    const templates: VisualFaceData['templates'] | undefined =
      response.data?.templates;

    if (!normalized || !Array.isArray(templates) || templates.length === 0) {
      // Log de diagnóstico para identificar la estructura real en un formato desconocido
      const preview = JSON.stringify(response.data).slice(0, 400);
      this.logger.warn(
        `[VISUAL_FACE] Estructura de respuesta desconocida de BioStar. Preview: ${preview}`,
      );
      throw new Error(
        'BioStar no retornó templates biométricos válidos (formato de respuesta no reconocido).',
      );
    }

    this.logger.log(
      `🧠 Templates biométricos extraídos de BioStar 2 (${templates.length} template(s))`,
    );

    return { template_ex_normalized_image: normalized, templates };
  }

  /**
   * Sincroniza TODAS las credenciales físicas (RFID, SMART_CARD) de una visita con BioStar.
   *
   * Para cada tarjeta registrada localmente que no esté sincronizada:
   * 1. POST /api/cards para asignarla al usuario en BioStar
   * 2. Actualiza syncStatus de la credencial en la BD local
   *
   * Tipos de tarjeta BioStar:
   * - CSN (type ID 1): Número de tarjeta en decimal/hex
   * - QR Code (type ID 2): Código generado
   * - Wiegand (type ID 4): Formato facility-card
   * - Smart Card custom (type ID 6)
   */
  private async syncCardCredentials(
    apiUrl: string,
    headers: Record<string, string>,
    httpsAgent: https.Agent,
    supremaUserId: string,
    visitId: string,
    platform?: BioStarPlatform,
  ): Promise<void> {
    const physicalCredentials = await this.credentialRepo.find({
      where: [
        { visitId, type: CredentialType.RFID,       syncStatus: CredentialSyncStatus.PENDING },
        { visitId, type: CredentialType.RFID,       syncStatus: CredentialSyncStatus.FAILED  },
        { visitId, type: CredentialType.SMART_CARD, syncStatus: CredentialSyncStatus.PENDING },
        { visitId, type: CredentialType.SMART_CARD, syncStatus: CredentialSyncStatus.FAILED  },
      ],
    });

    if (physicalCredentials.length === 0) return;

    // Deduplicar por (type, cardNumber): si el operador agregó el mismo número de
    // tarjeta más de una vez (p. ej. reintentos manuales desde "Agregar credencial"),
    // solo se procesa la primera contra BioStar. Las duplicadas se marcan SYNCED
    // apuntando al mismo supremaCardId, en vez de reintentar el POST y producir un
    // segundo error confuso para una tarjeta que ya quedó enrolada.
    const seen = new Map<string, string>(); // key `${type}:${cardNumber}` → credential.id ya procesado
    const toProcess: typeof physicalCredentials = [];
    const duplicates: typeof physicalCredentials = [];
    for (const cred of physicalCredentials) {
      const key = `${cred.type}:${cred.cardNumber}`;
      if (seen.has(key)) {
        duplicates.push(cred);
      } else {
        seen.set(key, cred.id);
        toProcess.push(cred);
      }
    }

    if (duplicates.length > 0) {
      this.logger.warn(
        `🃏 ${duplicates.length} credencial(es) duplicada(s) detectada(s) para visita ${visitId} (mismo tipo+número de tarjeta) — se omite reintento.`,
      );
    }

    this.logger.log(
      `🃏 Sincronizando ${toProcess.length} credencial(es) física(s) de visita ${visitId}`,
    );

    const isBioStarX = platform === BioStarPlatform.BIOSTAR_X;

    for (const credential of toProcess) {
      if (!credential.cardNumber) {
        this.logger.warn(
          `⚠️ Credencial ${credential.id} de tipo ${credential.type} sin cardNumber, omitiendo.`,
        );
        continue;
      }

      try {
        // Nota: este cardTypeId solo se usa en la rama BioStar 2 (1-paso) más abajo;
        // BioStar X calcula su propio mapeo (RFID_SUBTYPE_MAP / SMART_CARD_TYPE) por separado.
        const cardTypeId = credential.type === CredentialType.SMART_CARD ? '6' : '1';
        let biostarCardId: string = credential.cardNumber;

        if (isBioStarX) {
          // ── BioStar X: POST /api/cards (1 intento, tipo exacto) + PUT /api/users/:id ──
          //
          // Tabla confirmada en vivo contra GET /api/cards/types de BioStar X:
          //   id | name          | type | subtipo credential.cardSubtype
          //   ---|---------------|------|-------------------------------
          //    0 | CSN           |  1   | CSN (default)
          //    1 | CSN Wiegand   |  10  | WIEGAND
          //    4 | CSN Mobile    |  4   | MOBILE_CSN
          //    8 | Custom Smart Card | 13 | (SMART_CARD)
          //
          // El card_id se envía SIEMPRE en decimal (NO se convierte a hexadecimal) —
          // el mapeo anterior que forzaba hex de 8 chars y card_type genérico
          // producía el error "Invalid Card ID" en BioStar X.
          const RFID_SUBTYPE_MAP: Record<string, { id: string; type: string }> = {
            CSN:        { id: '0', type: '1' },
            WIEGAND:    { id: '1', type: '10' },
            MOBILE_CSN: { id: '4', type: '4' },
          };
          const SMART_CARD_TYPE = { id: '8', type: '13' };

          const cardIdToSend = credential.cardNumber;
          const biostarCardType = credential.type === CredentialType.SMART_CARD
            ? SMART_CARD_TYPE
            : (RFID_SUBTYPE_MAP[credential.cardSubtype ?? 'CSN'] ?? RFID_SUBTYPE_MAP.CSN);

          const postPayload = {
            CardCollection: {
              rows: [{ card_id: cardIdToSend, card_type: { id: biostarCardType.id, type: biostarCardType.type } }],
            },
          };

          this.logger.log(
            `🃏 [${credential.type}${credential.cardSubtype ? '/' + credential.cardSubtype : ''}] POST /api/cards — card_id=${cardIdToSend} (decimal) card_type=${JSON.stringify(biostarCardType)}`,
          );

          const postResp = await firstValueFrom(
            this.httpService.post(`${apiUrl}/api/cards`, postPayload, {
              headers, httpsAgent, timeout: 10000, validateStatus: () => true,
            }),
          );

          let internalCardId: string;

          if (postResp.status === 200 || postResp.status === 201) {
            internalCardId =
              String(postResp.data?.CardCollection?.rows?.[0]?.id ??
              postResp.data?.CardCollection?.rows?.[0]?.card_id ??
              cardIdToSend);
            this.logger.log(`✅ Tarjeta registrada en BioStar X (ID interno: ${internalCardId})`);
            this.logger.debug(`[DEBUG_CARD] POST /api/cards response: ${JSON.stringify(postResp.data)}`);
          } else if (postResp.status === 409) {
            // La tarjeta ya existe en BioStar — tratar como éxito
            internalCardId = cardIdToSend;
            this.logger.log(`🃏 Tarjeta ya existe en BioStar X (card_id: ${internalCardId}) — omitiendo duplicado`);
          } else {
            const errMsg = postResp.data?.Response?.message || postResp.data?.message || `HTTP ${postResp.status}`;
            throw new Error(`POST /api/cards falló: ${errMsg}`);
          }

          // Paso 2: asignar la tarjeta al usuario (preservando otras tarjetas existentes)
          const userResp = await firstValueFrom(
            this.httpService.get(`${apiUrl}/api/users/${supremaUserId}`, {
              headers, httpsAgent, timeout: 10000, validateStatus: () => true,
            }),
          );
          const existingCards: any[] = userResp.data?.User?.cards ?? [];
          // Deduplicar: eliminar cualquier entrada previa con el mismo card_id o id interno
          const filteredCards = existingCards.filter(
            (c: any) =>
              String(c.id  ?? '') !== String(internalCardId) &&
              String(c.card_id ?? '') !== cardIdToSend,
          );
          this.logger.debug(
            `[DEBUG_CARD] GET /api/users/${supremaUserId} existingCards=${JSON.stringify(existingCards)} filteredCards=${JSON.stringify(filteredCards)}`,
          );
          const assignPayload = { User: { cards: [...filteredCards, { id: internalCardId }] } };
          this.logger.debug(`[DEBUG_CARD] PUT /api/users/${supremaUserId} payload: ${JSON.stringify(assignPayload)}`);
          const assignResp = await firstValueFrom(
            this.httpService.put(
              `${apiUrl}/api/users/${supremaUserId}`,
              assignPayload,
              { headers, httpsAgent, timeout: 10000, validateStatus: () => true },
            ),
          );
          this.logger.debug(`[DEBUG_CARD] PUT /api/users assign response status=${assignResp.status} body=${JSON.stringify(assignResp.data)}`);
          if (assignResp.status !== 200 && assignResp.status !== 201) {
            const msg = assignResp.data?.Response?.message || assignResp.data?.message || `HTTP ${assignResp.status}`;
            throw new Error(`Asignación de tarjeta al usuario fallida (Paso 2): ${msg}`);
          }

          // Verificación: releer el usuario para confirmar que la tarjeta quedó realmente vinculada.
          const verifyResp = await firstValueFrom(
            this.httpService.get(`${apiUrl}/api/users/${supremaUserId}`, {
              headers, httpsAgent, timeout: 10000, validateStatus: () => true,
            }),
          );
          const verifyCards: any[] = verifyResp.data?.User?.cards ?? [];
          const isLinked = verifyCards.some(
            (c: any) => String(c.id ?? '') === String(internalCardId) || String(c.card_id ?? '') === cardIdToSend,
          );
          this.logger.debug(`[DEBUG_CARD] Verificación post-asignación: cards=${JSON.stringify(verifyCards)} isLinked=${isLinked}`);
          if (!isLinked) {
            throw new Error(
              `La tarjeta se creó/asignó sin error HTTP pero no aparece vinculada al usuario tras verificar (GET /api/users/${supremaUserId})`,
            );
          }
          this.logger.log(`✅ Tarjeta ${cardIdToSend} asignada a usuario BioStar X ${supremaUserId}`);
          biostarCardId = internalCardId;

        } else {
          // ── BioStar 2: proceso en 1 paso (user_id en el payload de tarjeta) ──
          const cardPayload = {
            CardCollection: {
              rows: [
                {
                  card_id: credential.cardNumber,
                  card_type: { id: cardTypeId },
                  user_id: { user_id: supremaUserId },
                },
              ],
            },
          };
          const response = await firstValueFrom(
            this.httpService.post(`${apiUrl}/api/cards`, cardPayload, {
              headers, httpsAgent, timeout: 10000, validateStatus: (s) => s < 500,
            }),
          );
          if (response.status !== 200 && response.status !== 201) {
            const msg = response.data?.Response?.message || response.data?.message || `HTTP ${response.status}`;
            throw new Error(msg);
          }
          biostarCardId = response.data?.CardCollection?.rows?.[0]?.card_id || credential.cardNumber;
          this.logger.log(`✅ Tarjeta ${credential.cardNumber} (${credential.type}) sincronizada en BioStar 2 para usuario ${supremaUserId}`);
        }

        credential.syncStatus = CredentialSyncStatus.SYNCED;
        credential.supremaCardId = biostarCardId;
        credential.lastSyncError = null;
        credential.lastSyncAttemptAt = new Date();

      } catch (err: any) {
        credential.syncStatus = CredentialSyncStatus.PENDING;
        credential.lastSyncError = this.buildSyncError(err);
        credential.lastSyncAttemptAt = new Date();
        this.logger.warn(
          `⚠️ Fallo asignación de tarjeta ${credential.cardNumber}: ${credential.lastSyncError}`,
        );
      }

      await this.credentialRepo.save(credential);
    }

    if (duplicates.length > 0) {
      for (const dup of duplicates) {
        const master = toProcess.find(
          (c) => c.type === dup.type && c.cardNumber === dup.cardNumber,
        );
        dup.syncStatus = master?.syncStatus === CredentialSyncStatus.SYNCED
          ? CredentialSyncStatus.SYNCED
          : dup.syncStatus;
        dup.supremaCardId = master?.supremaCardId ?? dup.supremaCardId;
        dup.lastSyncError = master?.syncStatus === CredentialSyncStatus.SYNCED
          ? null
          : 'Tarjeta duplicada (mismo número ya registrado en otra credencial de esta visita)';
        dup.lastSyncAttemptAt = new Date();
        await this.credentialRepo.save(dup);
      }
    }
  }

  /**
   * Importa el evento de acceso en BioStar para que aparezca en los logs.
   * Código 4088 = Access Granted (entrada autorizada).
   * Requiere un Virtual Device en BioStar (rango ID 100001–999999).
   */
  private async importAccessEvent(
    apiUrl: string,
    headers: Record<string, string>,
    httpsAgent: https.Agent,
    supremaUserId: string,
    eventDatetime: Date,
  ): Promise<void> {
    const eventPayload = {
      EventCollection: {
        rows: [
          {
            event_type_id: { code: '4088' },
            user_id: { user_id: supremaUserId },
            datetime: eventDatetime.toISOString(),
            device_id: { id: '100001' },
          },
        ],
      },
    };

    await firstValueFrom(
      this.httpService.post(`${apiUrl}/api/events/import`, eventPayload, {
        headers,
        httpsAgent,
        timeout: 10000,
      }),
    );

    this.logger.log(
      `📋 Evento de acceso (4088) importado en BioStar para usuario ${supremaUserId}`,
    );
  }

  /**
   * Cierra la sesión en BioStar (POST /api/logout).
   * Se ejecuta siempre en el bloque finally para no dejar sesiones abiertas.
   */
  private async logout(
    apiUrl: string,
    sessionId: string,
    httpsAgent: https.Agent,
  ): Promise<void> {
    await firstValueFrom(
      this.httpService.post(
        `${apiUrl}/api/logout`,
        {},
        {
          headers: { 'bs-session-id': sessionId },
          httpsAgent,
          timeout: 5000,
        },
      ),
    );
  }

  /**
   * Persiste el nuevo syncStatus de la visita en la BD.
   */
  private async updateVisitSyncStatus(
    visit: Visit,
    status: SyncStatusValue,
    supremaUserId: string | null,
    errorMessage: string | null,
  ): Promise<void> {
    visit.syncStatus = status;
    visit.lastSyncAttemptAt = new Date();
    visit.lastSyncError = errorMessage;
    if (supremaUserId) {
      visit.supremaUserRefId = supremaUserId;
    }
    await this.visitRepo.save(visit);
  }

  /**
   * Construye mensajes de error descriptivos y seguros para el operador.
   */
  private buildSyncError(error: any): string {
    if (error.code === 'ECONNREFUSED') {
      return 'El servidor BioStar rechazó la conexión. Verifica que esté activo y accesible.';
    }
    if (error.code === 'ENOTFOUND') {
      return 'No se puede resolver el hostname del servidor BioStar. Verifica la URL configurada.';
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return 'Timeout: el servidor BioStar no respondió en 15 segundos.';
    }
    if (
      error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      error.code === 'CERT_HAS_EXPIRED'
    ) {
      return 'Error de certificado SSL con el servidor BioStar. Configura el certificado CA.';
    }
    if (error.response?.status === 401) {
      return 'Credenciales de BioStar incorrectas. Actualiza el login_id y contraseña en Configuración.';
    }
    if (error.response?.status === 403) {
      return 'El usuario de BioStar no tiene permisos de administrador.';
    }
    return error.message || 'Error desconocido al sincronizar con BioStar.';
  }
}
