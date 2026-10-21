import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ReceiptPayablesService } from './receipt-payables.service';
import { SupplierPaymentsModule } from '../supplier-payments/supplier-payments.module';

@Module({
  imports: [AuditLogsModule, SupplierPaymentsModule],
  providers: [ReceiptPayablesService],
  exports: [ReceiptPayablesService],
})
export class ReceiptPayablesModule {}
