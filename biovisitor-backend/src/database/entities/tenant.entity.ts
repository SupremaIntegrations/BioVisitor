/**
 * @file tenant.entity.ts
 * @description Entidad de Tenant (inquilino/cliente) para multi-tenancy.
 *
 * Cada tenant representa un cliente o sitio que usa el VMS.
 * Incluye su propia configuración de conexión a BioStar (URL, credenciales cifradas),
 * personalización de marca, y aislamiento completo de datos.
 *
 * @module database/entities
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';

/**
 * Plataforma de BioStar asociada al tenant.
 */
export enum BioStarPlatform {
  BIOSTAR_2 = 'BIOSTAR_2',
  BIOSTAR_X = 'BIOSTAR_X',
}

/**
 * Entidad Tenant - Representa un cliente/sitio del VMS.
 *
 * Cada tenant tiene aislamiento completo: sus propios visitantes,
 * visitas, usuarios operadores, y configuración de BioStar.
 * Las credenciales de BioStar se almacenan cifradas con AES-256-GCM.
 */
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre del cliente o sitio (ej: "Corporativo México DF") */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** Código único del tenant para uso interno (ej: "mx-df-corp") */
  @Column({ type: 'varchar', length: 100, unique: true })
  code: string;

  /** Plataforma de BioStar que utiliza este tenant */
  @Column({ type: 'enum', enum: BioStarPlatform })
  biostarPlatform: BioStarPlatform;

  /** URL base de la API de BioStar (ej: "https://192.168.1.10:2778") */
  @Column({ type: 'varchar', length: 500 })
  biostarApiUrl: string;

  /**
   * Credenciales cifradas con AES-256-GCM.
   * Formato almacenado: JSON cifrado con { loginId, password }
   * Se descifra en runtime con EncryptionService.
   */
  @Column({ type: 'text' })
  biostarCredentialsEncrypted: string;

  /** Ruta al certificado CA para la conexión SSL con BioStar */
  @Column({ type: 'varchar', length: 500, nullable: true })
  biostarCaCertPath: string;

  /**
   * Configuración de personalización de marca (JSON).
   * Incluye: logo, colores primarios/secundarios, nombre visible.
   * Por defecto usa los lineamientos de marca Suprema.
   */
  @Column({ type: 'jsonb', default: '{}' })
  brandingConfig: Record<string, unknown>;

  /** Zona horaria del sitio (ej: "America/Bogota") */
  @Column({ type: 'varchar', length: 100, default: 'America/Bogota' })
  timezone: string;

  /** Idioma por defecto del tenant */
  @Column({ type: 'varchar', length: 5, default: 'es' })
  defaultLanguage: string;

  /** Estado activo del tenant */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /** Capacidad máxima de visitantes simultáneos (para control de aforo) */
  @Column({ type: 'int', default: 500 })
  maxConcurrentVisitors: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
