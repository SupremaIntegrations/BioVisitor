/**
 * @file index.ts
 * @description Barrel export de todas las entidades de base de datos.
 * Centraliza las exportaciones para uso en TypeORM y en los módulos de servicio.
 *
 * @module database/entities
 */

export { Tenant, BioStarPlatform } from './tenant.entity';
export { User, UserRole } from './user.entity';
export { Visitor, DocumentType } from './visitor.entity';
export { Visit, AccessMethod, VisitStatus, VisitorType } from './visit.entity';
export { AccessCredential, CredentialType, CredentialSyncStatus, RfidCardSubtype } from './access-credential.entity';
export { AuditLog } from './audit-log.entity';
export { Blacklist } from './blacklist.entity';
export { PreRegistration } from './pre-registration.entity';
export {
  VisitorDocument,
  VisitorDocumentType,
} from './visitor-document.entity';
export {
  SupremaApiConnection,
  ConnectionTestStatus,
} from './suprema-api-connection.entity';
export { Host, HostSource } from './host.entity';
export { VisitorAsset, AssetCategory } from './visitor-asset.entity';
export { VisitorVehicle, VehicleType } from './visitor-vehicle.entity';
export { EquipmentEntry, EquipmentCategory, EquipmentStatus } from './equipment-entry.entity';
