import { Module } from '@nestjs/common';
import { ComplianceCalendarController } from './compliance-calendar.controller';
import { ComplianceCalendarService } from './compliance-calendar.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ComplianceCalendarController],
  providers: [ComplianceCalendarService],
  exports: [ComplianceCalendarService],
})
export class ComplianceCalendarModule {}
