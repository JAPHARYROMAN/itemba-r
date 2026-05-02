import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { SupplierQuotationsController } from './supplier-quotations.controller';
import { SupplierQuotationsService } from './supplier-quotations.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SupplierQuotationsController],
  providers: [SupplierQuotationsService, CompanyScopeService],
  exports: [SupplierQuotationsService],
})
export class SupplierQuotationsModule {}
