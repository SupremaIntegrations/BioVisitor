/**
 * @file user.entity.ts
 * @description Entidad de Usuario del VMS (operadores, administradores, hosts).
 *
 * NO confundir con los visitantes. Esta entidad representa a las personas
 * que operan el sistema: recepcionistas, administradores y empleados
 * que reciben visitantes (hosts).
 *
 * Los passwords se almacenan con hash bcrypt (nunca en texto plano).
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

/**
 * Roles disponibles en el VMS.
 * Cada rol tiene permisos específicos definidos en los Guards.
 */
export enum UserRole {
  /** Acceso total: configuración, reportes, gestión de usuarios y tenants */
  ADMIN = 'ADMIN',
  /** Gestión de visitantes: check-in, check-out, pre-registro, impresión de badges */
  OPERATOR = 'OPERATOR',
  /** Solo puede ver sus propios visitantes agendados y aprobar pre-registros */
  HOST = 'HOST',
}

/**
 * Permisos granulares por módulo para usuarios OPERATOR.
 * Permite segmentar qué puede ver/hacer cada operador (recepción, seguridad, etc.).
 */
export interface OperatorPermissions {
  visitors:   { view: boolean; checkin: boolean; checkout: boolean; preregister: boolean; editVisitor: boolean };
  reports:    { view: boolean };
  accessLogs: { view: boolean };
  auditTrail: { view: boolean };
  settings:   { view: boolean };
}

/**
 * Configuración de ciberseguridad opcional por operador.
 * Todas las opciones vienen deshabilitadas por defecto.
 */
export interface OperatorSecurityConfig {
  mfaRequired:             boolean;
  ssoRequired:             boolean;
  passwordComplexity:      boolean;
  passwordExpiryDays:      number | null;
  maxFailedAttempts:       number | null;
  sessionTimeoutMinutes:   number | null;
  maxConcurrentSessions:   number | null;
  ipAllowlist:             string[];
}

/** Permisos por defecto para un OPERATOR nuevo */
export const DEFAULT_OPERATOR_PERMISSIONS: OperatorPermissions = {
  visitors:   { view: true, checkin: true, checkout: true, preregister: true, editVisitor: false },
  reports:    { view: false },
  accessLogs: { view: true },
  auditTrail: { view: false },
  settings:   { view: false },
};

/** Configuración de seguridad por defecto (todo deshabilitado) */
export const DEFAULT_SECURITY_CONFIG: OperatorSecurityConfig = {
  mfaRequired:           false,
  ssoRequired:           false,
  passwordComplexity:    false,
  passwordExpiryDays:    null,
  maxFailedAttempts:     null,
  sessionTimeoutMinutes: null,
  maxConcurrentSessions: null,
  ipAllowlist:           [],
};

/**
 * Entidad User - Usuarios operadores del VMS.
 *
 * Representa a recepcionistas, administradores y empleados
 * que interactúan con el sistema de control de visitantes.
 */
@Entity('users')
@Index(['tenantId', 'email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK al tenant al que pertenece este usuario */
  @Column({ type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  /** Email del usuario (único por tenant) */
  @Column({ type: 'varchar', length: 255 })
  email: string;

  /**
   * Hash bcrypt del password.
   * Nunca se almacena en texto plano.
   * El hash incluye salt automáticamente (bcrypt rounds: 12).
   */
  @Column({ type: 'varchar', length: 255 })
  passwordHash: string;

  /** Nombre completo del usuario */
  @Column({ type: 'varchar', length: 255 })
  fullName: string;

  /** Rol del usuario en el VMS */
  @Column({ type: 'enum', enum: UserRole, default: UserRole.OPERATOR })
  role: UserRole;

  /** Departamento o área al que pertenece (relevante para hosts) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  department: string;

  /** Teléfono de contacto */
  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string;

  /** Notas internas del administrador sobre este operador */
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Idioma preferido del usuario */
  @Column({ type: 'varchar', length: 5, default: 'es' })
  language: string;

  /** Estado activo del usuario */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /**
   * Permisos granulares por módulo (solo aplica a OPERATOR).
   * Almacenado como JSONB. Nulo para ADMIN y HOST.
   */
  @Column({ type: 'jsonb', nullable: true })
  permissions: OperatorPermissions | null;

  /**
   * IDs de sedes/edificios a los que tiene acceso este operador.
   * Array vacío = acceso a todas las sedes del tenant.
   */
  @Column({ type: 'jsonb', nullable: true, default: '[]' })
  allowedSites: string[];

  /**
   * Configuración de ciberseguridad del operador.
   * Todas las opciones son opcionales y vienen deshabilitadas por defecto.
   */
  @Column({ type: 'jsonb', nullable: true })
  securityConfig: OperatorSecurityConfig | null;

  /** El operador debe cambiar su contraseña en el próximo login */
  @Column({ type: 'boolean', default: false })
  mustChangePassword: boolean;

  /** Fecha del último cambio de contraseña */
  @Column({ type: 'timestamptz', nullable: true })
  passwordChangedAt: Date | null;

  /** Último login exitoso (para auditoría) */
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date;

  /** Número de intentos de login fallidos consecutivos (para bloqueo de cuenta) */
  @Column({ type: 'int', default: 0 })
  failedLoginAttempts: number;

  /** Fecha de bloqueo de cuenta (si excede max intentos fallidos) */
  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
