import { Module } from '@nestjs/common';
import { PayrollEntriesController } from './payroll-entries.controller';
import { PayrollEntriesService } from './payroll-entries.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PayrollEntriesController],
  providers: [PayrollEntriesService, CompanyScopeService],
  exports: [PayrollEntriesService],
})
export class PayrollEntriesModule {}
