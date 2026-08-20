/**
 * @file checkout.processor.ts
 * @description Procesador BullMQ para ejecutar check-outs en segundo plano.
 *
 * Se encarga de contactar al Suprema Gateway para el borrado del visitante (Data Minimization).
 * Incluye reintentos exponenciales en caso de que BioStar esté inalcanzable (Circuit Breaker OPEN).
 *
 * @module modules/job-queue/processors
 */

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { SupremaGatewayService } from '../../suprema-gateway/suprema-gateway.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Visit, Tenant } from '../../../database/entities';

export interface CheckoutJobData {
  visitId: string;
  tenantId: string;
  supremaRefId: string;
}

@Processor('checkout-queue')
export class CheckoutProcessor extends WorkerHost {
  private readonly logger = new Logger(CheckoutProcessor.name);

  constructor(
    private readonly supremaGateway: SupremaGatewayService,
    @InjectRepository(Visit)
    private readonly visitRepository: Repository<Visit>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {
    super();
  }

  async process(job: Job<CheckoutJobData, any, string>): Promise<void> {
    const { visitId, tenantId, supremaRefId } = job.data;

    this.logger.log(
      `Procesando tarea de check-out para visita ${visitId} (Ref: ${supremaRefId})`,
    );

    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
    });
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

    try {
      // 1. Invocar eliminación en BioStar
      await this.supremaGateway.deleteUser(tenant, supremaRefId);

      // 2. Marcar visita como sincronizada si el borrado tuvo éxito
      const visit = await this.visitRepository.findOne({
        where: { id: visitId },
      });
      if (visit) {
        visit.syncStatus = 'SYNCED';
        await this.visitRepository.save(visit);
      }

      this.logger.log(`Check-out asíncrono exitoso para visita ${visitId}`);
    } catch (error: any) {
      this.logger.error(
        `Error en check-out asíncrono para ${visitId}. Reintentando...`,
        error.stack,
      );

      // Lanzar error permite que BullMQ maneje el reintento usando backoff
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onWorkerFailed(job: Job, error: Error) {
    this.logger.error(`Checkout Job ${job.id} falló: ${error.message}`);
  }
}
