import { DeskTransactionLinksService } from '../../common/services/desk-transaction-links.service';
import { DeskPartyLinksService } from '../../common/services/desk-party-links.service';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CashDeskModule } from '../cash-desk/cash-desk.module';
import { SalesDeskController } from './sales-desk.controller';
import { SalesDeskService } from './sales-desk.service';
@Module({
  imports: [PrismaModule, AuditLogsModule, CashDeskModule],
  controllers: [SalesDeskController],
  providers: [
    DeskTransactionLinksService,
    DeskPartyLinksService,
    SalesDeskService,
    CompanyScopeService,
    OrganizationScopeService,
  ],
})
export class SalesDeskModule {}
