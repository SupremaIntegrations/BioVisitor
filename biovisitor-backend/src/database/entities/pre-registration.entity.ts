/**
 * @file pre-registration.entity.ts
 * @description Entidad de Pre-Registro de visitantes.
 *
 * Gestiona el flujo de pre-registro remoto:
 * 1. Un host agenda una visita y genera un link de pre-registro único.
 * 2. El visitante recibe el link por email y completa el formulario.
 * 3. Al completar, el visitante queda en estado PRE_REGISTERED.
 * 4. Cuando llega a recepción, el operador solo necesita confirmar datos y hacer check-in.
 *
 * El token es un UUID único que se incluye en la URL del portal de pre-registro.
 * Tiene fecha de expiración para evitar accesos tardíos.
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
import { Visit } from './visit.entity';

/**
 * Entidad PreRegistration - Datos del proceso de pre-registro remoto.
 */
@Entity('pre_registrations')
@Index(['token'], { unique: true })
export class PreRegistration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK a la visita asociada */
  @Column({ type: 'uuid' })
  visitId: string;

  @ManyToOne(() => Visit)
  @JoinColumn({ name: 'visitId' })
  visit: Visit;

  /**
   * Token UUID único para el link de pre-registro.
   * La URL será: {frontendUrl}/pre-register/{token}
   */
  @Column({ type: 'uuid' })
  token: string;

  /** Si el visitante completó el formulario de datos personales */
  @Column({ type: 'boolean', default: false })
  formCompleted: boolean;

  /** Si el visitante subió/capturó una fotografía */
  @Column({ type: 'boolean', default: false })
  photoUploaded: boolean;

  /** Fecha de expiración del link de pre-registro */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Datos adicionales enviados por el visitante en el formulario (JSON) */
  @Column({ type: 'jsonb', nullable: true })
  formData: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
