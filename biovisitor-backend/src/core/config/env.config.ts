/**
 * @file env.config.ts
 * @description Configuración tipada de variables de entorno para el VMS.
 * Centraliza todas las variables de configuración del sistema, incluyendo
 * credenciales de BioStar, configuración de base de datos, Redis, JWT, y email.
 *
 * Utiliza el patrón de validación con class-validator para garantizar que
 * todas las variables requeridas estén presentes al iniciar la aplicación,
 * evitando fallos en runtime por configuración faltante.
 *
 * @module core/config
 */

import { registerAs } from '@nestjs/config';

/**
 * Configuración de la base de datos PostgreSQL.
 * Se registra bajo el namespace 'database' para acceder como:
 * configService.get('database.host')
 */
export const databaseConfig = registerAs('database', () => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'biovisitor',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'biovisitor_x',
  /** Sincronizar esquema automáticamente (solo para desarrollo) */
  synchronize: process.env.NODE_ENV === 'development',
  /** Habilitar logging de queries SQL (solo para desarrollo/debug) */
  logging: process.env.DB_LOGGING === 'true',
}));

/**
 * Configuración de Redis.
 * Redis se usa para: caché de bs-session-id, tokens QR, colas Bull, y WebSocket adapter.
 */
export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  /** Prefijo para las claves en Redis, útil para multi-tenancy y aislamiento */
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'bv:',
}));

/**
 * Configuración de JWT para autenticación interna del VMS.
 * No confundir con los JWT usados para códigos QR dinámicos.
 */
export const jwtConfig = registerAs('jwt', () => ({
  // Sin valor por defecto a propósito: un secreto conocido públicamente
  // (aunque sea un placeholder tipo "CHANGE_ME") permitiría forjar tokens
  // válidos si esta variable llega a faltar. validateSecurityEnv() en
  // main.ts aborta el arranque si no está definida.
  secret: process.env.JWT_SECRET || '',
  /** Tiempo de expiración del token de acceso */
  expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  /** Tiempo de expiración del refresh token */
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
}));

/**
 * Configuración de conexión con BioStar 2.
 * Las credenciales se almacenan cifradas con AES-256-GCM.
 * La clave de cifrado se carga desde ENCRYPTION_MASTER_KEY.
 */
export const biostar2Config = registerAs('biostar2', () => ({
  /** URL base del servidor BioStar 2 (ej: https://192.168.1.10:2778) */
  apiUrl: process.env.BIOSTAR2_API_URL || '',
  /** ID de login del administrador de BioStar 2 */
  adminUser: process.env.BIOSTAR2_ADMIN_USER || '',
  /** Contraseña del administrador (se recomienda cifrar en producción) */
  adminPassword: process.env.BIOSTAR2_ADMIN_PASSWORD || '',
  /** Ruta al certificado CA del servidor BioStar 2 para verificación SSL */
  caCertPath: process.env.BIOSTAR2_CA_CERT_PATH || '',
  /** Tiempo de caché del bs-session-id en segundos (por defecto 25 min) */
  sessionCacheTtl: parseInt(
    process.env.BIOSTAR2_SESSION_CACHE_TTL || '1500',
    10,
  ),
}));

/**
 * Configuración de conexión con BioStar X.
 * BioStar X utiliza una arquitectura de microservicios diferente a BS2.
 */
export const biostarXConfig = registerAs('biostarx', () => ({
  /** URL base del servidor BioStar X */
  apiUrl: process.env.BIOSTARX_API_URL || '',
  /** Credenciales de autenticación para BioStar X */
  adminUser: process.env.BIOSTARX_ADMIN_USER || '',
  adminPassword: process.env.BIOSTARX_ADMIN_PASSWORD || '',
  /** Ruta al certificado CA del servidor BioStar X */
  caCertPath: process.env.BIOSTARX_CA_CERT_PATH || '',
}));

/**
 * Configuración del motor de QR dinámico.
 * Estos tokens JWT son de uso único y se validan contra Redis.
 */
export const qrConfig = registerAs('qr', () => ({
  /**
   * Clave secreta para firmar los JWT de los códigos QR dinámicos.
   * Sin valor por defecto — ver comentario en jwtConfig.secret.
   */
  jwtSecret: process.env.QR_JWT_SECRET || '',
  /** Tiempo de expiración del QR en minutos (por defecto 15 min) */
  expirationMinutes: parseInt(process.env.QR_EXPIRATION_MINUTES || '15', 10),
}));

/**
 * Configuración del servicio de email para notificaciones.
 * Se usa para enviar links de pre-registro, QR dinámicos y reportes.
 */
export const emailConfig = registerAs('email', () => ({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  password: process.env.SMTP_PASSWORD || '',
  /** Dirección de remitente (ej: noreply@biovisitor.com) */
  fromAddress: process.env.SMTP_FROM || 'noreply@biovisitor.com',
  fromName: process.env.SMTP_FROM_NAME || 'BioVisitor X',
}));

/**
 * Configuración de la aplicación VMS.
 * Parámetros generales del sistema.
 */
export const appConfig = registerAs('app', () => ({
  /** Puerto del servidor NestJS */
  port: parseInt(process.env.APP_PORT || '3001', 10),
  /** Entorno de ejecución */
  nodeEnv: process.env.NODE_ENV || 'development',
  /** URL del frontend (para CORS y links en emails) */
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  /** Clave maestra para cifrado AES-256-GCM de datos sensibles */
  encryptionMasterKey: process.env.ENCRYPTION_MASTER_KEY || '',
  /** Idioma por defecto del sistema */
  defaultLanguage: process.env.DEFAULT_LANGUAGE || 'es',
}));
