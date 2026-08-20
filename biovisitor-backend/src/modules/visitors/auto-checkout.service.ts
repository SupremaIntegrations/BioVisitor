/**
 * @file auto-checkout.service.ts
 * @description Servicio de auto-checkout nocturno configurable por tenant.
 *
 * Almacena la configuración en Redis (clave: `autocheckout:{tenantId}`)
 * y ejecuta un cron que verifica cada minuto si algún tenant tiene
 * auto-checkout programado para la hora actual.
 *
 * @module modules/visitors
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../database/entities/tenant.entity';
import { Visit, VisitStatus } from '../../database/entities/visit.entity';
import { VisitorsService } from './visitors.service';

export interface AutoCheckoutConfig {
    enabled: boolean;
    /** Hora del día (0–23) */
    hour: number;
    /** Minuto (0–59) */
    minute: number;
    /** Tiempo máximo de estadía por defecto en minutos (0 = sin límite) */
    defaultMaxStayMinutes: number;
}

const DEFAULT_CONFIG: AutoCheckoutConfig = {
    enabled: false,
    hour: 23,
    minute: 0,
    defaultMaxStayMinutes: 480, // 8 horas
};

@Injectable()
export class AutoCheckoutService {
    private readonly logger = new Logger(AutoCheckoutService.name);

    constructor(
        @InjectRedis() private readonly redis: Redis,
        @InjectRepository(Tenant)
        private readonly tenantRepository: Repository<Tenant>,
        @InjectRepository(Visit)
        private readonly visitRepository: Repository<Visit>,
        private readonly visitorsService: VisitorsService,
    ) {}

    private redisKey(tenantId: string): string {
        return `autocheckout:${tenantId}`;
    }

    async getConfig(tenantId: string): Promise<AutoCheckoutConfig> {
        const raw = await this.redis.get(this.redisKey(tenantId));
        if (!raw) return { ...DEFAULT_CONFIG };
        try {
            return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        } catch {
            return { ...DEFAULT_CONFIG };
        }
    }

    async saveConfig(tenantId: string, config: Partial<AutoCheckoutConfig>): Promise<AutoCheckoutConfig> {
        const current = await this.getConfig(tenantId);
        const updated: AutoCheckoutConfig = { ...current, ...config };
        await this.redis.set(this.redisKey(tenantId), JSON.stringify(updated));
        this.logger.log(
            `Auto-checkout config actualizada para tenant ${tenantId}: hora=${updated.hour}:${String(updated.minute).padStart(2, '0')}, enabled=${updated.enabled}`,
        );
        return updated;
    }

    /**
     * Cron que se ejecuta cada minuto y dispara el auto-checkout
     * para los tenants cuya hora configurada coincida con la actual.
     */
    @Cron('* * * * *')
    async runAutoCheckoutCron(): Promise<void> {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        const tenants = await this.tenantRepository.find({ where: { isActive: true } });

        for (const tenant of tenants) {
            try {
                const config = await this.getConfig(tenant.id);
                if (
                    config.enabled &&
                    config.hour === currentHour &&
                    config.minute === currentMinute
                ) {
                    this.logger.log(
                        `⏰ Auto-checkout nocturno disparado para tenant ${tenant.id} a las ${currentHour}:${String(currentMinute).padStart(2, '0')}`,
                    );
                    const count = await this.visitorsService.bulkCheckoutTenant(tenant.id, 'auto-checkout');
                    this.logger.log(`✅ Auto-checkout completado: ${count} visita(s) cerrada(s) para tenant ${tenant.id}`);
                }
            } catch (err: any) {
                this.logger.error(`Error en auto-checkout para tenant ${tenant.id}: ${err?.message}`);
            }
        }
    }

    /**
     * Verifica las visitas CHECKED_IN que han excedido su maxStayMinutes
     * y emite una alerta real-time (cada 2 minutos).
     */
    @Cron('*/2 * * * *')
    async checkOvertimeVisits(): Promise<void> {
        // Se delega al EventsGateway via VisitorsService
        // El frontend hace polling por su cuenta también
    }

    /**
     * Cierra automáticamente las visitas cuya "habilitación temporal" (tras un
     * reporte de falsa salida) venció. Se ejecuta cada minuto junto con el
     * resto de los crons de auto-checkout.
     */
    @Cron('* * * * *')
    async closeExpiredTemporaryReenablements(): Promise<void> {
        const now = new Date();
        let expired: Visit[] = [];
        try {
            expired = await this.visitRepository
                .createQueryBuilder('visit')
                .where('visit.status = :status', { status: VisitStatus.CHECKED_IN })
                .andWhere('visit.temporaryReenableUntil IS NOT NULL')
                .andWhere('visit.temporaryReenableUntil <= :now', { now })
                .getMany();
        } catch (err: any) {
            this.logger.error(`Error consultando habilitaciones temporales vencidas: ${err?.message}`);
            return;
        }

        for (const visit of expired) {
            try {
                await this.visitorsService.checkoutVisit(
                    visit.id,
                    visit.tenantId,
                    'system',
                    'Fin de habilitación temporal (falsa salida)',
                );
                this.logger.log(
                    `⏱️ Habilitación temporal vencida — visita ${visit.id} cerrada automáticamente.`,
                );
            } catch (err: any) {
                this.logger.error(
                    `Error cerrando visita ${visit.id} tras vencer habilitación temporal: ${err?.message}`,
                );
            }
        }
    }

    // ── Auto-Print Config ──────────────────────────────────────────────────────

    private autoPrintKey(tenantId: string): string {
        return `autoprint:${tenantId}`;
    }

    async getAutoPrintConfig(tenantId: string): Promise<{ enabled: boolean }> {
        const raw = await this.redis.get(this.autoPrintKey(tenantId));
        if (!raw) return { enabled: false };
        try {
            return { enabled: false, ...JSON.parse(raw) };
        } catch {
            return { enabled: false };
        }
    }

    async saveAutoPrintConfig(
        tenantId: string,
        config: Partial<{ enabled: boolean }>,
    ): Promise<{ enabled: boolean }> {
        const current = await this.getAutoPrintConfig(tenantId);
        const updated = { ...current, ...config };
        await this.redis.set(this.autoPrintKey(tenantId), JSON.stringify(updated));
        this.logger.log(
            `Auto-print config actualizada para tenant ${tenantId}: enabled=${updated.enabled}`,
        );
        return updated;
    }

    // ── Encuesta de salida + Reporte de falsa salida ─────────────────────────────

    private exitSurveyKey(tenantId: string): string {
        return `exitsurvey:${tenantId}`;
    }

    /**
     * Determina si se debe enviar el correo de encuesta + aviso de falsa
     * salida cuando ocurre un auto-checkout por dispositivo de salida.
     * Habilitado por defecto.
     */
    async getExitSurveyConfig(tenantId: string): Promise<{ enabled: boolean }> {
        const raw = await this.redis.get(this.exitSurveyKey(tenantId));
        if (!raw) return { enabled: true };
        try {
            return { enabled: true, ...JSON.parse(raw) };
        } catch {
            return { enabled: true };
        }
    }

    async saveExitSurveyConfig(
        tenantId: string,
        config: Partial<{ enabled: boolean }>,
    ): Promise<{ enabled: boolean }> {
        const current = await this.getExitSurveyConfig(tenantId);
        const updated = { ...current, ...config };
        await this.redis.set(this.exitSurveyKey(tenantId), JSON.stringify(updated));
        this.logger.log(
            `Config de encuesta de salida actualizada para tenant ${tenantId}: enabled=${updated.enabled}`,
        );
        return updated;
    }

    // ── Auto-Checkout: defaults por tipo de visitante ────────────────────────────

    private visitorTypeDefaultsKey(tenantId: string): string {
        return `autocheckout:visitortype:${tenantId}`;
    }

    /**
     * Valores por defecto de "autoCheckoutEnabled" según el tipo de visitante.
     * Estos defaults solo se aplican al crear/editar una visita en el frontend
     * (se pueden sobreescribir manualmente por visita); no afectan visitas ya creadas.
     */
    async getVisitorTypeDefaults(tenantId: string): Promise<Record<string, boolean>> {
        const raw = await this.redis.get(this.visitorTypeDefaultsKey(tenantId));
        if (!raw) return {};
        try {
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }

    /**
     * Actualiza los defaults de auto-checkout por tipo de visitante.
     * Por defecto hace un merge con los valores existentes; si `replace` es
     * true, reemplaza el registro completo (usado al eliminar un tipo
     * personalizado, para limpiar su entrada sin volver a re-mergearla).
     */
    async saveVisitorTypeDefaults(
        tenantId: string,
        defaults: Record<string, boolean>,
        replace = false,
    ): Promise<Record<string, boolean>> {
        const current = replace ? {} : await this.getVisitorTypeDefaults(tenantId);
        const updated = { ...current, ...defaults };
        await this.redis.set(this.visitorTypeDefaultsKey(tenantId), JSON.stringify(updated));
        this.logger.log(
            `Defaults de auto-checkout por tipo de visitante actualizados para tenant ${tenantId}: ${JSON.stringify(updated)}`,
        );
        return updated;
    }
}
