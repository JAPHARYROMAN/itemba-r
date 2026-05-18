import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { RentInvoicesService } from './rent-invoices.service';
import { RentInvoicesController } from './rent-invoices.controller';

// AccountingEngineModule is @Global, so PostingEngineService is available
// across the app without importing it here. AccountResolverService is a
// stateless helper and is provided locally so each module has its own instance.
@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [RentInvoicesService, AccountResolverService],
  controllers: [RentInvoicesController],
  exports: [RentInvoicesService],
})
export class RentInvoicesModule {}
