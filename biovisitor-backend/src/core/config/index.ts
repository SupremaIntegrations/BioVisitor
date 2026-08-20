/**
 * @file config/index.ts
 * @description Barrel export para todas las configuraciones del sistema.
 * Centraliza los exports para simplificar las importaciones en otros módulos.
 *
 * @module core/config
 */

export {
  databaseConfig,
  redisConfig,
  jwtConfig,
  biostar2Config,
  biostarXConfig,
  qrConfig,
  emailConfig,
  appConfig,
} from './env.config';
