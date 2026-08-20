/**
 * @file host.entity.ts
 * @description Entidad Host - Empleados que pueden recibir visitantes.
 *
 * Un Host es cualquier persona interna que figura como anfitrión de una visita.
 * Puede originarse desde dos fuentes:
 *   1. LOCAL: Creado manualmente en el VMS (sin integración BioStar).
 *   2. SUPREMA: Importado desde el directorio de usuarios de BioStar 2 / BioStar X.
 *
 * A diferencia de la entidad `User` (que requiere credenciales de login al VMS),
 * un Host no necesita acceder al sistema — es solo un contacto de referencia
 * que aparece en el formulario de visitas y en los reportes.
 *
 * Si el host también opera el VMS, se puede vincular a un `User` mediante `userId`.
 *
 * @module database/entities
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';

export enum HostSource {
  /** Creado manualmente en el VMS local */
  LOCAL = 'LOCAL',
  /** Importado desde BioStar 2 */
  BIOSTAR2 = 'BIOSTAR2',
  /** Importado desde BioStar X */
  BIOSTAR_X = 'BIOSTAR_X',
}

/**
 * Entidad Host - Anfitriones de visitantes.
 *
 * Almacena la información de contacto de los empleados que reciben visitantes.
 * Soporta sincronización bidireccional con el directorio de BioStar.
 */
@Entity('hosts')
@Index(['tenantId', 'email'])
@Index(['tenantId', 'supremaUserId'])
@Index(['tenantId', 'isActive'])
export class Host {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK al tenant */
  @Column({ type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  // ─── Datos personales ──────────────────────────────────────────────────────

  /** Nombre completo del anfitrión */
  @Column({ type: 'varchar', length: 255 })
  fullName: string;

  /** Email de contacto (único por tenant, opcional) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  /** Teléfono de contacto */
  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  /** Departamento o área de la empresa */
  @Column({ type: 'varchar', length: 255, nullable: true })
  department: string | null;

  /** Cargo o título profesional */
  @Column({ type: 'varchar', length: 255, nullable: true })
  jobTitle: string | null;

  // ─── Origen y estado ───────────────────────────────────────────────────────

  /** Origen del registro: creado localmente o importado desde Suprema */
  @Column({ type: 'enum', enum: HostSource, default: HostSource.LOCAL })
  source: HostSource;

  /** Si el host está activo y puede aparecer en el selector de visitas */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  // ─── Integración Suprema BioStar ───────────────────────────────────────────

  /**
   * ID del usuario en BioStar (campo `user_id` de la API).
   * Nulo si el host es LOCAL y no está sincronizado con BioStar.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  supremaUserId: string | null;

  /**
   * Login ID en BioStar (campo `login_id` de la API).
   * Solo útil si el host también inicia sesión en BioStar.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  supremaLoginId: string | null;

  /**
   * ID de la conexión Suprema por la que fue importado.
   * FK soft a `suprema_api_connections.id`.
   */
  @Column({ type: 'uuid', nullable: true })
  supremaConnectionId: string | null;

  /**
   * Estado de la última sincronización con BioStar.
   * 'SYNCED' | 'PENDING' | 'FAILED' | null
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  syncStatus: string | null;

  /** Fecha de la última sincronización exitosa */
  @Column({ type: 'timestamptz', nullable: true })
  lastSyncAt: Date | null;

  /** Mensaje de error de la última sincronización fallida */
  @Column({ type: 'text', nullable: true })
  lastSyncError: string | null;

  // ─── Vínculo opcional con cuenta VMS ──────────────────────────────────────

  /**
   * UUID del User si el host también tiene acceso al VMS.
   * Relación opcional — la mayoría de los hosts no necesitan login.
   */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  // ─── Timestamps ────────────────────────────────────────────────────────────

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
