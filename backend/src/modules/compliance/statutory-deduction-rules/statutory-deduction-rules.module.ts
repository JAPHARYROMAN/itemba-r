import { Module } from '@nestjs/common';
import { StatutoryDeductionRulesController } from './statutory-deduction-rules.controller';
import { StatutoryDeductionRulesService } from './statutory-deduction-rules.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [StatutoryDeductionRulesController],
  providers: [StatutoryDeductionRulesService],
  exports: [StatutoryDeductionRulesService],
})
export class StatutoryDeductionRulesModule {}
