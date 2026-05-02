import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { OshaRegistrationsController } from './osha-registrations.controller';
import { OshaRegistrationsService } from './osha-registrations.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [OshaRegistrationsController],
  providers: [OshaRegistrationsService],
  exports: [OshaRegistrationsService],
})
export class OshaRegistrationsModule {}
