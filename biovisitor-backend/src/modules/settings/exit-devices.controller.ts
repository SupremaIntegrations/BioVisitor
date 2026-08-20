/**
 * @file exit-devices.controller.ts
 * @description Controlador para gestión de "dispositivos de salida".
 *
 * Un dispositivo de salida es un lector/terminal BioStar (torniquete, molinete,
 * lector de salida, etc.) que, cuando reporta un evento de autenticación
 * concedido (ACCESS_GRANTED), se interpreta como la "última salida" del
 * visitante y dispara el checkout automático de su visita en tiempo real.
 *
 * GET    /api/v1/settings/exit-devices           — Lista dispositivos de salida configurados
 * POST   /api/v1/settings/exit-devices           — Marca un dispositivo como de salida
 * DELETE /api/v1/settings/exit-devices/:deviceId — Quita un dispositivo de la lista
 *
 * Los dispositivos de salida se almacenan en Redis: exitdevices:{tenantId}
 *
 * @module modules/settings
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
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
import { IsString, IsNumber, Min, Max } from 'class-validator';
import { EnrollerDevicesService } from './enroller-devices.service';

export class AddExitDeviceDto {
  @IsString()
  deviceId: string;
}

export class SetExitDelayDto {
  @IsNumber()
  @Min(0)
  @Max(3600)
  delaySeconds: number;
}

@Controller('settings/exit-devices')
@UseGuards(JwtAuthGuard)
export class ExitDevicesController {
  constructor(private readonly enrollerService: EnrollerDevicesService) {}

  /**
   * Lista los dispositivos configurados como "de salida".
   */
  @Get()
  async getExitDevices(@Request() req: any) {
    const tenantId: string = req.user?.tenantId || 'default';
    return this.enrollerService.getExitDevices(tenantId);
  }

  /**
   * Marca un dispositivo BioStar como "de salida". Solo ADMIN.
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async addExitDevice(@Request() req: any, @Body() body: AddExitDeviceDto) {
    const tenantId: string = req.user?.tenantId || 'default';

    if (!body.deviceId) {
      throw new BadRequestException('deviceId es requerido');
    }

    return this.enrollerService.addExitDevice(tenantId, body.deviceId);
  }

  /**
   * Elimina un dispositivo de la lista de "dispositivos de salida". Solo ADMIN.
   */
  @Delete(':deviceId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async removeExitDevice(
    @Param('deviceId') deviceId: string,
    @Request() req: any,
  ) {
    const tenantId: string = req.user?.tenantId || 'default';
    return this.enrollerService.removeExitDevice(tenantId, deviceId);
  }

  /**
   * Obtiene el retraso configurado (segundos) para el checkout automático
   * disparado por dispositivo de salida.
   */
  @Get('delay')
  async getExitDelay(@Request() req: any) {
    const tenantId: string = req.user?.tenantId || 'default';
    const delaySeconds = await this.enrollerService.getExitCheckoutDelaySeconds(tenantId);
    return { delaySeconds };
  }

  /**
   * Configura el retraso (segundos) del checkout automático por dispositivo
   * de salida. Solo ADMIN.
   */
  @Put('delay')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async setExitDelay(@Request() req: any, @Body() body: SetExitDelayDto) {
    const tenantId: string = req.user?.tenantId || 'default';
    const delaySeconds = await this.enrollerService.setExitCheckoutDelaySeconds(
      tenantId,
      body.delaySeconds,
    );
    return { delaySeconds };
  }
}
