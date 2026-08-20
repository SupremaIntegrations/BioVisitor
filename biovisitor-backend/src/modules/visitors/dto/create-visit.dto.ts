/**
 * @file create-visit.dto.ts
 * @description Data Transfer Object para registrar una visita (check-in o agendamiento).
 *
 * @module modules/visitors/dto
 */

import {
  IsString,
  IsDate,
  IsOptional,
  IsEnum,
  IsUUID,
  IsBoolean,
  IsArray,
  ValidateNested,
  MaxLength,
  IsNumber,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AccessMethod } from '../../../database/entities/visit.entity';
import { CredentialType, RfidCardSubtype } from '../../../database/entities/access-credential.entity';
import { AssetCategory } from '../../../database/entities/visitor-asset.entity';
import { VehicleType } from '../../../database/entities/visitor-vehicle.entity';

/**
 * Grupo de acceso de BioStar que se asignará al visitante.
 * Se persiste junto con la visita para visualización y re-sincronización.
 */
export class AccessGroupDto {
  /** ID numérico del grupo en BioStar */
  @IsNumber()
  id: number;

  /** Nombre legible del grupo (se almacena para evitar lookups adicionales) */
  @IsString()
  name: string;
}

/**
 * Define una credencial adicional a registrar junto con la visita.
 * Permite solicitar múltiples credenciales simultáneas (QR + RFID, etc.).
 */
export class AdditionalCredentialDto {
  /** Tipo de credencial */
  @IsEnum(CredentialType)
  type: CredentialType;

  /**
   * Número o ID de la tarjeta (requerido para RFID y SMART_CARD).
   * Para RFID CSN: formato hexadecimal sin espacios (e.g. "A1B2C3D4").
   * Para Wiegand: formato "facility-card" (e.g. "023-12345").
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  cardNumber?: string;

  /**
   * Subtipo de tarjeta física (solo aplica cuando type = RFID).
   * CSN | WIEGAND | MOBILE_CSN. Si se omite, se asume CSN.
   */
  @IsOptional()
  @IsEnum(RfidCardSubtype)
  cardSubtype?: RfidCardSubtype;
}

/**
 * Un activo declarado por el visitante al ingresar.
 */
export class VisitorAssetDto {
  /** Descripción del activo (ej: "Laptop Dell XPS 15") */
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  description: string;

  /** Número de serie (opcional) */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  serialNumber?: string;

  /** Categoría del activo */
  @IsOptional()
  @IsEnum(AssetCategory)
  category?: AssetCategory;
}

/**
 * Un vehículo declarado por el visitante al ingresar.
 */
export class VisitorVehicleDto {
  /** Placa del vehículo (se normaliza a mayúsculas sin espacios) */
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  licensePlate: string;

  /** Marca (opcional). Ej: "Toyota" */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  /** Modelo (opcional). Ej: "Corolla" */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  /** Color (opcional). Ej: "Blanco" */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  color?: string;

  /** Tipo de vehículo */
  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  /** Zona de parqueadero asignada (opcional). Ej: "P1-A3" */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  parkingZone?: string;
}

export class CreateVisitDto {
  /** ID del visitante relacionado */
  @IsUUID()
  visitorId: string;

  /** ID del usuario (host) al que se visita (legacy - tabla users) */
  @IsOptional()
  @IsUUID()
  hostUserId?: string;

  /** ID del host en la tabla dedicada de anfitriones (preferido) */
  @IsOptional()
  @IsUUID()
  hostId?: string;

  /** Motivo de la visita */
  @IsString()
  reason: string;

  /** Fecha de inicio programada o real */
  @Type(() => Date)
  @IsDate()
  expectedEntryTime: Date;

  /** Fecha de salida programada */
  @Type(() => Date)
  @IsDate()
  expectedExitTime: Date;

  /** Método de acceso principal para esta visita */
  @IsEnum(AccessMethod)
  accessMethod: AccessMethod;

  /**
   * Número de tarjeta RFID (acceso directo para el caso de uso más común).
   * Equivalente a enviar additionalCredentials con type=RFID + cardNumber.
   * Si se especifica, se crea automáticamente una credencial RFID adicional.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  rfidCardNumber?: string;

  /**
   * Subtipo de la tarjeta indicada en `rfidCardNumber`.
   * CSN | WIEGAND | MOBILE_CSN. Si se omite, se asume CSN.
   */
  @IsOptional()
  @IsEnum(RfidCardSubtype)
  rfidCardSubtype?: RfidCardSubtype;

  /**
   * Credenciales adicionales para asignar a esta visita.
   * Permite configurar múltiples métodos de acceso simultáneos:
   * ej: [{ type: 'RFID', cardNumber: 'A1B2C3D4' }, { type: 'QR_JWT' }]
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdditionalCredentialDto)
  additionalCredentials?: AdditionalCredentialDto[];

  /**
   * Grupos de acceso de BioStar que se asignarán al visitante.
   * Se persisten en la visita para visualización y sincronización hardware.
   * Si está vacío, el visitante NO tendrá acceso físico a ninguna puerta.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessGroupDto)
  accessGroups?: AccessGroupDto[];

  /**
   * Si es true, el sistema intentará enrolar al usuario inmediatamente en BioStar.
   * @deprecated La sincronización híbrida ahora es automática (fire-and-forget).
   */
  @IsOptional()
  @IsBoolean()
  autoSyncBioStar?: boolean;

  /**
   * Si es true, el visitante declaró que ingresa con activos (equipos, herramientas, etc.).
   * Cuando es true, el array `assets` debe contener al menos un elemento.
   */
  @IsOptional()
  @IsBoolean()
  hasAssets?: boolean;

  /**
   * Lista de activos declarados por el visitante al ingresar.
   * Requeridos cuando hasAssets es true.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitorAssetDto)
  assets?: VisitorAssetDto[];

  /**
   * Si es true, el visitante declaró que ingresa con vehículo(s).
   * Cuando es true, el array `vehicles` debe contener al menos un elemento.
   */
  @IsOptional()
  @IsBoolean()
  hasVehicles?: boolean;

  /**
   * Lista de vehículos declarados por el visitante al ingresar.
   * Requeridos cuando hasVehicles es true.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitorVehicleDto)
  vehicles?: VisitorVehicleDto[];

  /**
   * Tipo de visitante — categoriza la naturaleza de la visita.
   * Determina el flujo de registro y los requisitos documentales.
   * Acepta los tipos predefinidos (VisitorType) o una clave de tipo
   * personalizado creada por el tenant (texto libre, máx. 50 caracteres).
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  visitorType?: string;

  /**
   * Número / referencia de orden de servicio (solo para visitorType = CONTRACTOR).
   * Permite relacionar la entrada del contratista con una orden de trabajo.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serviceOrder?: string;

  /**
   * Notas adicionales del operador sobre la visita.
   * Campo libre para observaciones, instrucciones especiales, etc.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /**
   * Si es true, habilita el auto-checkout automático para esta visita específica.
   * La lógica de ejecución se implementará posteriormente.
   */
  @IsOptional()
  @IsBoolean()
  autoCheckoutEnabled?: boolean;

  /** Tenant ID, normalmente inyectado en el controlador desde el usuario autenticado */
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
