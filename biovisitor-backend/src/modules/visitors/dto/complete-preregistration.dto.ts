/**
 * @file complete-preregistration.dto.ts
 * @description DTO para que el visitante envíe sus datos a través del link remoto.
 */

import {
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
  IsEnum,
  IsObject,
} from 'class-validator';
import { DocumentType } from '../../../database/entities/visitor.entity';

export class CompletePreRegistrationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  firstName: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  lastName: string;

  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoPath?: string; // Podría ser Base64 o S3 URL según cómo procesemos el archivo

  @IsOptional()
  @IsObject()
  ocrData?: Record<string, unknown>;
}
