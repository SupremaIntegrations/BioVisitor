/**
 * @file visitor-document.entity.ts
 * @description Entidad de Documentos del Visitante.
 *
 * Almacena referencias a documentos escaneados del visitante:
 * - Foto de pasaporte (capturada por lector de pasaportes)
 * - DNI escaneado (capturado por lector de códigos de barras/QR)
 * - Fotografía del visitante (capturada por webcam)
 *
 * Los archivos se almacenan en el servidor local del VMS (nunca en servicios
 * cloud externos) siguiendo el principio de Data Minimization.
 * Las rutas de archivos se cifran con AES-256-GCM.
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
} from 'typeorm';
import { Visitor } from './visitor.entity';

/**
 * Tipo de documento almacenado.
 */
export enum VisitorDocumentType {
  /** Fotografía del visitante (webcam) */
  PHOTO = 'PHOTO',
  /** Escaneo del pasaporte */
  PASSPORT_SCAN = 'PASSPORT_SCAN',
  /** Escaneo del DNI (ambos lados) */
  ID_SCAN = 'ID_SCAN',
  /** Firma del visitante (si se requiere NDA o acuerdo de confidencialidad) */
  SIGNATURE = 'SIGNATURE',
  /** Otro tipo de documento */
  OTHER = 'OTHER',
}

/**
 * Entidad VisitorDocument - Documentos e imágenes del visitante.
 *
 * Separada de Visitor para mantener los datos sensibles aislados
 * y facilitar políticas de retención (borrado periódico de documentos
 * antiguos sin afectar el registro del visitante).
 */
@Entity('visitor_documents')
export class VisitorDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK al visitante */
  @Column({ type: 'uuid' })
  visitorId: string;

  @ManyToOne(() => Visitor)
  @JoinColumn({ name: 'visitorId' })
  visitor: Visitor;

  /** Tipo de documento */
  @Column({ type: 'enum', enum: VisitorDocumentType })
  documentType: VisitorDocumentType;

  /**
   * Ruta al archivo cifrada con AES-256-GCM.
   * La ruta real se descifra en runtime con EncryptionService.
   * Esto evita que una brecha de BD revele la ubicación de los archivos.
   */
  @Column({ type: 'text' })
  filePathEncrypted: string;

  /**
   * Datos extraídos vía OCR del documento (JSON).
   * Solo se almacenan los campos que sirven para llenado automático
   * de formularios (nombre, número de documento, fecha de nacimiento, etc.).
   */
  @Column({ type: 'jsonb', nullable: true })
  ocrDataJson: Record<string, unknown>;

  /** Tamaño del archivo en bytes (para auditoría de almacenamiento) */
  @Column({ type: 'int', nullable: true })
  fileSizeBytes: number;

  /** MIME type del archivo (ej: "image/jpeg", "application/pdf") */
  @Column({ type: 'varchar', length: 100, nullable: true })
  mimeType: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
