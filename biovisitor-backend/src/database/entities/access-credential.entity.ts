/**
 * @file access-credential.entity.ts
 * @description Entidad de Credencial de Acceso.
 *
 * Almacena los tokens y credenciales asignadas a cada visita:
 * - JWT de QR dinámico (hash del token, no el token raw)
 * - Referencias a tarjetas RFID
 * - Referencias a templates biométricos en BioStar
 *
 * Los tokens QR se almacenan como hash SHA-256 por seguridad.
 * La invalidación de tokens se maneja tanto localmente (is_revoked)
 * como en Redis (para rendimiento en la validación en tiempo real).
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

/**
 * Tipo de credencial de acceso.
 *
 * Representa todos los mecanismos de identificación soportados por el ecosistema Suprema
 * y el sistema BioVisitor X. Cada visita puede tener una o múltiples credenciales simultáneas.
 */
export enum CredentialType {
  /** Token JWT para QR dinámico de uso único (generado por BioVisitor X) */
  QR_JWT = 'QR_JWT',
  /** Tarjeta RFID CSN o Wiegand (BioEntry, BioStation, etc.) */
  RFID = 'RFID',
  /** Smart Card de contacto/sin contacto (MIFARE, DESFire, iCLASS, HID) */
  SMART_CARD = 'SMART_CARD',
  /** Acceso móvil vía Suprema Mobile Card (NFC para Android / BLE para iOS+Android) */
  MOBILE_CARD = 'MOBILE_CARD',
  /** Referencia a template facial enrollado en BioStar (IR Face o Visual Face) */
  FACE_TEMPLATE_REF = 'FACE_TEMPLATE_REF',
  /** Referencia a template de huella dactilar enrollado en BioStar */
  FINGERPRINT_REF = 'FINGERPRINT_REF',
  /**
   * Solicitud explícita de enrolar la foto de perfil del visitante como
   * credencial Visual Face en BioStar (FaceStation F2 / BioStation 3).
   * Se crea cuando el operador activa el toggle "Rostro Visual" en el registro.
   */
  VISUAL_FACE = 'VISUAL_FACE',
}

/**
 * Subtipo de tarjeta física para credenciales de tipo RFID.
 *
 * Corresponde a los tipos reales confirmados contra `GET /api/cards/types`
 * de BioStar X (ver también SupremaSyncService.syncCardCredentials):
 *   CSN         → card_type { id: '0', type: '1'  }
 *   WIEGAND     → card_type { id: '1', type: '10' }
 *   MOBILE_CSN  → card_type { id: '4', type: '4'  }
 */
export enum RfidCardSubtype {
  CSN = 'CSN',
  WIEGAND = 'WIEGAND',
  MOBILE_CSN = 'MOBILE_CSN',
}

/**
 * Estado de sincronización de una credencial individual con BioStar.
 */
export enum CredentialSyncStatus {
  SYNCED = 'SYNCED',
  PENDING = 'PENDING',
  FAILED = 'FAILED',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}

/**
 * Entidad AccessCredential - Credenciales asignadas por visita.
 *
 * Cada visita puede tener múltiples credenciales (ej: QR + tarjeta RFID).
 * Los tokens QR se almacenan como hash para evitar que una brecha de BD
 * permita la generación de códigos QR válidos.
 */
@Entity('access_credentials')
@Index(['tokenHash'], { unique: true, where: '"tokenHash" IS NOT NULL' })
export class AccessCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK a la visita a la que pertenece esta credencial */
  @Column({ type: 'uuid' })
  visitId: string;

  @ManyToOne(() => Visit)
  @JoinColumn({ name: 'visitId' })
  visit: Visit;

  /** Tipo de credencial */
  @Column({ type: 'enum', enum: CredentialType })
  type: CredentialType;

  /**
   * Hash SHA-256 del token (para QR_JWT).
   * Para RFID/SMART_CARD, contiene el número/ID de la tarjeta.
   * Para FACE/FINGERPRINT_REF, contiene la referencia en BioStar.
   * NUNCA almacenamos el JWT raw — solo el hash para verificación.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  tokenHash: string;

  /**
   * Número o ID de tarjeta física para credenciales RFID y SMART_CARD.
   * Ejemplos: CSN hex (e.g. "A1B2C3D4"), Wiegand facility+card (e.g. "023-12345")
   * Para RFID CSN de BioStar se almacena en formato hexadecimal sin espacios.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  cardNumber: string | null;

  /**
   * Subtipo de tarjeta física (solo aplica cuando type = RFID).
   * Determina el `card_type` real enviado a BioStar X: CSN, WIEGAND o MOBILE_CSN.
   * Si es null para una credencial RFID existente (datos previos a este campo),
   * se asume CSN por compatibilidad hacia atrás.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  cardSubtype: RfidCardSubtype | null;

  /**
   * ID de la tarjeta registrada en BioStar (retornado por POST /api/cards).
   * Se usa para eliminarla en el check-out o al revocar la credencial.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  supremaCardId: string | null;

  /**
   * Datos biométricos cifrados con AES-256-GCM.
   * Para FINGERPRINT_REF: JSON con { template0: <base64>, template1: <base64> }
   * Para FACE_TEMPLATE_REF: JSON con { irTemplate: <base64>, visualTemplate: <base64> }
   * NUNCA se retornan al cliente — solo se usan para sincronización con BioStar.
   */
  @Column({ type: 'text', nullable: true })
  encryptedData: string | null;

  /**
   * Cantidad de templates biométricos almacenados en BioStar.
   * Refleja los contadores de la API: fingerprint_template_count, face_count.
   * Se actualiza tras cada sincronización exitosa para auditoría.
   */
  @Column({ type: 'smallint', default: 0 })
  supremaTemplateCount: number;

  /**
   * Estado de sincronización de esta credencial específica con BioStar.
   * Independiente del syncStatus general de la Visit.
   */
  @Column({ type: 'varchar', length: 30, nullable: true })
  syncStatus: CredentialSyncStatus | null;

  /** Último error de sincronización de esta credencial */
  @Column({ type: 'text', nullable: true })
  lastSyncError: string | null;

  /** Timestamp del último intento de sincronización de esta credencial */
  @Column({ type: 'timestamptz', nullable: true })
  lastSyncAttemptAt: Date | null;

  /** Fecha y hora de expiración de la credencial */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date;

  /** Fecha y hora en que fue utilizada (null = aún no usada) */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date;

  /** Si la credencial ha sido revocada manualmente */
  @Column({ type: 'boolean', default: false })
  isRevoked: boolean;

  /** Motivo de revocación (si aplica) */
  @Column({ type: 'varchar', length: 500, nullable: true })
  revokeReason: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
