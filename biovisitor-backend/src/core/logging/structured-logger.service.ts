/**
 * @file structured-logger.service.ts
 * @description Sistema de logging estructurado con 3 categorías: USER_ACTION, OPERATIONAL, AUDIT_EVENT.
 *
 * Este servicio implementa un logging de nivel enterprise que cumple con requisitos de:
 * - Auditoría de seguridad (quién hizo qué, cuándo, desde dónde)
 * - Monitoreo operativo (fallos de sistema, timeouts, errores de conexión con BioStar)
 * - Trazabilidad de acciones de usuario (para supervisión administrativa)
 *
 * Persistencia dual:
 * 1. Archivos rotativos en disco (Winston transports) para acceso inmediato
 * 2. Tabla audit_logs en PostgreSQL para consultas y reportes del administrador
 *
 * El formato JSON estructurado es compatible con ELK Stack (Elasticsearch, Logstash, Kibana)
 * o cualquier SIEM (Security Information and Event Management) para análisis avanzado.
 *
 * Cada entrada de log incluye un correlationId para rastrear flujos completos
 * (ej: todo el flujo de check-in de un visitante desde la creación hasta la sincronización con BioStar).
 *
 * @module core/logging
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { User } from '../../database/entities/user.entity';
import * as winston from 'winston';
import * as path from 'path';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Categorías de log del sistema.
 * Cada categoría tiene un propósito específico de auditoría.
 */
export enum LogCategory {
  /** Acciones realizadas por usuarios del VMS (operadores, admins, hosts) */
  USER_ACTION = 'USER_ACTION',
  /** Fallos operacionales del sistema (timeouts, errores de red, fallos de BioStar) */
  OPERATIONAL = 'OPERATIONAL',
  /** Eventos de seguridad auditables (logins, cambios de permisos, accesos a datos sensibles) */
  AUDIT_EVENT = 'AUDIT_EVENT',
}

/**
 * Interfaz para una entrada de log estructurada.
 * Todos los campos son opcionales excepto category y action,
 * lo que permite flexibilidad sin perder estructura.
 */
export interface StructuredLogEntry {
  /** Categoría del log (USER_ACTION, OPERATIONAL, AUDIT_EVENT) */
  category: LogCategory;
  /** Acción realizada (ej: 'visitor.create', 'auth.login_failed', 'biostar.sync_error') */
  action: string;
  /** ID del tenant (para multi-tenancy) */
  tenantId?: string;
  /** ID del usuario que realizó la acción */
  userId?: string;
  /** Nombre del usuario (para lectura humana en logs) */
  userName?: string;
  /** Tipo de entidad afectada (visitor, visit, user, access_credential, etc.) */
  entityType?: string;
  /** ID de la entidad afectada */
  entityId?: string;
  /** Detalles adicionales en formato libre (JSON serializable) */
  details?: Record<string, unknown>;
  /** Dirección IP del cliente */
  ipAddress?: string;
  /** User-Agent del navegador/cliente */
  userAgent?: string;
  /** ID de correlación para rastrear flujos completos */
  correlationId?: string;
  /** Nivel de severidad (override del nivel por defecto de la categoría) */
  level?: 'info' | 'warn' | 'error' | 'debug';
}

/**
 * Servicio de logging estructurado para el VMS.
 *
 * Utiliza Winston para escritura en archivos con rotación,
 * y opcionalmente persiste en PostgreSQL a través del módulo de auditoría.
 */
@Injectable()
export class StructuredLoggerService {
  private readonly logger = new Logger(StructuredLoggerService.name);
  private readonly winstonLogger: winston.Logger;

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    // Directorio de logs: se crea automáticamente si no existe
    const logDir = path.join(process.cwd(), 'logs');

    this.winstonLogger = winston.createLogger({
      level: 'info',
      // Formato JSON estructurado para compatibilidad con ELK/SIEM
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
        winston.format.json(),
      ),
      defaultMeta: { service: 'biovisitor-x' },
      transports: [
        // Transport 1: Archivo rotativo para TODOS los logs
        new winston.transports.File({
          filename: path.join(logDir, 'combined.log'),
          maxsize: 10 * 1024 * 1024, // 10 MB por archivo
          maxFiles: 30, // Mantener últimos 30 archivos (≈300 MB máx)
        }),
        // Transport 2: Archivo separado solo para errores operacionales
        new winston.transports.File({
          filename: path.join(logDir, 'errors.log'),
          level: 'error',
          maxsize: 10 * 1024 * 1024,
          maxFiles: 30,
        }),
        // Transport 3: Archivo separado para eventos de auditoría de seguridad
        new winston.transports.File({
          filename: path.join(logDir, 'audit.log'),
          maxsize: 10 * 1024 * 1024,
          maxFiles: 90, // Más retención para auditoría (≈900 MB, ~3 meses)
        }),
      ],
    });

    // En desarrollo, también mostrar en consola con formato legible
    if (process.env.NODE_ENV !== 'production') {
      this.winstonLogger.add(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(
              ({ timestamp, level, category, action, message, ...meta }) => {
                const categoryTag = `[${category || 'SYSTEM'}]`;
                const actionTag = action ? ` ${action}` : '';
                return `${timestamp} ${level} ${categoryTag}${actionTag}: ${message || ''} ${
                  Object.keys(meta).length > 2
                    ? JSON.stringify(meta, null, 0)
                    : ''
                }`;
              },
            ),
          ),
        }),
      );
    }

    this.logger.log(
      '📋 Sistema de logging estructurado inicializado (3 categorías, persistencia dual).',
    );
  }

  /**
   * Registra un evento estructurado en el sistema de logging.
   *
   * @param entry - Entrada de log estructurada con categoría, acción y detalles
   */
  log(entry: StructuredLogEntry): void {
    // Determinar el nivel de log según la categoría si no se especifica explícitamente
    const level = entry.level || this.getDefaultLevel(entry.category);

    const correlationId = entry.correlationId || this.generateCorrelationId();

    const logData = {
      level,
      category: entry.category,
      action: entry.action,
      tenantId: entry.tenantId || 'system',
      userId: entry.userId || 'system',
      userName: entry.userName || undefined,
      entityType: entry.entityType || undefined,
      entityId: entry.entityId || undefined,
      details: entry.details || {},
      ipAddress: entry.ipAddress || undefined,
      userAgent: entry.userAgent || undefined,
      correlationId: correlationId,
      message: this.buildMessage(entry),
    };

    // 1. Escribir en archivos Winston (SIEM / ELK)
    this.winstonLogger.log(logData);

    // 2. Persistencia en DB para auditoría (solo para eventos críticos y acciones)
    if (
      entry.category === LogCategory.AUDIT_EVENT ||
      entry.category === LogCategory.USER_ACTION
    ) {
      // Se ejecuta de manera asíncrona ("fire and forget") para no bloquear el flujo principal.
      // Si tenantId es 'system', en DB guardamos null porque es UUID
      const tenantIdForDb =
        logData.tenantId === 'system' ? null : logData.tenantId;

      (async () => {
        // Si el llamador no proporcionó userName explícitamente, se intenta
        // resolver automáticamente desde la tabla de usuarios por userId.
        // Esto evita que la columna "Quién" del audit trail muestre UUIDs crudos
        // cuando alguno de los ~40 call-sites de logUserAction/logAuditEvent
        // omite el nombre.
        let userName = logData.userName;
        if (!userName) {
          userName = await this.resolveUserName(logData.userId);
        }

        return this.auditLogRepo.insert({
          tenantId: tenantIdForDb as any,
          userId: logData.userId,
          userName,
          category: logData.category,
          action: logData.action,
          entityType: logData.entityType,
          entityId: logData.entityId,
          details: logData.details as any, // Cast to any to satisfy TypeORM deep partial JSON constraints
          ipAddress: logData.ipAddress,
          userAgent: logData.userAgent,
          correlationId: logData.correlationId,
        });
      })().catch((err) => {
        // Si la BD falla, se registra en el log Winston de errores operacionales.
        // IMPORTANTE: no se debe lanzar excepción para evitar interrumpir el flujo seguro.
        this.winstonLogger.log({
          level: 'error',
          category: LogCategory.OPERATIONAL,
          action: 'logging.db_persist_failed',
          message: 'Fallo al guardar log de auditoría en Base de Datos',
          details: {
            error: err.message,
            correlationId: logData.correlationId,
          },
        });
      });
    }
  }

  /**
   * Resuelve el nombre legible de un usuario a partir de su userId (UUID).
   *
   * Se usa como fallback cuando un call-site de logUserAction/logAuditEvent
   * omite el parámetro userName, para que el audit trail nunca muestre
   * un UUID crudo en la columna "Quién". Cachea en memoria por request-lifetime
   * no es necesario dado el bajo volumen; se consulta directo a la BD.
   */
  private async resolveUserName(
    userId: string | undefined,
  ): Promise<string | undefined> {
    if (!userId || userId === 'system' || !UUID_REGEX.test(userId)) {
      return undefined;
    }
    try {
      const user = await this.userRepo.findOne({
        where: { id: userId },
        select: ['id', 'fullName', 'email'],
      });
      return user ? user.fullName || user.email : undefined;
    } catch {
      // Si la consulta falla (p.ej. BD no disponible momentáneamente),
      // no se debe interrumpir la persistencia del audit log.
      return undefined;
    }
  }

  /**
   * Shortcut para registrar una acción de usuario.
   */
  logUserAction(
    action: string,
    userId: string,
    details?: Record<string, unknown>,
    tenantId?: string,
    entityType?: string,
    entityId?: string,
    userName?: string,
  ): void {
    this.log({
      category: LogCategory.USER_ACTION,
      action,
      userId,
      userName,
      tenantId,
      entityType,
      entityId,
      details,
    });
  }

  /**
   * Shortcut para registrar un evento operacional exitoso o informativo.
   */
  logOperational(
    action: string,
    details?: Record<string, unknown>,
    tenantId?: string,
  ): void {
    this.log({
      category: LogCategory.OPERATIONAL,
      action,
      tenantId,
      details,
    });
  }

  /**
   * Shortcut para registrar un error operacional.
   */
  logOperationalError(
    action: string,
    error: Error | string,
    details?: Record<string, unknown>,
  ): void {
    this.log({
      category: LogCategory.OPERATIONAL,
      action,
      level: 'error',
      details: {
        ...details,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
  }

  /**
   * Shortcut para registrar un evento de auditoría de seguridad.
   */
  logAuditEvent(
    action: string,
    userId: string,
    details?: Record<string, unknown>,
    ipAddress?: string,
  ): void {
    this.log({
      category: LogCategory.AUDIT_EVENT,
      action,
      userId,
      ipAddress,
      details,
    });
  }

  /**
   * Determina el nivel de log por defecto según la categoría.
   * - USER_ACTION: info (acciones normales del usuario)
   * - OPERATIONAL: warn (fallos que pueden requerir atención)
   * - AUDIT_EVENT: info (eventos de seguridad a registrar siempre)
   */
  private getDefaultLevel(category: LogCategory): string {
    switch (category) {
      case LogCategory.USER_ACTION:
        return 'info';
      case LogCategory.OPERATIONAL:
        return 'warn';
      case LogCategory.AUDIT_EVENT:
        return 'info';
      default:
        return 'info';
    }
  }

  /**
   * Construye un mensaje legible para el log a partir de la entrada estructurada.
   */
  private buildMessage(entry: StructuredLogEntry): string {
    const parts: string[] = [];

    if (entry.userName) parts.push(`User: ${entry.userName}`);
    if (entry.entityType && entry.entityId) {
      parts.push(`${entry.entityType}:${entry.entityId}`);
    }
    parts.push(entry.action);

    return parts.join(' | ');
  }

  /**
   * Genera un ID de correlación único para rastrear flujos completos.
   * Formato: timestamp-random (para ordenación temporal + unicidad).
   */
  private generateCorrelationId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  }
}
