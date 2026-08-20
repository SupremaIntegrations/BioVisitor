/**
 * @file visitor-portal.controller.ts
 * @description Controlador público para el portal de QR del visitante.
 *
 * Estos endpoints NO requieren autenticación JWT. El acceso está protegido
 * únicamente por el portalToken criptográficamente opaco incluido en la URL.
 *
 * @module modules/visitors
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { VisitorsService } from './visitors.service';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';

@Controller('visitors/qr-portal')
export class VisitorPortalController {
  constructor(private readonly visitorsService: VisitorsService) {}

  /**
   * GET /api/v1/visitors/qr-portal/:token
   * Devuelve la imagen QR activa (data URL) y metadatos de la visita.
   * Acceso público: el portalToken funciona como credencial de un solo uso.
   */
  @Get(':token')
  async getQr(@Param('token') token: string) {
    return this.visitorsService.getQrForPortal(token);
  }

  /**
   * POST /api/v1/visitors/qr-portal/:token/refresh
   * Invalida el QR anterior y genera uno nuevo.
   * El visitante puede llamar esto cada 60 segundos para rotar su código.
   */
  @Post(':token/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Param('token') token: string) {
    return this.visitorsService.refreshQrForPortal(token);
  }
}

/**
 * Controlador público para el flujo de onboarding por invitación.
 * Endpoints accesibles sin JWT — la seguridad se basa en el onboardingToken.
 */
@Controller('visitors/onboarding')
export class VisitorOnboardingController {
  constructor(private readonly visitorsService: VisitorsService) {}

  /**
   * GET /api/v1/visitors/onboarding/:token
   * Retorna los metadatos de la visita para mostrar el formulario de onboarding.
   * Acceso público protegido solo por el token.
   */
  @Get(':token')
  async getOnboardingInfo(@Param('token') token: string) {
    return this.visitorsService.getOnboardingInfo(token);
  }

  /**
   * PUT /api/v1/visitors/onboarding/:token
   * El visitante completa su registro personal.
   * Actualiza el Visitor, cambia el estado de la Visit a PRE_REGISTERED e invalida el token.
   */
  @Put(':token')
  @HttpCode(HttpStatus.OK)
  async completeOnboarding(
    @Param('token') token: string,
    @Body() dto: CompleteOnboardingDto,
  ) {
    return this.visitorsService.completeOnboarding(token, dto);
  }
}

/**
 * Controlador público para la encuesta de satisfacción enviada tras el
 * auto-checkout por dispositivo de salida. Sin JWT — protegido por el
 * token firmado (7 días de validez).
 */
@Controller('visitors/survey')
export class ExitSurveyController {
  constructor(private readonly visitorsService: VisitorsService) {}

  /**
   * POST /api/v1/visitors/survey/:token
   * Registra la calificación (1-5) y comentario opcional del visitante.
   */
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  async submit(
    @Param('token') token: string,
    @Body() dto: { rating: number; comment?: string },
  ) {
    return this.visitorsService.submitExitSurvey(token, dto.rating, dto.comment);
  }
}

/**
 * Controlador público para el reporte de "falsa salida". Sin JWT —
 * protegido por un token de un solo uso, válido 1 hora tras el checkout.
 */
@Controller('visitors/false-exit')
export class FalseExitController {
  constructor(private readonly visitorsService: VisitorsService) {}

  /**
   * POST /api/v1/visitors/false-exit/:token
   * Marca la visita como FALSE_EXIT_REPORTED y alerta al operador en vivo.
   * Requiere confirmación explícita del visitante en el frontend antes de
   * llamar este endpoint (para evitar disparos por escáneres de email).
   */
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  async report(@Param('token') token: string) {
    return this.visitorsService.reportFalseExit(token);
  }
}
