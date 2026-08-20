/**
 * @file data-retention.service.ts
 * @description Servicio de retención y purga automática de datos de visitantes.
 *
 * Almacena la configuración en Redis (clave: `dataretention:{tenantId}`)
 * y ejecuta un cron diario que elimina los registros de visitantes/visitas
 * anteriores al período configurado, cumpliendo políticas de privacidad (GDPR, etc.).
 *
 * @module modules/visitors
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Tenant } from '../../database/entities/tenant.entity';
import { Visit } from '../../database/entities/visit.entity';
import { Visitor } from '../../database/entities/visitor.entity';
import { AccessCredential } from '../../database/entities/access-credential.entity';
import { VisitStatus } from '../../database/entities/visit.entity';

export interface DataRetentionConfig {
    enabled: boolean;
    /** Número de días que se conservan los registros (mínimo 1) */
    retentionDays: number;
}

export interface DataRetentionRunResult {
    deletedVisits: number;
    deletedVisitors: number;
    deletedCredentials: number;
    deletedPhotos: number;
    ranAt: string;
    tenantId: string;
}

const DEFAULT_CONFIG: DataRetentionConfig = {
    enabled: false,
    retentionDays: 365,
};

/** Estados finales — los únicos que se purgan automáticamente */
const PURGEABLE_STATUSES: VisitStatus[] = [
    VisitStatus.CHECKED_OUT,
    VisitStatus.CANCELLED,
    VisitStatus.NO_SHOW,
];

@Injectable()
export class DataRetentionService {
    private readonly logger = new Logger(DataRetentionService.name);

    constructor(
        @InjectRedis() private readonly redis: Redis,
        @InjectRepository(Tenant)
        private readonly tenantRepository: Repository<Tenant>,
        @InjectRepository(Visit)
        private readonly visitRepository: Repository<Visit>,
        @InjectRepository(Visitor)
        private readonly visitorRepository: Repository<Visitor>,
        @InjectRepository(AccessCredential)
        private readonly credentialRepository: Repository<AccessCredential>,
    ) {}

    private configKey(tenantId: string): string {
        return `dataretention:config:${tenantId}`;
    }

    private statsKey(tenantId: string): string {
        return `dataretention:stats:${tenantId}`;
    }

    async getConfig(tenantId: string): Promise<DataRetentionConfig & { lastRun?: DataRetentionRunResult | null }> {
        const [rawConfig, rawStats] = await Promise.all([
            this.redis.get(this.configKey(tenantId)),
            this.redis.get(this.statsKey(tenantId)),
        ]);

        const config: DataRetentionConfig = rawConfig
            ? { ...DEFAULT_CONFIG, ...JSON.parse(rawConfig) }
            : { ...DEFAULT_CONFIG };

        const lastRun: DataRetentionRunResult | null = rawStats ? JSON.parse(rawStats) : null;

        return { ...config, lastRun };
    }

    async setConfig(tenantId: string, config: Partial<DataRetentionConfig>): Promise<DataRetentionConfig> {
        const current = await this.getConfig(tenantId);
        const updated: DataRetentionConfig = {
            enabled: config.enabled ?? current.enabled,
            retentionDays: Math.max(1, config.retentionDays ?? current.retentionDays),
        };
        await this.redis.set(this.configKey(tenantId), JSON.stringify(updated));
        return updated;
    }

    /**
     * Purga manual para un tenant. Elimina visitas en estado final
     * con `scheduledAt` anterior al umbral y visitantes sin visitas restantes.
     */
    async runPurge(tenantId: string): Promise<DataRetentionRunResult> {
        const config = await this.getConfig(tenantId);
        const threshold = new Date();
        threshold.setDate(threshold.getDate() - config.retentionDays);

        this.logger.log(
            `[DataRetention] Iniciando purga para tenant ${tenantId} — umbral: ${threshold.toISOString()}`,
        );

        // 1. Encontrar visitas antiguas en estado final
        const oldVisits = await this.visitRepository.find({
            where: {
                tenantId,
                status: In(PURGEABLE_STATUSES),
                scheduledAt: LessThan(threshold),
            },
            select: ['id', 'visitorId'],
        });

        const visitIds = oldVisits.map(v => v.id);
        const visitorIds = [...new Set(oldVisits.map(v => v.visitorId).filter(Boolean))] as string[];

        let deletedCredentials = 0;
        let deletedVisits = 0;

        if (visitIds.length > 0) {
            // 2. Eliminar credenciales de acceso relacionadas
            const credResult = await this.credentialRepository.delete({ visitId: In(visitIds) });
            deletedCredentials = credResult.affected ?? 0;

            // 3. Eliminar visitas
            const visitResult = await this.visitRepository.delete({ id: In(visitIds) });
            deletedVisits = visitResult.affected ?? 0;
        }

        // 4. Encontrar visitantes sin visitas restantes (huérfanos)
        let deletedVisitors = 0;
        let deletedPhotos = 0;

        if (visitorIds.length > 0) {
            const remainingVisits = await this.visitRepository.find({
                where: { visitorId: In(visitorIds), tenantId },
                select: ['visitorId'],
            });
            const visitorsWithRemainingVisits = new Set(remainingVisits.map(v => v.visitorId));
            const visitorsToDelete = visitorIds.filter(id => !visitorsWithRemainingVisits.has(id));

            if (visitorsToDelete.length > 0) {
                // Eliminar fotos del disco
                for (const visitorId of visitorsToDelete) {
                    const visitor = await this.visitorRepository.findOne({ where: { id: visitorId }, select: ['id', 'photoPath'] });
                    if (visitor?.photoPath) {
                        const photoPath = path.join(process.cwd(), 'uploads', path.basename(visitor.photoPath));
                        try {
                            if (fs.existsSync(photoPath)) {
                                fs.unlinkSync(photoPath);
                                deletedPhotos++;
                            }
                        } catch (err) {
                            this.logger.warn(`[DataRetention] No se pudo eliminar foto: ${photoPath}`);
                        }
                    }
                }

                const delResult = await this.visitorRepository.delete({ id: In(visitorsToDelete) });
                deletedVisitors = delResult.affected ?? 0;
            }
        }

        const result: DataRetentionRunResult = {
            deletedVisits,
            deletedVisitors,
            deletedCredentials,
            deletedPhotos,
            ranAt: new Date().toISOString(),
            tenantId,
        };

        // Guardar estadísticas de la última ejecución
        await this.redis.set(this.statsKey(tenantId), JSON.stringify(result));

        this.logger.log(
            `[DataRetention] Purga completada para ${tenantId}: ` +
            `${deletedVisits} visitas, ${deletedVisitors} visitantes, ${deletedCredentials} credenciales, ${deletedPhotos} fotos eliminados.`,
        );

        return result;
    }

    /**
     * Cron diario a las 02:00 AM — recorre todos los tenants con retención activa.
     */
    @Cron(CronExpression.EVERY_DAY_AT_2AM)
    async scheduledPurge(): Promise<void> {
        const tenants = await this.tenantRepository.find({ select: ['id'] });
        for (const tenant of tenants) {
            try {
                const config = await this.getConfig(tenant.id);
                if (!config.enabled) continue;
                await this.runPurge(tenant.id);
            } catch (err) {
                this.logger.error(`[DataRetention] Error en purga programada para tenant ${tenant.id}: ${err}`);
            }
        }
    }
}
