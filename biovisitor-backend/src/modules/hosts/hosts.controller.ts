/**
 * @file hosts.controller.ts
 * @description Controlador REST para gestión de anfitriones (hosts).
 *
 * Expone endpoints bajo /api/v1/hosts para:
 * - Listar, crear, actualizar y desactivar hosts locales
 * - Importar hosts desde BioStar (sync)
 *
 * @module modules/hosts
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { HostsService } from './hosts.service';
import { CreateHostDto } from './dto/create-host.dto';
import { UpdateHostDto } from './dto/update-host.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('hosts')
@UseGuards(JwtAuthGuard)
export class HostsController {
  constructor(private readonly hostsService: HostsService) {}

  /** GET /hosts - Listar todos los hosts del tenant */
  @Get()
  findAll(@Request() req: any, @Query('active') active?: string) {
    const tenantId: string = req.user.tenantId;
    const onlyActive = active === 'true';
    return this.hostsService.findAll(tenantId, onlyActive);
  }

  /** GET /hosts/:id - Detalle de un host */
  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.hostsService.findOne(id, req.user.tenantId);
  }

  /** POST /hosts - Crear host manualmente */
  @Post()
  create(@Body() dto: CreateHostDto, @Request() req: any) {
    return this.hostsService.create(req.user.tenantId, dto);
  }

  /** PATCH /hosts/:id - Actualizar datos de un host */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateHostDto,
    @Request() req: any,
  ) {
    return this.hostsService.update(id, req.user.tenantId, dto);
  }

  /** DELETE /hosts/:id - Desactivar host (soft delete) */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: any) {
    return this.hostsService.remove(id, req.user.tenantId);
  }

  /**
   * POST /hosts/sync-from-suprema - Importar hosts desde BioStar.
   * Body opcional: { connectionId?: string }
   */
  @Post('sync-from-suprema')
  @HttpCode(HttpStatus.OK)
  syncFromSuprema(
    @Request() req: any,
    @Body() body: { connectionId?: string },
  ) {
    return this.hostsService.syncFromSuprema(
      req.user.tenantId,
      body.connectionId,
    );
  }

  /**
   * POST /hosts/:id/create-user
   * Crea una cuenta de acceso al VMS (rol HOST) vinculada a este anfitrión.
   * Solo ADMIN puede crear cuentas de usuario.
   */
  @Post(':id/create-user')
  @HttpCode(HttpStatus.CREATED)
  createUserAccount(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { email: string; password: string; language?: string },
  ) {
    return this.hostsService.createUserAccount(id, req.user.tenantId, body);
  }

  /**
   * DELETE /hosts/:id/user-account
   * Revoca la cuenta de acceso VMS del anfitrión (desactiva el User).
   * Solo ADMIN puede revocar cuentas.
   */
  @Delete(':id/user-account')
  @HttpCode(HttpStatus.OK)
  revokeUserAccount(@Param('id') id: string, @Request() req: any) {
    return this.hostsService.revokeUserAccount(id, req.user.tenantId);
  }

  /**
   * POST /hosts/:id/reset-password
   * Restablece la contraseña de la cuenta de acceso del anfitrión.
   */
  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetHostPassword(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { newPassword: string },
  ) {
    return this.hostsService.resetHostPassword(id, req.user.tenantId, body.newPassword);
  }
}
