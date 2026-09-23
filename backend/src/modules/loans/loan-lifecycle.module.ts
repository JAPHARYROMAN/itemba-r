import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LoanLedgerService } from './loan-ledger.service';
import { LoanLifecycleService } from './loan-lifecycle.service';
import { IntercompanyLoanLedgerService } from './intercompany-loan-ledger.service';
@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [
    LoanLedgerService,
    LoanLifecycleService,
    IntercompanyLoanLedgerService,
    CompanyScopeService,
    OrganizationScopeService,
  ],
  exports: [LoanLedgerService, LoanLifecycleService, IntercompanyLoanLedgerService],
})
export class LoanLifecycleModule {}
