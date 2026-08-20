/**
 * @file pre-registration.controller.ts
 * @description Controlador REST para las operaciones de pre-registro.
 *
 * Contiene endpoints públicos (sin AuthGuard) para que el visitante pueda acceder
 * a su formulario, y endpoints protegidos para que los operadores generen los links.
 *
 * @module modules/visitors
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PreRegistrationService } from './pre-registration.service';
import { GeneratePreRegistrationDto } from './dto/generate-preregistration.dto';
import { CompletePreRegistrationDto } from './dto/complete-preregistration.dto';

@Controller('pre-registration')
export class PreRegistrationController {
  constructor(private readonly preRegService: PreRegistrationService) {}

  /**
   * [PROTEGIDO] Genera un nuevo link de pre-registro.
   * Usualmente llamado por el frontend de operador al crear una visita futura.
   */
  @Post('generate')
  @UseGuards(AuthGuard('jwt'))
  async generateLink(@Body() dto: GeneratePreRegistrationDto, @Req() req: any) {
    dto.tenantId = req.user.tenantId;
    const auditorUserId = req.user.sub;

    const preReg = await this.preRegService.generateToken(dto, auditorUserId);

    // En un sistema real, aquí se emitiría un evento para enviar el Email/WhatsApp
    // Retornamos el token para que el front lo muestre o lo copie al portapapeles.
    return { token: preReg.token, expiresAt: preReg.expiresAt };
  }

  /**
   * [PÚBLICO] Obtiene los datos iniciales para renderizar el formulario al visitante.
   */
  @Get('token/:token')
  async getPreRegistrationInfo(@Param('token') token: string) {
    return this.preRegService.validateTokenAndGetVisit(token);
  }

  /**
   * [PÚBLICO] Envía los datos capturados y completa el proceso.
   */
  @Post('token/:token/complete')
  async completePreRegistration(
    @Param('token') token: string,
    @Body() dto: CompletePreRegistrationDto,
  ) {
    return this.preRegService.completePreRegistration(token, dto);
  }
}
