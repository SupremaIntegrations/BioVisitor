/**
 * @file visitor-asset.entity.ts
 * @description Entidad de Activos del Visitante.
 *
 * Registra los equipos y activos que un visitante declara al ingresar
 * (laptops, tablets, cámaras, herramientas, etc.) para verificarlos
 * al momento del check-out y garantizar que no salgan con activos no declarados.
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
import { Visitor } from './visitor.entity';

/**
 * Categorías de activos que puede traer un visitante.
 */
export enum AssetCategory {
  LAPTOP    = 'LAPTOP',
  TABLET    = 'TABLET',
  PHONE     = 'PHONE',
  CAMERA    = 'CAMERA',
  TOOL      = 'TOOL',
  USB_DRIVE = 'USB_DRIVE',
  OTHER     = 'OTHER',
}

/**
 * Entidad VisitorAsset - Activo declarado por el visitante al ingresar.
 *
 * Asociado a una visita específica. Al checkout, el recepcionista marca
 * cada activo como verificado para confirmar que el visitante sale con
 * los mismos equipos con los que entró.
 */
@Entity('visitor_assets')
@Index(['visitId'])
@Index(['tenantId'])
export class VisitorAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK a la visita en la que se declaró el activo */
  @Column({ type: 'uuid' })
  visitId: string;

  @ManyToOne(() => Visit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'visitId' })
  visit: Visit;

  /** FK al visitante dueño del activo */
  @Column({ type: 'uuid' })
  visitorId: string;

  @ManyToOne(() => Visitor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'visitorId' })
  visitor: Visitor;

  /** FK al tenant */
  @Column({ type: 'uuid' })
  tenantId: string;

  /** Descripción del activo (ej: "Laptop Dell XPS 15") */
  @Column({ type: 'varchar', length: 500 })
  description: string;

  /**
   * Número de serie o identificador del activo.
   * Opcional, pero recomendado para activos de alto valor.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  serialNumber: string | null;

  /** Categoría del activo */
  @Column({ type: 'enum', enum: AssetCategory, default: AssetCategory.OTHER })
  category: AssetCategory;

  /**
   * Indica si el activo fue verificado por el recepcionista al check-out.
   * false = pendiente de verificación, true = verificado y autorizado para salida.
   */
  @Column({ type: 'boolean', default: false })
  verifiedAtCheckout: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
