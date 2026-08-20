import { IsEnum, IsOptional, IsString, MaxLength, IsObject } from 'class-validator';
import { RfidCardSubtype } from '../../../database/entities/access-credential.entity';

export enum CredentialTypeInput {
  RFID            = 'RFID',
  SMART_CARD      = 'SMART_CARD',
  QR_JWT          = 'QR_JWT',
  VISUAL_FACE     = 'VISUAL_FACE',
  FINGERPRINT_REF = 'FINGERPRINT_REF',
}

export class AddCredentialDto {
  @IsEnum(CredentialTypeInput)
  type: CredentialTypeInput;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cardNumber?: string;

  @IsOptional()
  @IsEnum(RfidCardSubtype)
  cardSubtype?: RfidCardSubtype;

  /**
   * Templates de rostro obtenidos desde un dispositivo BioStar vía
   * GET /api/devices/:id/credentials/face?pose_sensitivity=4
   * Solo aplica cuando type = VISUAL_FACE y el operador escaneó desde dispositivo.
   */
  @IsOptional()
  @IsObject()
  faceTemplates?: Record<string, unknown>;

  /**
   * Template de huella dactilar obtenido desde un dispositivo BioStar vía
   * POST /api/devices/:id/scan_fingerprint
   * Solo aplica cuando type = FINGERPRINT_REF.
   */
  @IsOptional()
  @IsObject()
  fingerprintTemplate?: { template: string; quality?: number };
}
