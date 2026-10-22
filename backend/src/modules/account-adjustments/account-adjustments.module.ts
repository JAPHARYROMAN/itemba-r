import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/services';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccountingEngineModule } from '../accounting-engine/accounting-engine.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SupplierPaymentsModule } from '../supplier-payments/supplier-payments.module';
import { AccountAdjustmentsController } from './account-adjustments.controller';
import { AccountAdjustmentsService } from './account-adjustments.service';

@Module({
  imports: [PrismaModule, AccountingEngineModule, AuditLogsModule, SupplierPaymentsModule],
  controllers: [AccountAdjustmentsController],
  providers: [AccountAdjustmentsService, CompanyScopeService, OrganizationScopeService],
  exports: [AccountAdjustmentsService],
})
export class AccountAdjustmentsModule {}
