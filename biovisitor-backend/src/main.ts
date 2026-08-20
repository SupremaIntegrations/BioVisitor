/**
 * @file main.ts
 * @description Punto de entrada de la aplicación BioVisitor X.
 *
 * Configura el bootstrap de NestJS aplicando:
 * - Configuraciones de seguridad (Helmet, CORS, Validation Pipes)
 * - Trust Proxy para detección correcta de IPs
 * - Puerto de escucha desde variable de entorno
 * - Logging de inicio con información del sistema
 *
 * @module main
 */

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { applySecurityConfig } from './core/security/security.config';

/**
 * Verifica que los secretos de seguridad críticos estén definidos antes de
 * arrancar. Estas variables ya NO tienen un valor por defecto en
 * env.config.ts — un placeholder tipo "CHANGE_ME" quedaría público en el
 * repositorio, así que si faltan, el arranque debe fallar de forma ruidosa
 * en vez de firmar tokens JWT reales o cifrar datos con una clave conocida.
 */
function validateSecurityEnv(logger: Logger): void {
  const errors: string[] = [];

  const jwtSecret = process.env.JWT_SECRET || '';
  if (jwtSecret.length < 32) {
    errors.push(
      'JWT_SECRET no está definida o es demasiado corta (mínimo 32 caracteres).',
    );
  }

  const qrJwtSecret = process.env.QR_JWT_SECRET || '';
  if (qrJwtSecret.length < 32) {
    errors.push(
      'QR_JWT_SECRET no está definida o es demasiado corta (mínimo 32 caracteres).',
    );
  }

  const encryptionKey = process.env.ENCRYPTION_MASTER_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    errors.push(
      'ENCRYPTION_MASTER_KEY no está definida o no tiene exactamente 64 caracteres hexadecimales (32 bytes).',
    );
  }

  if (errors.length > 0) {
    logger.error('═══════════════════════════════════════════════════════════');
    logger.error('❌ No se puede iniciar: faltan variables de seguridad en .env');
    errors.forEach((e) => logger.error(`   - ${e}`));
    logger.error('═══════════════════════════════════════════════════════════');
    process.exit(1);
  }
}

/**
 * Bootstrap de la aplicación.
 * Inicializa NestJS con todas las configuraciones de seguridad
 * y comienza a escuchar peticiones HTTP.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  validateSecurityEnv(logger);

  // Crear la aplicación NestJS
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // Suprema BioStar X spec: imágenes biométricas hasta 10 MB en Base64
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '10mb' });

  // Obtener servicio de configuración
  const configService = app.get(ConfigService);

  // ═══════════════════════════════════════════════════════════════════
  // Aplicar configuraciones de seguridad
  // ═══════════════════════════════════════════════════════════════════
  applySecurityConfig(app, configService);

  // Prefijo global de API (todas las rutas empiezan con /api/v1)
  app.setGlobalPrefix('api/v1');

  // ═══════════════════════════════════════════════════════════════════
  // Iniciar servidor
  // ═══════════════════════════════════════════════════════════════════
  const port = configService.get<number>('app.port') || 3001;
  const nodeEnv = configService.get<string>('app.nodeEnv') || 'development';

  await app.listen(port);

  logger.log('═══════════════════════════════════════════════════════════');
  logger.log(`🚀 BioVisitor X Backend iniciado exitosamente`);
  logger.log(`📡 Puerto: ${port}`);
  logger.log(`🌍 Entorno: ${nodeEnv}`);
  logger.log(`🔗 URL: http://localhost:${port}/api/v1`);
  logger.log(`📋 Prefix de API: /api/v1`);
  logger.log('═══════════════════════════════════════════════════════════');
}

bootstrap();
