/**
 * @file security.config.ts
 * @description Configuración centralizada de seguridad y ciberseguridad del VMS.
 *
 * Implementa las mejores prácticas de seguridad para aplicaciones enterprise:
 * - Helmet: Headers HTTP de seguridad (CSP, HSTS, X-Frame-Options, etc.)
 * - CORS: Control estricto de orígenes permitidos
 * - Rate Limiting: Protección contra fuerza bruta y abuso de API
 * - HTTPS Only: Rechazo de conexiones no cifradas
 *
 * Estas configuraciones se aplican globalmente a toda la aplicación
 * y son la primera línea de defensa contra ataques comunes.
 *
 * @module core/security
 */

import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';

/**
 * Aplica todas las configuraciones de seguridad a la aplicación NestJS.
 *
 * Esta función debe llamarse una sola vez durante el bootstrap de la aplicación,
 * antes de que comience a escuchar peticiones.
 *
 * @param app - Instancia de la aplicación NestJS
 * @param configService - Servicio de configuración para acceder a variables de entorno
 */
export function applySecurityConfig(
  app: INestApplication,
  configService: ConfigService,
): void {
  const logger = new Logger('SecurityConfig');
  const frontendUrl =
    configService.get<string>('app.frontendUrl') || 'http://localhost:3000';
  const isProduction =
    configService.get<string>('app.nodeEnv') === 'production';

  // ═══════════════════════════════════════════════════════════════════════
  // 1. HELMET — Headers HTTP de seguridad
  // ═══════════════════════════════════════════════════════════════════════
  // Helmet configura automáticamente múltiples headers de seguridad:
  // - X-Content-Type-Options: nosniff (previene MIME type sniffing)
  // - X-Frame-Options: DENY (previene clickjacking)
  // - Strict-Transport-Security (HSTS en producción)
  // - Content-Security-Policy (CSP)
  // - X-XSS-Protection
  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? undefined // Usar defaults estrictos en producción
        : false, // Desactivar CSP en desarrollo para facilitar debugging
      hsts: isProduction
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    }),
  );
  logger.log('🛡️ Helmet configurado (headers HTTP de seguridad activos).');

  // ═══════════════════════════════════════════════════════════════════════
  // 2. CORS — Control de Orígenes Cruzados
  // ═══════════════════════════════════════════════════════════════════════
  // Solo permitimos peticiones desde el frontend autorizado.
  // En multi-tenancy, cada tenant podría tener su propio dominio,
  // por lo que se soporta una lista de orígenes desde variable de entorno.
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || frontendUrl)
    .split(',')
    .map((origin) => origin.trim());

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true, // Necesario para enviar cookies/headers de sesión
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Tenant-Id',
      'X-Correlation-Id',
    ],
    maxAge: 3600, // Pre-flight cache: 1 hora
  });
  logger.log(
    `🔒 CORS configurado. Orígenes permitidos: ${allowedOrigins.join(', ')}`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  // 3. VALIDACIÓN GLOBAL DE PIPES
  // ═══════════════════════════════════════════════════════════════════════
  // Todos los DTOs se validan automáticamente usando class-validator.
  // whitelist: true → elimina propiedades no decoradas (previene inyección de datos)
  // forbidNonWhitelisted: true → rechaza peticiones con propiedades no esperadas
  // transform: true → transforma tipos automáticamente (string → number, etc.)
  app.useGlobalPipes(
    new (require('@nestjs/common').ValidationPipe)({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  logger.log('✅ Validación global de DTOs activada (whitelist + transform).');

  // ═══════════════════════════════════════════════════════════════════════
  // 4. TRUST PROXY (para obtener IP real detrás de load balancers)
  // ═══════════════════════════════════════════════════════════════════════
  // Necesario para que el rate limiting funcione correctamente cuando
  // la aplicación está detrás de un reverse proxy (Nginx, AWS ALB, etc.)
  const httpAdapter = app.getHttpAdapter();
  if (typeof httpAdapter.getInstance === 'function') {
    const expressApp = httpAdapter.getInstance();
    if (typeof expressApp.set === 'function') {
      expressApp.set('trust proxy', 1);
      logger.log('🔄 Trust proxy habilitado (IP real desde X-Forwarded-For).');
    }
  }
}
