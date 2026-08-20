/**
 * @file blacklist.entity.ts
 * @description Entidad de Lista Negra de visitantes bloqueados.
 *
 * Permite a los administradores bloquear visitantes específicos.
 * Cuando un visitante en la lista negra intenta hacer check-in,
 * el sistema genera una alerta y bloquea el acceso.
 *
 * El bloqueo puede ser permanente o temporal (con fecha de expiración).
 *
 * @module database/entities
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Visitor } from './visitor.entity';
import { User } from './user.entity';

/**
 * Entidad Blacklist - Visitantes bloqueados.
 */
@Entity('blacklist')
@Index(['tenantId', 'visitorId'], { unique: true })
export class Blacklist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK al tenant */
  @Column({ type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  /** FK al visitante bloqueado */
  @Column({ type: 'uuid' })
  visitorId: string;

  @ManyToOne(() => Visitor)
  @JoinColumn({ name: 'visitorId' })
  visitor: Visitor;

  /** Motivo del bloqueo */
  @Column({ type: 'text' })
  reason: string;

  /** ID del usuario que realizó el bloqueo */
  @Column({ type: 'uuid' })
  blockedByUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'blockedByUserId' })
  blockedByUser: User;

  /** Fecha y hora del bloqueo */
  @CreateDateColumn({ type: 'timestamptz' })
  blockedAt: Date;

  /**
   * Fecha de expiración del bloqueo (null = permanente).
   * Útil para bloqueos temporales (ej: 30 días).
   */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date;

  /** Estado activo del bloqueo */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
