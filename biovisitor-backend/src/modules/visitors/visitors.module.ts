/**
 * @file visitors.module.ts
 * @description Módulo de visitantes para el VMS.
 *
 * Agrupa la lógica de negocio para crear visitantes, agendar visitas (con credenciales)
 * manejando a su vez el gateway de Suprema para sincronizar la información y los
 * códigos QR.
 *
 * @module modules/visitors
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { VisitorsController } from './visitors.controller';
import { VisitorsService } from './visitors.service';
import {
  VisitorPortalController,
  VisitorOnboardingController,
  ExitSurveyController,
  FalseExitController,
} from './visitor-portal.controller';
import { PreRegistrationController } from './pre-registration.controller';
import { AccessGroupsController } from './access-groups.controller';
import { PreRegistrationService } from './pre-registration.service';
import { SupremaSyncService } from './suprema-sync.service';
import { AutoCheckoutService } from './auto-checkout.service';
import { VisitorTypeService } from './visitor-type.service';
import { DataRetentionService } from './data-retention.service';
import { BiostarWsService } from './biostar-ws.service';
import { ExitLinksService } from './exit-links.service';
import {
  Visitor,
  Visit,
  AccessCredential,
  Tenant,
  PreRegistration,
  SupremaApiConnection,
  Host,
  VisitorAsset,
  VisitorVehicle,
} from '../../database/entities';
import { SupremaGatewayModule } from '../suprema-gateway/suprema-gateway.module';
import { QrEngineModule } from '../qr-engine/qr-engine.module';
import { CoreModule } from '../../core/core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Visitor,
      Visit,
      AccessCredential,
      Tenant,
      PreRegistration,
      SupremaApiConnection,
      Host,
      VisitorAsset,
      VisitorVehicle,
    ]),
    SupremaGatewayModule,
    QrEngineModule,
    CoreModule,
    NotificationsModule,
    SettingsModule,
    HttpModule.register({ timeout: 20000, maxRedirects: 2 }),
  ],
  controllers: [VisitorsController, VisitorPortalController, VisitorOnboardingController, PreRegistrationController, AccessGroupsController, ExitSurveyController, FalseExitController],
  providers: [VisitorsService, PreRegistrationService, SupremaSyncService, AutoCheckoutService, VisitorTypeService, DataRetentionService, BiostarWsService, ExitLinksService],
  exports: [VisitorsService, PreRegistrationService, SupremaSyncService, AutoCheckoutService, VisitorTypeService, DataRetentionService, ExitLinksService],
})
export class VisitorsModule {}
