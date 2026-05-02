import { Module } from '@nestjs/common';
import { ComplianceEventsController } from './compliance-events.controller';
import { ComplianceEventsService } from './compliance-events.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ComplianceEventsController],
  providers: [ComplianceEventsService],
  exports: [ComplianceEventsService],
})
export class ComplianceEventsModule {}
