/**
 * @file qr-engine.service.ts
 * @description Motor de QR Dinámico de uso único con JWT + Redis.
 *
 * Implementación híbrida que elimina la necesidad de sincronización
 * constante con BioStar. En lugar de actualizar el card_id en BioStar
 * cada 60 segundos, validamos el QR en el VMS y luego ejecutamos
 * la apertura de puerta vía API.
 *
 * Flujo:
 * 1. GENERACIÓN: Se crea un JWT firmado con visit_id + jti (ID único).
 *    El jti se almacena en Redis con TTL = expiración del QR.
 * 2. DISTRIBUCIÓN: El JWT se codifica como QR y se envía al visitante
 *    vía email o se muestra en el portal de pre-registro.
 * 3. VALIDACIÓN: Al escanear, el VMS verifica:
 *    - Firma JWT válida
 *    - No expirado
 *    - jti existe en Redis (no fue usado)
 *    - visit_id corresponde a una visita activa
 * 4. INVALIDACIÓN: Al primer uso exitoso, el jti se ELIMINA de Redis.
 *    Un segundo escaneo falla inmediatamente (anti-compartición).
 * 5. REGENERACIÓN: El visitante puede solicitar un nuevo QR, lo que
 *    invalida el anterior y genera un nuevo jti.
 *
 * Seguridad:
 * - JWT firmado con clave secreta del servidor (no forjable)
 * - Uso único garantizado por Redis (atómico)
 * - Expiración configurable (por defecto 15 minutos)
 * - Anti-compartición: segundo intento rechazado inmediatamente
 *
 * @module modules/qr-engine
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as jwt from 'jsonwebtoken';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import {
  StructuredLoggerService,
  LogCategory,
} from '../../core/logging/structured-logger.service';

/**
 * Payload contenido dentro del JWT del QR dinámico.
 */
export interface QrTokenPayload {
  /** ID de la visita asociada */
  visitId: string;
  /** ID del visitante */
  visitorId: string;
  /** ID del tenant */
  tenantId: string;
  /** ID único del token (jti - JWT ID), usado para invalidación de uso único */
  jti: string;
}

/**
 * Resultado de la generación de un QR dinámico.
 */
export interface GeneratedQr {
  /** Token JWT raw (para validación interna) */
  token: string;
  /** Imagen del QR en formato data URL (base64) para mostrar en frontend */
  qrDataUrl: string;
  /** Fecha y hora de expiración del QR */
  expiresAt: Date;
  /** JTI (JWT ID) para referencia */
  jti: string;
}

/**
 * Resultado de la validación de un QR.
 */
export interface QrValidationResult {
  /** Si el QR es válido */
  isValid: boolean;
  /** Payload decodificado si es válido */
  payload?: QrTokenPayload;
  /** Motivo del rechazo si no es válido */
  rejectReason?: string;
}

/**
 * Motor de QR Dinámico para el VMS.
 *
 * @example
 * // Generar un QR para una visita
 * const qr = await qrEngine.generateQr({
 *   visitId: 'visit-123',
 *   visitorId: 'visitor-456',
 *   tenantId: 'tenant-789',
 * });
 * // qr.qrDataUrl contiene la imagen QR en base64 para mostrar en email o frontend
 *
 * // Validar un QR al ser escaneado
 * const result = await qrEngine.validateQr(scannedToken);
 * if (result.isValid) {
 *   // Abrir la puerta vía Suprema Gateway
 *   await supremaGateway.openDoor(tenant, doorId);
 * }
 */
@Injectable()
export class QrEngineService {
  private readonly logger = new Logger(QrEngineService.name);
  private readonly jwtSecret: string;
  private readonly expirationMinutes: number;
  private readonly REDIS_PREFIX = 'bv:qr:';

  constructor(
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
    private readonly structuredLogger: StructuredLoggerService,
  ) {
    this.jwtSecret =
      this.configService.get<string>('qr.jwtSecret') || 'QR_SECRET_CHANGE_ME';
    this.expirationMinutes =
      this.configService.get<number>('qr.expirationMinutes') || 15;
  }

  /**
   * Genera un código QR dinámico de uso único para una visita.
   *
   * Proceso:
   * 1. Genera un JTI (JWT ID) único con UUID v4.
   * 2. Crea un JWT firmado con el payload de la visita.
   * 3. Almacena el JTI en Redis con TTL igual a la expiración.
   * 4. Genera la imagen QR como data URL.
   *
   * @param params - Datos de la visita para incluir en el QR
   * @returns QR generado con token, imagen y fecha de expiración
   */
  async generateQr(params: {
    visitId: string;
    visitorId: string;
    tenantId: string;
  }): Promise<GeneratedQr> {
    // Generar un JTI único para este QR
    const jti = uuidv4();

    // Crear el payload del JWT
    const payload: QrTokenPayload = {
      visitId: params.visitId,
      visitorId: params.visitorId,
      tenantId: params.tenantId,
      jti,
    };

    // Firmar el JWT con expiración configurable
    const expiresInSeconds = this.expirationMinutes * 60;
    const token = jwt.sign(payload, this.jwtSecret, {
      expiresIn: expiresInSeconds,
      issuer: 'biovisitor-x',
      subject: params.visitorId,
    });

    // Almacenar el JTI en Redis con TTL
    // La existencia del JTI en Redis indica que el QR NO ha sido usado.
    // Al usar el QR, se elimina el JTI de Redis.
    const redisKey = `${this.REDIS_PREFIX}${jti}`;
    await this.redis.setex(
      redisKey,
      expiresInSeconds,
      JSON.stringify({
        visitId: params.visitId,
        createdAt: new Date().toISOString(),
      }),
    );

    // Generar la imagen QR como data URL (base64)
    const qrDataUrl = await QRCode.toDataURL(token, {
      width: 300,
      margin: 2,
      color: {
        dark: '#A12944', // Infinite Burgundy de Suprema
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'H', // Alta: 30% de corrección de errores
    });

    // Calcular fecha de expiración
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    this.structuredLogger.logAuditEvent('qr.generated', 'system', {
      visitId: params.visitId,
      visitorId: params.visitorId,
      jti,
      expiresAt: expiresAt.toISOString(),
    });

    this.logger.log(
      `📱 QR dinámico generado para visita ${params.visitId} (expira: ${expiresAt.toISOString()})`,
    );

    return { token, qrDataUrl, expiresAt, jti };
  }

  /**
   * Valida un código QR escaneado.
   *
   * Verificaciones realizadas (en orden):
   * 1. Firma JWT válida (no forjado)
   * 2. Token no expirado
   * 3. JTI existe en Redis (no fue usado previamente)
   * 4. Operación atómica: eliminar JTI de Redis (marcar como usado)
   *
   * La eliminación del JTI es ATÓMICA (Redis DEL), lo que garantiza
   * que dos escaneos simultáneos no pasen ambos.
   *
   * @param token - Token JWT del QR escaneado
   * @returns Resultado de la validación
   */
  async validateQr(token: string): Promise<QrValidationResult> {
    // 1. Verificar firma y expiración del JWT
    let decoded: QrTokenPayload;
    try {
      decoded = jwt.verify(token, this.jwtSecret, {
        issuer: 'biovisitor-x',
      }) as QrTokenPayload;
    } catch (error: any) {
      const reason =
        error.name === 'TokenExpiredError'
          ? 'QR expirado'
          : 'QR inválido o manipulado';

      this.structuredLogger.logAuditEvent('qr.validation_failed', 'system', {
        reason,
        error: error.message,
      });

      return { isValid: false, rejectReason: reason };
    }

    // 2. Verificar que el JTI existe en Redis (no fue usado)
    const redisKey = `${this.REDIS_PREFIX}${decoded.jti}`;

    // Operación atómica: intentar eliminar el JTI.
    // DEL devuelve 1 si la clave existía (QR válido y no usado).
    // DEL devuelve 0 si la clave NO existía (QR ya usado o expirado en Redis).
    const wasDeleted = await this.redis.del(redisKey);

    if (wasDeleted === 0) {
      this.structuredLogger.logAuditEvent('qr.reuse_attempt', 'system', {
        visitId: decoded.visitId,
        visitorId: decoded.visitorId,
        jti: decoded.jti,
        reason: 'QR ya utilizado o expirado (posible intento de compartición)',
      });

      this.logger.warn(
        `🚫 Intento de reutilización de QR: jti=${decoded.jti} (visita: ${decoded.visitId})`,
      );

      return {
        isValid: false,
        rejectReason: 'Código QR ya utilizado. Solicite uno nuevo.',
      };
    }

    // 3. QR válido - marcar como usado exitosamente
    this.structuredLogger.logAuditEvent('qr.validated_successfully', 'system', {
      visitId: decoded.visitId,
      visitorId: decoded.visitorId,
      jti: decoded.jti,
    });

    this.logger.log(
      `✅ QR validado exitosamente: visita=${decoded.visitId}, jti=${decoded.jti}`,
    );

    return {
      isValid: true,
      payload: decoded,
    };
  }

  /**
   * Revoca un QR activo (ej: cuando el visitante solicita uno nuevo o cancela).
   *
   * @param jti - ID único del QR a revocar
   */
  async revokeQr(jti: string): Promise<void> {
    const redisKey = `${this.REDIS_PREFIX}${jti}`;
    await this.redis.del(redisKey);

    this.structuredLogger.logAuditEvent('qr.revoked', 'system', { jti });

    this.logger.log(`🔒 QR revocado: jti=${jti}`);
  }

  /**
   * Verifica si un QR específico sigue activo (no usado ni revocado).
   * Útil para mostrar el estado del QR en el dashboard del visitante.
   *
   * @param jti - ID del QR a verificar
   * @returns true si el QR sigue activo
   */
  async isQrActive(jti: string): Promise<boolean> {
    const redisKey = `${this.REDIS_PREFIX}${jti}`;
    const exists = await this.redis.exists(redisKey);
    return exists === 1;
  }

  /**
   * Genera una imagen QR a partir de un texto plano (card_id para BioStar 2).
   * El QR codifica exactamente el string recibido — sin JWT ni encapsulación.
   * Esto es lo que el lector hardware de BioStar escanea y compara con card_id.
   *
   * @param text - El card_id de máx 32 caracteres ASCII que se registró en BioStar
   * @returns Data URL (base64 PNG) lista para mostrar como <img src="...">
   */
  async generateCardQrDataUrl(text: string): Promise<string> {
    return QRCode.toDataURL(text, {
      width: 320,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
      errorCorrectionLevel: 'M',
    });
  }

  /**
   * Genera un QR de alta resolución negro puro para impresión en gafete físico.
   * Usa corrección de error nivel H para mayor robustez al imprimir.
   *
   * @param text - Contenido a codificar (card_id de BioStar o VISIT:{visitId})
   * @returns Data URL (base64 PNG)
   */
  async generateBadgePrintQrDataUrl(text: string): Promise<string> {
    return QRCode.toDataURL(text, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
      errorCorrectionLevel: 'H',
    });
  }
}
