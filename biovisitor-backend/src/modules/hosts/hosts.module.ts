import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { HostsController } from './hosts.controller';
import { HostsService } from './hosts.service';
import { Host, SupremaApiConnection, User } from '../../database/entities';
import { CoreModule } from '../../core/core.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Host, SupremaApiConnection, User]),
    HttpModule.register({ timeout: 20000, maxRedirects: 2 }),
    CoreModule,
  ],
  controllers: [HostsController],
  providers: [HostsService],
  exports: [HostsService],
})
export class HostsModule {}
