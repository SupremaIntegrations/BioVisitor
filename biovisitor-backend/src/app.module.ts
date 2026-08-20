/**
 * @file app.module.ts
 * @description Módulo raíz de la aplicación BioVisitor X.
 *
 * Configura e integra todos los módulos del sistema:
 * - ConfigModule: Variables de entorno tipadas
 * - TypeOrmModule: Conexión a PostgreSQL con todas las entidades
 * - RedisModule: Conexión a Redis para caché, QR tokens y colas
 * - ThrottlerModule: Rate limiting global
 * - JwtModule: Generación y verificación de tokens JWT
 * - Módulos de negocio: Auth, Visitors, Suprema Gateway, QR Engine, etc.
 *
 * La configuración es modular y cada componente se importa de forma
 * independiente, permitiendo testing aislado y escalabilidad.
 *
 * @module app
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { JwtModule } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ScheduleModule } from '@nestjs/schedule';

// Configuraciones
import {
  databaseConfig,
  redisConfig,
  jwtConfig,
  biostar2Config,
  biostarXConfig,
  qrConfig,
  emailConfig,
  appConfig,
} from './core/config';

// Entidades de base de datos
import {
  Tenant,
  User,
  Visitor,
  Visit,
  AccessCredential,
  AuditLog,
  Blacklist,
  PreRegistration,
  VisitorDocument,
  SupremaApiConnection,
  Host,
  VisitorAsset,
  VisitorVehicle,
  EquipmentEntry,
} from './database/entities';

// Servicios de módulos
import { CoreModule } from './core/core.module';
import { AuthService } from './modules/auth/auth.service';
import { SupremaGatewayService } from './modules/suprema-gateway/suprema-gateway.service';
import { QrEngineService } from './modules/qr-engine/qr-engine.service';

// Modules
import { AuthModule } from './modules/auth/auth.module';
import { VisitorsModule } from './modules/visitors/visitors.module';
import { JobQueueModule } from './modules/job-queue/job-queue.module';
import { SupremaGatewayModule } from './modules/suprema-gateway/suprema-gateway.module';
import { QrEngineModule } from './modules/qr-engine/qr-engine.module';
import { EventsModule } from './modules/events/events.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AppI18nModule } from './modules/i18n/i18n.module';
import { SettingsModule } from './modules/settings/settings.module';
import { HostsModule } from './modules/hosts/hosts.module';
import { OperatorsModule } from './modules/operators/operators.module';
import { LogsModule } from './modules/logs/logs.module';
import { AuditModule } from './modules/audit/audit.module';
import { EquipmentModule } from './modules/equipment/equipment.module';

/**
 * Todas las entidades TypeORM del sistema.
 * Se registran globalmente para poder usar InjectRepository en cualquier módulo.
 */
const ALL_ENTITIES = [
  Tenant,
  User,
  Visitor,
  Visit,
  AccessCredential,
  AuditLog,
  Blacklist,
  PreRegistration,
  VisitorDocument,
  SupremaApiConnection,
  Host,
  VisitorAsset,
  VisitorVehicle,
  EquipmentEntry,
];

@Module({
  imports: [
    // ═══════════════════════════════════════════════════════════════════
    // CONFIGURACIÓN — Variables de entorno tipadas y validadas
    // ═══════════════════════════════════════════════════════════════════
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        redisConfig,
        jwtConfig,
        biostar2Config,
        biostarXConfig,
        qrConfig,
        emailConfig,
        appConfig,
      ],
      envFilePath: '.env',
    }),

    // ═══════════════════════════════════════════════════════════════════
    // BASE DE DATOS — PostgreSQL con TypeORM
    // ═══════════════════════════════════════════════════════════════════
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        database: configService.get<string>('database.database'),
        autoLoadEntities: true,
        synchronize: configService.get<boolean>('database.synchronize'),
        logging: configService.get<boolean>('database.logging'),
        // Pool de conexiones optimizado para producción
        extra: {
          max: 20, // Máximo de conexiones simultáneas
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        },
      }),
    }),

    // ═══════════════════════════════════════════════════════════════════
    // REDIS — Caché de sesiones, tokens QR, colas Bull
    // ═══════════════════════════════════════════════════════════════════
    RedisModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single' as const,
        url: `redis://${configService.get<string>('redis.host')}:${configService.get<number>('redis.port')}`,
        options: {
          password: configService.get<string>('redis.password') || undefined,
          keyPrefix: configService.get<string>('redis.keyPrefix'),
        },
      }),
    }),

    // ═══════════════════════════════════════════════════════════════════
    // RATE LIMITING — Protección contra abuso de API
    // ═══════════════════════════════════════════════════════════════════
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 segundo
        limit: 10, // Máximo 10 peticiones por segundo
      },
      {
        name: 'medium',
        ttl: 60000, // 1 minuto
        limit: 100, // Máximo 100 peticiones por minuto
      },
      {
        name: 'long',
        ttl: 3600000, // 1 hora
        limit: 1000, // Máximo 1000 peticiones por hora
      },
    ]),

    // ═══════════════════════════════════════════════════════════════════
    // JWT — Tokens de autenticación
    // ═══════════════════════════════════════════════════════════════════
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret') || 'default-secret',
        signOptions: {
          expiresIn: (configService.get<string>('jwt.expiresIn') ||
            '8h') as any,
        },
      }),
    }),

    // ═══════════════════════════════════════════════════════════════════
    // HTTP — Cliente HTTP para llamadas a BioStar API
    // ═══════════════════════════════════════════════════════════════════
    HttpModule.register({
      timeout: 30000, // 30 segundos de timeout
      maxRedirects: 3,
    }),

    // ═══════════════════════════════════════════════════════════════════
    // TAREAS PROGRAMADAS — Auto-checkout nocturno y alertas de overtime
    // ═══════════════════════════════════════════════════════════════════
    ScheduleModule.forRoot(),

    // Módulos de aplicación
    CoreModule,
    AuthModule,
    VisitorsModule,
    // JobQueueModule, // Disabled for local test (requires Redis 6.2+)
    SupremaGatewayModule,
    QrEngineModule,
    EventsModule,
    NotificationsModule,
    ReportsModule,
    AppI18nModule,
    SettingsModule,
    HostsModule,
    OperatorsModule,
    LogsModule,
    AuditModule,
    EquipmentModule,
  ],
  providers: [],
  exports: [],
})
export class AppModule { }
