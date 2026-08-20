/**
 * @file visitor-type.service.ts
 * @description Gestión de tipos de visitante personalizados por tenant.
 *
 * Los tipos predefinidos (VisitorType) siempre están disponibles. Este servicio
 * permite a cada tenant agregar tipos adicionales (ej: "Auditor", "Practicante")
 * que se comportan igual que los predefinidos en el resto del sistema:
 * seleccionables al registrar/editar una visita y configurables en las reglas
 * de auto-checkout por tipo de visitante.
 *
 * Almacenamiento: Redis, clave `visitortypes:custom:{tenantId}`.
 *
 * @module modules/visitors
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { VisitorType } from '../../database/entities/visit.entity';
import { AutoCheckoutService } from './auto-checkout.service';

export interface CustomVisitorType {
  /** Clave única (mayúsculas, snake_case), usada como valor de visitorType */
  key: string;
  /** Nombre legible mostrado en la UI */
  label: string;
  /** Emoji/ícono representativo */
  icon: string;
}

const MAX_CUSTOM_TYPES = 30;

@Injectable()
export class VisitorTypeService {
  private readonly logger = new Logger(VisitorTypeService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly autoCheckoutService: AutoCheckoutService,
  ) {}

  private redisKey(tenantId: string): string {
    return `visitortypes:custom:${tenantId}`;
  }

  private builtInKeys(): string[] {
    return Object.values(VisitorType);
  }

  async getCustomTypes(tenantId: string): Promise<CustomVisitorType[]> {
    const raw = await this.redis.get(this.redisKey(tenantId));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Retorna los tipos predefinidos y los personalizados del tenant.
   */
  async getAllTypes(tenantId: string): Promise<{ builtIn: string[]; custom: CustomVisitorType[] }> {
    return {
      builtIn: this.builtInKeys(),
      custom: await this.getCustomTypes(tenantId),
    };
  }

  private slugifyKey(label: string): string {
    return label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quita acentos
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 50);
  }

  async createCustomType(
    tenantId: string,
    input: { label: string; icon?: string },
  ): Promise<CustomVisitorType[]> {
    const label = (input.label ?? '').trim();
    if (!label) {
      throw new BadRequestException('El nombre del tipo de visitante es obligatorio.');
    }
    const icon = (input.icon ?? '🏷️').trim() || '🏷️';

    const key = this.slugifyKey(label);
    if (!key) {
      throw new BadRequestException('El nombre del tipo de visitante no es válido.');
    }
    if (this.builtInKeys().includes(key)) {
      throw new BadRequestException('Ya existe un tipo de visitante predefinido con ese nombre.');
    }

    const current = await this.getCustomTypes(tenantId);
    if (current.some((t) => t.key === key)) {
      throw new BadRequestException('Ya existe un tipo de visitante personalizado con ese nombre.');
    }
    if (current.length >= MAX_CUSTOM_TYPES) {
      throw new BadRequestException(`Se alcanzó el máximo de ${MAX_CUSTOM_TYPES} tipos personalizados.`);
    }

    const updated = [...current, { key, label, icon }];
    await this.redis.set(this.redisKey(tenantId), JSON.stringify(updated));
    this.logger.log(`Tipo de visitante personalizado creado para tenant ${tenantId}: ${key} (${label})`);
    return updated;
  }

  async deleteCustomType(tenantId: string, key: string): Promise<CustomVisitorType[]> {
    if (this.builtInKeys().includes(key)) {
      throw new BadRequestException('No se pueden eliminar los tipos de visitante predefinidos.');
    }
    const current = await this.getCustomTypes(tenantId);
    const updated = current.filter((t) => t.key !== key);
    await this.redis.set(this.redisKey(tenantId), JSON.stringify(updated));

    // Limpia el default de auto-checkout asociado, si existía.
    const defaults = await this.autoCheckoutService.getVisitorTypeDefaults(tenantId);
    if (key in defaults) {
      const { [key]: _removed, ...rest } = defaults;
      await this.autoCheckoutService.saveVisitorTypeDefaults(tenantId, rest, true);
    }

    this.logger.log(`Tipo de visitante personalizado eliminado para tenant ${tenantId}: ${key}`);
    return updated;
  }
}
