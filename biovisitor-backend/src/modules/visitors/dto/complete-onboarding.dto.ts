import {
  IsString,
  IsOptional,
  IsEmail,
  IsEnum,
  MinLength,
  MaxLength,
} from 'class-validator';
import { DocumentType } from '../../../database/entities/visitor.entity';

export class CompleteOnboardingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  lastName: string;

  @IsEnum(DocumentType)
  documentType: DocumentType;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  documentNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  position?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}
