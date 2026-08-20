/**
 * @file visitors.controller.ts
 * @description Controlador REST para la gestión de visitantes y visitas.
 *
 * Expone endpoints para crear visitantes, agendar visitas, listar visitas activas
 * y procesar check-out. Protegido por JWT.
 *
 * @module modules/visitors
 */

import {
  ForbiddenException,
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
  Put,
  Patch,
  Delete,
  Res,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { VisitorsService } from './visitors.service';
import { AutoCheckoutService } from './auto-checkout.service';
import { VisitorTypeService } from './visitor-type.service';
import { DataRetentionService } from './data-retention.service';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitorDto } from './dto/update-visitor.dto';
import { ValidateFaceDto } from './dto/validate-face.dto';
import { AddCredentialDto } from './dto/add-credential.dto';
import { InviteVisitorsDto } from './dto/invite-visitors.dto';
import { VisitorAssetDto, VisitorVehicleDto } from './dto/create-visit.dto';
import { CheckInVisitDto } from './dto/check-in-visit.dto';
import { AssetCategory, VehicleType, VisitorType } from '../../database/entities';

@Controller('visitors')
@UseGuards(AuthGuard('jwt')) // Requiere autenticación
export class VisitorsController {
  constructor(
    private readonly visitorsService: VisitorsService,
    private readonly autoCheckoutService: AutoCheckoutService,
    private readonly visitorTypeService: VisitorTypeService,
    private readonly dataRetentionService: DataRetentionService,
  ) {}

  /**
   * Crea o actualiza un visitante recurrente en el sistema.
   */
  @Post()
  async createOrUpdateVisitor(@Body() dto: CreateVisitorDto, @Req() req: any) {
    // Inyectar tenantId desde el usuario autenticado (extraído del JWT)
    dto.tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub; // user ID

    return this.visitorsService.createOrUpdateVisitor(dto, auditorUserId);
  }

  /**
   * Programa una visita y (opcionalmente) la sincroniza en vivo con BioStar.
   */
  @Post('schedule')
  async scheduleVisit(@Body() dto: CreateVisitDto, @Req() req: any) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;

    return this.visitorsService.scheduleVisit(dto, tenantId, auditorUserId);
  }

  /**
   * Busca un visitante existente por número de documento (para auto-relleno en frontend).
   * GET /api/v1/visitors/lookup?documentType=NATIONAL_ID&documentNumber=12345678
   * Retorna { found: true, visitor: {...} } o { found: false }
   */
  @Get('lookup')
  async lookupVisitor(
    @Query('documentType') documentType: string,
    @Query('documentNumber') documentNumber: string,
    @Req() req: any,
  ) {
    const tenantId = req.user.tenantId;
    if (!documentNumber?.trim()) return { found: false };

    const result = await this.visitorsService.lookupByDocument(
      tenantId,
      documentType || 'NATIONAL_ID',
      documentNumber,
    );

    if (!result) return { found: false };

    const {
      visitor, activeVisitsToday, activeVisit,
      visitCount, isFrecuent,
      suggestedHostId, suggestedHostName, suggestedPurpose,
      suggestedAccessGroups, recentVisits,
    } = result;

    return {
      found: true,
      activeVisitsToday,
      activeVisit: activeVisit ? {
        id: activeVisit.id,
        status: activeVisit.status,
        checkedInAt: activeVisit.checkedInAt,
        scheduledAt: activeVisit.scheduledAt,
        maxStayMinutes: activeVisit.maxStayMinutes,
      } : null,
      visitCount,
      isFrecuent,
      suggestedHostId,
      suggestedHostName,
      suggestedPurpose,
      suggestedAccessGroups,
      recentVisits,
      visitor: {
        id: visitor.id,
        firstName: visitor.firstName,
        lastName: visitor.lastName,
        documentType: visitor.documentType,
        documentNumber: visitor.documentNumber,
        email: visitor.email,
        phone: visitor.phone,
        company: visitor.company,
        hasPhoto: !!visitor.photoPath,
        photoPath: visitor.photoPath,
        updatedAt: visitor.updatedAt,
      },
    };
  }

  /**
   * Retorna el historial de visitas de un visitante específico (paginado).
   * GET /api/v1/visitors/:visitorId/history?limit=10&offset=0
   */
  @Get(':visitorId/history')
  async getVisitorHistory(
    @Param('visitorId') visitorId: string,
    @Query('limit') limit: string,
    @Query('offset') offset: string,
    @Req() req: any,
  ) {
    return this.visitorsService.getVisitorHistory(
      visitorId,
      req.user.tenantId,
      Math.min(parseInt(limit) || 10, 50),
      parseInt(offset) || 0,
    );
  }

  /**
   * Realiza check-in manual de una visita (SCHEDULED → CHECKED_IN).
   * Requiere `expiresAt` (fecha de expiración de la visita) en el cuerpo.
   */
  @Put('visit/:visitId/checkin')
  @HttpCode(HttpStatus.OK)
  async checkInVisit(
    @Param('visitId') visitId: string,
    @Body() body: CheckInVisitDto,
    @Req() req: any,
  ) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    const auditorUserName: string = req.user.fullName ?? req.user.email ?? auditorUserId;
    if (
      req.user.role === 'OPERATOR' &&
      req.user.permissions?.visitors?.checkin !== true
    ) {
      throw new ForbiddenException('No tienes permiso para realizar check-in.');
    }
    return this.visitorsService.checkInVisit(
      visitId,
      tenantId,
      auditorUserId,
      auditorUserName,
      false,
      new Date(body.expiresAt),
      body.startsAt ? new Date(body.startsAt) : undefined,
      body.autoCheckoutEnabled,
    );
  }

  /**
   * Marca una visita como No-Show (nunca llegó). Solo aplica a SCHEDULED / PRE_REGISTERED.
   */
  @Put('visit/:visitId/no-show')
  @HttpCode(HttpStatus.OK)
  async markAsNoShow(@Param('visitId') visitId: string, @Req() req: any) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    await this.visitorsService.markAsNoShow(visitId, tenantId, auditorUserId);
    return { success: true, message: 'Visita marcada como No-Show.' };
  }

  /**
   * Realiza checkout masivo de todas las visitas activas del tenant.
   * Requiere rol ADMIN.
   */
  @Post('bulk-checkout')
  @HttpCode(HttpStatus.OK)
  async bulkCheckout(@Req() req: any) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    const count = await this.visitorsService.bulkCheckoutTenant(tenantId, auditorUserId);
    return { success: true, checkedOutCount: count };
  }

  /**
   * Check-in masivo de visitas seleccionadas por ID.
   * Body: { visitIds: string[] }
   */
  @Post('bulk-checkin')
  @HttpCode(HttpStatus.OK)
  async bulkCheckin(@Body() body: { visitIds: string[]; startsAt?: string; expiresAt?: string }, @Req() req: any) {
    if (req.user.role === 'OPERATOR' && req.user.permissions?.visitors?.checkin !== true) {
      throw new ForbiddenException('No tienes permiso para realizar check-in.');
    }
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    const auditorUserName: string = req.user.fullName ?? req.user.email ?? auditorUserId;
    return this.visitorsService.bulkCheckInVisits(
      body.visitIds ?? [],
      tenantId,
      auditorUserId,
      auditorUserName,
      body.expiresAt ? new Date(body.expiresAt) : undefined,
      body.startsAt ? new Date(body.startsAt) : undefined,
    );
  }

  /**
   * Check-out masivo de visitas seleccionadas por ID.
   * Body: { visitIds: string[] }
   */
  @Post('bulk-checkout-selected')
  @HttpCode(HttpStatus.OK)
  async bulkCheckoutSelected(@Body() body: { visitIds: string[] }, @Req() req: any) {
    if (req.user.role === 'OPERATOR' && req.user.permissions?.visitors?.checkout !== true) {
      throw new ForbiddenException('No tienes permiso para realizar check-out.');
    }
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    const auditorUserName: string = req.user.fullName ?? req.user.email ?? auditorUserId;
    return this.visitorsService.bulkCheckoutSelected(
      body.visitIds ?? [],
      tenantId,
      auditorUserId,
      auditorUserName,
    );
  }

  /**
   * Importación masiva de visitantes desde CSV (parseado en frontend).
   * Body: { rows: ImportCsvRow[] }
   */
  @Post('import-csv')
  @HttpCode(HttpStatus.OK)
  async importFromCsv(@Body() body: { rows: any[] }, @Req() req: any) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    return this.visitorsService.importVisitorsFromCsv(
      body.rows ?? [],
      tenantId,
      auditorUserId,
    );
  }

  /**
   * Retorna la lista paginada de visitantes frecuentes del tenant.
   * Requiere rol ADMIN o SUPERVISOR.
   */
  @Get('frequent')
  async getFrequentVisitors(
    @Req() req: any,
    @Query('minVisits') minVisits?: string,
    @Query('windowDays') windowDays?: string,
    @Query('visitorType') visitorType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const tenantId: string = req.user.tenantId;
    const role: string = req.user.role;
    if (!['ADMIN', 'SUPERVISOR', 'DPO'].includes(role)) {
      throw new ForbiddenException('Acceso denegado: se requiere rol ADMIN o SUPERVISOR.');
    }
    return this.visitorsService.getFrequentVisitors(tenantId, {
      minVisits: minVisits ? Number(minVisits) : 3,
      windowDays: windowDays ? Number(windowDays) : 180,
      visitorType: visitorType || undefined,
      limit: limit ? Number(limit) : 100,
      offset: offset ? Number(offset) : 0,
    });
  }

  /**
   * Obtiene las visitas del tenant actual.
   * ?includeNoShow=true  → incluye NO_SHOW
   * ?includeAll=true     → incluye TODOS los estados (CHECKED_OUT, NO_SHOW, CANCELLED, etc.)
   * Ideal para el frontdesk / dashboard.
   */
  @Get('active')
  async getActiveVisits(
    @Req() req: any,
    @Query('includeNoShow') includeNoShow?: string,
    @Query('includeAll') includeAll?: string,
  ) {
    const tenantId: string = req.user.tenantId;
    const hostId: string | null = req.user.role === 'HOST' ? (req.user.hostId ?? null) : null;
    return this.visitorsService.getActiveVisits(
      tenantId,
      hostId,
      includeNoShow === 'true' || includeAll === 'true',
      includeAll === 'true',
    );
  }

  /**
   * Lista liviana de visitas con reporte de falsa salida pendiente (badge de notificaciones).
   */
  @Get('alerts/false-exits')
  async getFalseExitAlerts(@Req() req: any) {
    const tenantId: string = req.user.tenantId;
    return this.visitorsService.getFalseExitAlerts(tenantId);
  }

  /**
   * Finaliza una visita (check-out) explícitamente y remueve los privilegios de BioStar.
   */
  @Put('checkout/:visitId')
  async checkoutVisit(@Param('visitId') visitId: string, @Req() req: any) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    const auditorUserName: string = req.user.fullName ?? req.user.email ?? auditorUserId;
    if (
      req.user.role === 'OPERATOR' &&
      req.user.permissions?.visitors?.checkout !== true
    ) {
      throw new ForbiddenException('No tienes permiso para realizar check-out.');
    }
    await this.visitorsService.checkoutVisit(visitId, tenantId, auditorUserId, auditorUserName);
    return { success: true, message: 'Check-out completado exitosamente.' };
  }

  /**
   * El operador descarta un reporte de falsa salida (confirma que el
   * visitante en efecto salió). La visita permanece CHECKED_OUT.
   */
  @Put('visit/:visitId/false-exit/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismissFalseExit(
    @Param('visitId') visitId: string,
    @Body() body: { resolutionNote?: string },
    @Req() req: any,
  ) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    const auditorUserName: string = req.user.fullName ?? req.user.email ?? auditorUserId;
    return this.visitorsService.dismissFalseExit(
      visitId,
      tenantId,
      auditorUserId,
      auditorUserName,
      body?.resolutionNote,
    );
  }

  /**
   * El operador reactiva temporalmente el acceso físico tras un reporte de
   * falsa salida. Recrea el usuario/credencial en BioStar y define una
   * expiración explícita. La visita ORIGINAL se preserva (mismo checkedInAt).
   * Body: { reenableUntil: ISOString, autoCheckoutEnabled?: boolean, resolutionNote?: string }
   */
  @Put('visit/:visitId/temporary-reenable')
  @HttpCode(HttpStatus.OK)
  async temporaryReenableVisit(
    @Param('visitId') visitId: string,
    @Body()
    body: { reenableUntil: string; autoCheckoutEnabled?: boolean; resolutionNote?: string },
    @Req() req: any,
  ) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    const auditorUserName: string = req.user.fullName ?? req.user.email ?? auditorUserId;
    if (
      req.user.role === 'OPERATOR' &&
      req.user.permissions?.visitors?.checkin !== true
    ) {
      throw new ForbiddenException('No tienes permiso para reactivar accesos.');
    }
    return this.visitorsService.temporaryReenableVisit(
      visitId,
      tenantId,
      auditorUserId,
      auditorUserName,
      new Date(body.reenableUntil),
      body.autoCheckoutEnabled,
      body.resolutionNote,
    );
  }

  @Get('visit/:visitId')
  async getVisitDetail(@Param('visitId') visitId: string, @Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.visitorsService.getVisitDetail(visitId, tenantId);
  }

  @Get(':visitorId/photo')
  async getVisitorPhoto(
    @Param('visitorId') visitorId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const tenantId = req.user.tenantId;
    const buffer = await this.visitorsService.getVisitorPhotoBuffer(
      visitorId,
      tenantId,
    );
    if (!buffer) {
      throw new NotFoundException('Photo not found.');
    }
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store',
    });
    res.send(buffer);
  }

  @Patch(':visitorId')
  async updateVisitor(
    @Param('visitorId') visitorId: string,
    @Body() dto: UpdateVisitorDto,
    @Req() req: any,
  ) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    return this.visitorsService.updateVisitor(
      visitorId,
      tenantId,
      dto,
      auditorUserId,
    );
  }

  /**
   * Actualiza campos editables de una visita (ej: anfitrión).
   */
  @Patch('visit/:visitId')
  @HttpCode(HttpStatus.OK)
  async updateVisit(
    @Param('visitId') visitId: string,
    @Body() dto: {
      hostId?: string | null;
      purpose?: string | null;
      visitorType?: string | null;
      scheduledAt?: string | null;
      expectedEndAt?: string | null;
      accessGroups?: { id: number; name: string }[];
      autoCheckoutEnabled?: boolean;
    },
    @Req() req: any,
  ) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    return this.visitorsService.updateVisitFields(visitId, tenantId, dto, auditorUserId);
  }

  /**
   * Fuerza la sincronización manual de una visita con BioStar.
   * Útil cuando la sincronización automática falló (syncStatus = PENDING | FAILED).
   *
   * POST /api/v1/visitors/visit/:visitId/force-sync
   */
  @Post('visit/:visitId/force-sync')
  @HttpCode(HttpStatus.OK)
  async forceSyncVisit(@Param('visitId') visitId: string, @Req() req: any) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    return this.visitorsService.forceSyncVisit(visitId, tenantId, auditorUserId);
  }

  /**
   * DELETE /api/v1/visitors/biostar-user/:biostarUserId
   * Elimina un usuario huérfano de BioStar X/2 por su ID directo.
   * Útil cuando el usuario existe en BioStar pero ya no está referenciado en la BD local.
   */
  @Delete('biostar-user/:biostarUserId')
  @HttpCode(HttpStatus.OK)
  async deleteOrphanedBioStarUser(
    @Param('biostarUserId') biostarUserId: string,
    @Req() req: any,
  ) {
    const tenantId = req.user.tenantId;
    await this.visitorsService.deleteOrphanedBioStarUser(tenantId, biostarUserId);
    return { message: `Usuario BioStar "${biostarUserId}" eliminado de todas las conexiones activas.` };
  }

  @Post('validate-face')
  async validateFace(@Body() dto: ValidateFaceDto, @Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.visitorsService.validateFaceImage(dto.imageBase64, tenantId);
  }

  @Post('visit/:visitId/credentials')
  async addCredential(
    @Param('visitId') visitId: string,
    @Body() dto: AddCredentialDto,
    @Req() req: any,
  ) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    return this.visitorsService.addCredentialToVisit(visitId, tenantId, dto, auditorUserId);
  }

  // ── Asset endpoints ────────────────────────────────────────────────────────

  /** GET /visitors/visit/:visitId/assets — Lista los activos de una visita */
  @Get('visit/:visitId/assets')
  async getVisitAssets(@Param('visitId') visitId: string, @Req() req: any) {
    return this.visitorsService.getVisitAssets(visitId, req.user.tenantId);
  }

  /** POST /visitors/visit/:visitId/assets — Agrega un activo a una visita */
  @Post('visit/:visitId/assets')
  async addAsset(
    @Param('visitId') visitId: string,
    @Body() dto: VisitorAssetDto,
    @Req() req: any,
  ) {
    return this.visitorsService.addAssetToVisit(
      visitId,
      req.user.tenantId,
      { description: dto.description, serialNumber: dto.serialNumber, category: dto.category as AssetCategory | undefined },
      req.user.sub,
    );
  }

  /** PATCH /visitors/visit/:visitId/assets/:assetId/verify — Marca/desmarca activo como verificado */
  @Patch('visit/:visitId/assets/:assetId/verify')
  async verifyAsset(
    @Param('visitId') visitId: string,
    @Param('assetId') assetId: string,
    @Body() body: { verified: boolean },
    @Req() req: any,
  ) {
    return this.visitorsService.verifyAsset(
      visitId,
      assetId,
      req.user.tenantId,
      body.verified,
      req.user.sub,
    );
  }

  /** DELETE /visitors/visit/:visitId/assets/:assetId — Elimina un activo de la visita */
  @Delete('visit/:visitId/assets/:assetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAsset(
    @Param('visitId') visitId: string,
    @Param('assetId') assetId: string,
    @Req() req: any,
  ) {
    await this.visitorsService.removeAsset(visitId, assetId, req.user.tenantId, req.user.sub);
  }

  // ── Vehicle endpoints ──────────────────────────────────────────────────────

  /** GET /visitors/visit/:visitId/vehicles — Lista los vehículos de una visita */
  @Get('visit/:visitId/vehicles')
  async getVisitVehicles(@Param('visitId') visitId: string, @Req() req: any) {
    return this.visitorsService.getVisitVehicles(visitId, req.user.tenantId);
  }

  /** POST /visitors/visit/:visitId/vehicles — Agrega un vehículo a una visita */
  @Post('visit/:visitId/vehicles')
  async addVehicle(
    @Param('visitId') visitId: string,
    @Body() dto: VisitorVehicleDto,
    @Req() req: any,
  ) {
    return this.visitorsService.addVehicleToVisit(
      visitId,
      req.user.tenantId,
      {
        licensePlate: dto.licensePlate,
        brand: dto.brand,
        model: dto.model,
        color: dto.color,
        vehicleType: dto.vehicleType as VehicleType | undefined,
        parkingZone: dto.parkingZone,
      },
      req.user.sub,
    );
  }

  /** PATCH /visitors/visit/:visitId/vehicles/:vehicleId/verify — Marca/desmarca vehículo como verificado */
  @Patch('visit/:visitId/vehicles/:vehicleId/verify')
  async verifyVehicle(
    @Param('visitId') visitId: string,
    @Param('vehicleId') vehicleId: string,
    @Body() body: { verified: boolean },
    @Req() req: any,
  ) {
    return this.visitorsService.verifyVehicle(
      visitId,
      vehicleId,
      req.user.tenantId,
      body.verified,
      req.user.sub,
    );
  }

  /** PATCH /visitors/visit/:visitId/vehicles/:vehicleId/entered — Marca vehículo como "ya ingresó" */
  @Patch('visit/:visitId/vehicles/:vehicleId/entered')
  async markVehicleEntered(
    @Param('visitId') visitId: string,
    @Param('vehicleId') vehicleId: string,
    @Body() body: { hasEntered: boolean },
    @Req() req: any,
  ) {
    return this.visitorsService.markVehicleEntered(
      visitId,
      vehicleId,
      req.user.tenantId,
      body.hasEntered,
      req.user.sub,
    );
  }

  /** DELETE /visitors/visit/:visitId/vehicles/:vehicleId — Elimina un vehículo de la visita */
  @Delete('visit/:visitId/vehicles/:vehicleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeVehicle(
    @Param('visitId') visitId: string,
    @Param('vehicleId') vehicleId: string,
    @Req() req: any,
  ) {
    await this.visitorsService.removeVehicle(visitId, vehicleId, req.user.tenantId, req.user.sub);
  }

  @Delete('credentials/:credentialId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeCredential(
    @Param('credentialId') credentialId: string,
    @Req() req: any,
  ) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    await this.visitorsService.revokeCredential(credentialId, tenantId, auditorUserId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTO-CHECKOUT — Configuración de cierre automático nocturno
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Obtiene la configuración de auto-checkout del tenant.
   */
  @Get('settings/auto-checkout')
  async getAutoCheckoutConfig(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.autoCheckoutService.getConfig(tenantId);
  }

  /**
   * Actualiza la configuración de auto-checkout del tenant.
   * Acepta: enabled, hour (0-23), minute (0-59), defaultMaxStayMinutes.
   */
  @Put('settings/auto-checkout')
  async updateAutoCheckoutConfig(@Body() body: any, @Req() req: any) {
    const tenantId = req.user.tenantId;
    const { enabled, hour, minute, defaultMaxStayMinutes } = body;
    return this.autoCheckoutService.saveConfig(tenantId, {
      ...(enabled !== undefined && { enabled: Boolean(enabled) }),
      ...(hour !== undefined && { hour: Number(hour) }),
      ...(minute !== undefined && { minute: Number(minute) }),
      ...(defaultMaxStayMinutes !== undefined && { defaultMaxStayMinutes: Number(defaultMaxStayMinutes) }),
    });
  }

  /**
   * Obtiene la configuración de la encuesta de salida + aviso de falsa salida.
   */
  @Get('settings/exit-survey')
  async getExitSurveyConfig(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.autoCheckoutService.getExitSurveyConfig(tenantId);
  }

  /**
   * Habilita/deshabilita el envío del correo de encuesta + aviso de falsa
   * salida tras un auto-checkout por dispositivo de salida.
   */
  @Put('settings/exit-survey')
  async updateExitSurveyConfig(@Body() body: { enabled?: boolean }, @Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.autoCheckoutService.saveExitSurveyConfig(tenantId, {
      ...(body?.enabled !== undefined && { enabled: Boolean(body.enabled) }),
    });
  }

  /**
   * Dispara manualmente un auto-checkout para el tenant actual.
   */
  @Post('settings/auto-checkout/trigger')
  @HttpCode(HttpStatus.OK)
  async triggerAutoCheckout(@Req() req: any) {
    const tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;
    const count = await this.visitorsService.bulkCheckoutTenant(tenantId, auditorUserId);
    return { success: true, checkedOutCount: count };
  }

  /**
   * Obtiene los valores por defecto de auto-checkout por tipo de visitante.
   * Ej: { WALK_IN: true, CONTRACTOR: false, VIP: false, ... }
   */
  @Get('settings/auto-checkout/visitor-types')
  async getAutoCheckoutVisitorTypeDefaults(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.autoCheckoutService.getVisitorTypeDefaults(tenantId);
  }

  /**
   * Actualiza los valores por defecto de auto-checkout por tipo de visitante.
   * Este valor solo determina el estado inicial del toggle al registrar/editar
   * una visita; el operador puede modificarlo individualmente por visita.
   */
  @Put('settings/auto-checkout/visitor-types')
  async updateAutoCheckoutVisitorTypeDefaults(@Body() body: Record<string, boolean>, @Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.autoCheckoutService.saveVisitorTypeDefaults(tenantId, body ?? {});
  }

  // ═══════════════════════════════════════════════════════════════════
  // TIPOS DE VISITANTE — Predefinidos + personalizados por tenant
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Retorna los tipos de visitante predefinidos (fijos del sistema) y los
   * personalizados creados por el tenant actual.
   */
  @Get('settings/visitor-types')
  async getVisitorTypes(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.visitorTypeService.getAllTypes(tenantId);
  }

  /**
   * Crea un tipo de visitante personalizado para el tenant actual.
   * Body: { label: string, icon?: string }
   */
  @Post('settings/visitor-types')
  async createVisitorType(@Body() body: { label: string; icon?: string }, @Req() req: any) {
    const tenantId = req.user.tenantId;
    const custom = await this.visitorTypeService.createCustomType(tenantId, body ?? { label: '' });
    return { builtIn: Object.values(VisitorType), custom };
  }

  /**
   * Elimina un tipo de visitante personalizado del tenant actual.
   * No permite eliminar tipos predefinidos.
   */
  @Delete('settings/visitor-types/:key')
  async deleteVisitorType(@Param('key') key: string, @Req() req: any) {
    const tenantId = req.user.tenantId;
    const custom = await this.visitorTypeService.deleteCustomType(tenantId, key);
    return { custom };
  }

  // ═══════════════════════════════════════════════════════════════════
  // DATA RETENTION — Configuración del tiempo de retención de datos
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Obtiene la configuración de retención de datos del tenant.
   */
  @Get('settings/data-retention')
  async getDataRetentionConfig(@Req() req: any) {
    return this.dataRetentionService.getConfig(req.user.tenantId);
  }

  /**
   * Actualiza la configuración de retención de datos del tenant.
   * Acepta: enabled (boolean), retentionDays (número ≥ 1).
   */
  @Put('settings/data-retention')
  async updateDataRetentionConfig(@Body() body: any, @Req() req: any) {
    const { enabled, retentionDays } = body;
    return this.dataRetentionService.setConfig(req.user.tenantId, {
      ...(enabled !== undefined && { enabled: Boolean(enabled) }),
      ...(retentionDays !== undefined && { retentionDays: Number(retentionDays) }),
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECKIN NOTIFICATION — Configuración del mensaje al anfitrión
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Obtiene la configuración de notificación de check-in del tenant.
   */
  @Get('settings/checkin-notification')
  async getCheckinNotifSettings(@Req() req: any) {
    return this.visitorsService.getCheckinNotifSettings(req.user.tenantId);
  }

  /**
   * Actualiza la configuración de notificación de check-in.
   * Acepta: enabled (boolean), subject (string), bodyText (string).
   */
  @Put('settings/checkin-notification')
  async updateCheckinNotifSettings(@Body() body: any, @Req() req: any) {
    const { enabled, subject, bodyText, logoUrl } = body;
    return this.visitorsService.setCheckinNotifSettings(req.user.tenantId, {
      ...(enabled  !== undefined && { enabled:  Boolean(enabled) }),
      ...(subject  !== undefined && { subject:  String(subject) }),
      ...(bodyText !== undefined && { bodyText: String(bodyText) }),
      ...('logoUrl' in body     && { logoUrl:  logoUrl ?? null }),
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // QR SETTINGS — Vigencia y visibilidad del botón de renovación
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Obtiene la configuración de QR dinámico del tenant.
   */
  @Get('settings/qr')
  async getQrSettings(@Req() req: any) {
    return this.visitorsService.getQrSettings(req.user.tenantId);
  }

  /**
   * Actualiza la configuración de QR dinámico.
   * Acepta: countdownSeconds (10-3600), showRenewButton (boolean).
   */
  @Put('settings/qr')
  async updateQrSettings(@Body() body: any, @Req() req: any) {
    const { countdownSeconds, showRenewButton } = body;
    return this.visitorsService.setQrSettings(req.user.tenantId, {
      ...(countdownSeconds !== undefined && { countdownSeconds: Number(countdownSeconds) }),
      ...(showRenewButton !== undefined && { showRenewButton: Boolean(showRenewButton) }),
    });
  }

  /**
   * Ejecuta manualmente la purga de datos para el tenant actual.
   */
  @Post('settings/data-retention/trigger')
  @HttpCode(HttpStatus.OK)
  async triggerDataRetentionPurge(@Req() req: any) {
    const result = await this.dataRetentionService.runPurge(req.user.tenantId);
    return { success: true, ...result };
  }

  /**
   * POST /api/v1/visitors/invite
   * Invita a uno o varios visitantes por email. Protegido por JWT.
   * Roles: ADMIN, OPERATOR, HOST.
   */
  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  async inviteVisitors(@Body() dto: InviteVisitorsDto, @Req() req: any) {
    const tenantId: string = req.user.tenantId;
    const userId: string = req.user.sub;
    return this.visitorsService.inviteVisitors(dto, tenantId, userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // FINGERPRINT ENROLLMENT — BioMini Slim 2 via agente local
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Recibe plantillas dactilares del frontend (capturadas por el agente BioMini
   * en la PC de recepción) y las envía a BioStar para acceso físico.
   * NUNCA almacena imágenes de huellas — solo metadatos del evento.
   *
   * POST /api/v1/visitors/visit/:visitId/fingerprints
   * Body: { fingerprints: [{ fingerIndex, template, samples?, quality }] }
   */
  @Post('visit/:visitId/fingerprints')
  @HttpCode(HttpStatus.OK)
  async enrollFingerprints(
    @Param('visitId') visitId: string,
    @Body() body: {
      fingerprints: Array<{
        fingerIndex: number;
        template: string;
        samples?: string[];
        quality: number;
      }>;
    },
    @Req() req: any,
  ) {
    return this.visitorsService.enrollVisitorFingerprints(
      visitId,
      req.user.tenantId,
      req.user.sub,
      body.fingerprints ?? [],
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // BADGE PRINT — Gafetes físicos (62mm × 100mm, impresora térmica)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Retorna todos los datos necesarios para renderizar e imprimir el gafete.
   * La foto del visitante y el QR se devuelven como data URLs para que
   * funcionen dentro del iframe de impresión sin requerir auth headers.
   *
   * GET /api/v1/visitors/visit/:visitId/badge-data
   */
  @Get('visit/:visitId/badge-data')
  async getBadgeData(@Param('visitId') visitId: string, @Req() req: any) {
    return this.visitorsService.getBadgeData(visitId, req.user.tenantId);
  }

  /**
   * Registra en el audit log que se imprimió un gafete físico (evento BADGE_PRINT).
   *
   * POST /api/v1/visitors/visit/:visitId/badge-print
   */
  @Post('visit/:visitId/badge-print')
  @HttpCode(HttpStatus.OK)
  async logBadgePrint(@Param('visitId') visitId: string, @Req() req: any) {
    await this.visitorsService.logBadgePrint(
      visitId,
      req.user.tenantId,
      req.user.sub,
    );
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTO-PRINT — Toggle de auto-impresión al registrar check-in
  // ═══════════════════════════════════════════════════════════════════

  /** GET /api/v1/visitors/settings/auto-print */
  @Get('settings/auto-print')
  async getAutoPrintConfig(@Req() req: any) {
    return this.autoCheckoutService.getAutoPrintConfig(req.user.tenantId);
  }

  /** PUT /api/v1/visitors/settings/auto-print */
  @Put('settings/auto-print')
  async updateAutoPrintConfig(@Body() body: any, @Req() req: any) {
    return this.autoCheckoutService.saveAutoPrintConfig(req.user.tenantId, {
      enabled: Boolean(body.enabled),
    });
  }
}
