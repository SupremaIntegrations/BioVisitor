/**
 * @file enrollers.controller.ts
 * @description Controlador para gestión de dispositivos enroladores configurados.
 *
 * GET    /api/v1/settings/enrollers           — Lista enroladores (filter: ?type=face)
 * POST   /api/v1/settings/enrollers           — Agrega un enrolador
 * DELETE /api/v1/settings/enrollers/:deviceId — Elimina enrolador (filter: ?type=face)
 *
 * Los enroladores se almacenan en Redis: enrollers:{tenantId}
 *
 * @module modules/settings
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../database/entities';
import { IsString, IsIn } from 'class-validator';
import { EnrollerDevicesService } from './enroller-devices.service';

export class AddEnrollerDto {
  @IsString()
  deviceId: string;

  @IsIn(['face', 'fingerprint', 'card'])
  type: 'face' | 'fingerprint' | 'card';
}

@Controller('settings/enrollers')
@UseGuards(JwtAuthGuard)
export class EnrollersController {
  constructor(private readonly enrollerService: EnrollerDevicesService) {}

  /**
   * Lista los enroladores configurados.
   * @query type - Filtrar por tipo: 'face' | 'fingerprint' | 'card'
   */
  @Get()
  async getEnrollers(
    @Request() req: any,
    @Query('type') type?: string,
  ) {
    const tenantId: string = req.user?.tenantId || 'default';
    return this.enrollerService.getEnrollers(tenantId, type);
  }

  /**
   * Registra un dispositivo BioStar como enrolador. Solo ADMIN.
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async addEnroller(@Request() req: any, @Body() body: AddEnrollerDto) {
    const tenantId: string = req.user?.tenantId || 'default';

    if (!body.deviceId) {
      throw new BadRequestException('deviceId es requerido');
    }
    if (!['face', 'fingerprint', 'card'].includes(body.type)) {
      throw new BadRequestException(
        'type debe ser face, fingerprint o card',
      );
    }

    return this.enrollerService.addEnroller(tenantId, body.deviceId, body.type);
  }

  /**
   * Elimina un enrolador por deviceId. Solo ADMIN.
   */
  @Delete(':deviceId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async removeEnroller(
    @Param('deviceId') deviceId: string,
    @Request() req: any,
    @Query('type') type?: string,
  ) {
    const tenantId: string = req.user?.tenantId || 'default';
    return this.enrollerService.removeEnroller(tenantId, deviceId, type);
  }
}
