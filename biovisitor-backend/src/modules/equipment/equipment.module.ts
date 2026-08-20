import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EquipmentEntry } from '../../database/entities/equipment-entry.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { EquipmentService } from './equipment.service';
import { EquipmentController } from './equipment.controller';
import { CoreModule } from '../../core/core.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EquipmentEntry, Tenant]),
    CoreModule,
  ],
  controllers: [EquipmentController],
  providers: [EquipmentService],
  exports: [EquipmentService],
})
export class EquipmentModule {}
