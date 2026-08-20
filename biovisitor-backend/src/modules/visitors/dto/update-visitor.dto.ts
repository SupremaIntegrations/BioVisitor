import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DocumentType } from '../../../database/entities/visitor.entity';
import { FaceBoxDto } from './create-visitor.dto';

export class UpdateVisitorDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  position?: string;

  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  nationality?: string;

  @IsOptional()
  @IsString()
  photoBase64?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FaceBoxDto)
  faceBox?: FaceBoxDto;
}
