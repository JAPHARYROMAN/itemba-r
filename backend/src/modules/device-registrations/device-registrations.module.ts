import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DeviceRegistrationsController } from './device-registrations.controller';
import { DeviceRegistrationsService } from './device-registrations.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DeviceRegistrationsController],
  providers: [DeviceRegistrationsService],
  exports: [DeviceRegistrationsService],
})
export class DeviceRegistrationsModule {}
