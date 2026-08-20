/**
 * @file audit-log.entity.ts
 * @description Entidad de Log de Auditoría - Registro inmutable de toda acción del sistema.
 *
 * Esta tabla es APPEND-ONLY (solo inserción, nunca actualización ni borrado).
 * Cumple con requisitos de auditoría enterprise y compliance de seguridad.
 *
 * Registra: acciones de usuarios, eventos de seguridad, fallos operacionales,
 * intentos de acceso no autorizados, cambios de configuración, y más.
 *
 * Compatible con el StructuredLoggerService que escribe tanto a archivos
 * Winston como a esta tabla para consultas administrativas.
 *
 * @module database/entities
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Entidad AuditLog - Registro inmutable de auditoría.
 *
 * Índices optimizados para las consultas más comunes:
 * - Por tenant y fecha (reportes de actividad)
 * - Por usuario (supervisión de operadores)
 * - Por acción (búsqueda de eventos específicos)
 */
@Entity('audit_logs')
@Index(['tenantId', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['action'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * FK al tenant (no se usa foreign key para performance en inserciones masivas).
   * Nullable porque algunos eventos de sistema (ej: login con email inexistente,
   * intentos fallidos antes de resolver el tenant) no tienen un tenant asociado.
   */
  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

  /** ID del usuario que realizó la acción (puede ser 'system' para acciones automáticas) */
  @Column({ type: 'varchar', length: 255 })
  userId: string;

  /** Nombre del usuario en el momento de la acción (desnormalizado para consulta rápida) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  userName: string;

  /**
   * Categoría del evento (USER_ACTION, OPERATIONAL, AUDIT_EVENT).
   * Permite filtrar rápidamente los tipos de eventos en reportes.
   */
  @Column({ type: 'varchar', length: 50 })
  category: string;

  /**
   * Acción específica realizada.
   * Formato: entity.action (ej: 'visitor.create', 'auth.login_failed', 'biostar.sync_error')
   */
  @Column({ type: 'varchar', length: 255 })
  action: string;

  /** Tipo de entidad afectada (visitor, visit, user, tenant, etc.) */
  @Column({ type: 'varchar', length: 100, nullable: true })
  entityType: string;

  /** ID de la entidad afectada */
  @Column({ type: 'varchar', length: 255, nullable: true })
  entityId: string;

  /** Detalles adicionales del evento en formato JSON */
  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, unknown>;

  /** Dirección IP desde la que se realizó la acción */
  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string;

  /** User-Agent del navegador/cliente */
  @Column({ type: 'varchar', length: 500, nullable: true })
  userAgent: string;

  /** ID de correlación para rastrear flujos completos */
  @Column({ type: 'varchar', length: 100, nullable: true })
  correlationId: string;

  /**
   * Timestamp de creación (inmutable).
   * Se usa timestamptz para soporte correcto de zonas horarias.
   */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
