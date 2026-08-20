/**
 * @file job-queue.module.ts
 * @description Módulo de gestión de colas (Job Queue) con BullMQ + Redis.
 *
 * Configura colas como 'checkout-queue' para operaciones asíncronas pesadas,
 * aplicando políticas de reintentos exponenciales.
 *
 * @module modules/job-queue
 */

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CheckoutProcessor } from './processors/checkout.processor';
import { SupremaGatewayModule } from '../suprema-gateway/suprema-gateway.module';
import { Visit, Tenant } from '../../database/entities';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
          password: configService.get<string>('redis.password'),
        },
        defaultJobOptions: {
          attempts: 5, // Reintentar hasta 5 veces
          backoff: {
            type: 'exponential',
            delay: 1000 * 60 * 5, // 5 minutos base delay (5, 10, 20...)
          },
          removeOnComplete: true, // Limpiar BD Redis tras completar
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'checkout-queue',
    }),
    TypeOrmModule.forFeature([Visit, Tenant]),
    SupremaGatewayModule,
  ],
  providers: [CheckoutProcessor],
  exports: [BullModule], // Para poder inyectar Queue('checkout-queue') en otros servicios
})
export class JobQueueModule {}
