/**
 * @file generate-preregistration.dto.ts
 * @description DTO para generar un link de pre-registro.
 */

import { IsUUID, IsDate, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class GeneratePreRegistrationDto {
  @IsUUID()
  visitId: string;

  /** Cuándo expira el link (opcional, default: 24h) */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
