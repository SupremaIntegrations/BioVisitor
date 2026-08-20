/**
 * @file operators.controller.ts
 * @description Controlador REST para la gestión de operadores del VMS.
 *
 * Todos los endpoints están protegidos por JWT y restringidos al rol ADMIN.
 * Cada acción queda auditada con valores de transición.
 *
 * @module modules/operators
 */

import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Req, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { OperatorsService } from './operators.service';
import { CreateOperatorDto } from './dto/create-operator.dto';
import { UpdateOperatorDto, ResetPasswordDto } from './dto/update-operator.dto';

@Controller('operators')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.ADMIN)
export class OperatorsController {
  constructor(private readonly operatorsService: OperatorsService) {}

  /** GET /operators — Lista todos los operadores del tenant */
  @Get()
  async list(@Req() req: any) {
    return this.operatorsService.listOperators(req.user.tenantId);
  }

  /** GET /operators/:id — Detalle de un operador */
  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: any) {
    return this.operatorsService.getOperator(id, req.user.tenantId);
  }

  /** POST /operators — Crea un nuevo operador */
  @Post()
  async create(@Body() dto: CreateOperatorDto, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    return this.operatorsService.createOperator(dto, req.user.tenantId, req.user.sub, ip);
  }

  /** PATCH /operators/:id — Actualiza datos del operador */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOperatorDto,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    return this.operatorsService.updateOperator(id, dto, req.user.tenantId, req.user.sub, ip);
  }

  /** PATCH /operators/:id/toggle-active — Activa o desactiva la cuenta */
  @Patch(':id/toggle-active')
  async toggleActive(@Param('id') id: string, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    return this.operatorsService.toggleActive(id, req.user.tenantId, req.user.sub, ip);
  }

  /** PATCH /operators/:id/reset-password — Fuerza reseteo de contraseña */
  @Patch(':id/reset-password')
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    return this.operatorsService.resetPassword(id, dto, req.user.tenantId, req.user.sub, ip);
  }

  /** PATCH /operators/:id/permissions — Actualiza permisos granulares */
  @Patch(':id/permissions')
  async updatePermissions(
    @Param('id') id: string,
    @Body() body: { permissions: any },
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    return this.operatorsService.updatePermissions(id, body.permissions, req.user.tenantId, req.user.sub, ip);
  }

  /** PATCH /operators/:id/security — Actualiza configuración de seguridad avanzada */
  @Patch(':id/security')
  async updateSecurity(
    @Param('id') id: string,
    @Body() body: { securityConfig: any },
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    return this.operatorsService.updateSecurityConfig(id, body.securityConfig, req.user.tenantId, req.user.sub, ip);
  }

  /** DELETE /operators/:id — Elimina permanentemente un operador */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    await this.operatorsService.deleteOperator(id, req.user.tenantId, req.user.sub, ip);
  }
}
