import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog, User } from '../database/entities';
import { EncryptionService } from './crypto/encryption.service';
import { StructuredLoggerService } from './logging/structured-logger.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, User])],
  providers: [EncryptionService, StructuredLoggerService],
  exports: [EncryptionService, StructuredLoggerService],
})
export class CoreModule {}
