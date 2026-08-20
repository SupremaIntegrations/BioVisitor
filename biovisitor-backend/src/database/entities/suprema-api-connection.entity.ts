/**
 * @file suprema-api-connection.entity.ts
 * @description Entidad para gestionar múltiples conexiones a la API de Suprema BioStar.
 *
 * Permite al sistema administrar N conexiones simultáneas a servidores BioStar 2
 * y/o BioStar X. Cada conexión almacena sus credenciales cifradas con AES-256-GCM.
 *
 * Casos de uso:
 * - Un cliente con múltiples edificios, cada uno con su propio servidor BioStar.
 * - Entornos mixtos con BioStar 2 y BioStar X corriendo simultáneamente.
 * - Migración gradual de BioStar 2 a BioStar X.
 *
 * Las credenciales NUNCA se almacenan en texto plano.
 * El campo loginIdEncrypted y passwordEncrypted se cifran con EncryptionService (AES-256-GCM)
 * antes de persistir y se descifran solo en runtime para usarlas.
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
import { BioStarPlatform } from './tenant.entity';

/**
 * Estado de la última prueba de conexión.
 */
export enum ConnectionTestStatus {
  /** Nunca probada */
  NEVER_TESTED = 'NEVER_TESTED',
  /** Última prueba exitosa */
  SUCCESS = 'SUCCESS',
  /** Última prueba fallida */
  FAILED = 'FAILED',
  /** Prueba en progreso */
  PENDING = 'PENDING',
}

/**
 * Entidad SupremaApiConnection - Representa una conexión configurada a BioStar 2 o X.
 *
 * Una instalación puede tener múltiples conexiones activas al mismo tiempo,
 * permitiendo arquitecturas multi-sitio y entornos mixtos de plataformas Suprema.
 */
@Entity('suprema_api_connections')
@Index(['tenantId', 'name'], { unique: true, where: '"tenantId" IS NOT NULL' })
export class SupremaApiConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * FK opcional al tenant.
   * Si es null, la conexión es de nivel global (sistema).
   */
  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

  @ManyToOne(() => Tenant, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant | null;

  /**
   * Nombre descriptivo para identificar esta conexión.
   * Ej: "Servidor Principal - Edificio A", "BioStar X - HQ", "BS2 Legacy"
   */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  /**
   * Descripción opcional para documentar el propósito de esta conexión.
   */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * Plataforma Suprema a la que apunta esta conexión.
   */
  @Column({ type: 'enum', enum: BioStarPlatform })
  platform: BioStarPlatform;

  /**
   * URL base del servidor BioStar.
   * Formato: https://[IP|Dominio][:Puerto]
   * El puerto por defecto del Unified Gateway es 443.
   * Ejemplo: "https://192.168.10.50:443" o "https://biostar.miempresa.com"
   */
  @Column({ type: 'varchar', length: 500 })
  apiUrl: string;

  /**
   * Login ID cifrado con AES-256-GCM.
   * Formato almacenado: "iv_hex:ciphertext_hex:authtag_hex"
   * Se descifra solo en runtime con EncryptionService.
   */
  @Column({ type: 'text' })
  loginIdEncrypted: string;

  /**
   * Password cifrado con AES-256-GCM.
   * Formato almacenado: "iv_hex:ciphertext_hex:authtag_hex"
   * Se descifra solo en runtime con EncryptionService.
   */
  @Column({ type: 'text' })
  passwordEncrypted: string;

  /**
   * Ruta opcional al certificado CA para verificación SSL.
   * Si no se provee, la conexión se realiza sin verificar el certificado del servidor
   * (solo aceptable en entornos de desarrollo o redes cerradas).
   * En producción se recomienda siempre proveer el CA.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  caCertPath: string | null;

  /**
   * Si esta conexión está activa y puede ser usada por el gateway.
   */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /**
   * Timestamp de la última prueba de conexión ejecutada.
   */
  @Column({ type: 'timestamptz', nullable: true })
  lastTestedAt: Date | null;

  /**
   * Estado del resultado de la última prueba.
   */
  @Column({
    type: 'enum',
    enum: ConnectionTestStatus,
    default: ConnectionTestStatus.NEVER_TESTED,
  })
  lastTestStatus: ConnectionTestStatus;

  /**
   * Mensaje detallado de la última prueba (éxito o error).
   * En caso de éxito: versión del servidor, licencias activas, etc.
   * En caso de error: mensaje de error descriptivo.
   */
  @Column({ type: 'text', nullable: true })
  lastTestMessage: string | null;

  /**
   * Metadatos adicionales descubiertos en la última prueba exitosa.
   * Puede incluir: versión del servidor, número de licencias, features activos.
   */
  @Column({ type: 'jsonb', nullable: true })
  serverMetadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
