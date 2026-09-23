import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { DeskReportsController } from './desk-reports.controller';
import { DeskReportsService } from './desk-reports.service';
import { FinancingReportsService } from './financing.service';
import { FinancingReportsController } from './financing.controller';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DeskPostingService } from './desk-posting.service';
import { DeskPostingController } from './desk-posting.controller';
import { CashConnectionsService } from './cash-connections.service';
import { CashConnectionsController } from './cash-connections.controller';
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [
    DeskReportsController,
    FinancingReportsController,
    DeskPostingController,
    CashConnectionsController,
  ],
  exports: [CashConnectionsService],
  providers: [
    CashConnectionsService,
    DeskReportsService,
    DeskPostingService,
    FinancingReportsService,
    AccountResolverService,
    CompanyScopeService,
    OrganizationScopeService,
  ],
})
export class DeskReportsModule {}
