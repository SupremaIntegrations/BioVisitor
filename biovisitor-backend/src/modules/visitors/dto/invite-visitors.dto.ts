import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsISO8601,
  ArrayMinSize,
  ArrayMaxSize,
  MaxLength,
  IsEnum,
} from 'class-validator';
import { DocumentType } from '../../../database/entities/visitor.entity';

export class InviteVisitorsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  emails: string[];

  @IsISO8601()
  scheduledAt: string;

  @IsOptional()
  @IsISO8601()
  expectedEndAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  hostId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  purpose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** Nombre completo del visitante invitado (pre-registro del host) */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  invitedName?: string;

  /** Tipo de documento del visitante */
  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  /** Número de documento del visitante */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentNumber?: string;
}
