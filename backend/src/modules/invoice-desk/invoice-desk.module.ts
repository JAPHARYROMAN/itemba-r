import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InvoiceDeskController } from './invoice-desk.controller';
import { InvoiceDeskService } from './invoice-desk.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  exports: [InvoiceDeskService],
  controllers: [InvoiceDeskController],
  providers: [InvoiceDeskService, CompanyScopeService, OrganizationScopeService],
})
export class InvoiceDeskModule {}
