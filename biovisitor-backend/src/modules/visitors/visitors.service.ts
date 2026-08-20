/**
 * @file visitors.service.ts
 * @description Servicio para gestión de visitantes y visitas.
 *
 * Orquesta la creación de visitantes, programación de visitas, check-in, check-out,
 * y la integración automática con la API de BioStar (mediante el Suprema Gateway).
 *
 * @module modules/visitors
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Repository, DataSource, Raw, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import {
  Visitor,
  Visit,
  VisitStatus,
  AccessMethod,
  AccessCredential,
  CredentialType,
  RfidCardSubtype,
  Tenant,
  Host,
  VisitorAsset,
  AssetCategory,
  VisitorVehicle,
  VehicleType,
} from '../../database/entities';
import { VisitorType } from '../../database/entities/visit.entity';
import { CredentialSyncStatus } from '../../database/entities/access-credential.entity';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitorDto } from './dto/update-visitor.dto';
import { InviteVisitorsDto } from './dto/invite-visitors.dto';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { SupremaGatewayService } from '../suprema-gateway/suprema-gateway.service';
import { QrEngineService } from '../qr-engine/qr-engine.service';
import { StructuredLoggerService } from '../../core/logging/structured-logger.service';
import { EncryptionService } from '../../core/crypto/encryption.service';
import { EventsGateway } from '../events/events.gateway';
import { SupremaSyncService, SyncStatus } from './suprema-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExitLinksService } from './exit-links.service';

@Injectable()
export class VisitorsService {
  private readonly logger = new Logger(VisitorsService.name);

  constructor(
    @InjectRepository(Visitor)
    private readonly visitorRepository: Repository<Visitor>,
    @InjectRepository(Visit)
    private readonly visitRepository: Repository<Visit>,
    @InjectRepository(AccessCredential)
    private readonly credentialRepository: Repository<AccessCredential>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(Host)
    private readonly hostRepository: Repository<Host>,
    @InjectRepository(VisitorAsset)
    private readonly assetRepository: Repository<VisitorAsset>,
    @InjectRepository(VisitorVehicle)
    private readonly vehicleRepository: Repository<VisitorVehicle>,
    private readonly supremaGateway: SupremaGatewayService,
    private readonly qrEngine: QrEngineService,
    private readonly structuredLogger: StructuredLoggerService,
    private readonly dataSource: DataSource,
    private readonly eventsGateway: EventsGateway,
    private readonly supremaSync: SupremaSyncService,
    private readonly notifications: NotificationsService,
    private readonly exitLinks: ExitLinksService,
    @InjectRedis() private readonly redis: Redis,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * Busca un visitante existente por número de documento dentro del tenant.
   * También retorna el número de visitas activas (SCHEDULED o CHECKED_IN) del día de hoy.
   * Usado para auto-relleno y control de duplicados en el frontend.
   */
  async lookupByDocument(
    tenantId: string,
    documentType: string,
    documentNumber: string,
  ): Promise<{
    visitor: Visitor;
    activeVisitsToday: number;
    activeVisit: Visit | null;
    visitCount: number;
    isFrecuent: boolean;
    suggestedHostId: string | null;
    suggestedHostName: string | null;
    suggestedPurpose: string | null;
    suggestedAccessGroups: Array<{ id: number; name: string }>;
    recentVisits: Array<{
      id: string;
      date: string | null;
      purpose: string | null;
      status: string;
      hostName: string | null;
    }>;
  } | null> {
    const visitor = await this.visitorRepository.findOne({
      where: {
        tenantId,
        documentType: documentType as any,
        documentNumber: documentNumber.trim(),
      },
    });

    if (!visitor) return null;

    // Contar visitas activas (SCHEDULED o CHECKED_IN) del día de hoy
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // Ejecutar todas las consultas de enriquecimiento en paralelo
    const [activeVisitsToday, activeVisit, visitCount, pastVisits] =
      await Promise.all([
        // 1. Visitas activas hoy
        this.visitRepository.count({
          where: [
            {
              visitorId: visitor.id,
              tenantId,
              status: VisitStatus.SCHEDULED,
              scheduledAt: Raw(
                (alias) => `${alias} BETWEEN :start AND :end`,
                { start: startOfDay, end: endOfDay },
              ),
            },
            { visitorId: visitor.id, tenantId, status: VisitStatus.CHECKED_IN },
          ],
        }),
        // 2. Visita activa más reciente
        this.visitRepository.findOne({
          where: [
            { visitorId: visitor.id, tenantId, status: VisitStatus.CHECKED_IN },
            { visitorId: visitor.id, tenantId, status: VisitStatus.SCHEDULED },
            { visitorId: visitor.id, tenantId, status: VisitStatus.PRE_REGISTERED },
          ],
          order: { scheduledAt: 'DESC' },
        }),
        // 3. Total de visitas históricas
        this.visitRepository.count({
          where: { visitorId: visitor.id, tenantId },
        }),
        // 4. Últimas visitas completadas para calcular sugerencias
        this.visitRepository.find({
          where: {
            visitorId: visitor.id,
            tenantId,
            status: In([VisitStatus.CHECKED_OUT, VisitStatus.CHECKED_IN]),
          },
          order: { checkedOutAt: 'DESC', checkedInAt: 'DESC' },
          take: 20,
          relations: ['host'],
        }),
      ]);

    // ── Calcular sugerencias a partir del historial ────────────────────
    // Host más frecuente
    const hostFreq: Record<string, { hostId: string; hostName: string; count: number }> = {};
    for (const v of pastVisits) {
      if (v.hostId && v.host) {
        if (!hostFreq[v.hostId]) {
          hostFreq[v.hostId] = { hostId: v.hostId, hostName: v.host.fullName, count: 0 };
        }
        hostFreq[v.hostId].count++;
      }
    }
    const topHost =
      Object.values(hostFreq).sort((a, b) => b.count - a.count)[0] ?? null;

    // Propósito más frecuente
    const purposeFreq: Record<string, number> = {};
    for (const v of pastVisits) {
      if (v.purpose) purposeFreq[v.purpose] = (purposeFreq[v.purpose] ?? 0) + 1;
    }
    const topPurpose =
      Object.entries(purposeFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    // Grupos de acceso de la visita más reciente
    const suggestedAccessGroups: Array<{ id: number; name: string }> =
      pastVisits[0]?.accessGroups ?? [];

    // Visitas recientes para mostrar al operador (últimas 5)
    const recentVisits = pastVisits.slice(0, 5).map((v) => ({
      id: v.id,
      date: v.checkedInAt?.toISOString() ?? v.scheduledAt?.toISOString() ?? null,
      purpose: v.purpose ?? null,
      status: v.status,
      hostName: v.host?.fullName ?? null,
    }));

    return {
      visitor,
      activeVisitsToday,
      activeVisit: activeVisit ?? null,
      visitCount,
      isFrecuent: visitCount >= 3,
      suggestedHostId: topHost?.hostId ?? null,
      suggestedHostName: topHost?.hostName ?? null,
      suggestedPurpose: topPurpose,
      suggestedAccessGroups,
      recentVisits,
    };
  }

  /**
   * Retorna el historial paginado de visitas de un visitante específico.
   * Usado en el modal de detalle para mostrar "Visitas anteriores".
   */
  async getVisitorHistory(
    visitorId: string,
    tenantId: string,
    limit = 10,
    offset = 0,
  ): Promise<{ visits: any[]; total: number }> {
    const [visits, total] = await this.visitRepository.findAndCount({
      where: { visitorId, tenantId },
      order: { scheduledAt: 'DESC' },
      take: limit,
      skip: offset,
      relations: ['host'],
    });

    return {
      total,
      visits: visits.map((v) => ({
        id: v.id,
        status: v.status,
        purpose: v.purpose ?? null,
        scheduledAt: v.scheduledAt ?? null,
        checkedInAt: v.checkedInAt ?? null,
        checkedOutAt: v.checkedOutAt ?? null,
        hostName: v.host?.fullName ?? null,
        accessGroups: v.accessGroups ?? [],
      })),
    };
  }

  /**
   * Retorna la lista paginada de visitantes frecuentes del tenant.
   * Un visitante se considera frecuente si tiene >= minVisits visitas
   * dentro de una ventana de tiempo rolling de windowDays días.
   */
  async getFrequentVisitors(
    tenantId: string,
    options: {
      minVisits?: number;
      windowDays?: number;
      visitorType?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ visitors: any[]; total: number }> {
    const {
      minVisits = 3,
      windowDays = 180,
      visitorType,
      limit = 100,
      offset = 0,
    } = options;

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - windowDays);

    // Paso 1: obtener visitor IDs que superan el umbral con sus conteos
    const qb = this.visitRepository
      .createQueryBuilder('vt')
      .select('vt.visitorId', 'visitorId')
      .addSelect('COUNT(vt.id)', 'visitCount')
      .addSelect('MAX(vt.scheduledAt)', 'lastVisitDate')
      .addSelect('MIN(vt.scheduledAt)', 'firstVisitDate')
      .where('vt.tenantId = :tenantId', { tenantId })
      .andWhere('vt.scheduledAt >= :windowStart', { windowStart })
      .andWhere('vt.status IN (:...statuses)', {
        statuses: [VisitStatus.CHECKED_IN, VisitStatus.CHECKED_OUT, VisitStatus.SCHEDULED],
      })
      .groupBy('vt.visitorId')
      .having('COUNT(vt.id) >= :minVisits', { minVisits })
      .orderBy('COUNT(vt.id)', 'DESC');

    const rawAll = await qb.getRawMany();
    const total = rawAll.length;

    const page = rawAll.slice(offset, offset + limit);
    if (page.length === 0) return { visitors: [], total };

    const visitorIds: string[] = page.map((r) => r.visitorId);
    const countMap = new Map<string, { visitCount: number; lastVisitDate: Date; firstVisitDate: Date }>(
      page.map((r) => [
        r.visitorId,
        {
          visitCount: Number(r.visitCount),
          lastVisitDate: r.lastVisitDate,
          firstVisitDate: r.firstVisitDate,
        },
      ]),
    );

    // Paso 2: obtener detalles de los visitantes
    let visitorsQuery = this.visitorRepository
      .createQueryBuilder('v')
      .where('v.id IN (:...ids)', { ids: visitorIds })
      .andWhere('v.tenantId = :tenantId', { tenantId });

    if (visitorType) {
      visitorsQuery = visitorsQuery.andWhere('v.visitorType = :visitorType', { visitorType });
    }

    const visitors = await visitorsQuery.getMany();

    // Ordenar por visitCount descendente (mismo orden que rawAll)
    visitors.sort((a, b) => {
      const ca = countMap.get(a.id)?.visitCount ?? 0;
      const cb = countMap.get(b.id)?.visitCount ?? 0;
      return cb - ca;
    });

    return {
      total,
      visitors: visitors.map((v) => {
        const meta = countMap.get(v.id);
        return {
          id: v.id,
          firstName: v.firstName,
          lastName: v.lastName,
          fullName: `${v.firstName} ${v.lastName}`,
          company: v.company ?? null,
          email: v.email ?? null,
          documentType: v.documentType,
          documentNumber: v.documentNumber,
          photoPath: v.photoPath ?? null,
          visitorType: (v as any).visitorType ?? null,
          visitCount: meta?.visitCount ?? 0,
          lastVisitDate: meta?.lastVisitDate ?? null,
          firstVisitDate: meta?.firstVisitDate ?? null,
          isFrecuent: true,
        };
      }),
    };
  }

  /**
   * Realiza el check-in manual de una visita (SCHEDULED/PRE_REGISTERED → CHECKED_IN).
   * Registra `checkedInAt` y emite evento en tiempo real.
   */
  async checkInVisit(
    visitId: string,
    tenantId: string,
    auditorUserId: string,
    auditorUserName?: string,
    skipAudit = false,
    expiresAt?: Date,
    startsAt?: Date,
    autoCheckoutEnabled?: boolean,
  ): Promise<Visit> {
    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
      relations: ['visitor', 'hostUser', 'host'],
    });
    if (!visit) throw new NotFoundException('Visita no encontrada');

    if (visit.status === VisitStatus.CHECKED_IN) {
      throw new BadRequestException('El visitante ya realizó check-in.');
    }
    if (visit.status === VisitStatus.CANCELLED) {
      throw new BadRequestException('Esta visita fue cancelada.');
    }

    const now = new Date();
    visit.status = VisitStatus.CHECKED_IN;
    visit.checkedInAt = now;
    visit.checkedInByUserId = auditorUserId;

    // Vigencia: actualizar scheduledAt y expectedEndAt para que BioStar
    // reciba start_datetime y expiry_datetime correctos en la sincronización.
    const validFrom = startsAt ?? now;
    visit.scheduledAt = validFrom;

    if (expiresAt) {
      visit.expectedEndAt = expiresAt;
      visit.expectedCheckoutAt = expiresAt;
      visit.maxStayMinutes = Math.max(
        1,
        Math.round((expiresAt.getTime() - validFrom.getTime()) / 60000),
      );
    }

    // Si se re-admite tras un checkout previo, se limpia la hora de salida
    if (visit.checkedOutAt) {
      visit.checkedOutAt = null as any;
    }

    // Defensivo: cualquier "habilitación temporal" (falsa salida) previa no
    // debe sobrevivir a un check-in normal — si quedara con una fecha en el
    // pasado, el cron de cierre automático cerraría esta visita segundos
    // después, sin relación con el reporte de falsa salida original.
    visit.temporaryReenableUntil = null as any;

    // Re-admisión tras checkout: en el checkout, BioStar elimina por completo
    // al usuario (y con él, cualquier tarjeta asignada). Si no reseteamos el
    // estado de las credenciales físicas (RFID/SMART_CARD) que ya habían
    // quedado en SYNCED de un check-in anterior, syncCardCredentials las
    // ignora (solo procesa PENDING/FAILED) y la tarjeta nunca se reenvía al
    // usuario nuevo que se crea en este check-in — el rostro sí se reenvía
    // porque ese paso no depende del syncStatus. Forzamos PENDING aquí para
    // que toda credencial física se vuelva a sincronizar en cada check-in.
    await this.credentialRepository.update(
      {
        visitId: visit.id,
        type: In([CredentialType.RFID, CredentialType.SMART_CARD]),
      },
      { syncStatus: CredentialSyncStatus.PENDING, lastSyncError: null },
    );

    if (typeof autoCheckoutEnabled === 'boolean') {
      visit.autoCheckoutEnabled = autoCheckoutEnabled;
    }

    await this.visitRepository.save(visit);

    // ─── Sincronización con BioStar al CHECK-IN (FIRE-AND-FORGET) ────────
    // El usuario se crea en BioStar AQUÍ, no al registrar la visita.
    // Recuperamos el QR activo (si existe) para enrolarlo junto al usuario.
    // Auto-sanación: si el QR existe pero sin tokenHash (creado con código
    // anterior), se genera el token aquí antes de sincronizar.
    setImmediate(async () => {
      try {
        const visitor = (visit as any).visitor;
        if (!visitor) return;

        let [qrCredential, faceCredential] = await Promise.all([
          this.credentialRepository.findOne({
            where: { visitId: visit.id, type: CredentialType.QR_JWT, isRevoked: false },
            order: { createdAt: 'DESC' },
          }),
          this.credentialRepository.findOne({
            where: { visitId: visit.id, type: CredentialType.VISUAL_FACE },
          }),
        ]);

        // ── Auto-sanar QR sin tokenHash ──────────────────────────────────
        if (qrCredential && !qrCredential.tokenHash) {
          this.logger.log(
            `[QR-HEAL] Credencial QR_JWT sin tokenHash en visita ${visit.id} — generando token ahora.`,
          );
          const generatedQr = await this.qrEngine.generateQr({
            visitId: visit.id,
            visitorId: visit.visitorId,
            tenantId: visit.tenantId,
          });
          await this.credentialRepository.update(qrCredential.id, {
            tokenHash: generatedQr.jti,
            expiresAt: generatedQr.expiresAt,
          });
          qrCredential = { ...qrCredential, tokenHash: generatedQr.jti, expiresAt: generatedQr.expiresAt };
          this.logger.log(`[QR-HEAL] Token generado y guardado para credencial ${qrCredential.id}.`);
        }

        await this.supremaSync.syncVisit({
          visit,
          visitor,
          // QR se enrolla de forma lazy cuando el visitante abre el portal
          // por primera vez — no en check-in — para evitar desperdiciar
          // credenciales en BioStar antes de que se necesiten.
          qrJti: undefined,
          // Si el visitante tiene foto, siempre intentamos enrolar Visual Face
          // en BioStar (FaceStation F2 / BioStation 3), independientemente de
          // si existe ya una credencial VISUAL_FACE explícita.
          enrollFace: !!(faceCredential || visitor.photoPath),
          accessGroups: visit.accessGroups ?? undefined,
        });

        // ── Auto-crear credencial VISUAL_FACE si visitor tiene foto ──────
        // Después del sync exitoso creamos la fila de credencial para que
        // el operador pueda verla en el detalle de la visita.
        if (visitor.photoPath) {
          try {
            const existingFaceCred = await this.credentialRepository.findOne({
              where: { visitId: visit.id, type: CredentialType.VISUAL_FACE },
            });
            if (!existingFaceCred) {
              await this.credentialRepository.save(
                this.credentialRepository.create({
                  visitId: visit.id,
                  type: CredentialType.VISUAL_FACE,
                  syncStatus: CredentialSyncStatus.SYNCED,
                } as Partial<AccessCredential>),
              );
              this.logger.log(
                `[VISUAL_FACE] Credencial VISUAL_FACE auto-creada para visita ${visit.id}`,
              );
            }
          } catch (faceCredErr: any) {
            this.logger.warn(
              `[VISUAL_FACE] No se pudo auto-crear credencial: ${faceCredErr.message}`,
            );
          }
        }

        // ── Notificar Magic Link QR al visitante tras sync exitoso ────────
        if (qrCredential?.tokenHash) {
          // Recargamos la visita con el visitor para que notifyQrPortalIfApplicable
          // tenga las relaciones completas y el tokenHash ya persistido.
          const freshVisit = await this.visitRepository.findOne({
            where: { id: visit.id },
            relations: ['visitor', 'host'],
          });
          if (freshVisit) {
            await this.notifyQrPortalIfApplicable(freshVisit).catch(() => null);
          }
        }
      } catch (err: any) {
        this.logger.error(
          `Error inesperado en syncVisit background (check-in): ${err?.message}`,
        );
      }
    });

    const visitorName = (visit as any).visitor
      ? `${(visit as any).visitor.firstName} ${(visit as any).visitor.lastName}`.trim()
      : undefined;

    if (!skipAudit) {
      this.structuredLogger.logUserAction(
        'visit.checked_in',
        auditorUserId,
        {
          visitId: visit.id,
          visitorId: visit.visitorId,
          visitorName,
          visitorType: (visit as any).visitorType,
          checkedInAt: visit.checkedInAt,
        },
        tenantId,
        'visit',
        visit.id,
        auditorUserName,
      );
    }

    this.eventsGateway.broadcastToTenant(tenantId, 'visit.checked_in', {
      visitId: visit.id,
      visitorId: visit.visitorId,
      status: visit.status,
      checkedInAt: visit.checkedInAt,
    });

    // ─── Notificación email al anfitrión (FIRE-AND-FORGET) ────────────────
    // Soporta dos fuentes de anfitrión: hostUser (tabla users) y host (tabla hosts).
    setImmediate(async () => {
      try {
        const notifSettings = await this.getCheckinNotifSettings(visit.tenantId);
        if (!notifSettings.enabled) {
          this.logger.debug(`[HOST-NOTIFY] Notificación de check-in deshabilitada para tenant ${visit.tenantId}.`);
          return;
        }
        const hostUser = (visit as any).hostUser;
        const host = (visit as any).host;
        // Resuelve el anfitrión con email desde cualquiera de las dos relaciones
        const effectiveHost = hostUser?.email
          ? { email: hostUser.email, fullName: hostUser.fullName }
          : host?.email
          ? { email: host.email, fullName: host.fullName }
          : null;
        if (!effectiveHost) {
          this.logger.warn(
            `[HOST-NOTIFY] Visita ${visit.id} — anfitrión sin email registrado. Notificación omitida.`,
          );
          return;
        }
        const visitor = (visit as any).visitor;
        await this.notifications.sendHostCheckinNotification(effectiveHost.email, {
          hostName: effectiveHost.fullName,
          visitorName: visitorName || 'Visitante',
          visitorCompany: visitor?.company ?? null,
          visitorDocument: visitor?.documentNumber ?? null,
          purpose: visit.purpose ?? null,
          checkedInAt: visit.checkedInAt!,
        }, notifSettings);
      } catch (err: any) {
        this.logger.warn(
          `[HOST-NOTIFY] Error enviando notificación de check-in: ${err?.message}`,
        );
      }
    });

    return visit;
  }

  /**
   * Realiza checkout masivo de todas las visitas CHECKED_IN de un tenant.
   * Usado por el auto-checkout nocturno configurable.
   */
  async bulkCheckoutTenant(
    tenantId: string,
    auditorUserId = 'system',
  ): Promise<number> {
    const activeVisits = await this.visitRepository.find({
      where: [
        { tenantId, status: VisitStatus.CHECKED_IN },
        { tenantId, status: VisitStatus.SCHEDULED },
        { tenantId, status: VisitStatus.PRE_REGISTERED },
      ],
    });

    let count = 0;
    for (const visit of activeVisits) {
      try {
        await this.checkoutVisit(visit.id, tenantId, auditorUserId);
        count++;
      } catch {
        // Continuar con los demás aunque uno falle
      }
    }

    this.logger.log(
      `Auto-checkout masivo: ${count} visita(s) cerrada(s) para tenant ${tenantId}`,
    );
    return count;
  }

  /**
   * Check-in masivo de visitas seleccionadas por IDs.
   * Genera UNA sola entrada de auditoría consolidada con todos los visitantes afectados.
   */
  async bulkCheckInVisits(
    visitIds: string[],
    tenantId: string,
    auditorUserId: string,
    auditorUserName?: string,
    expiresAt?: Date,
    startsAt?: Date,
  ): Promise<{ success: number; failed: number; errors: { visitId: string; message: string }[] }> {
    let success = 0;
    let failed = 0;
    const errors: { visitId: string; message: string }[] = [];
    const successVisitors: { visitId: string; visitorId: string; visitorName: string }[] = [];

    for (const visitId of visitIds) {
      try {
        const visit = await this.checkInVisit(visitId, tenantId, auditorUserId, auditorUserName, true, expiresAt, startsAt);
        const visitorName = (visit as any).visitor
          ? `${(visit as any).visitor.firstName} ${(visit as any).visitor.lastName}`.trim()
          : visit.visitorId;
        successVisitors.push({ visitId: visit.id, visitorId: visit.visitorId, visitorName });
        success++;
      } catch (err: any) {
        failed++;
        errors.push({ visitId, message: err.message ?? 'Error desconocido' });
      }
    }

    if (successVisitors.length > 0) {
      this.structuredLogger.logUserAction(
        'visit.bulk_checkin',
        auditorUserId,
        {
          count: successVisitors.length,
          visitors: successVisitors,
          failed,
          ...(errors.length > 0 ? { failDetails: errors } : {}),
        },
        tenantId,
        'bulk_visit',
        undefined,
        auditorUserName,
      );
    }

    this.logger.log(`Bulk check-in: ${success} exitosos, ${failed} fallidos para tenant ${tenantId}`);
    return { success, failed, errors };
  }

  /**
   * Check-out masivo de visitas seleccionadas por IDs.
   * Genera UNA sola entrada de auditoría consolidada con todos los visitantes afectados.
   */
  async bulkCheckoutSelected(
    visitIds: string[],
    tenantId: string,
    auditorUserId: string,
    auditorUserName?: string,
  ): Promise<{ success: number; failed: number; errors: { visitId: string; message: string }[] }> {
    let success = 0;
    let failed = 0;
    const errors: { visitId: string; message: string }[] = [];
    const successVisitors: { visitId: string; visitorId: string; visitorName: string }[] = [];

    for (const visitId of visitIds) {
      try {
        const result = await this.checkoutVisit(visitId, tenantId, auditorUserId, auditorUserName, true);
        successVisitors.push({ visitId, visitorId: result.visitorId, visitorName: result.visitorName });
        success++;
      } catch (err: any) {
        failed++;
        errors.push({ visitId, message: err.message ?? 'Error desconocido' });
      }
    }

    if (successVisitors.length > 0) {
      this.structuredLogger.logUserAction(
        'visit.bulk_checkout',
        auditorUserId,
        {
          count: successVisitors.length,
          visitors: successVisitors,
          failed,
          ...(errors.length > 0 ? { failDetails: errors } : {}),
        },
        tenantId,
        'bulk_visit',
        undefined,
        auditorUserName,
      );
    }

    this.logger.log(`Bulk check-out: ${success} exitosos, ${failed} fallidos para tenant ${tenantId}`);
    return { success, failed, errors };
  }

  /**
   * Importación masiva de visitantes desde filas CSV (parseadas en frontend).
   * Crea o actualiza visitante + programa visita para cada fila.
   */
  async importVisitorsFromCsv(
    rows: {
      firstName: string;
      lastName: string;
      documentNumber: string;
      documentType?: string;
      email?: string;
      phone?: string;
      company?: string;
      purpose?: string;
      scheduledAt?: string;
      visitorType?: string;
    }[],
    tenantId: string,
    auditorUserId: string,
  ): Promise<{ total: number; created: number; updated: number; failed: number; errors: { row: number; message: string }[] }> {
    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (!row.firstName || !row.lastName || !row.documentNumber) {
          throw new Error('firstName, lastName y documentNumber son obligatorios');
        }

        const isExisting = !!(await this.visitorRepository.findOne({
          where: {
            tenantId,
            documentNumber: row.documentNumber.trim(),
          },
        }));

        const visitorDto: any = {
          tenantId,
          fullName: `${row.firstName.trim()} ${row.lastName.trim()}`,
          documentType: row.documentType ?? 'NATIONAL_ID',
          documentNumber: row.documentNumber.trim(),
          email: row.email || undefined,
          phone: row.phone || undefined,
          company: row.company || undefined,
        };
        const visitor = await this.createOrUpdateVisitor(visitorDto, auditorUserId);

        // Schedule a visit
        const now = new Date();
        const scheduledAt = row.scheduledAt ? new Date(row.scheduledAt) : new Date(now.getTime() + 30 * 60 * 1000);
        const expectedEndAt = new Date(scheduledAt.getTime() + 120 * 60 * 1000);

        // Skip if visitor already has an active visit
        const existingVisit = await this.visitRepository.findOne({
          where: [
            { visitorId: visitor.id, tenantId, status: VisitStatus.SCHEDULED },
            { visitorId: visitor.id, tenantId, status: VisitStatus.CHECKED_IN },
            { visitorId: visitor.id, tenantId, status: VisitStatus.PRE_REGISTERED },
          ],
        });
        if (!existingVisit) {
          // Acepta cualquier tipo de visitante (predefinido o personalizado del
          // tenant, creado en Configuración > Tipos de Visitante). Si la celda
          // viene vacía, usa WALK_IN como default.
          const rawType = (row.visitorType ?? '').toString().trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
          const resolvedType: string = rawType || VisitorType.WALK_IN;

          const visit = this.visitRepository.create({
            visitorId: visitor.id,
            tenantId,
            purpose: row.purpose ?? 'Visita programada',
            scheduledAt,
            expectedEndAt,
            accessMethod: AccessMethod.MANUAL,
            status: VisitStatus.SCHEDULED,
            visitorType: resolvedType,
          });
          await this.visitRepository.save(visit);
        }

        if (isExisting) updated++; else created++;
      } catch (err: any) {
        failed++;
        errors.push({ row: i + 2, message: err.message ?? 'Error desconocido' });
      }
    }

    this.logger.log(`Import CSV: ${created} creados, ${updated} actualizados, ${failed} fallidos para tenant ${tenantId}`);
    return { total: rows.length, created, updated, failed, errors };
  }

  /**
   * Crea o actualiza un visitante.
   * El número de documento es el identificador único primario.
   * Si ya existe un visitante con ese documento (mismo tenant), se actualizan sus datos.
   */
  async createOrUpdateVisitor(
    dto: CreateVisitorDto,
    auditorUserId: string,
  ): Promise<Visitor> {
    let visitor: Visitor | null = null;

    // El número de documento es EL identificador único — no hay fallback por email
    if (dto.documentType && dto.documentNumber) {
      visitor = await this.visitorRepository.findOne({
        where: {
          tenantId: dto.tenantId,
          documentType: dto.documentType,
          documentNumber: dto.documentNumber.trim(),
        },
      });
    }

    const nameParts = dto.fullName.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    if (!visitor) {
      // ── NEW visitor: INSERT then update photo if provided ────────────────────
      visitor = this.visitorRepository.create({
        firstName,
        lastName,
        email: dto.email?.toLowerCase(),
        phone: dto.phone,
        company: dto.company,
        documentType: dto.documentType,
        documentNumber: dto.documentNumber,
        ocrData: dto.extraData,
        tenantId: dto.tenantId,
      });
      await this.visitorRepository.save(visitor);

      if (dto.photoBase64) {
        try {
          const photoData = await this.processPhotoForUpsert(visitor.id, { photoBase64: dto.photoBase64, faceBox: dto.faceBox });
          const photoPath = await this.saveVisitorPhoto(visitor.id, photoData);
          // Use update() so @UpdateDateColumn is always refreshed
          await this.visitorRepository.update({ id: visitor.id }, { photoPath });
          visitor.photoPath = photoPath;
        } catch (err) {
          this.logger.warn(
            `Failed to save photo for new visitor ${visitor.id}: ${err instanceof Error ? err.message : 'unknown'}`,
          );
        }
      }
    } else {
      // ── EXISTING visitor: collect all changes + photo, single UPDATE ─────────
      // Using repository.update() instead of save() guarantees @UpdateDateColumn
      // is always refreshed even when photoPath stays the same string value.
      const fieldsToUpdate: Partial<Record<string, any>> = {
        firstName,
        lastName,
      };
      if (dto.email)        fieldsToUpdate.email        = dto.email.toLowerCase();
      if (dto.phone)        fieldsToUpdate.phone        = dto.phone;
      if (dto.company)      fieldsToUpdate.company      = dto.company;
      if (dto.documentType) fieldsToUpdate.documentType = dto.documentType;
      if (dto.documentNumber) fieldsToUpdate.documentNumber = dto.documentNumber;
      if (dto.extraData)    fieldsToUpdate.ocrData      = { ...visitor.ocrData, ...dto.extraData };

      if (dto.photoBase64) {
        try {
          const photoData = await this.processPhotoForUpsert(visitor.id, { photoBase64: dto.photoBase64, faceBox: dto.faceBox });
          const photoPath = await this.saveVisitorPhoto(visitor.id, photoData);
          fieldsToUpdate.photoPath = photoPath;
        } catch (err) {
          this.logger.warn(
            `Failed to save photo for existing visitor ${visitor.id}: ${err instanceof Error ? err.message : 'unknown'}`,
          );
        }
      }

      // Single UPDATE — always executes SQL UPDATE → @UpdateDateColumn refreshed
      await this.visitorRepository.update(
        { id: visitor.id, tenantId: dto.tenantId },
        fieldsToUpdate as any,
      );

      // Keep in-memory entity in sync with what we persisted
      Object.assign(visitor, fieldsToUpdate);
    }

    this.structuredLogger.logUserAction(
      'visitor.created_or_updated',
      auditorUserId,
      {
        visitorId: visitor.id,
        fullName: `${visitor.firstName} ${visitor.lastName}`.trim(),
      },
      dto.tenantId,
    );

    // Return fresh entity with new updatedAt
    return (await this.visitorRepository.findOne({
      where: { id: visitor.id, tenantId: dto.tenantId },
    }))!;
  }

  /**
   * Shared photo-processing helper: runs processVisualFace (crop) if faceBox
   * is provided, otherwise returns the raw base64 unchanged for later saving.
   */
  private async processPhotoForUpsert(
    visitorId: string,
    dto: { photoBase64: string; faceBox?: { x: number; y: number; width: number; height: number } },
  ): Promise<string> {
    if (dto.faceBox) {
      this.logger.log(
        `INFO: AUDIT: CROP_START — procesando imagen para visitante ${visitorId} ` +
        `con faceBox (${dto.faceBox.x},${dto.faceBox.y},${dto.faceBox.width}×${dto.faceBox.height})`,
      );
      const processed = await this.processVisualFace(dto.photoBase64, dto.faceBox);
      return `data:image/jpeg;base64,${processed}`;
    }
    return dto.photoBase64;
  }

  /**
   * Programa una visita y opcionalmente sincroniza con BioStar creando sus credenciales.
   */
  async scheduleVisit(
    dto: CreateVisitDto,
    tenantId: string,
    auditorUserId: string,
  ): Promise<Visit> {
    if (dto.expectedExitTime <= dto.expectedEntryTime) {
      throw new BadRequestException(
        'La fecha de salida debe ser posterior a la de entrada.',
      );
    }

    const visitor = await this.visitorRepository.findOne({
      where: { id: dto.visitorId },
    });
    if (!visitor) {
      throw new NotFoundException(
        `Visitante con ID ${dto.visitorId} no encontrado.`,
      );
    }

    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant con ID ${tenantId} no encontrado.`);
    }

    // ── BLOQUEO DE DUPLICADOS: un visitante solo puede tener UNA visita activa ──
    const existingActiveVisit = await this.visitRepository.findOne({
      where: [
        { visitorId: visitor.id, tenantId, status: VisitStatus.SCHEDULED },
        { visitorId: visitor.id, tenantId, status: VisitStatus.PRE_REGISTERED },
        { visitorId: visitor.id, tenantId, status: VisitStatus.CHECKED_IN },
      ],
      order: { scheduledAt: 'DESC' },
    });
    if (existingActiveVisit) {
      throw new BadRequestException(
        `DUPLICATE_VISIT:${existingActiveVisit.status}:${existingActiveVisit.id}`,
      );
    }

    // Iniciar transacción de BD para asegurar integridad entre Visit y Credentials
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let visit: Visit;
    try {
      visit = this.visitRepository.create({
        visitorId: visitor.id,
        tenantId,
        hostUserId: dto.hostUserId ?? null,
        hostId: dto.hostId ?? null,
        purpose: dto.reason,
        scheduledAt: dto.expectedEntryTime,
        expectedEndAt: dto.expectedExitTime,
        accessMethod: dto.accessMethod,
        status: VisitStatus.SCHEDULED,
        syncStatus: null,
        lastSyncError: null,
        lastSyncAttemptAt: null,
        portalToken: uuidv4(),
        accessGroups: dto.accessGroups?.length ? dto.accessGroups : null,
        hasAssets: !!(dto.hasAssets && dto.assets?.length),
        hasVehicles: !!(dto.hasVehicles && dto.vehicles?.length),
        visitorType: dto.visitorType ?? 'WALK_IN' as any,
        notes: dto.notes ?? null as any,
        serviceOrder: dto.visitorType === 'CONTRACTOR' ? (dto.serviceOrder ?? null) : null,
        autoCheckoutEnabled: !!dto.autoCheckoutEnabled,
      });

      await queryRunner.manager.save(Visit, visit);

      let qrJti: string | undefined;

      // Generar QR Dinámico si el método de acceso es QR_DYNAMIC
      if (dto.accessMethod === AccessMethod.QR_DYNAMIC) {
        const generatedQr = await this.qrEngine.generateQr({
          visitId: visit.id,
          visitorId: visitor.id,
          tenantId,
        });

        qrJti = generatedQr.jti;

        const credential = this.credentialRepository.create({
          visitId: visit.id,
          type: CredentialType.QR_JWT,
          tokenHash: generatedQr.jti,
          expiresAt: generatedQr.expiresAt,
          syncStatus: null,
        });
        await queryRunner.manager.save(AccessCredential, credential);
      }

      // Crear credencial RFID si se proporcionó número de tarjeta directamente
      if (dto.rfidCardNumber) {
        const rfidCredential = this.credentialRepository.create({
          visitId: visit.id,
          type: CredentialType.RFID,
          cardNumber: dto.rfidCardNumber.trim().toUpperCase(),
          cardSubtype: dto.rfidCardSubtype ?? RfidCardSubtype.CSN,
          expiresAt: dto.expectedExitTime,
          syncStatus: null,
        });
        await queryRunner.manager.save(AccessCredential, rfidCredential);
        this.logger.log(
          `💳 Credencial RFID registrada para visita ${visit.id}: ${dto.rfidCardNumber}`,
        );
      }

      // Crear credenciales adicionales del array (multi-modal)
      if (dto.additionalCredentials?.length) {
        for (const cred of dto.additionalCredentials) {
          // Saltar QR_JWT aquí, ya se maneja arriba por accessMethod
          if (cred.type === CredentialType.QR_JWT) continue;

          const additionalCred = this.credentialRepository.create({
            visitId: visit.id,
            type: cred.type,
            cardNumber: cred.cardNumber?.trim().toUpperCase() || null,
            cardSubtype: cred.type === CredentialType.RFID
              ? (cred.cardSubtype ?? RfidCardSubtype.CSN)
              : null,
            expiresAt: dto.expectedExitTime,
            syncStatus: null,
          });
          await queryRunner.manager.save(AccessCredential, additionalCred);
          this.logger.log(
            `🔑 Credencial adicional ${cred.type} registrada para visita ${visit.id}`,
          );
        }
      }

      await queryRunner.commitTransaction();

      // ─── Guardar activos declarados por el visitante (FIRE-AND-FORGET) ─────
      if (dto.hasAssets && dto.assets?.length) {
        setImmediate(async () => {
          try {
            const assetEntities = dto.assets!.map((a) =>
              this.assetRepository.create({
                visitId: visit.id,
                visitorId: visitor.id,
                tenantId,
                description: a.description,
                serialNumber: a.serialNumber ?? null,
                category: a.category ?? AssetCategory.OTHER,
                verifiedAtCheckout: false,
              }),
            );
            await this.assetRepository.save(assetEntities);

            this.structuredLogger.logUserAction(
              'visit.assets_declared',
              auditorUserId,
              { visitId: visit.id, assetCount: assetEntities.length },
              tenantId,
            );
          } catch (err: any) {
            this.logger.error(`Error guardando activos para visita ${visit.id}: ${err?.message}`);
          }
        });
      }

      // ─── Guardar vehículos declarados por el visitante (FIRE-AND-FORGET) ─────
      if (dto.hasVehicles && dto.vehicles?.length) {
        setImmediate(async () => {
          try {
            const vehicleEntities = dto.vehicles!.map((v) =>
              this.vehicleRepository.create({
                visitId: visit.id,
                visitorId: visitor.id,
                tenantId,
                licensePlate: v.licensePlate.trim().toUpperCase().replace(/\s+/g, ''),
                brand: v.brand ?? null,
                model: v.model ?? null,
                color: v.color ?? null,
                vehicleType: v.vehicleType ?? VehicleType.CAR,
                parkingZone: v.parkingZone ?? null,
                verifiedAtCheckout: false,
                hasEntered: false,
              }),
            );
            await this.vehicleRepository.save(vehicleEntities);

            this.structuredLogger.logUserAction(
              'visit.vehicles_declared',
              auditorUserId,
              { visitId: visit.id, vehicleCount: vehicleEntities.length },
              tenantId,
            );
          } catch (err: any) {
            this.logger.error(`Error guardando vehículos para visita ${visit.id}: ${err?.message}`);
          }
        });
      }

      // ─── Envío automático del Magic Link por email (FIRE-AND-FORGET) ─────
      // Si el método de acceso es QR_DYNAMIC y el visitante tiene email,
      // le enviamos el enlace personal a su portal QR sin bloquear la respuesta.
      if (
        dto.accessMethod === AccessMethod.QR_DYNAMIC &&
        visitor.email &&
        visit.portalToken
      ) {
        const portalToken = visit.portalToken;
        const visitorEmail = visitor.email;
        const visitorName = `${visitor.firstName} ${visitor.lastName}`;
        const scheduledDate = new Date(dto.expectedEntryTime).toLocaleDateString(
          'es-ES',
          { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' },
        );
        const hostId = dto.hostId ?? null;

        setImmediate(async () => {
          let hostName = 'el equipo de Recepción';
          if (hostId) {
            const host = await this.hostRepository.findOne({ where: { id: hostId } }).catch(() => null);
            if (host?.fullName) hostName = host.fullName;
          }
          await this.notifications.sendQrPortalLink(visitorEmail, {
            visitorName,
            hostName,
            scheduledDate,
            portalToken,
          }).catch((err) =>
            this.logger.error(`Error enviando Magic Link a ${visitorEmail}: ${err?.message}`),
          );
        });
      }

      // ─── NO sincronizar con BioStar al registrar ─────────────────────────
      // La sincronización con BioStar (creación del usuario, enrolamiento de
      // credenciales y acceso físico) ocurre al momento del CHECK-IN.
      // Esto evita crear usuarios en BioStar que quizás nunca lleguen.
      // Si la visita se cancela o no se presenta, BioStar no se contamina.
      this.logger.log(
        `📋 Visita ${visit.id} registrada localmente. Sincronización con BioStar pendiente al check-in.`,
      );

      this.structuredLogger.logUserAction(
        'visit.scheduled',
        auditorUserId,
        {
          visitId: visit.id,
          visitorId: visitor.id,
          visitorName: `${visitor.firstName} ${visitor.lastName}`.trim(),
          visitorDocument: visitor.documentNumber,
          accessMethod: dto.accessMethod,
          visitorType: dto.visitorType ?? 'WALK_IN',
        },
        tenantId,
        'visit',
        visit.id,
      );

      return visit;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Finaliza una visita de forma explícita (check-out manual o automático).
   * Remueve el usuario del dispositivo BioStar de inmediato usando el Circuit Breaker.
   */
  async markAsNoShow(
    visitId: string,
    tenantId: string,
    auditorUserId: string,
  ): Promise<void> {
    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
    });
    if (!visit) throw new NotFoundException('Visita no encontrada');
    const allowedStatuses: VisitStatus[] = [
      VisitStatus.SCHEDULED,
      VisitStatus.PRE_REGISTERED,
    ];
    if (!allowedStatuses.includes(visit.status)) {
      throw new BadRequestException(
        `Solo se puede marcar como No-Show una visita en estado SCHEDULED o PRE_REGISTERED. Estado actual: ${visit.status}`,
      );
    }

    visit.status = VisitStatus.NO_SHOW;
    await this.visitRepository.save(visit);

    this.structuredLogger.logUserAction(
      'visit.no_show',
      auditorUserId,
      { visitId },
      tenantId,
    );

    this.eventsGateway.broadcastToTenant(tenantId, 'visit.no_show', {
      visitId: visit.id,
      visitorId: visit.visitorId,
      status: visit.status,
    });
  }

  async checkoutVisit(
    visitId: string,
    tenantId: string,
    auditorUserId: string,
    auditorUserName?: string,
    skipAudit = false,
  ): Promise<{ visitorId: string; visitorName: string }> {
    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
      relations: ['visitor'],
    });
    if (!visit) throw new NotFoundException('Visita no encontrada');
    if (visit.status === VisitStatus.CHECKED_OUT) {
      const visitorName = (visit as any).visitor
        ? `${(visit as any).visitor.firstName} ${(visit as any).visitor.lastName}`.trim()
        : visit.visitorId;
      return { visitorId: visit.visitorId, visitorName };
    }

    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant con ID ${tenantId} no encontrado.`);
    }

    visit.status = VisitStatus.CHECKED_OUT;
    visit.checkedOutAt = new Date();
    // Limpiar cualquier "habilitación temporal" (de un reporte de falsa
    // salida) que haya quedado activa. De lo contrario, si esta misma visita
    // se re-admite más adelante (nuevo check-in), el cron que cierra
    // habilitaciones vencidas (closeExpiredTemporaryReenablements) la
    // encontraría con temporaryReenableUntil ya en el pasado y la cerraría
    // automáticamente segundos después del check-in, sin relación alguna
    // con el nuevo ingreso.
    visit.temporaryReenableUntil = null as any;
    await this.visitRepository.save(visit);

    if (visit.supremaUserRefId) {
      // Eliminar el usuario de BioStar usando las SupremaApiConnections activas
      // (misma ruta que la creación en check-in — garantiza compatibilidad BS2/BSX).
      await this.supremaSync.deleteUserFromBioStar(visit);
      // Limpiar la referencia local independientemente del resultado en BioStar
      // (el usuario ya no está activo — evita re-intentos innecesarios).
      visit.supremaUserRefId = null as any;
      visit.syncStatus = null as any;
      await this.visitRepository.save(visit);
      this.logger.log(`🗑️ Usuario BioStar eliminado en check-out de visita ${visitId}`);
    }

    const visitorName = (visit as any).visitor
      ? `${(visit as any).visitor.firstName} ${(visit as any).visitor.lastName}`.trim()
      : visit.visitorId;

    if (!skipAudit) {
      this.structuredLogger.logUserAction(
        'visit.checkout',
        auditorUserId,
        {
          visitId,
          visitorId: visit.visitorId,
          visitorName,
          checkedOutAt: visit.checkedOutAt,
        },
        tenantId,
        'visit',
        visitId,
        auditorUserName,
      );
    }

    this.eventsGateway.broadcastToTenant(tenantId, 'visit.checked_out', {
      visitId: visit.id,
      visitorId: visit.visitorId,
      status: visit.status,
      checkedOutAt: visit.checkedOutAt,
    });

    return { visitorId: visit.visitorId, visitorName };
  }

  // ── Encuesta de salida ────────────────────────────────────────────────────

  /**
   * Registra la respuesta de un visitante a la encuesta de satisfacción
   * enviada tras su auto-checkout. Endpoint público (sin JWT), protegido
   * únicamente por la firma del token de encuesta.
   */
  async submitExitSurvey(
    token: string,
    rating: number,
    comment?: string,
  ): Promise<{ visitorName: string }> {
    const result = this.exitLinks.validateSurveyToken(token);
    if (!result.valid || !result.payload) {
      throw new BadRequestException(result.reason || 'Link inválido.');
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('La calificación debe ser un número entre 1 y 5.');
    }

    const { visitId, tenantId } = result.payload;
    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
      relations: ['visitor'],
    });
    if (!visit) throw new NotFoundException('Visita no encontrada.');

    visit.surveyRating = rating;
    visit.surveyComment = comment?.trim() || null;
    visit.surveyRespondedAt = new Date();
    await this.visitRepository.save(visit);

    this.structuredLogger.logUserAction(
      'visit.survey_responded',
      'visitor-portal',
      { visitId, rating, hasComment: !!comment },
      tenantId,
      'visit',
      visitId,
    );

    this.eventsGateway.broadcastToTenant(tenantId, 'visit.survey_responded', {
      visitId,
      rating,
    });

    const visitorName = (visit as any).visitor
      ? `${(visit as any).visitor.firstName} ${(visit as any).visitor.lastName}`.trim()
      : '';
    return { visitorName };
  }

  // ── Reporte de "falsa salida" ─────────────────────────────────────────────

  /**
   * Marca una visita como reportada por falsa salida (el visitante indica que
   * sigue dentro de las instalaciones a pesar del auto-checkout). Endpoint
   * público protegido por un token JWT de un solo uso (1h de validez).
   * NO modifica el estado de acceso físico — solo alerta al operador, quien
   * decide si reactiva el acceso temporalmente.
   */
  async reportFalseExit(token: string): Promise<{ visitId: string }> {
    const result = await this.exitLinks.validateFalseExitToken(token);
    if (!result.valid || !result.payload) {
      throw new BadRequestException(result.reason || 'Link inválido.');
    }

    const { visitId, tenantId } = result.payload;
    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
      relations: ['visitor'],
    });
    if (!visit) throw new NotFoundException('Visita no encontrada.');

    if (visit.status !== VisitStatus.CHECKED_OUT) {
      throw new BadRequestException(
        'Esta visita ya no está en estado de salida — el reporte no aplica.',
      );
    }

    visit.status = VisitStatus.FALSE_EXIT_REPORTED;
    visit.falseExitReportedAt = new Date();
    await this.visitRepository.save(visit);

    const visitorName = (visit as any).visitor
      ? `${(visit as any).visitor.firstName} ${(visit as any).visitor.lastName}`.trim()
      : visit.visitorId;

    this.structuredLogger.logUserAction(
      'visit.false_exit_reported',
      'visitor-portal',
      { visitId, visitorName },
      tenantId,
      'visit',
      visitId,
    );

    this.eventsGateway.broadcastToTenant(tenantId, 'visit.false_exit_reported', {
      visitId: visit.id,
      visitorId: visit.visitorId,
      visitorName,
      status: visit.status,
      falseExitReportedAt: visit.falseExitReportedAt,
    });

    this.logger.warn(`🚨 Falsa salida reportada para visita ${visitId} (tenant ${tenantId})`);

    return { visitId: visit.id };
  }

  /**
   * El operador descarta el reporte de falsa salida (confirma que el
   * visitante en efecto salió). La visita permanece CHECKED_OUT.
   */
  async dismissFalseExit(
    visitId: string,
    tenantId: string,
    auditorUserId: string,
    auditorUserName?: string,
    resolutionNote?: string,
  ): Promise<Visit> {
    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
    });
    if (!visit) throw new NotFoundException('Visita no encontrada.');
    if (visit.status !== VisitStatus.FALSE_EXIT_REPORTED) {
      throw new BadRequestException('Esta visita no tiene un reporte de falsa salida pendiente.');
    }

    visit.status = VisitStatus.CHECKED_OUT;
    visit.falseExitResolvedAt = new Date();
    visit.falseExitResolvedByUserId = auditorUserId;
    visit.falseExitResolutionNote = resolutionNote?.trim() || null;
    await this.visitRepository.save(visit);

    this.structuredLogger.logUserAction(
      'visit.false_exit_dismissed',
      auditorUserId,
      { visitId, resolutionNote },
      tenantId,
      'visit',
      visitId,
      auditorUserName,
    );

    this.eventsGateway.broadcastToTenant(tenantId, 'visit.false_exit_dismissed', {
      visitId: visit.id,
      status: visit.status,
    });

    return visit;
  }

  /**
   * El operador reactiva temporalmente el acceso físico del visitante tras un
   * reporte de falsa salida. Recrea el usuario/credencial en BioStar
   * (acceso completo restaurado) y define una expiración explícita tras la
   * cual el cron de auto-checkout cerrará la visita automáticamente.
   *
   * REGLA DE NEGOCIO: se preserva `checkedInAt` original — esta NUNCA se
   * cuenta como una segunda visita, solo se anota con una nota de resolución.
   */
  async temporaryReenableVisit(
    visitId: string,
    tenantId: string,
    auditorUserId: string,
    auditorUserName: string | undefined,
    reenableUntil: Date,
    autoCheckoutEnabled?: boolean,
    resolutionNote?: string,
  ): Promise<Visit> {
    if (!(reenableUntil instanceof Date) || isNaN(reenableUntil.getTime())) {
      throw new BadRequestException('Fecha de expiración inválida.');
    }
    if (reenableUntil.getTime() <= Date.now()) {
      throw new BadRequestException('La fecha de expiración debe ser futura.');
    }

    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
      relations: ['visitor'],
    });
    if (!visit) throw new NotFoundException('Visita no encontrada.');
    if (visit.status !== VisitStatus.FALSE_EXIT_REPORTED) {
      throw new BadRequestException('Esta visita no tiene un reporte de falsa salida pendiente.');
    }

    const visitor = (visit as any).visitor;

    // Preservar checkedInAt original — la visita jamás se cuenta dos veces.
    visit.status = VisitStatus.CHECKED_IN;
    visit.checkedOutAt = null as any;
    visit.temporaryReenableUntil = reenableUntil;
    visit.wasTemporaryReenabled = true;
    visit.falseExitResolvedAt = new Date();
    visit.falseExitResolvedByUserId = auditorUserId;
    visit.falseExitResolutionNote = resolutionNote?.trim() || null;
    if (typeof autoCheckoutEnabled === 'boolean') {
      visit.autoCheckoutEnabled = autoCheckoutEnabled;
    }
    visit.expectedEndAt = reenableUntil;
    visit.expectedCheckoutAt = reenableUntil;

    await this.visitRepository.save(visit);

    // ─── Recrear usuario/credencial en BioStar (acceso completo) ──────────
    try {
      if (visitor) {
        await this.supremaSync.syncVisit({
          visit,
          visitor,
          qrJti: undefined,
          enrollFace: !!visitor.photoPath,
          accessGroups: visit.accessGroups ?? undefined,
        });
        this.logger.log(
          `🔓 Acceso BioStar recreado tras reactivación temporal — visita ${visitId}, expira ${reenableUntil.toISOString()}`,
        );
      }
    } catch (syncError: any) {
      this.logger.error(
        `No se pudo recrear el usuario en BioStar durante la reactivación temporal de la visita ${visitId}: ${syncError?.message}`,
      );
      // No revertimos el estado local: el operador puede reintentar el sync manualmente.
    }

    this.structuredLogger.logUserAction(
      'visit.temporary_reenable',
      auditorUserId,
      { visitId, reenableUntil, autoCheckoutEnabled, resolutionNote },
      tenantId,
      'visit',
      visitId,
      auditorUserName,
    );

    this.eventsGateway.broadcastToTenant(tenantId, 'visit.temporary_reenabled', {
      visitId: visit.id,
      visitorId: visit.visitorId,
      status: visit.status,
      temporaryReenableUntil: visit.temporaryReenableUntil,
      autoCheckoutEnabled: visit.autoCheckoutEnabled,
    });

    return visit;
  }

  /**
   * Valida una imagen facial contra el motor de IA de BioStar.
   * Limpia el prefijo data:image del base64 antes de enviar a Suprema.
   * Si BioStar no está configurado, aplica validación local básica.
   */
  async validateFaceImage(
    imageBase64: string,
    tenantId: string,
  ): Promise<{
    valid: boolean;
    imageTemplate?: string;
    imageTemplate2?: string;
    cachedKey?: string;
    errorMessage?: string;
  }> {
    const cleanBase64 = imageBase64.replace(
      /^data:image\/(jpeg|jpg|png|webp);base64,/,
      '',
    );

    const buffer = Buffer.from(cleanBase64, 'base64');
    const sizeInMb = buffer.length / (1024 * 1024);
    if (sizeInMb > 10) {
      throw new BadRequestException(
        'La imagen excede el límite de 10 MB.',
      );
    }

    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant con ID ${tenantId} no encontrado.`);
    }

    if (
      !tenant.biostarApiUrl ||
      !tenant.biostarCredentialsEncrypted
    ) {
      this.logger.warn(
        'BioStar no configurado para este tenant. Validación local aplicada.',
      );
      this.structuredLogger.logUserAction(
        'face.validate.local_only',
        'system',
        { reason: 'BioStar not configured', sizeKb: Math.round(buffer.length / 1024) },
        tenantId,
      );
      return { valid: true, cachedKey: undefined };
    }

    try {
      const result = await this.supremaGateway.validateFaceTemplate(
        tenant,
        cleanBase64,
      );

      if (!result.valid) {
        throw new BadRequestException(
          result.errorMessage || 'Imagen no apta para reconocimiento facial. Intente de nuevo con mejor iluminación.',
        );
      }

      return {
        valid: true,
        imageTemplate: result.imageTemplate,
        imageTemplate2: result.imageTemplate2,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.warn(
        `BioStar connection failed (${error instanceof Error ? error.message : 'unknown'}). Client-side validation applies.`,
      );
      this.structuredLogger.logUserAction(
        'face.validate.biostar_unreachable',
        'system',
        { error: error instanceof Error ? error.message : 'unknown' },
        tenantId,
      );
      return { valid: true };
    }
  }

  /**
   * Obtiene la lista de visitas activas de un tenant.
   */
  async getActiveVisits(
    tenantId: string,
    hostId?: string | null,
    includeNoShow = false,
    includeCheckedOut = false,
  ): Promise<Visit[]> {
    const baseStatuses = [
      VisitStatus.CHECKED_IN,
      VisitStatus.SCHEDULED,
      VisitStatus.PRE_REGISTERED,
      VisitStatus.FALSE_EXIT_REPORTED,
      ...(includeNoShow ? [VisitStatus.NO_SHOW] : []),
      ...(includeCheckedOut ? [VisitStatus.CHECKED_OUT, VisitStatus.CANCELLED] : []),
    ];

    const statusFilter = hostId
      ? baseStatuses.map((status) => ({ tenantId, status, hostId }))
      : baseStatuses.map((status) => ({ tenantId, status }));

    return this.visitRepository.find({
      where: statusFilter,
      relations: ['visitor', 'hostUser', 'host'],
      order: { scheduledAt: 'DESC' },
    });
  }

  /**
   * Lista liviana de visitas con reporte de falsa salida pendiente (para badge/notificaciones).
   */
  async getFalseExitAlerts(tenantId: string): Promise<
    { visitId: string; visitorName: string; falseExitReportedAt: Date | null }[]
  > {
    const visits = await this.visitRepository.find({
      where: { tenantId, status: VisitStatus.FALSE_EXIT_REPORTED },
      relations: ['visitor'],
      order: { falseExitReportedAt: 'DESC' },
    });
    return visits.map((v) => ({
      visitId: v.id,
      visitorName: v.visitor ? `${v.visitor.firstName} ${v.visitor.lastName}`.trim() : 'Visitante',
      falseExitReportedAt: v.falseExitReportedAt ?? null,
    }));
  }

  async updateVisitFields(
    visitId: string,
    tenantId: string,
    dto: {
      hostId?: string | null;
      purpose?: string | null;
      visitorType?: string | null;
      scheduledAt?: string | null;
      expectedEndAt?: string | null;
      accessGroups?: { id: number; name: string }[];
      autoCheckoutEnabled?: boolean;
    },
    auditorUserId: string,
  ): Promise<Visit> {
    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
      relations: ['visitor', 'hostUser', 'host'],
    });
    if (!visit) throw new NotFoundException('Visita no encontrada.');

    const fields: Partial<Record<string, any>> = {};

    if ('hostId' in dto) {
      if (!dto.hostId) {
        fields.hostId = null;
      } else {
        const host = await this.hostRepository.findOne({ where: { id: dto.hostId } });
        if (!host) throw new NotFoundException('Anfitrión no encontrado.');
        fields.hostId = dto.hostId;
      }
    }

    if ('purpose' in dto)      fields.purpose      = dto.purpose      ?? null;
    if ('visitorType' in dto && dto.visitorType) fields.visitorType = dto.visitorType;
    if ('scheduledAt' in dto && dto.scheduledAt) fields.scheduledAt = new Date(dto.scheduledAt);
    if ('expectedEndAt' in dto) fields.expectedEndAt = dto.expectedEndAt ? new Date(dto.expectedEndAt) : null;
    if ('accessGroups' in dto)  fields.accessGroups = dto.accessGroups ?? [];
    if ('autoCheckoutEnabled' in dto) fields.autoCheckoutEnabled = !!dto.autoCheckoutEnabled;

    if (Object.keys(fields).length === 0) return visit;

    await this.visitRepository.update({ id: visitId, tenantId }, fields);

    this.structuredLogger.logUserAction(
      'visit.updated',
      auditorUserId,
      { visitId, updatedFields: Object.keys(fields) },
      tenantId,
    );

    return (await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
      relations: ['visitor', 'hostUser', 'host'],
    }))!;
  }

  async getVisitDetail(visitId: string, tenantId: string): Promise<Visit & { credentials: AccessCredential[]; assets: VisitorAsset[]; vehicles: VisitorVehicle[] }> {
    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
      relations: ['visitor', 'hostUser', 'host'],
    });
    if (!visit) {
      throw new NotFoundException('Visita no encontrada.');
    }

    const credentials = await this.credentialRepository.find({
      where: { visitId: visit.id },
      order: { createdAt: 'ASC' },
      select: [
        'id',
        'type',
        'cardNumber',
        'cardSubtype',
        'supremaCardId',
        'syncStatus',
        'lastSyncError',
        'lastSyncAttemptAt',
        'supremaTemplateCount',
        'expiresAt',
        'isRevoked',
        'createdAt',
      ],
    });

    const assets = await this.assetRepository.find({
      where: { visitId: visit.id },
      order: { createdAt: 'ASC' },
    });

    const vehicles = await this.vehicleRepository.find({
      where: { visitId: visit.id },
      order: { createdAt: 'ASC' },
    });

    return { ...visit, credentials, assets, vehicles } as Visit & { credentials: AccessCredential[]; assets: VisitorAsset[]; vehicles: VisitorVehicle[] };
  }

  /** Obtiene los activos de una visita específica. */
  async getVisitAssets(visitId: string, tenantId: string): Promise<VisitorAsset[]> {
    const visit = await this.visitRepository.findOne({ where: { id: visitId, tenantId } });
    if (!visit) throw new NotFoundException('Visita no encontrada.');
    return this.assetRepository.find({ where: { visitId }, order: { createdAt: 'ASC' } });
  }

  /** Agrega un activo a una visita activa. */
  async addAssetToVisit(
    visitId: string,
    tenantId: string,
    data: { description: string; serialNumber?: string; category?: AssetCategory },
    auditorUserId: string,
  ): Promise<VisitorAsset> {
    const visit = await this.visitRepository.findOne({ where: { id: visitId, tenantId } });
    if (!visit) throw new NotFoundException('Visita no encontrada.');

    const asset = this.assetRepository.create({
      visitId,
      visitorId: visit.visitorId,
      tenantId,
      description: data.description,
      serialNumber: data.serialNumber ?? null,
      category: data.category ?? AssetCategory.OTHER,
      verifiedAtCheckout: false,
    });
    await this.assetRepository.save(asset);

    if (!visit.hasAssets) {
      await this.visitRepository.update({ id: visitId }, { hasAssets: true });
    }

    this.structuredLogger.logUserAction(
      'visit.asset_added',
      auditorUserId,
      { visitId, assetId: asset.id, description: asset.description },
      tenantId,
    );

    return asset;
  }

  /** Marca un activo como verificado en el checkout. */
  async verifyAsset(
    visitId: string,
    assetId: string,
    tenantId: string,
    verified: boolean,
    auditorUserId: string,
  ): Promise<VisitorAsset> {
    const asset = await this.assetRepository.findOne({ where: { id: assetId, visitId, tenantId } });
    if (!asset) throw new NotFoundException('Activo no encontrado.');
    asset.verifiedAtCheckout = verified;
    await this.assetRepository.save(asset);

    this.structuredLogger.logUserAction(
      verified ? 'visit.asset_verified' : 'visit.asset_unverified',
      auditorUserId,
      { visitId, assetId, description: asset.description },
      tenantId,
    );

    return asset;
  }

  /** Elimina un activo de una visita. */
  async removeAsset(visitId: string, assetId: string, tenantId: string, auditorUserId: string): Promise<void> {
    const asset = await this.assetRepository.findOne({ where: { id: assetId, visitId, tenantId } });
    if (!asset) throw new NotFoundException('Activo no encontrado.');
    await this.assetRepository.remove(asset);

    const remaining = await this.assetRepository.count({ where: { visitId } });
    if (remaining === 0) {
      await this.visitRepository.update({ id: visitId }, { hasAssets: false });
    }

    this.structuredLogger.logUserAction(
      'visit.asset_removed',
      auditorUserId,
      { visitId, assetId, description: asset.description },
      tenantId,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  VEHICLES — Gestión de vehículos declarados por el visitante
  // ══════════════════════════════════════════════════════════════════════════

  /** Obtiene los vehículos de una visita específica. */
  async getVisitVehicles(visitId: string, tenantId: string): Promise<VisitorVehicle[]> {
    const visit = await this.visitRepository.findOne({ where: { id: visitId, tenantId } });
    if (!visit) throw new NotFoundException('Visita no encontrada.');
    return this.vehicleRepository.find({ where: { visitId }, order: { createdAt: 'ASC' } });
  }

  /** Agrega un vehículo a una visita activa. */
  async addVehicleToVisit(
    visitId: string,
    tenantId: string,
    data: {
      licensePlate: string;
      brand?: string;
      model?: string;
      color?: string;
      vehicleType?: VehicleType;
      parkingZone?: string;
    },
    auditorUserId: string,
  ): Promise<VisitorVehicle> {
    const visit = await this.visitRepository.findOne({ where: { id: visitId, tenantId } });
    if (!visit) throw new NotFoundException('Visita no encontrada.');

    const vehicle = this.vehicleRepository.create({
      visitId,
      visitorId: visit.visitorId,
      tenantId,
      licensePlate: data.licensePlate.trim().toUpperCase().replace(/\s+/g, ''),
      brand: data.brand ?? null,
      model: data.model ?? null,
      color: data.color ?? null,
      vehicleType: data.vehicleType ?? VehicleType.CAR,
      parkingZone: data.parkingZone ?? null,
      verifiedAtCheckout: false,
      hasEntered: false,
    });
    await this.vehicleRepository.save(vehicle);

    if (!visit.hasVehicles) {
      await this.visitRepository.update({ id: visitId }, { hasVehicles: true });
    }

    this.structuredLogger.logUserAction(
      'visit.vehicle_added',
      auditorUserId,
      { visitId, vehicleId: vehicle.id, licensePlate: vehicle.licensePlate },
      tenantId,
    );

    return vehicle;
  }

  /** Marca un vehículo como verificado en el checkout. */
  async verifyVehicle(
    visitId: string,
    vehicleId: string,
    tenantId: string,
    verified: boolean,
    auditorUserId: string,
  ): Promise<VisitorVehicle> {
    const vehicle = await this.vehicleRepository.findOne({ where: { id: vehicleId, visitId, tenantId } });
    if (!vehicle) throw new NotFoundException('Vehículo no encontrado.');
    vehicle.verifiedAtCheckout = verified;
    await this.vehicleRepository.save(vehicle);

    this.structuredLogger.logUserAction(
      verified ? 'visit.vehicle_verified' : 'visit.vehicle_unverified',
      auditorUserId,
      { visitId, vehicleId, licensePlate: vehicle.licensePlate },
      tenantId,
    );

    return vehicle;
  }

  /** Marca un vehículo como "ya ingresó al parqueadero". */
  async markVehicleEntered(
    visitId: string,
    vehicleId: string,
    tenantId: string,
    hasEntered: boolean,
    auditorUserId: string,
  ): Promise<VisitorVehicle> {
    const vehicle = await this.vehicleRepository.findOne({ where: { id: vehicleId, visitId, tenantId } });
    if (!vehicle) throw new NotFoundException('Vehículo no encontrado.');
    vehicle.hasEntered = hasEntered;
    await this.vehicleRepository.save(vehicle);

    this.structuredLogger.logUserAction(
      'visit.vehicle_entered',
      auditorUserId,
      { visitId, vehicleId, licensePlate: vehicle.licensePlate, hasEntered },
      tenantId,
    );

    return vehicle;
  }

  /** Elimina un vehículo de una visita. */
  async removeVehicle(visitId: string, vehicleId: string, tenantId: string, auditorUserId: string): Promise<void> {
    const vehicle = await this.vehicleRepository.findOne({ where: { id: vehicleId, visitId, tenantId } });
    if (!vehicle) throw new NotFoundException('Vehículo no encontrado.');
    await this.vehicleRepository.remove(vehicle);

    const remaining = await this.vehicleRepository.count({ where: { visitId } });
    if (remaining === 0) {
      await this.visitRepository.update({ id: visitId }, { hasVehicles: false });
    }

    this.structuredLogger.logUserAction(
      'visit.vehicle_removed',
      auditorUserId,
      { visitId, vehicleId, licensePlate: vehicle.licensePlate },
      tenantId,
    );
  }

  private static readonly MAX_PHOTO_BYTES = 2 * 1024 * 1024;
  private static readonly UPLOADS_DIR = path.resolve(
    process.cwd(),
    'uploads',
    'photos',
  );

  /**
   * Recorta y normaliza una imagen facial usando las coordenadas del bounding box
   * detectadas en el frontend (face-api.js). Aplica 30% de padding alrededor del
   * rostro, redimensiona a 600×800 px y comprime a JPEG q85.
   *
   * El backend nunca confía en el recorte visual del frontend: usa las coordenadas
   * únicamente para hacer el crop autoritativo con Sharp.
   *
   * @returns Base64 puro (sin prefijo data:image) del JPEG resultante.
   */
  private async processVisualFace(
    photoBase64: string,
    faceBox: { x: number; y: number; width: number; height: number },
  ): Promise<string> {
    const cleanBase64 = photoBase64.replace(
      /^data:image\/(jpeg|jpg|png|webp);base64,/,
      '',
    );
    const buffer = Buffer.from(cleanBase64, 'base64');

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(buffer).metadata();
    } catch (err) {
      this.logger.warn(
        `AUDIT: CROP_FAILED — no se pudo leer metadata de la imagen: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return cleanBase64;
    }

    const imgWidth = metadata.width ?? 0;
    const imgHeight = metadata.height ?? 0;

    if (imgWidth === 0 || imgHeight === 0) {
      this.logger.warn('AUDIT: CROP_FAILED — dimensiones de imagen inválidas, se omite el crop.');
      return cleanBase64;
    }

    const paddingX = Math.round(faceBox.width * 0.30);
    const paddingY = Math.round(faceBox.height * 0.30);

    const left   = Math.max(0, Math.round(faceBox.x - paddingX));
    const top    = Math.max(0, Math.round(faceBox.y - paddingY));
    const right  = Math.min(imgWidth,  Math.round(faceBox.x + faceBox.width  + paddingX));
    const bottom = Math.min(imgHeight, Math.round(faceBox.y + faceBox.height + paddingY));

    const cropWidth  = right - left;
    const cropHeight = bottom - top;

    if (cropWidth < 10 || cropHeight < 10) {
      this.logger.warn(
        `AUDIT: CROP_FAILED — región de crop inválida (${cropWidth}×${cropHeight}), se omite el crop.`,
      );
      return cleanBase64;
    }

    try {
      const processed = await sharp(buffer)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .resize(600, 800, { fit: 'inside', withoutEnlargement: false })
        .jpeg({ quality: 85 })
        .toBuffer();

      this.logger.log(
        `INFO: AUDIT: CROP_OK — rostro recortado (${left},${top},${cropWidth}×${cropHeight}) → ` +
        `output ${processed.length} bytes, ${imgWidth}×${imgHeight} original.`,
      );

      return processed.toString('base64');
    } catch (err) {
      this.logger.warn(
        `AUDIT: CROP_FAILED — sharp falló al procesar imagen: ${err instanceof Error ? err.message : 'unknown'}. Se usa imagen original.`,
      );
      return cleanBase64;
    }
  }

  private async saveVisitorPhoto(
    visitorId: string,
    base64Data: string,
  ): Promise<string> {
    const cleanBase64 = base64Data.replace(
      /^data:image\/(jpeg|jpg|png|webp);base64,/,
      '',
    );
    const buffer = Buffer.from(cleanBase64, 'base64');

    if (buffer.length > VisitorsService.MAX_PHOTO_BYTES) {
      throw new BadRequestException(
        `Photo exceeds maximum size of ${VisitorsService.MAX_PHOTO_BYTES / (1024 * 1024)} MB.`,
      );
    }

    if (buffer.length < 100) {
      throw new BadRequestException('Invalid photo data.');
    }

    const uploadsDir = VisitorsService.UPLOADS_DIR;
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const safeId = visitorId.replace(/[^a-f0-9-]/gi, '');
    const filename = `${safeId}.jpg`;
    const filePath = path.join(uploadsDir, filename);

    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(uploadsDir)) {
      throw new BadRequestException('Invalid visitor ID for photo storage.');
    }

    fs.writeFileSync(resolved, buffer);

    return filename;
  }

  async getVisitorPhotoBuffer(
    visitorId: string,
    tenantId: string,
  ): Promise<Buffer | null> {
    const visitor = await this.visitorRepository.findOne({
      where: { id: visitorId, tenantId },
    });
    if (!visitor || !visitor.photoPath) return null;

    const safeFilename = path.basename(visitor.photoPath);
    const filePath = path.join(VisitorsService.UPLOADS_DIR, safeFilename);

    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(VisitorsService.UPLOADS_DIR)) return null;

    if (!fs.existsSync(resolved)) return null;

    return fs.readFileSync(resolved);
  }

  /**
   * Reintenta la sincronización manual de una visita con BioStar.
   * Útil cuando la sincronización automática falló (syncStatus = PENDING | FAILED).
   */
  async forceSyncVisit(
    visitId: string,
    tenantId: string,
    auditorUserId: string,
  ): Promise<{ success: boolean; message: string; syncStatus: string }> {
    const result = await this.supremaSync.forceSyncVisit(visitId, tenantId);

    this.structuredLogger.logUserAction(
      result.success ? 'biostar.force_sync_success' : 'biostar.force_sync_pending',
      auditorUserId,
      { visitId, syncStatus: result.syncStatus, message: result.message },
      tenantId,
    );

    return result;
  }

  async deleteOrphanedBioStarUser(tenantId: string, biostarUserId: string): Promise<void> {
    await this.supremaSync.deleteUserByIdFromBioStar(tenantId, biostarUserId);
  }

  async updateVisitor(
    visitorId: string,
    tenantId: string,
    dto: UpdateVisitorDto,
    auditorUserId: string,
  ): Promise<Visitor> {
    const visitor = await this.visitorRepository.findOne({
      where: { id: visitorId, tenantId },
    });
    if (!visitor) {
      throw new NotFoundException('Visitante no encontrado.');
    }

    // Collect changed scalar fields
    const fieldsToUpdate: Partial<Record<string, any>> = {};
    if (dto.firstName  !== undefined) fieldsToUpdate.firstName  = dto.firstName;
    if (dto.lastName   !== undefined) fieldsToUpdate.lastName   = dto.lastName;
    if (dto.email      !== undefined) fieldsToUpdate.email      = dto.email.toLowerCase();
    if (dto.phone      !== undefined) fieldsToUpdate.phone      = dto.phone;
    if (dto.company    !== undefined) fieldsToUpdate.company    = dto.company;
    if (dto.position   !== undefined) fieldsToUpdate.position   = dto.position;
    if (dto.documentType   !== undefined) fieldsToUpdate.documentType   = dto.documentType;
    if (dto.documentNumber !== undefined) fieldsToUpdate.documentNumber = dto.documentNumber;
    if (dto.nationality    !== undefined) fieldsToUpdate.nationality    = dto.nationality;

    // Process photo: crop (if faceBox provided) + normalize then save to disk
    if (dto.photoBase64) {
      try {
        let photoData: string;
        if (dto.faceBox) {
          // Full Visual Face pipeline: crop around face then resize+compress
          photoData = await this.processVisualFace(dto.photoBase64, dto.faceBox);
          this.logger.log(
            `INFO: AUDIT: VISUAL_FACE_OK — foto actualizada con recorte para visitante ${visitor.id} ` +
            `(faceBox ${dto.faceBox.x},${dto.faceBox.y} ${dto.faceBox.width}×${dto.faceBox.height}).`,
          );
        } else {
          // No faceBox: just normalize (resize + compress) without cropping
          const cleanB64 = dto.photoBase64.replace(/^data:image\/(jpeg|jpg|png|webp);base64,/, '');
          const normalized = await sharp(Buffer.from(cleanB64, 'base64'))
            .resize(600, 800, { fit: 'inside', withoutEnlargement: false })
            .jpeg({ quality: 85 })
            .toBuffer();
          photoData = `data:image/jpeg;base64,${normalized.toString('base64')}`;
          this.logger.log(
            `INFO: AUDIT: NORMALIZE_OK — foto actualizada para visitante ${visitor.id}, ` +
            `output ${normalized.length} bytes.`,
          );
        }
        const photoPath = await this.saveVisitorPhoto(visitor.id, photoData);
        fieldsToUpdate.photoPath = photoPath;
      } catch (err) {
        this.logger.warn(`Failed to save updated photo for visitor ${visitor.id}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    // Use repository.update() instead of save() so @UpdateDateColumn is ALWAYS
    // refreshed in the DB — save() skips the SQL UPDATE when no column values
    // changed (e.g. only the photo file on disk changed, same photoPath string).
    await this.visitorRepository.update(
      { id: visitor.id, tenantId },
      fieldsToUpdate as any,
    );

    this.structuredLogger.logUserAction(
      'visitor.updated',
      auditorUserId,
      {
        visitorId: visitor.id,
        updatedFields: Object.keys(dto).filter(
          (k) => (dto as any)[k] !== undefined,
        ),
      },
      tenantId,
    );

    // Return fresh entity with new updatedAt so callers see the updated timestamp
    return (await this.visitorRepository.findOne({ where: { id: visitorId, tenantId } }))!;
  }

  async addCredentialToVisit(
    visitId: string,
    tenantId: string,
    dto: {
      type: string;
      cardNumber?: string;
      cardSubtype?: string;
      faceTemplates?: Record<string, unknown>;
      fingerprintTemplate?: { template: string; quality?: number };
    },
    auditorUserId: string,
  ): Promise<AccessCredential> {
    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
      relations: ['visitor'],
    });
    if (!visit) throw new NotFoundException('Visita no encontrada.');

    // ─── QR_JWT: generar JWT y guardar tokenHash ──────────────────────────
    // addCredentialToVisit se llama desde el modal de detalle (manual).
    // A diferencia del flujo scheduleVisit (QR_DYNAMIC automático), aquí
    // necesitamos generar el token explícitamente para que el portal funcione
    // y para poder enrollar la credencial en BioStar al hacer check-in.
    let qrJti: string | undefined;
    let qrExpiresAt: Date | undefined;

    if (dto.type === CredentialType.QR_JWT) {
      // Revocar cualquier QR_JWT activo previo en esta visita
      const existingQr = await this.credentialRepository.findOne({
        where: { visitId: visit.id, type: CredentialType.QR_JWT, isRevoked: false },
        order: { createdAt: 'DESC' },
      });
      if (existingQr?.tokenHash) {
        await this.qrEngine.revokeQr(existingQr.tokenHash).catch(() => null);
        await this.credentialRepository.update(existingQr.id, { isRevoked: true });
      }

      const generatedQr = await this.qrEngine.generateQr({
        visitId: visit.id,
        visitorId: visit.visitorId,
        tenantId,
      });
      qrJti = generatedQr.jti;
      qrExpiresAt = generatedQr.expiresAt;
    }

    // Cifrar y serializar templates biométricos (AES-256-GCM) para VISUAL_FACE / FINGERPRINT_REF
    let encryptedData: string | null = null;
    let supremaTemplateCount = 0;
    if (dto.type === CredentialType.VISUAL_FACE && dto.faceTemplates) {
      const json = JSON.stringify(dto.faceTemplates);
      encryptedData = this.encryptionService.encrypt(json);
      const tpls = (dto.faceTemplates.templates as unknown[]) || [];
      supremaTemplateCount = Array.isArray(tpls) ? tpls.length : (dto.faceTemplates.template_ex_normalized_image ? 1 : 0);
    } else if (dto.type === CredentialType.FINGERPRINT_REF && dto.fingerprintTemplate) {
      const json = JSON.stringify(dto.fingerprintTemplate);
      encryptedData = this.encryptionService.encrypt(json);
      supremaTemplateCount = 1;
    }

    const credential = this.credentialRepository.create({
      visitId: visit.id,
      type: dto.type as CredentialType,
      cardNumber: dto.cardNumber?.trim().toUpperCase() || null,
      cardSubtype: dto.type === CredentialType.RFID
        ? ((dto as any).cardSubtype ?? RfidCardSubtype.CSN)
        : null,
      tokenHash: qrJti ?? null,
      expiresAt: qrExpiresAt ?? null,
      syncStatus: CredentialSyncStatus.PENDING,
      encryptedData,
      supremaTemplateCount,
    } as Partial<AccessCredential>);
    await this.credentialRepository.save(credential);

    this.structuredLogger.logUserAction(
      'credential.added',
      auditorUserId,
      { visitId, credentialType: dto.type },
      tenantId,
    );

    // ─── Sincronizar credencial con BioStar si la visita está activa ─────
    if (
      visit.status === VisitStatus.CHECKED_IN &&
      visit.supremaUserRefId &&
      (dto.type === CredentialType.RFID || dto.type === CredentialType.SMART_CARD)
    ) {
      setImmediate(() => {
        this.supremaSync.pushNewPhysicalCredential(visit).catch((err: any) =>
          this.logger.error(
            `Error sincronizando credencial física en BioStar: ${err?.message}`,
          ),
        );
      });
    }

    // ─── VISUAL_FACE: enrolar rostro si la visita ya tiene usuario en BioStar ──
    if (
      dto.type === CredentialType.VISUAL_FACE &&
      visit.status === VisitStatus.CHECKED_IN &&
      visit.supremaUserRefId
    ) {
      const freshVisitor = await this.visitorRepository.findOne({
        where: { id: visit.visitorId },
      });
      if (freshVisitor) {
        const credId = credential.id;
        // Si el operador escaneó desde dispositivo, usar esos templates directamente
        const precomputed = dto.faceTemplates
          ? {
              template_ex_normalized_image: dto.faceTemplates.template_ex_normalized_image as string | undefined,
              templates: dto.faceTemplates.templates as unknown[] | undefined,
              image: dto.faceTemplates.image as string | undefined,
            }
          : undefined;
        setImmediate(async () => {
          try {
            await this.supremaSync.pushVisualFace(visit, freshVisitor, precomputed);
            await this.credentialRepository.update(credId, {
              syncStatus: CredentialSyncStatus.SYNCED,
            });
          } catch (err: any) {
            this.logger.warn(
              `[VISUAL_FACE] No se pudo enrolar rostro en BioStar: ${err.message}`,
            );
            await this.credentialRepository.update(credId, {
              syncStatus: CredentialSyncStatus.FAILED,
              lastSyncError: err.message?.substring(0, 500),
            }).catch(() => {});
          }
        });
      }
    }

    // ─── FINGERPRINT_REF: enrolar huella si la visita ya tiene usuario en BioStar ──
    if (
      dto.type === CredentialType.FINGERPRINT_REF &&
      dto.fingerprintTemplate &&
      visit.status === VisitStatus.CHECKED_IN &&
      visit.supremaUserRefId
    ) {
      const fpTemplate = dto.fingerprintTemplate;
      const credId = credential.id;
      setImmediate(async () => {
        try {
          await this.supremaSync.pushFingerprintCredential(visit, fpTemplate);
          await this.credentialRepository.update(credId, {
            syncStatus: CredentialSyncStatus.SYNCED,
          });
        } catch (err: any) {
          this.logger.warn(
            `[FINGERPRINT_REF] No se pudo enrolar huella en BioStar: ${err.message}`,
          );
          await this.credentialRepository.update(credId, {
            syncStatus: CredentialSyncStatus.FAILED,
            lastSyncError: err.message?.substring(0, 500),
          }).catch(() => {});
        }
      });
    }

    // ─── QR_JWT: enviar Magic Link al visitante por email ────────────────
    // Fire-and-forget: no bloquea la respuesta al operador.
    // Requiere que el visitante tenga email registrado.
    if (dto.type === CredentialType.QR_JWT) {
      const visitor = visit.visitor as Visitor & { firstName?: string; lastName?: string; email?: string };
      const visitorEmail = visitor?.email;
      const portalToken = visit.portalToken;

      if (visitorEmail && portalToken) {
        setImmediate(async () => {
          try {
            const visitorName = `${visitor.firstName ?? ''} ${visitor.lastName ?? ''}`.trim();
            const hostName = visit.hostId
              ? ((await this.hostRepository.findOne({ where: { id: visit.hostId } }).catch(() => null))?.fullName ?? 'Recepción')
              : 'Recepción';
            const scheduledDate = visit.scheduledAt
              ? new Date(visit.scheduledAt).toLocaleDateString('es-ES', {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })
              : new Date().toLocaleDateString('es-ES', { dateStyle: 'long' });

            await this.notifications.sendQrPortalLink(visitorEmail, {
              visitorName,
              hostName,
              scheduledDate,
              portalToken,
            });
            this.logger.log(`📧 Magic Link QR enviado a ${visitorEmail} (visita ${visit.id})`);
          } catch (err: any) {
            this.logger.error(`Error enviando Magic Link QR a ${visitorEmail}: ${err?.message}`);
          }
        });
      } else {
        this.logger.warn(
          `QR_JWT asignado a visita ${visit.id} pero sin email de visitante — no se envió correo.`,
        );
      }
    }

    return credential;
  }

  async revokeCredential(
    credentialId: string,
    tenantId: string,
    auditorUserId: string,
  ): Promise<void> {
    const credential = await this.credentialRepository.findOne({
      where: { id: credentialId },
    });
    if (!credential) throw new NotFoundException('Credencial no encontrada.');

    credential.isRevoked = true;
    credential.syncStatus = CredentialSyncStatus.PENDING;
    await this.credentialRepository.save(credential);

    this.structuredLogger.logUserAction(
      'credential.revoked',
      auditorUserId,
      { credentialId },
      tenantId,
    );
  }

  // ─── SETTINGS: CHECKIN NOTIFICATION ─────────────────────────────────────

  private readonly CHECKIN_NOTIF_REDIS_PREFIX = 'checkin-notif:';

  async getCheckinNotifSettings(tenantId: string): Promise<{
    enabled: boolean;
    subject: string;
    bodyText: string;
    logoUrl: string | null;
  }> {
    const raw = await this.redis.get(`${this.CHECKIN_NOTIF_REDIS_PREFIX}${tenantId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { logoUrl: null, ...parsed };
    }
    return {
      enabled: true,
      subject: 'Tu visitante {{visitorName}} ha llegado al edificio',
      bodyText:
        'Hola {{hostName}},\n\nTu visitante {{visitorName}} de {{visitorCompany}} ha realizado check-in en recepción y se encuentra esperándote.\n\nMotivo de visita: {{purpose}}\nHora de ingreso: {{checkedInTime}}\n\nSaludos,\nRecepción',
      logoUrl: null,
    };
  }

  async setCheckinNotifSettings(
    tenantId: string,
    settings: { enabled?: boolean; subject?: string; bodyText?: string; logoUrl?: string | null },
  ): Promise<{ enabled: boolean; subject: string; bodyText: string; logoUrl: string | null }> {
    const current = await this.getCheckinNotifSettings(tenantId);
    const updated = {
      enabled: settings.enabled !== undefined ? Boolean(settings.enabled) : current.enabled,
      subject: settings.subject !== undefined ? String(settings.subject) : current.subject,
      bodyText: settings.bodyText !== undefined ? String(settings.bodyText) : current.bodyText,
      logoUrl: 'logoUrl' in settings ? (settings.logoUrl ?? null) : current.logoUrl,
    };
    await this.redis.set(
      `${this.CHECKIN_NOTIF_REDIS_PREFIX}${tenantId}`,
      JSON.stringify(updated),
    );
    return updated;
  }

  // ─── SETTINGS: QR ─────────────────────────────────────────────────────────

  private readonly QR_SETTINGS_REDIS_PREFIX = 'qrsettings:';

  async getQrSettings(tenantId: string): Promise<{
    countdownSeconds: number;
    showRenewButton: boolean;
  }> {
    const raw = await this.redis.get(`${this.QR_SETTINGS_REDIS_PREFIX}${tenantId}`);
    if (raw) return JSON.parse(raw);
    return { countdownSeconds: 60, showRenewButton: true };
  }

  async setQrSettings(
    tenantId: string,
    settings: { countdownSeconds?: number; showRenewButton?: boolean },
  ): Promise<{ countdownSeconds: number; showRenewButton: boolean }> {
    const current = await this.getQrSettings(tenantId);
    const updated = {
      countdownSeconds:
        settings.countdownSeconds !== undefined
          ? Math.max(10, Math.min(3600, Number(settings.countdownSeconds)))
          : current.countdownSeconds,
      showRenewButton:
        settings.showRenewButton !== undefined
          ? Boolean(settings.showRenewButton)
          : current.showRenewButton,
    };
    await this.redis.set(
      `${this.QR_SETTINGS_REDIS_PREFIX}${tenantId}`,
      JSON.stringify(updated),
    );
    return updated;
  }

  // ─── QR PORTAL (PUBLIC) ──────────────────────────────────────────────────

  /**
   * Devuelve los datos del QR activo para el portal del visitante.
   * El QR codifica el card_id (jti truncado a 32 chars) que fue registrado
   * en BioStar 2 — esto es lo que el lector hardware escanea y valida.
   */
  async getQrForPortal(portalToken: string): Promise<{
    qrDataUrl: string;
    cardId: string;
    visitorName: string;
    expiresAt: Date | null;
    visitId: string;
    countdownSeconds: number;
    showRenewButton: boolean;
  }> {
    const visit = await this.visitRepository.findOne({
      where: { portalToken },
      relations: ['visitor'],
    });
    if (!visit) throw new NotFoundException('Portal de visita no encontrado.');

    const credential = await this.credentialRepository.findOne({
      where: { visitId: visit.id, type: CredentialType.QR_JWT, isRevoked: false },
      order: { createdAt: 'DESC' },
    });
    if (!credential?.tokenHash)
      throw new NotFoundException('No hay credencial QR activa para esta visita.');

    const cardId = credential.tokenHash.substring(0, 32);
    const qrDataUrl = await this.qrEngine.generateCardQrDataUrl(cardId);

    const visitor = visit.visitor as Visitor & { firstName?: string; lastName?: string };
    const visitorName = visitor
      ? `${visitor.firstName ?? ''} ${visitor.lastName ?? ''}`.trim()
      : 'Visitante';

    // ── Lazy BioStar QR enrollment: solo al abrir el portal por primera vez ──
    // El sync inicial en check-in NO enrolla el QR en BioStar. Lo hacemos aquí
    // para no desperdiciar credenciales antes de que el visitante realmente
    // necesite autenticarse. Un flag en Redis evita re-enrollar en cada GET.
    if (
      visit.status === VisitStatus.CHECKED_IN &&
      visit.supremaUserRefId &&
      credential?.tokenHash
    ) {
      const enrolledKey = `qr:biostar:enrolled:${visit.id}`;
      const alreadyEnrolled = await this.redis.exists(enrolledKey);
      if (!alreadyEnrolled) {
        // Marcar como enrollado ANTES del fire-and-forget para evitar
        // doble-enrollment si el visitante hace varios GET rápidos.
        await this.redis.set(enrolledKey, '1', 'EX', 7 * 24 * 3600);
        const credentialSnapshot = credential;
        const visitSnapshot = visit;
        setImmediate(() => {
          this.supremaSync
            .updateQrCredential(visitSnapshot, credentialSnapshot.tokenHash)
            .catch((err: any) =>
              this.logger.error(
                `[QR-LAZY] Error enrollando QR en BioStar al abrir portal: ${err?.message}`,
              ),
            );
        });
        this.logger.log(
          `[QR-LAZY] Primera apertura del portal — enrollando QR en BioStar para visita ${visit.id}`,
        );
      }
    }

    const qrSettings = await this.getQrSettings(visit.tenantId);
    return {
      qrDataUrl,
      cardId,
      visitorName,
      expiresAt: credential.expiresAt,
      visitId: visit.id,
      countdownSeconds: qrSettings.countdownSeconds,
      showRenewButton: qrSettings.showRenewButton,
    };
  }

  /**
   * Invalida el QR actual en Redis y genera uno nuevo para el portal.
   * Útil cuando el visitante solicita refrescar el código pasados N segundos (configurable).
   */
  async refreshQrForPortal(portalToken: string): Promise<{
    qrDataUrl: string;
    cardId: string;
    expiresAt: Date | null;
    visitId: string;
    countdownSeconds: number;
    showRenewButton: boolean;
  }> {
    const visit = await this.visitRepository.findOne({
      where: { portalToken },
      relations: ['visitor'],
    });
    if (!visit) throw new NotFoundException('Portal de visita no encontrado.');

    const oldCredential = await this.credentialRepository.findOne({
      where: { visitId: visit.id, type: CredentialType.QR_JWT, isRevoked: false },
      order: { createdAt: 'DESC' },
    });

    if (oldCredential?.tokenHash) {
      await this.qrEngine.revokeQr(oldCredential.tokenHash);
      await this.credentialRepository.update(oldCredential.id, { isRevoked: true });
    }

    const generatedQr = await this.qrEngine.generateQr({
      visitId: visit.id,
      visitorId: visit.visitorId,
      tenantId: visit.tenantId,
    });

    const newCredential = this.credentialRepository.create({
      visitId: visit.id,
      type: CredentialType.QR_JWT,
      tokenHash: generatedQr.jti,
      expiresAt: generatedQr.expiresAt,
      syncStatus: null,
    });
    await this.credentialRepository.save(newCredential);

    const cardId = generatedQr.jti.substring(0, 32);
    const qrDataUrl = await this.qrEngine.generateCardQrDataUrl(cardId);

    this.logger.log(`🔄 QR refrescado para portal ${portalToken} (visita ${visit.id})`);

    // ─── Actualizar credencial QR en BioStar si visita está activa ───────
    // Si el visitante ya hizo check-in y su usuario existe en BioStar,
    // enrollamos el nuevo JTI como tarjeta QR en BioStar en segundo plano.
    if (visit.status === VisitStatus.CHECKED_IN && visit.supremaUserRefId) {
      setImmediate(() => {
        this.supremaSync.updateQrCredential(visit, generatedQr.jti).catch((err: any) =>
          this.logger.error(
            `Error actualizando QR en BioStar tras refresh: ${err?.message}`,
          ),
        );
      });
    }

    const qrSettings = await this.getQrSettings(visit.tenantId);
    return {
      qrDataUrl,
      cardId,
      expiresAt: generatedQr.expiresAt,
      visitId: visit.id,
      countdownSeconds: qrSettings.countdownSeconds,
      showRenewButton: qrSettings.showRenewButton,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INVITE & ONBOARDING FLOW
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Invita a uno o varios visitantes por correo electrónico.
   * Por cada email: crea un Visitor placeholder + una Visit con estado SCHEDULED
   * y envía un Magic Link de onboarding.
   */
  async inviteVisitors(
    dto: InviteVisitorsDto,
    tenantId: string,
    invitedByUserId: string,
  ): Promise<{ invited: number; skipped: number; results: { email: string; status: string; visitId?: string }[] }> {
    const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });
    const companyName = tenant?.name ?? 'BioVisitor X';

    let host: Host | null = null;
    if (dto.hostId) {
      host = await this.hostRepository.findOne({ where: { id: dto.hostId, tenantId } });
    }
    const hostName = host?.fullName ?? 'El equipo de BioVisitor';

    const results: { email: string; status: string; visitId?: string }[] = [];
    let invited = 0;
    let skipped = 0;

    for (const email of dto.emails) {
      try {
        const onboardingToken = uuidv4();

        // Determine document key: use provided doc number or fallback placeholder
        const docNumber = dto.documentNumber?.trim()
          ? dto.documentNumber.trim()
          : `INVITE_${email.toLowerCase()}`;

        // Parse name if provided
        let firstName = 'Invitado';
        let lastName = email.split('@')[0];
        if (dto.invitedName?.trim()) {
          const parts = dto.invitedName.trim().split(' ');
          firstName = parts[0];
          lastName = parts.slice(1).join(' ') || parts[0];
        }

        // Create or update visitor placeholder
        let visitor = await this.visitorRepository.findOne({
          where: { tenantId, documentNumber: docNumber },
        });

        if (!visitor) {
          visitor = this.visitorRepository.create({
            tenantId,
            email: email.toLowerCase(),
            firstName,
            lastName,
            documentNumber: docNumber,
            documentType: dto.documentType ?? undefined,
          });
          visitor = await this.visitorRepository.save(visitor);
        } else if (dto.invitedName?.trim()) {
          visitor.firstName = firstName;
          visitor.lastName = lastName;
          if (dto.documentType) visitor.documentType = dto.documentType;
          visitor = await this.visitorRepository.save(visitor);
        }

        // Create visit
        const visitData: Record<string, unknown> = {
          tenantId,
          visitorId: visitor.id,
          hostId: host?.id ?? null,
          scheduledAt: new Date(dto.scheduledAt),
          expectedEndAt: dto.expectedEndAt ? new Date(dto.expectedEndAt) : null,
          purpose: dto.purpose ?? null,
          notes: dto.notes ?? null,
          status: VisitStatus.SCHEDULED,
          accessMethod: AccessMethod.MANUAL,
          onboardingToken,
          invitedEmail: email.toLowerCase(),
          checkedInByUserId: invitedByUserId,
        };
        const visit = this.visitRepository.create(visitData as unknown as Visit);
        const savedVisit: Visit = await this.visitRepository.save(visit) as Visit;

        // Send invitation email asynchronously (non-blocking)
        setImmediate(() => {
          this.notifications.sendInvitationEmail(email, {
            hostName,
            companyName,
            scheduledAt: new Date(dto.scheduledAt),
            expectedEndAt: dto.expectedEndAt ? new Date(dto.expectedEndAt) : null,
            purpose: dto.purpose ?? null,
            onboardingToken,
          }).catch((err) => {
            this.logger.error(`Error enviando invitación a ${email}: ${err.message}`);
          });
        });

        results.push({ email, status: 'invited', visitId: savedVisit.id });
        invited++;
      } catch (err) {
        this.logger.error(`Error invitando a ${email}: ${err.message}`);
        results.push({ email, status: 'error' });
        skipped++;
      }
    }

    this.logger.log(`Invitaciones enviadas: ${invited} OK, ${skipped} errores`);
    return { invited, skipped, results };
  }

  /**
   * Retorna los datos de la visita para mostrar el formulario de onboarding público.
   */
  async getOnboardingInfo(token: string): Promise<{
    email: string;
    hostName: string;
    companyName: string;
    scheduledAt: Date;
    expectedEndAt: Date | null;
    purpose: string | null;
    status: string;
    isPreRegistered: boolean;
    lockedFirstName: string | null;
    lockedLastName: string | null;
    lockedDocumentType: string | null;
    lockedDocumentNumber: string | null;
  }> {
    const visit = await this.visitRepository.findOne({
      where: { onboardingToken: token },
      relations: ['host', 'tenant', 'visitor'],
    });

    if (!visit) {
      throw new NotFoundException('Token de onboarding inválido o expirado.');
    }

    if (visit.status !== VisitStatus.SCHEDULED) {
      throw new BadRequestException('Este enlace ya fue utilizado o la visita no está activa.');
    }

    // A visitor is "pre-registered" when the host entered real identity data
    // (documentNumber does NOT start with the placeholder prefix INVITE_)
    const visitor = visit.visitor;
    const isPreRegistered = !!(
      visitor &&
      visitor.documentNumber &&
      !visitor.documentNumber.startsWith('INVITE_')
    );

    return {
      email: visit.invitedEmail ?? '',
      hostName: visit.host?.fullName ?? 'Anfitrión',
      companyName: visit.tenant?.name ?? 'BioVisitor X',
      scheduledAt: visit.scheduledAt,
      expectedEndAt: visit.expectedEndAt ?? null,
      purpose: visit.purpose ?? null,
      status: visit.status,
      isPreRegistered,
      lockedFirstName: isPreRegistered ? (visitor?.firstName ?? null) : null,
      lockedLastName: isPreRegistered ? (visitor?.lastName ?? null) : null,
      lockedDocumentType: isPreRegistered ? (visitor?.documentType ?? null) : null,
      lockedDocumentNumber: isPreRegistered ? (visitor?.documentNumber ?? null) : null,
    };
  }

  /**
   * Completa el onboarding del visitante: actualiza sus datos personales,
   * cambia el estado de la visita a PRE_REGISTERED e invalida el token.
   */
  async completeOnboarding(
    token: string,
    dto: CompleteOnboardingDto,
  ): Promise<{ visitId: string; visitorName: string }> {
    const visit = await this.visitRepository.findOne({
      where: { onboardingToken: token },
      relations: ['visitor', 'host', 'tenant'],
    });

    if (!visit) {
      throw new NotFoundException('Token de onboarding inválido o expirado.');
    }

    if (visit.status !== VisitStatus.SCHEDULED) {
      throw new BadRequestException('Este enlace ya fue utilizado. Si tienes dudas, contacta recepción.');
    }

    const tenantId = visit.tenantId;

    // Load the current visitor placeholder linked to this visit
    const currentVisitor = await this.visitorRepository.findOne({ where: { id: visit.visitorId } });

    // Determine if identity was pre-registered by the host (not a placeholder)
    const isPreRegistered = !!(
      currentVisitor &&
      currentVisitor.documentNumber &&
      !currentVisitor.documentNumber.startsWith('INVITE_')
    );

    // When pre-registered, lock identity fields — use stored values regardless of what was submitted
    const firstName      = isPreRegistered ? currentVisitor!.firstName      : dto.firstName;
    const lastName       = isPreRegistered ? currentVisitor!.lastName        : dto.lastName;
    const documentType   = isPreRegistered ? currentVisitor!.documentType    : dto.documentType;
    const documentNumber = isPreRegistered ? currentVisitor!.documentNumber  : dto.documentNumber;

    // Check if visitor with this documentNumber already exists (returning visitor — only relevant for non-pre-registered)
    let existingByDoc: Visitor | null = null;
    if (!isPreRegistered) {
      existingByDoc = await this.visitorRepository.findOne({
        where: { tenantId, documentNumber },
      });
    }

    let visitor: Visitor;

    if (!isPreRegistered && existingByDoc && existingByDoc.id !== visit.visitorId) {
      // A real record exists for a returning visitor → link visit and update
      visitor = existingByDoc;
      visitor.firstName = firstName;
      visitor.lastName = lastName;
      if (dto.company) visitor.company = dto.company;
      if (dto.position) visitor.position = dto.position;
      if (dto.phone) visitor.phone = dto.phone;
      if (dto.email) visitor.email = dto.email;
      visitor = await this.visitorRepository.save(visitor);

      // Delete the placeholder visitor
      const placeholder = await this.visitorRepository.findOne({ where: { id: visit.visitorId } });
      if (placeholder && placeholder.documentNumber.startsWith('INVITE_')) {
        await this.visitorRepository.delete(placeholder.id);
      }

      visit.visitorId = visitor.id;
    } else {
      // Update in-place (pre-registered or new visitor)
      if (!currentVisitor) throw new NotFoundException('Registro de visitante no encontrado.');
      visitor = currentVisitor;
      visitor.firstName = firstName;
      visitor.lastName = lastName;
      visitor.documentNumber = documentNumber;
      visitor.documentType = documentType;
      if (dto.company) visitor.company = dto.company;
      if (dto.position) visitor.position = dto.position;
      if (dto.phone) visitor.phone = dto.phone;
      if (dto.email) visitor.email = dto.email;
      visitor = await this.visitorRepository.save(visitor);
    }

    // Update visit: PRE_REGISTERED + invalidate token
    visit.status = VisitStatus.PRE_REGISTERED;
    visit.onboardingToken = null;
    visit.visitor = visitor;
    await this.visitRepository.save(visit);

    this.logger.log(`Onboarding completado para visita ${visit.id} — ${dto.firstName} ${dto.lastName}`);

    return {
      visitId: visit.id,
      visitorName: `${dto.firstName} ${dto.lastName}`,
    };
  }

  /**
   * Devuelve todos los datos necesarios para imprimir el gafete de una visita.
   * La foto y el QR se devuelven como data URLs (base64) para que funcionen
   * dentro del iframe de impresión de react-to-print sin requerir auth headers.
   */
  async getBadgeData(visitId: string, tenantId: string) {
    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
      relations: ['visitor', 'host', 'hostUser'],
    });
    if (!visit) throw new NotFoundException('Visita no encontrada.');

    const visitor = visit.visitor;

    // Leer foto como data URL base64 (necesario para el iframe de impresión)
    let photoBase64: string | null = null;
    if (visitor.photoPath) {
      try {
        const photoBuffer = await fs.promises.readFile(visitor.photoPath);
        photoBase64 = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;
      } catch {
        photoBase64 = null;
      }
    }

    // Buscar credencial QR_JWT activa (la que está registrada en BioStar)
    const qrCredential = await this.credentialRepository.findOne({
      where: { visitId, type: CredentialType.QR_JWT, isRevoked: false },
      order: { createdAt: 'DESC' },
    });

    // QR negro alta resolución nivel H para impresión térmica
    // Si hay credencial, usar el cardNumber (card_id de BioStar)
    // Si no, codificar el visitId para referencia manual
    const qrContent = qrCredential?.cardNumber ?? `VISIT:${visitId}`;
    const qrDataUrl = await this.qrEngine.generateBadgePrintQrDataUrl(qrContent);

    // Resolver nombre del anfitrión (Host entity o User entity)
    const hostName =
      visit.host?.fullName ??
      visit.hostUser?.fullName ??
      null;

    return {
      visitId,
      visitorId: visitor.id,
      visitorName: `${visitor.firstName} ${visitor.lastName}`.trim(),
      company: visitor.company ?? null,
      position: (visitor as any).position ?? null,
      documentType: visitor.documentType ?? null,
      documentNumber: visitor.documentNumber ?? null,
      host: hostName,
      purpose: visit.purpose ?? null,
      scheduledAt: visit.scheduledAt?.toISOString() ?? null,
      checkedInAt: visit.checkedInAt?.toISOString() ?? null,
      status: visit.status,
      photoBase64,
      qrDataUrl,
      issuedAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BIOMETRIC FINGERPRINT ENROLLMENT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Recibe un arreglo de plantillas dactilares capturadas por el BioMini Slim 2
   * (a través del agente local en recepción) y las envía a BioStar para que
   * el controlador físico reconozca la huella del visitante en los torniquetes.
   *
   * NUNCA almacena la imagen visual de la huella — solo la plantilla matemática.
   * Las plantillas se envían directamente a BioStar y no se guardan en BioVisitor X.
   */
  async enrollVisitorFingerprints(
    visitId: string,
    tenantId: string,
    auditorUserId: string,
    fingerprints: Array<{
      fingerIndex: number;
      template: string;
      samples?: string[];
      quality: number;
    }>,
  ): Promise<{ enrolled: number }> {
    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
    });
    if (!visit) throw new NotFoundException('Visita no encontrada.');

    if (!visit.supremaUserRefId) {
      throw new BadRequestException(
        'El visitante no está sincronizado con BioStar. ' +
        'Realiza la sincronización primero desde el panel de credenciales.',
      );
    }

    const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado.');

    // Build BioStar 2 fingerprint template payload
    // data1 = primer sample, data2 = segundo sample (o duplicado si solo hay uno)
    const templateData = fingerprints.map(fp => ({
      index: fp.fingerIndex,
      data1: fp.samples?.[0] ?? fp.template,
      data2: fp.samples?.[1] ?? fp.template,
      templateFormat: 'BioStar2',
    }));

    await this.supremaGateway.enrollFingerprint(tenant, visit.supremaUserRefId, templateData);

    // Audit log — NO se registran las plantillas biométricas, solo metadatos
    const avgQuality = fingerprints.length > 0
      ? Math.round(fingerprints.reduce((sum, f) => sum + (f.quality ?? 0), 0) / fingerprints.length)
      : 0;

    this.structuredLogger.logUserAction(
      'biometric.fingerprints_enrolled',
      auditorUserId,
      {
        visitId,
        visitorId: visit.visitorId,
        fingersEnrolled: fingerprints.length,
        fingerIndices: fingerprints.map(f => f.fingerIndex),
        avgQuality,
        supremaUserId: visit.supremaUserRefId,
      },
      tenantId,
    );

    return { enrolled: fingerprints.length };
  }

  /**
   * Registra en el audit log la impresión de un gafete físico (evento badge.printed).
   */
  async logBadgePrint(
    visitId: string,
    tenantId: string,
    auditorUserId: string,
  ): Promise<void> {
    const visit = await this.visitRepository.findOne({
      where: { id: visitId, tenantId },
    });
    if (!visit) return;

    this.structuredLogger.logUserAction(
      'badge.printed',
      auditorUserId,
      {
        visitId,
        visitorId: visit.visitorId,
        printedAt: new Date().toISOString(),
      },
      tenantId,
    );
  }

  /**
   * Envía el Magic Link QR al visitante si:
   *   1. La visita tiene una credencial QR_JWT activa con tokenHash generado
   *   2. El visitante tiene email registrado
   *   3. La visita tiene portalToken
   *
   * Fire-and-forget — no lanza excepciones al caller.
   */
  private async notifyQrPortalIfApplicable(visit: Visit): Promise<void> {
    const visitor = (visit as any).visitor as (Visitor & { firstName?: string; lastName?: string; email?: string }) | undefined;
    const visitorEmail = visitor?.email;
    const portalToken = visit.portalToken;

    if (!visitorEmail || !portalToken) {
      if (!visitorEmail) {
        this.logger.warn(
          `[QR-NOTIFY] Visita ${visit.id} — visitante sin email. Magic Link QR omitido.`,
        );
      }
      return;
    }

    const qrCredential = await this.credentialRepository.findOne({
      where: { visitId: visit.id, type: CredentialType.QR_JWT, isRevoked: false },
      order: { createdAt: 'DESC' },
    });

    if (!qrCredential?.tokenHash) {
      this.logger.debug(
        `[QR-NOTIFY] Visita ${visit.id} — sin credencial QR_JWT activa. Magic Link QR omitido.`,
      );
      return;
    }

    try {
      const visitorName = `${visitor?.firstName ?? ''} ${visitor?.lastName ?? ''}`.trim() || 'Visitante';
      const hostName = visit.hostId
        ? ((await this.hostRepository.findOne({ where: { id: visit.hostId } }).catch(() => null))?.fullName ?? 'Recepción')
        : 'Recepción';
      const scheduledDate = visit.scheduledAt
        ? new Date(visit.scheduledAt).toLocaleDateString('es-ES', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })
        : new Date().toLocaleDateString('es-ES', { dateStyle: 'long' });

      await this.notifications.sendQrPortalLink(visitorEmail, {
        visitorName,
        hostName,
        scheduledDate,
        portalToken,
      });
      this.logger.log(
        `📧 Magic Link QR enviado a ${visitorEmail} — visita ${visit.id}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[QR-NOTIFY] Error enviando Magic Link QR a ${visitorEmail}: ${err?.message}`,
      );
    }
  }
}
