import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/services';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SupplierOrderDraftsController } from './supplier-order-drafts.controller';
import { SupplierOrderDraftsService } from './supplier-order-drafts.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SupplierOrderDraftsController],
  providers: [SupplierOrderDraftsService, CompanyScopeService],
  exports: [SupplierOrderDraftsService],
})
export class SupplierOrderDraftsModule {}
