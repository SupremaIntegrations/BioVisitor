/**
 * @file create-visitor.dto.ts
 * @description Data Transfer Object para la creación de un visitante.
 *
 * Contiene validaciones estrictas usando class-validator para asegurar
 * la integridad de los datos de entrada según las políticas de la VMS.
 *
 * @module modules/visitors/dto
 */

import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  MinLength,
  MaxLength,
  IsObject,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DocumentType } from '../../../database/entities/visitor.entity';

export class FaceBoxDto {
  @IsNumber()
  @Min(0)
  x: number;

  @IsNumber()
  @Min(0)
  y: number;

  @IsNumber()
  @Min(1)
  width: number;

  @IsNumber()
  @Min(1)
  height: number;
}

export class CreateVisitorDto {
  /** Nombre completo del visitante */
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  fullName: string;

  /** Email del visitante (opcional pero recomendado para QR) */
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  /** Teléfono del visitante */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  /** Compañía de donde proviene el visitante */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  company?: string;

  /** Tipo de documento de identidad */
  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  /** Número del documento de identidad */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentNumber?: string;

  /** ID del tenant asociado a la creación */
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  photoBase64?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FaceBoxDto)
  faceBox?: FaceBoxDto;

  @IsOptional()
  @IsObject()
  extraData?: Record<string, any>;
}
