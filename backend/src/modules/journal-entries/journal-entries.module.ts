import { Module } from '@nestjs/common';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntriesController } from './journal-entries.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AccountingControlService, CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [JournalEntriesController],
  providers: [JournalEntriesService, AccountingControlService, CompanyScopeService],
  exports: [JournalEntriesService],
})
export class JournalEntriesModule {}
