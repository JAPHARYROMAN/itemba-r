import { Module } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { QuotationsController } from './quotations.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  // SalesOrdersModule is imported so the quotation→SO conversion can route the
  // new order through SalesOrdersService.confirm(), which posts the GL journal,
  // creates the receivable, and issues stock atomically (there is no reverse
  // dependency, so this does not create a cycle).
  imports: [PrismaModule, AuditLogsModule, SalesOrdersModule],
  controllers: [QuotationsController],
  providers: [QuotationsService, CompanyScopeService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
