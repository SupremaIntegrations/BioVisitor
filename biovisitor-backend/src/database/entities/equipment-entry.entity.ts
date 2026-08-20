/**
 * @file equipment-entry.entity.ts
 * @description Entidad de Registro y Control de Ingreso de Equipos.
 *
 * Registra todos los equipos (laptops, cámaras, almacenamiento, etc.)
 * que ingresan a las instalaciones. Soporta flujo de pre-autorización,
 * alertas de overtime y trazabilidad completa.
 *
 * @module database/entities
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum EquipmentCategory {
  LAPTOP    = 'LAPTOP',
  TABLET    = 'TABLET',
  PHONE     = 'PHONE',
  CAMERA    = 'CAMERA',
  STORAGE   = 'STORAGE',
  TOOL      = 'TOOL',
  BIOMETRIC = 'BIOMETRIC',
  OTHER     = 'OTHER',
}

export enum EquipmentStatus {
  PENDING_AUTH = 'PENDING_AUTH',
  AUTHORIZED   = 'AUTHORIZED',
  INSIDE       = 'INSIDE',
  EXITED       = 'EXITED',
  REJECTED     = 'REJECTED',
}

@Entity('equipment_entries')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'entryAt'])
@Index(['serialNumber', 'tenantId'])
export class EquipmentEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Número de serie — normalizado a uppercase antes de persistir */
  @Column({ type: 'varchar', length: 100 })
  serialNumber: string;

  @Column({ type: 'varchar', length: 80 })
  brand: string;

  @Column({ type: 'varchar', length: 120 })
  model: string;

  @Column({ type: 'enum', enum: EquipmentCategory, default: EquipmentCategory.OTHER })
  category: EquipmentCategory;

  /** Nombre completo del responsable portador */
  @Column({ type: 'varchar', length: 200 })
  responsibleName: string;

  /** Visita asociada (opcional — puede ser acceso directo sin visita) */
  @Column({ type: 'uuid', nullable: true })
  visitId: string | null;

  /** Área o departamento que autoriza el equipo (texto libre) */
  @Column({ type: 'varchar', length: 200 })
  hostArea: string;

  @Column({ type: 'timestamptz' })
  entryAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  exitAt: Date | null;

  @Column({ type: 'enum', enum: EquipmentStatus, default: EquipmentStatus.INSIDE })
  status: EquipmentStatus;

  /** Código de autorización previa (referencia externa) */
  @Column({ type: 'varchar', length: 80, nullable: true })
  authorizationCode: string | null;

  /** ID del usuario que autorizó el ingreso (SUPERVISOR/ADMIN) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  authorizedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  authorizedAt: Date | null;

  /** Motivo de rechazo cuando status = REJECTED */
  @Column({ type: 'varchar', length: 500, nullable: true })
  rejectedReason: string | null;

  /** Ruta de la foto del equipo tomada al ingresar */
  @Column({ type: 'varchar', length: 500, nullable: true })
  photoPath: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Horas máximas permitidas antes de alertar overtime (default 8h) */
  @Column({ type: 'int', default: 8 })
  maxStayHours: number;

  /** Flag para evitar enviar alertas de overtime repetidas */
  @Column({ type: 'boolean', default: false })
  overtimeAlertSent: boolean;

  /** Tenant owner */
  @Column({ type: 'uuid' })
  tenantId: string;

  /** Operador que registró el ingreso */
  @Column({ type: 'varchar', length: 255 })
  createdById: string;

  /** Nombre del operador (desnormalizado para reportes rápidos) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  createdByName: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
