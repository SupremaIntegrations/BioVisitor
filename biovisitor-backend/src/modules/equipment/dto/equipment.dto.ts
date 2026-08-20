import {
  IsString,
  IsEnum,
  IsOptional,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsNotEmpty,
  IsUUID,
  IsDateString,
} from 'class-validator';
import { EquipmentCategory, EquipmentStatus } from '../../../database/entities/equipment-entry.entity';

export class CreateEquipmentDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  serialNumber: string;

  @IsString() @IsNotEmpty() @MaxLength(80)
  brand: string;

  @IsString() @IsNotEmpty() @MaxLength(120)
  model: string;

  @IsEnum(EquipmentCategory)
  category: EquipmentCategory;

  @IsString() @IsNotEmpty() @MaxLength(200)
  responsibleName: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  hostArea: string;

  @IsOptional() @IsUUID()
  visitId?: string;

  @IsOptional() @IsString() @MaxLength(80)
  authorizationCode?: string;

  @IsOptional() @IsString()
  notes?: string;

  @IsOptional() @IsInt() @Min(1) @Max(720)
  maxStayHours?: number;

  /** Si el tenant requiere pre-autorización para esta categoría,
   *  el frontend envía requiresAuth=true para crear en PENDING_AUTH */
  @IsOptional()
  requiresAuth?: boolean;
}

export class UpdateEquipmentDto {
  @IsOptional() @IsString() @MaxLength(80)
  brand?: string;

  @IsOptional() @IsString() @MaxLength(120)
  model?: string;

  @IsOptional() @IsString() @MaxLength(200)
  responsibleName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  hostArea?: string;

  @IsOptional() @IsString()
  notes?: string;

  @IsOptional() @IsInt() @Min(1) @Max(720)
  maxStayHours?: number;
}

export class RegisterExitDto {
  @IsOptional() @IsString()
  notes?: string;
}

export class RejectEquipmentDto {
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class EquipmentFilterDto {
  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsEnum(EquipmentStatus)
  status?: EquipmentStatus;

  @IsOptional() @IsEnum(EquipmentCategory)
  category?: EquipmentCategory;

  @IsOptional() @IsDateString()
  dateFrom?: string;

  @IsOptional() @IsDateString()
  dateTo?: string;

  @IsOptional()
  page?: string;

  @IsOptional()
  limit?: string;
}

export class EquipmentSettingsDto {
  /** Categorías que requieren pre-autorización */
  @IsOptional()
  requiresAuthCategories?: EquipmentCategory[];

  /** Horas por defecto de estadía máxima */
  @IsOptional() @IsInt() @Min(1) @Max(720)
  defaultMaxStayHours?: number;
}
