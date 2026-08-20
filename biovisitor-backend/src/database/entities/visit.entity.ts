/**
 * @file visit.entity.ts
 * @description Entidad de Visita - Cada instancia individual de una persona visitando.
 *
 * Separada de Visitor para permitir múltiples visitas del mismo visitante.
 * Contiene toda la información temporal de la visita: fechas, estado,
 * método de acceso, host que recibe, y referencia al usuario en BioStar.
 *
 * El ciclo de vida de una visita es:
 * SCHEDULED → PRE_REGISTERED → CHECKED_IN → CHECKED_OUT
 * O bien:
 * SCHEDULED → CHECKED_IN → CHECKED_OUT (registro directo en recepción)
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
import { Visitor } from './visitor.entity';
import { User } from './user.entity';
import { Host } from './host.entity';

/**
 * Tipo de visitante — categoriza la naturaleza de la visita.
 * Impacta el flujo de registro: CONTRACTOR puede requerir certificados ARL.
 */
export enum VisitorType {
  WALK_IN = 'WALK_IN',       // Visitante general (por defecto)
  CONTRACTOR = 'CONTRACTOR', // Contratista — puede requerir ARL/certificado
  VIP = 'VIP',               // VIP — acceso prioritario
  INTERVIEW = 'INTERVIEW',   // Candidato a entrevista de trabajo
  SUPPLIER = 'SUPPLIER',     // Proveedor / Vendedor
  COURIER = 'COURIER',       // Mensajería / Paquetería
}

/**
 * Método de acceso utilizado por el visitante.
 */
export enum AccessMethod {
  /** Reconocimiento facial vía lector Suprema */
  FACE = 'FACE',
  /** Huella dactilar vía lector Suprema */
  FINGERPRINT = 'FINGERPRINT',
  /** Tarjeta RFID (Suprema o terceros vía USB) */
  RFID = 'RFID',
  /** Código QR dinámico de uso único */
  QR_DYNAMIC = 'QR_DYNAMIC',
  /** Acceso manual autorizado por recepción (sin biometría) */
  MANUAL = 'MANUAL',
}

/**
 * Estados posibles de una visita.
 * Representan el ciclo de vida completo desde la programación hasta la salida.
 */
export enum VisitStatus {
  /** Visita agendada por un host pero el visitante no ha completado pre-registro */
  SCHEDULED = 'SCHEDULED',
  /** El visitante completó el formulario de pre-registro (datos + foto listos) */
  PRE_REGISTERED = 'PRE_REGISTERED',
  /** El visitante hizo check-in (está dentro de las instalaciones) */
  CHECKED_IN = 'CHECKED_IN',
  /** El visitante hizo check-out (salió de las instalaciones) */
  CHECKED_OUT = 'CHECKED_OUT',
  /** La visita fue cancelada antes del check-in */
  CANCELLED = 'CANCELLED',
  /** El visitante no se presentó (no-show, pasó la fecha agendada sin check-in) */
  NO_SHOW = 'NO_SHOW',
  /**
   * El visitante fue auto-checked-out por autenticarse en un dispositivo de
   * salida, pero reportó (vía el link del correo de encuesta) que en realidad
   * sigue dentro de las instalaciones. Requiere validación de un operador.
   */
  FALSE_EXIT_REPORTED = 'FALSE_EXIT_REPORTED',
}

/**
 * Entidad Visit - Registro individual de una visita.
 *
 * Conecta un Visitor con un Host (User) en un periodo de tiempo específico.
 * Gestiona el ciclo de vida completo de la visita y mantiene la referencia
 * al usuario creado en BioStar para el check-out automático.
 */
@Entity('visits')
@Index(['tenantId', 'status', 'scheduledAt'])
@Index(['tenantId', 'checkedInAt'])
export class Visit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK al tenant */
  @Column({ type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  /** FK al visitante */
  @Column({ type: 'uuid' })
  visitorId: string;

  @ManyToOne(() => Visitor)
  @JoinColumn({ name: 'visitorId' })
  visitor: Visitor;

  /** FK al host (empleado que recibe al visitante) */
  @Column({ type: 'uuid', nullable: true })
  hostUserId: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'hostUserId' })
  hostUser: User;

  /**
   * FK al Host (tabla dedicada de anfitriones).
   * Reemplaza gradualmente a hostUserId — usar hostId cuando el host
   * fue creado localmente o importado desde BioStar.
   */
  @Column({ type: 'uuid', nullable: true })
  hostId: string | null;

  @ManyToOne(() => Host, { nullable: true, eager: false })
  @JoinColumn({ name: 'hostId' })
  host: Host;

  /** Propósito o motivo de la visita */
  @Column({ type: 'varchar', length: 500, nullable: true })
  purpose: string;

  /** Departamento o área a visitar */
  @Column({ type: 'varchar', length: 255, nullable: true })
  department: string;

  /** Fecha y hora agendada para la visita */
  @Column({ type: 'timestamptz' })
  scheduledAt: Date;

  /** Fecha y hora esperada de finalización */
  @Column({ type: 'timestamptz', nullable: true })
  expectedEndAt: Date;

  /** Fecha y hora real de check-in */
  @Column({ type: 'timestamptz', nullable: true })
  checkedInAt: Date;

  /** Fecha y hora real de check-out */
  @Column({ type: 'timestamptz', nullable: true })
  checkedOutAt: Date;

  /** Método de acceso utilizado en esta visita */
  @Column({ type: 'enum', enum: AccessMethod, default: AccessMethod.MANUAL })
  accessMethod: AccessMethod;

  /** Estado actual de la visita */
  @Column({ type: 'enum', enum: VisitStatus, default: VisitStatus.SCHEDULED })
  status: VisitStatus;

  /**
   * ID de referencia del usuario creado en BioStar (2 o X).
   * Se establece al momento del check-in cuando se sincroniza con BioStar.
   * Se usa para eliminarlo durante el check-out (liberar memoria de lectores).
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  supremaUserRefId: string;

  /**
   * Estado de sincronización con BioStar.
   * 'SYNCED'        : Usuario creado exitosamente en BioStar.
   * 'PENDING'       : Fallo al crear/sincronizar; pendiente de reintento.
   * 'FAILED'        : Agotó reintentos; requiere intervención manual.
   * 'OFFLINE'       : Sin conexión BioStar configurada (operación local pura).
   * 'NOT_CONFIGURED': No hay conexión activa de Suprema para este tenant.
   * null            : Recién creado, sincronización no intentada aún.
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  syncStatus: string | null;

  /**
   * Último mensaje de error de sincronización con BioStar.
   * Se usa para depuración y para mostrar feedback al operador.
   */
  @Column({ type: 'text', nullable: true })
  lastSyncError: string | null;

  /**
   * Timestamp del último intento de sincronización con BioStar.
   */
  @Column({ type: 'timestamptz', nullable: true })
  lastSyncAttemptAt: Date | null;

  /** ID del operador que realizó el check-in (recepcionista) */
  @Column({ type: 'uuid', nullable: true })
  checkedInByUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'checkedInByUserId' })
  checkedInByUser: User;

  /**
   * Fecha y hora de expiración de la visita, fijada obligatoriamente por el
   * operador en el momento del check-in. Determina hasta cuándo está autorizado
   * el visitante a permanecer en las instalaciones.
   */
  @Column({ type: 'timestamptz', nullable: true })
  expectedCheckoutAt: Date | null;

  /**
   * Tiempo máximo de estadía en minutos (calculado desde checkedInAt hasta expectedCheckoutAt).
   * Si la visita supera este límite desde el check-in, se genera una alerta operativa.
   * Si es null, no hay límite definido para esta visita.
   */
  @Column({ type: 'int', nullable: true })
  maxStayMinutes: number | null;

  /**
   * Indica si el auto-checkout automático está habilitado para esta visita específica.
   * Cuando es true, la visita será elegible para el cierre automático programado
   * (AutoCheckoutService) según la configuración del tenant.
   * La lógica de ejecución se implementará posteriormente.
   */
  @Column({ type: 'boolean', default: false })
  autoCheckoutEnabled: boolean;

  /**
   * Indica si el visitante declaró activos al ingresar (laptops, tablets, etc.).
   * Cuando es true, se espera que haya registros en visitor_assets para esta visita.
   */
  @Column({ type: 'boolean', default: false })
  hasAssets: boolean;

  /**
   * Indica si el visitante declaró vehículos al ingresar.
   * Cuando es true, se espera que haya registros en visitor_vehicles para esta visita.
   */
  @Column({ type: 'boolean', default: false })
  hasVehicles: boolean;

  /** Notas adicionales del operador sobre la visita */
  @Column({ type: 'text', nullable: true })
  notes: string;

  /**
   * Número u referencia de la orden de servicio para visitas de tipo CONTRACTOR.
   * Permite asociar la entrada del contratista con una orden de trabajo/servicio.
   * Solo aplica cuando visitorType = CONTRACTOR.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  serviceOrder: string | null;

  /**
   * Tipo de visitante — categoriza el propósito de la visita.
   * Almacenado como texto libre (no enum de BD) para permitir que el tenant
   * defina tipos personalizados además de los predefinidos en VisitorType.
   */
  @Column({ type: 'varchar', length: 50, default: VisitorType.WALK_IN })
  visitorType: string;

  /** Número de badge o credencial impresa */
  @Column({ type: 'varchar', length: 100, nullable: true })
  badgeNumber: string;

  /**
   * Grupos de acceso asignados a esta visita (sincronizados con BioStar).
   * Almacena id y nombre para visualización rápida sin consultas adicionales.
   * Ejemplo: [{ id: 1, name: "Visitantes Generales" }]
   */
  @Column({ type: 'jsonb', nullable: true })
  accessGroups: { id: number; name: string }[] | null;

  /**
   * Token único (UUID) para el portal de visitante.
   * Permite acceso público a la página de QR sin autenticación.
   */
  @Column({ type: 'varchar', length: 36, nullable: true, unique: true })
  portalToken: string | null;

  /**
   * Token de onboarding de un solo uso (UUID v4).
   * Generado al invitar un visitante por email; se invalida al completar el formulario.
   * Diferente de portalToken (QR dinámico) — este es para el flujo de pre-registro por invitación.
   */
  @Column({ type: 'varchar', length: 36, nullable: true, unique: true })
  onboardingToken: string | null;

  /**
   * Email del invitado cuando aún no ha completado su registro.
   * Se usa para enviar la invitación antes de que el Visitor record tenga datos reales.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  invitedEmail: string | null;

  // ── Encuesta de salida ────────────────────────────────────────────────
  /** Calificación de 1 a 5 estrellas dada por el visitante al salir */
  @Column({ type: 'int', nullable: true })
  surveyRating: number | null;

  /** Comentario opcional del visitante sobre su visita */
  @Column({ type: 'text', nullable: true })
  surveyComment: string | null;

  /** Fecha y hora en que el visitante respondió la encuesta */
  @Column({ type: 'timestamptz', nullable: true })
  surveyRespondedAt: Date | null;

  // ── Reporte de falsa salida / habilitación temporal ─────────────────
  /**
   * Fecha y hora en que el visitante reportó (vía el link del correo de
   * encuesta) que en realidad sigue dentro de las instalaciones a pesar
   * de haber sido auto-checked-out por el dispositivo de salida.
   */
  @Column({ type: 'timestamptz', nullable: true })
  falseExitReportedAt: Date | null;

  /** Fecha y hora en que un operador resolvió el reporte de falsa salida */
  @Column({ type: 'timestamptz', nullable: true })
  falseExitResolvedAt: Date | null;

  /** ID del operador que validó/resolvió el reporte de falsa salida */
  @Column({ type: 'uuid', nullable: true })
  falseExitResolvedByUserId: string | null;

  /** Nota del operador explicando la causa/resolución del reporte */
  @Column({ type: 'text', nullable: true })
  falseExitResolutionNote: string | null;

  /**
   * Hora límite (definida por el operador) hasta la cual queda vigente la
   * habilitación temporal de acceso tras un reporte de falsa salida.
   * Al vencer, AutoCheckoutService vuelve a cerrar la visita automáticamente.
   * Si es null, la visita queda indefinida como cualquier CHECKED_IN normal.
   */
  @Column({ type: 'timestamptz', nullable: true })
  temporaryReenableUntil: Date | null;

  /**
   * Indica que esta visita tuvo que pasar por una habilitación temporal
   * (falsa salida). Se usa únicamente para mostrar una nota informativa en
   * reportes/auditoría — la visita sigue siendo el mismo registro, nunca se
   * duplica ni se cuenta como una segunda visita del día.
   */
  @Column({ type: 'boolean', default: false })
  wasTemporaryReenabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
