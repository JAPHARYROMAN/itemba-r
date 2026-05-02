import { Module } from '@nestjs/common';
import { FuelDailyReconciliationService } from './fuel-daily-reconciliation.service';
import { FuelDailyReconciliationController } from './fuel-daily-reconciliation.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PetroleumShiftControlService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FuelDailyReconciliationController],
  providers: [FuelDailyReconciliationService, PetroleumShiftControlService],
  exports: [FuelDailyReconciliationService],
})
export class FuelDailyReconciliationModule {}
