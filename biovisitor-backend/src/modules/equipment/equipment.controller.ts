/**
 * @file equipment.controller.ts
 * @description Controlador REST del Módulo de Equipos.
 *
 * RBAC:
 *  - GET listado/detalle/stats: ADMIN, SUPERVISOR, OPERATOR, SECURITY, READ_ONLY
 *  - POST (crear ingreso), POST exit: ADMIN, SUPERVISOR, OPERATOR, SECURITY
 *  - POST authorize/reject: ADMIN, SUPERVISOR
 *  - PATCH (editar): ADMIN, SUPERVISOR
 *  - DELETE: ADMIN
 *  - GET reports/csv, GET reports/pdf: ADMIN, SUPERVISOR
 *  - GET/PUT settings: ADMIN
 *
 * @module modules/equipment
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EquipmentService } from './equipment.service';
import {
  CreateEquipmentDto,
  UpdateEquipmentDto,
  RegisterExitDto,
  RejectEquipmentDto,
  EquipmentFilterDto,
  EquipmentSettingsDto,
} from './dto/equipment.dto';

const CAN_VIEW    = ['ADMIN', 'SUPERVISOR', 'OPERATOR', 'SECURITY', 'READ_ONLY'];
const CAN_WRITE   = ['ADMIN', 'SUPERVISOR', 'OPERATOR', 'SECURITY'];
const CAN_AUTH    = ['ADMIN', 'SUPERVISOR'];
const CAN_EXPORT  = ['ADMIN', 'SUPERVISOR'];
const CAN_ADMIN   = ['ADMIN'];

function checkRole(role: string, allowed: string[]) {
  if (!allowed.includes(role)) {
    throw new ForbiddenException('No tienes permisos para esta acción.');
  }
}

@UseGuards(JwtAuthGuard)
@Controller('equipment')
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  // ── Settings (define before :id to avoid route conflict) ──────────

  @Get('settings')
  async getSettings(@Req() req: any) {
    checkRole(req.user.role, CAN_ADMIN);
    return this.equipmentService.getSettings(req.user.tenantId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('settings')
  async saveSettings(@Body() dto: EquipmentSettingsDto, @Req() req: any) {
    checkRole(req.user.role, CAN_ADMIN);
    return this.equipmentService.saveSettings(req.user.tenantId, dto);
  }

  // ── Reports (define before :id) ───────────────────────────────────

  @Get('reports/csv')
  async exportCsv(
    @Query() filter: EquipmentFilterDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    checkRole(req.user.role, CAN_EXPORT);
    const csv = await this.equipmentService.exportCsv(
      req.user.tenantId,
      req.user.sub,
      req.user.fullName ?? req.user.email,
      filter,
    );
    const filename = `equipos_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM para Excel
  }

  @Get('reports/pdf')
  async exportPdf(
    @Query() filter: EquipmentFilterDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    checkRole(req.user.role, CAN_EXPORT);
    const pdf = await this.equipmentService.exportPdf(
      req.user.tenantId,
      req.user.sub,
      req.user.fullName ?? req.user.email,
      filter,
    );
    const filename = `equipos_${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  }

  // ── Stats ─────────────────────────────────────────────────────────

  @Get('stats')
  async getStats(@Req() req: any) {
    checkRole(req.user.role, CAN_VIEW);
    return this.equipmentService.getStats(req.user.tenantId);
  }

  // ── CRUD ──────────────────────────────────────────────────────────

  @Get()
  async findAll(@Query() filter: EquipmentFilterDto, @Req() req: any) {
    checkRole(req.user.role, CAN_VIEW);
    return this.equipmentService.findAll(req.user.tenantId, filter);
  }

  @Post()
  async create(@Body() dto: CreateEquipmentDto, @Req() req: any) {
    checkRole(req.user.role, CAN_WRITE);
    return this.equipmentService.createEntry(
      req.user.tenantId,
      req.user.sub,
      req.user.fullName ?? req.user.email,
      dto,
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    checkRole(req.user.role, CAN_VIEW);
    return this.equipmentService.findOne(id, req.user.tenantId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEquipmentDto,
    @Req() req: any,
  ) {
    checkRole(req.user.role, CAN_AUTH);
    return this.equipmentService.update(
      id,
      req.user.tenantId,
      req.user.sub,
      req.user.fullName ?? req.user.email,
      dto,
    );
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    checkRole(req.user.role, CAN_ADMIN);
    return this.equipmentService.softDelete(
      id,
      req.user.tenantId,
      req.user.sub,
      req.user.fullName ?? req.user.email,
      req.user.role,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/exit')
  async registerExit(
    @Param('id') id: string,
    @Body() dto: RegisterExitDto,
    @Req() req: any,
  ) {
    checkRole(req.user.role, CAN_WRITE);
    return this.equipmentService.registerExit(
      id,
      req.user.tenantId,
      req.user.sub,
      req.user.fullName ?? req.user.email,
      dto,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/authorize')
  async authorize(@Param('id') id: string, @Req() req: any) {
    checkRole(req.user.role, CAN_AUTH);
    return this.equipmentService.authorize(
      id,
      req.user.tenantId,
      req.user.sub,
      req.user.fullName ?? req.user.email,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectEquipmentDto,
    @Req() req: any,
  ) {
    checkRole(req.user.role, CAN_AUTH);
    return this.equipmentService.reject(
      id,
      req.user.tenantId,
      req.user.sub,
      req.user.fullName ?? req.user.email,
      dto,
    );
  }
}
