/**
 * @file visitor.entity.ts
 * @description Entidad de Visitante - Persona que visita las instalaciones.
 *
 * Esta entidad almacena los datos personales del visitante de forma REUTILIZABLE.
 * Un visitante puede tener múltiples visitas a lo largo del tiempo sin necesidad
 * de re-registrarse, lo que mejora la experiencia del visitante recurrente.
 *
 * Los datos sensibles (documentos, fotos) se almacenan en tablas separadas
 * siguiendo el principio de Data Minimization.
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
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';

/**
 * Tipo de documento de identidad del visitante.
 */
export enum DocumentType {
  /** Cédula de ciudadanía (Colombia, Ecuador, etc.) */
  NATIONAL_ID = 'NATIONAL_ID',
  /** Pasaporte */
  PASSPORT = 'PASSPORT',
  /** Cédula de extranjería */
  FOREIGN_ID = 'FOREIGN_ID',
  /** Licencia de conducción */
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
  /** Otro tipo de documento */
  OTHER = 'OTHER',
}

/**
 * Entidad Visitor - Datos personales de la persona que visita.
 *
 * Separada de Visit para permitir visitantes recurrentes sin re-registro.
 * Los datos biométricos NO se almacenan aquí — se gestionan a través
 * de BioStar 2/X y solo se mantiene una referencia (supremaRefId) en Visit.
 */
@Entity('visitors')
@Index(['tenantId', 'documentNumber'], { unique: true })
export class Visitor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK al tenant */
  @Column({ type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  /** Tipo de documento de identidad */
  @Column({
    type: 'enum',
    enum: DocumentType,
    default: DocumentType.NATIONAL_ID,
  })
  documentType: DocumentType;

  /** Número de documento de identidad (único por tenant) */
  @Column({ type: 'varchar', length: 50 })
  documentNumber: string;

  /** Nombre(s) del visitante */
  @Column({ type: 'varchar', length: 255 })
  firstName: string;

  /** Apellido(s) del visitante */
  @Column({ type: 'varchar', length: 255 })
  lastName: string;

  /** Email del visitante (para envío de QR y pre-registro) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string;

  /** Teléfono del visitante */
  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string;

  /** Empresa u organización del visitante */
  @Column({ type: 'varchar', length: 255, nullable: true })
  company: string;

  /** Cargo o posición del visitante */
  @Column({ type: 'varchar', length: 255, nullable: true })
  position: string;

  /** Nacionalidad del visitante (código ISO 3166-1 alpha-2, ej: "CO", "US") */
  @Column({ type: 'varchar', length: 5, nullable: true })
  nationality: string;

  /** Fecha de nacimiento */
  @Column({ type: 'date', nullable: true })
  dateOfBirth: Date;

  /**
   * Ruta a la foto del visitante (almacenada en el servidor VMS).
   * La foto se captura vía webcam en recepción o se sube en pre-registro.
   * Se almacena localmente por Data Minimization (no se envía a servicios externos).
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  photoPath: string;

  /**
   * Datos adicionales capturados vía OCR del documento (JSON).
   * Ej: { "mrz": "...", "expiryDate": "...", "issuingCountry": "CO" }
   */
  @Column({ type: 'jsonb', nullable: true })
  ocrData: Record<string, unknown>;

  /** Estado activo del visitante (false si fue eliminado lógicamente) */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
