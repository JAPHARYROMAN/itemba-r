import { Module } from '@nestjs/common';
import { PayrollRunsController } from './payroll-runs.controller';
import { PayrollRunsService } from './payroll-runs.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { PayrollCalculatorModule } from '../payroll-calculator/payroll-calculator.module';
import { PayrollPostingsModule } from '../payroll-postings/payroll-postings.module';
import { ConstructionLabourCostModule } from '../../construction-labour-cost/construction-labour-cost.module';
import { CompanyScopeService } from '../../../common/services';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    PayrollCalculatorModule,
    PayrollPostingsModule,
    ConstructionLabourCostModule,
  ],
  controllers: [PayrollRunsController],
  providers: [PayrollRunsService, CompanyScopeService],
  exports: [PayrollRunsService],
})
export class PayrollRunsModule {}
