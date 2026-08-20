/**
 * @file create-suprema-connection.dto.ts
 * @description DTO para crear una nueva conexión a la API de Suprema BioStar.
 *
 * Las credenciales (loginId y password) se reciben en texto plano desde el cliente
 * y son cifradas por el servicio antes de persistirlas.
 *
 * @module modules/settings/dto
 */

import {
  IsString,
  IsEnum,
  IsUrl,
  IsOptional,
  IsBoolean,
  IsUUID,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { BioStarPlatform } from '../../../database/entities';

export class CreateSupremaConnectionDto {
  /**
   * ID del tenant al que pertenece esta conexión.
   * Opcional: si no se provee, la conexión es de nivel global.
   */
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  /**
   * Nombre descriptivo de la conexión.
   * Ejemplo: "Servidor Principal Edificio A", "BioStar X - HQ"
   */
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  name: string;

  /**
   * Descripción opcional del propósito de esta conexión.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /**
   * Plataforma Suprema destino.
   */
  @IsEnum(BioStarPlatform)
  platform: BioStarPlatform;

  /**
   * URL base del servidor BioStar.
   * Debe ser HTTPS. El puerto 443 es el predeterminado del Unified Gateway.
   * Ejemplos:
   *   - https://192.168.1.10:443
   *   - https://biostar.empresa.com
   */
  @IsString()
  @Matches(/^https:\/\/.+/, {
    message: 'La URL debe usar protocolo HTTPS (ej: https://ip-o-dominio[:puerto])',
  })
  @MaxLength(500)
  apiUrl: string;

  /**
   * Login ID del administrador en BioStar.
   * Se recibirá en texto plano y será cifrado antes de persistir.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  loginId: string;

  /**
   * Contraseña del administrador en BioStar.
   * Se recibirá en texto plano y será cifrado antes de persistir.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  password: string;

  /**
   * Ruta al certificado CA para validación SSL del servidor BioStar.
   * Recomendado en producción para prevenir ataques MITM.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caCertPath?: string;

  /**
   * Si la conexión debe estar activa al crearla.
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
