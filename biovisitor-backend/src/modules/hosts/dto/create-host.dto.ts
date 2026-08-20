import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsUUID,
  MaxLength,
  IsBoolean,
} from 'class-validator';
import { HostSource } from '../../../database/entities/host.entity';

export class CreateHostDto {
  @IsString()
  @MaxLength(255)
  fullName: string;

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
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  jobTitle?: string;

  @IsOptional()
  @IsEnum(HostSource)
  source?: HostSource;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  supremaUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  supremaLoginId?: string;

  @IsOptional()
  @IsUUID()
  supremaConnectionId?: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
