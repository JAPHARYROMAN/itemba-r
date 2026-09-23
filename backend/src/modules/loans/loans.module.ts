import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { LoanLifecycleModule } from './loan-lifecycle.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, LoanLifecycleModule],
  controllers: [LoansController],
  providers: [LoansService, CompanyScopeService],
  exports: [LoansService],
})
export class LoansModule {}
