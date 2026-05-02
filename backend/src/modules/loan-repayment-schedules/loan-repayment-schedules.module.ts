import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LoanRepaymentSchedulesController } from './loan-repayment-schedules.controller';
import { LoanRepaymentSchedulesService } from './loan-repayment-schedules.service';
import { AccountingControlService } from '../../common/services/accounting-control.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [LoanRepaymentSchedulesController],
  providers: [LoanRepaymentSchedulesService, AccountingControlService, AccountResolverService],
  exports: [LoanRepaymentSchedulesService],
})
export class LoanRepaymentSchedulesModule {}
