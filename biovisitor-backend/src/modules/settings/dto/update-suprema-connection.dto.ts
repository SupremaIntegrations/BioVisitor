/**
 * @file update-suprema-connection.dto.ts
 * @description DTO para actualizar una conexión existente a la API de Suprema BioStar.
 *
 * Todos los campos son opcionales. Si loginId o password se proveen,
 * se re-cifran antes de persistir.
 *
 * @module modules/settings/dto
 */

import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { BioStarPlatform } from '../../../database/entities';

export class UpdateSupremaConnectionDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsEnum(BioStarPlatform)
  platform?: BioStarPlatform;

  @IsOptional()
  @IsString()
  @Matches(/^https:\/\/.+/, {
    message: 'La URL debe usar protocolo HTTPS',
  })
  @MaxLength(500)
  apiUrl?: string;

  /**
   * Si se provee, se re-cifra y reemplaza el loginId almacenado.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  loginId?: string;

  /**
   * Si se provee, se re-cifra y reemplaza el password almacenado.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caCertPath?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
