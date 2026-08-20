/**
 * @file visitor-vehicle.entity.ts
 * @description Entidad de Vehículos del Visitante.
 *
 * Registra los vehículos que un visitante declara al ingresar para
 * controlar su ingreso al parqueadero y verificarlos a la salida.
 * Diseñado para soportar integración futura con cámaras LPR.
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
import { Visit } from './visit.entity';
import { Visitor } from './visitor.entity';

/**
 * Tipos de vehículo soportados.
 */
export enum VehicleType {
  CAR        = 'CAR',
  MOTORCYCLE = 'MOTORCYCLE',
  TRUCK      = 'TRUCK',
  BICYCLE    = 'BICYCLE',
  OTHER      = 'OTHER',
}

/**
 * Entidad VisitorVehicle - Vehículo declarado por el visitante al ingresar.
 *
 * Vinculado a la instancia de la visita (no al perfil permanente del visitante).
 * Permite al recepcionista verificar a la salida que el vehículo registrado
 * es el que sale. Soporta el flujo donde el vehículo ingresa antes que el
 * visitante al lobby (hasEntered), preparado para integración LPR.
 */
@Entity('visitor_vehicles')
@Index(['visitId'])
@Index(['tenantId'])
@Index(['licensePlate', 'tenantId'])
export class VisitorVehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK a la visita en la que se declaró el vehículo */
  @Column({ type: 'uuid' })
  visitId: string;

  @ManyToOne(() => Visit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'visitId' })
  visit: Visit;

  /** FK al visitante dueño del vehículo */
  @Column({ type: 'uuid' })
  visitorId: string;

  @ManyToOne(() => Visitor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'visitorId' })
  visitor: Visitor;

  /** FK al tenant */
  @Column({ type: 'uuid' })
  tenantId: string;

  /**
   * Placa del vehículo normalizada (sin espacios, mayúsculas).
   * Indexada para búsquedas rápidas e integración futura LPR.
   * Ejemplo: "ABC123", "SWB042"
   */
  @Column({ type: 'varchar', length: 20 })
  licensePlate: string;

  /** Marca del vehículo (opcional). Ej: "Toyota", "Chevrolet" */
  @Column({ type: 'varchar', length: 100, nullable: true })
  brand: string | null;

  /** Modelo del vehículo (opcional). Ej: "Corolla", "Spark" */
  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  /** Color del vehículo (opcional). Ej: "Blanco", "Negro" */
  @Column({ type: 'varchar', length: 50, nullable: true })
  color: string | null;

  /** Tipo de vehículo */
  @Column({ type: 'enum', enum: VehicleType, default: VehicleType.CAR })
  vehicleType: VehicleType;

  /**
   * Zona o número de parqueadero asignado (opcional).
   * Ej: "P1-A3", "Sótano 2", "Visitantes"
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  parkingZone: string | null;

  /**
   * Indica si el vehículo ya ingresó al parqueadero.
   * Soporta el flujo donde el conductor llega antes al parqueadero
   * y el visitante sube al lobby después.
   * También para integración futura con cámaras LPR.
   */
  @Column({ type: 'boolean', default: false })
  hasEntered: boolean;

  /**
   * Indica si el recepcionista verificó el vehículo al check-out.
   * false = pendiente, true = vehículo confirmado en salida.
   */
  @Column({ type: 'boolean', default: false })
  verifiedAtCheckout: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
