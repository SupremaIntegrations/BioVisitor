/**
 * @file exit-links.service.ts
 * @description Genera y valida los links de un solo uso (JWT + Redis) que se
 * envían por correo tras un auto-checkout por dispositivo de salida:
 *  - Link de encuesta de satisfacción (larga duración, reutilizable).
 *  - Link de "reporte de falsa salida" (corta duración, un solo uso).
 *
 * Sigue el mismo patrón de QrEngineService (JWT firmado + jti en Redis).
 *
 * @module modules/visitors
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

export interface SurveyTokenPayload {
  visitId: string;
  tenantId: string;
  purpose: 'survey';
}

export interface FalseExitTokenPayload {
  visitId: string;
  tenantId: string;
  jti: string;
  purpose: 'false_exit';
}

const SURVEY_EXPIRATION_SECONDS = 7 * 24 * 60 * 60; // 7 días
const FALSE_EXIT_EXPIRATION_SECONDS = 60 * 60; // 1 hora
const FALSE_EXIT_REDIS_PREFIX = 'bv:falseexit:';

@Injectable()
export class ExitLinksService {
  private readonly logger = new Logger(ExitLinksService.name);
  private readonly jwtSecret: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.jwtSecret =
      this.configService.get<string>('qr.jwtSecret') || 'QR_SECRET_CHANGE_ME';
  }

  /**
   * Genera el token de encuesta de satisfacción. Válido por 7 días.
   * No requiere Redis: se valida solo por firma/expiración del JWT
   * (se permite reenviar/editar la respuesta dentro de la ventana).
   */
  generateSurveyToken(visitId: string, tenantId: string): string {
    const payload: SurveyTokenPayload = { visitId, tenantId, purpose: 'survey' };
    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: SURVEY_EXPIRATION_SECONDS,
      issuer: 'biovisitor-x',
    });
  }

  /**
   * Valida un token de encuesta. Retorna el payload si es válido.
   */
  validateSurveyToken(token: string): { valid: boolean; payload?: SurveyTokenPayload; reason?: string } {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        issuer: 'biovisitor-x',
      }) as SurveyTokenPayload;
      if (decoded.purpose !== 'survey') {
        return { valid: false, reason: 'Token inválido para esta operación.' };
      }
      return { valid: true, payload: decoded };
    } catch (error: any) {
      const reason =
        error.name === 'TokenExpiredError'
          ? 'El link de la encuesta ha expirado.'
          : 'Link inválido o manipulado.';
      return { valid: false, reason };
    }
  }

  /**
   * Genera el token de "reporte de falsa salida". Válido 1 hora, un solo uso
   * (el jti se guarda en Redis y se elimina atómicamente al validar).
   */
  async generateFalseExitToken(visitId: string, tenantId: string): Promise<string> {
    const jti = uuidv4();
    const payload: FalseExitTokenPayload = { visitId, tenantId, jti, purpose: 'false_exit' };
    const token = jwt.sign(payload, this.jwtSecret, {
      expiresIn: FALSE_EXIT_EXPIRATION_SECONDS,
      issuer: 'biovisitor-x',
    });

    await this.redis.setex(
      `${FALSE_EXIT_REDIS_PREFIX}${jti}`,
      FALSE_EXIT_EXPIRATION_SECONDS,
      JSON.stringify({ visitId, createdAt: new Date().toISOString() }),
    );

    return token;
  }

  /**
   * Valida (y "quema" — un solo uso) un token de reporte de falsa salida.
   */
  async validateFalseExitToken(
    token: string,
  ): Promise<{ valid: boolean; payload?: FalseExitTokenPayload; reason?: string }> {
    let decoded: FalseExitTokenPayload;
    try {
      decoded = jwt.verify(token, this.jwtSecret, {
        issuer: 'biovisitor-x',
      }) as FalseExitTokenPayload;
    } catch (error: any) {
      const reason =
        error.name === 'TokenExpiredError'
          ? 'Este link ya expiró (válido por 1 hora tras la salida).'
          : 'Link inválido o manipulado.';
      return { valid: false, reason };
    }

    if (decoded.purpose !== 'false_exit') {
      return { valid: false, reason: 'Token inválido para esta operación.' };
    }

    const redisKey = `${FALSE_EXIT_REDIS_PREFIX}${decoded.jti}`;
    const wasDeleted = await this.redis.del(redisKey);
    if (wasDeleted === 0) {
      return {
        valid: false,
        reason: 'Este reporte ya fue enviado anteriormente o el link expiró.',
      };
    }

    this.logger.log(
      `🚨 Reporte de falsa salida validado: visita=${decoded.visitId}, jti=${decoded.jti}`,
    );

    return { valid: true, payload: decoded };
  }
}
