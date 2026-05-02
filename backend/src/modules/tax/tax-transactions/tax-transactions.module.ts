import { Module } from '@nestjs/common';
import { TaxTransactionsController } from './tax-transactions.controller';
import { TaxTransactionsService } from './tax-transactions.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [TaxTransactionsController],
  providers: [TaxTransactionsService],
  exports: [TaxTransactionsService],
})
export class TaxTransactionsModule {}
