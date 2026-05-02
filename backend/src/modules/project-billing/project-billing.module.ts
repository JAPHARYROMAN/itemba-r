import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { ProjectBillingService } from './project-billing.service';
import { ProjectBillingController } from './project-billing.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, SalesOrdersModule],
  providers: [ProjectBillingService],
  controllers: [ProjectBillingController],
  exports: [ProjectBillingService],
})
export class ProjectBillingModule {}
