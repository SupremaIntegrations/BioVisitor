/**
 * @file devices.controller.ts
 * @description Controlador para listar dispositivos BioStar y disparar capturas faciales.
 *
 * GET  /api/v1/devices          — Lista dispositivos del servidor BioStar activo
 * POST /api/v1/devices/:id/capture-face — Dispara captura facial en un dispositivo
 * DELETE /api/v1/devices/cache  — Invalida caché de dispositivos
 *
 * @module modules/settings
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../database/entities';
import { EnrollerDevicesService } from './enroller-devices.service';

@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly enrollerService: EnrollerDevicesService) {}

  /**
   * Lista todos los dispositivos BioStar disponibles.
   * Permite filtrar por soporte facial con ?faceOnly=true
   */
  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  async listDevices(
    @Request() req: any,
    @Query('faceOnly') faceOnly?: string,
  ) {
    const tenantId: string = req.user?.tenantId || 'default';
    const devices = await this.enrollerService.listDevices(tenantId);

    if (faceOnly === 'true') {
      return devices.filter((d) => d.faceSupported);
    }
    return devices;
  }

  /**
   * Dispara la captura de foto facial desde un dispositivo BioStar.
   * Solo disponible para operadores y administradores autenticados.
   * @returns { imageBase64: string, quality?: number }
   */
  @Post(':deviceId/capture-face')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, 'operator')
  async captureFace(
    @Param('deviceId') deviceId: string,
    @Request() req: any,
  ) {
    const tenantId: string = req.user?.tenantId || 'default';
    const result = await this.enrollerService.captureFaceFromDevice(
      tenantId,
      deviceId,
    );
    return result;
  }

  /**
   * Obtiene la foto del evento de monitoreo más reciente de un dispositivo.
   * Usado por el frontend para mostrar una vista previa en tiempo real mientras
   * espera la captura facial. Retorna { photoBase64: string|null, capturedAt: string|null }.
   */
  @Get(':deviceId/latest-event-photo')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, 'operator')
  async getLatestEventPhoto(
    @Param('deviceId') deviceId: string,
    @Request() req: any,
  ) {
    const tenantId: string = req.user?.tenantId || 'default';
    return this.enrollerService.getLatestDeviceEventPhoto(tenantId, deviceId);
  }

  /**
   * Dispara la captura de huella dactilar desde un dispositivo BioStar.
   * @body { fingerIndex?: number } — índice del dedo (0-9, Suprema SDK). Opcional.
   * @returns { templateBase64: string, quality: number }
   */
  @Post(':deviceId/capture-fingerprint')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, 'operator')
  async captureFingerprint(
    @Param('deviceId') deviceId: string,
    @Request() req: any,
    @Body() body?: { fingerIndex?: number },
  ) {
    const tenantId: string = req.user?.tenantId || 'default';
    const fingerIndex =
      body?.fingerIndex !== undefined && body?.fingerIndex !== null
        ? Number(body.fingerIndex)
        : undefined;
    const result = await this.enrollerService.captureFingerprintFromDevice(
      tenantId,
      deviceId,
      fingerIndex,
    );
    return result;
  }

  /**
   * Consulta las capacidades de un dispositivo BioStar.
   * Llama a POST /api/devices/capability en BioStar y normaliza la respuesta.
   * Resultado cacheado en Redis 10 min.
   * @returns { deviceId, deviceName, face, fingerprint, card, qr }
   */
  @Get(':deviceId/capability')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  async getCapability(
    @Param('deviceId') deviceId: string,
    @Request() req: any,
  ) {
    const tenantId: string = req.user?.tenantId || 'default';
    return this.enrollerService.getDeviceCapabilities(tenantId, deviceId);
  }

  /**
   * Escanea una tarjeta RFID/Smart Card desde un dispositivo BioStar.
   * Llama a POST /api/devices/:id/scan_card en BioStar (timeout 35s).
   * El operador debe pasar la tarjeta en los próximos 30 s.
   * @returns { cardId: string, cardType?: string }
   */
  @Post(':deviceId/scan-card')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  async scanCard(
    @Param('deviceId') deviceId: string,
    @Request() req: any,
  ) {
    const tenantId: string = req.user?.tenantId || 'default';
    return this.enrollerService.scanCardFromDevice(tenantId, deviceId);
  }

  /**
   * Captura templates de credencial facial desde un dispositivo BioStar.
   * Llama a GET /api/devices/:id/credentials/face?pose_sensitivity=4 (timeout 35s).
   * @returns Objeto con template_ex_normalized_image y/o templates[]
   */
  @Get(':deviceId/scan-face-credential')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  async scanFaceCredential(
    @Param('deviceId') deviceId: string,
    @Request() req: any,
  ) {
    const tenantId: string = req.user?.tenantId || 'default';
    return this.enrollerService.scanFaceCredentialFromDevice(tenantId, deviceId);
  }

  /**
   * Captura template de huella dactilar desde un dispositivo BioStar.
   * Llama a POST /api/devices/:dev_id/scan_fingerprint (timeout 35s).
   * @returns { template: string, quality?: number }
   */
  @Post(':deviceId/scan-fingerprint-credential')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  async scanFingerprintCredential(
    @Param('deviceId') deviceId: string,
    @Request() req: any,
  ) {
    const tenantId: string = req.user?.tenantId || 'default';
    return this.enrollerService.scanFingerprintCredential(tenantId, deviceId);
  }

  /**
   * Captura la foto facial de un visitante esperando un evento con foto
   * de la Events API de BioStar (POST /api/events/search) — funciona
   * sobre ngrok/internet sin requerir acceso LAN al dispositivo.
   *
   * El visitante debe mirar la cámara del FaceStation F2; el backend
   * hace polling hasta 30 s hasta encontrar un evento con foto.
   *
   * @returns { imageBase64: string } — base64 sin prefijo data-URI
   */
  @Post(':deviceId/capture-face-via-events')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  async captureFaceViaEvents(
    @Param('deviceId') deviceId: string,
    @Request() req: any,
  ) {
    const tenantId: string = req.user?.tenantId || 'default';
    return this.enrollerService.captureFaceViaEvents(tenantId, deviceId);
  }

  /**
   * Invalida el caché de dispositivos. Solo ADMIN.
   */
  @Delete('cache')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async invalidateCache(@Request() req: any) {
    const tenantId: string = req.user?.tenantId || 'default';
    await this.enrollerService.invalidateDevicesCache(tenantId);
  }
}
