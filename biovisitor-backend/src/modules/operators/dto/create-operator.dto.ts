import {
  IsEmail, IsEnum, IsOptional, IsString,
  IsBoolean, IsNumber, IsArray, MinLength,
  MaxLength, Min, Max, ValidateNested, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '../../../database/entities/user.entity';

export class PermissionsVisitorsDto {
  @IsBoolean() view: boolean;
  @IsBoolean() checkin: boolean;
  @IsBoolean() checkout: boolean;
  @IsBoolean() preregister: boolean;
  @IsBoolean() editVisitor: boolean;
}

export class PermissionsModuleDto {
  @IsBoolean() view: boolean;
}

export class OperatorPermissionsDto {
  @ValidateNested() @Type(() => PermissionsVisitorsDto) visitors: PermissionsVisitorsDto;
  @ValidateNested() @Type(() => PermissionsModuleDto)   reports: PermissionsModuleDto;
  @ValidateNested() @Type(() => PermissionsModuleDto)   accessLogs: PermissionsModuleDto;
  @ValidateNested() @Type(() => PermissionsModuleDto)   auditTrail: PermissionsModuleDto;
  @ValidateNested() @Type(() => PermissionsModuleDto)   settings: PermissionsModuleDto;
}

export class SecurityConfigDto {
  @IsBoolean() mfaRequired: boolean;
  @IsBoolean() ssoRequired: boolean;
  @IsBoolean() passwordComplexity: boolean;
  @IsOptional() @IsNumber() @Min(1) @Max(365) passwordExpiryDays: number | null;
  @IsOptional() @IsNumber() @Min(3) @Max(20)  maxFailedAttempts: number | null;
  @IsOptional() @IsNumber() @Min(5) @Max(480) sessionTimeoutMinutes: number | null;
  @IsOptional() @IsNumber() @Min(1) @Max(10)  maxConcurrentSessions: number | null;
  @IsArray() @IsString({ each: true })         ipAllowlist: string[];
}

export class CreateOperatorDto {
  @IsString() @MinLength(2) @MaxLength(255)
  fullName: string;

  @IsEmail()
  email: string;

  @IsEnum([UserRole.ADMIN, UserRole.OPERATOR])
  role: UserRole.ADMIN | UserRole.OPERATOR;

  @IsString() @MinLength(8) @MaxLength(128)
  temporaryPassword: string;

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
