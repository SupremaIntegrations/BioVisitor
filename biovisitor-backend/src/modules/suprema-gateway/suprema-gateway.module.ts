/**
 * @file suprema-gateway.module.ts
 * @description Módulo para el Wrapper (Gateway) de BioStar 2 y BioStar X.
 *
 * Exporta el servicio que actúa como Facade para la interacción con Suprema.
 *
 * @module modules/suprema-gateway
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SupremaGatewayService } from './suprema-gateway.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 3,
    }),
  ],
  providers: [SupremaGatewayService],
  exports: [SupremaGatewayService],
})
export class SupremaGatewayModule {}
