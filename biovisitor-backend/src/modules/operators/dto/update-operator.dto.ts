import {
  IsEmail, IsEnum, IsOptional, IsString,
  IsBoolean, IsArray, MinLength, MaxLength,
  IsObject, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '../../../database/entities/user.entity';
import { OperatorPermissionsDto, SecurityConfigDto } from './create-operator.dto';

export class UpdateOperatorDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(255)
  fullName?: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsEnum([UserRole.ADMIN, UserRole.OPERATOR])
  role?: UserRole.ADMIN | UserRole.OPERATOR;

  @IsOptional() @IsString() @MaxLength(255)
  department?: string;

  @IsOptional() @IsString() @MaxLength(50)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @IsOptional() @IsObject() @ValidateNested()
  @Type(() => OperatorPermissionsDto)
  permissions?: OperatorPermissionsDto;

  @IsOptional() @IsArray() @IsString({ each: true })
  allowedSites?: string[];

  @IsOptional() @IsObject() @ValidateNested()
  @Type(() => SecurityConfigDto)
  securityConfig?: SecurityConfigDto;
}

export class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(128)
  newPassword: string;

  @IsOptional() @IsBoolean()
  mustChangePassword?: boolean;
}
