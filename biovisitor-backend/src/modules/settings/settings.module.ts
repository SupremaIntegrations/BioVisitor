/**
 * @file settings.module.ts
 * @description Módulo de Configuración del sistema BioVisitor X.
 *
 * Gestiona:
 * - Conexiones a la API de Suprema BioStar (múltiples simultáneas)
 * - Listado y caché de dispositivos BioStar
 * - Gestión de dispositivos enroladores (Redis)
 *
 * @module modules/settings
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';

import { SupremaApiConnection } from '../../database/entities/suprema-api-connection.entity';
import { SupremaConnectionsService } from './suprema-connections.service';
import { SupremaConnectionsController } from './suprema-connections.controller';
import { EnrollerDevicesService } from './enroller-devices.service';
import { DevicesController } from './devices.controller';
import { EnrollersController } from './enrollers.controller';
import { ExitDevicesController } from './exit-devices.controller';
import { CoreModule } from '../../core/core.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupremaApiConnection]),
    HttpModule.register({
      timeout: 38000,
      maxRedirects: 2,
    }),
    CoreModule,
  ],
  providers: [SupremaConnectionsService, EnrollerDevicesService],
  controllers: [
    SupremaConnectionsController,
    DevicesController,
    EnrollersController,
    ExitDevicesController,
  ],
  exports: [SupremaConnectionsService, EnrollerDevicesService],
})
export class SettingsModule {}
