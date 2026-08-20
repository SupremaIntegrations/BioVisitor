/**
 * @file qr-engine.module.ts
 * @description Módulo de motor de generación y validación de códigos QR únicos (JWT).
 *
 * @module modules/qr-engine
 */

import { Module } from '@nestjs/common';
import { QrEngineService } from './qr-engine.service';
import { CoreModule } from '../../core/core.module';

@Module({
  imports: [CoreModule],
  providers: [QrEngineService],
  exports: [QrEngineService],
})
export class QrEngineModule {}
