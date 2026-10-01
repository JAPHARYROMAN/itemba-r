import { Module } from '@nestjs/common';
import { FuelReportingModule } from '../fuel-reporting/fuel-reporting.module';
import { PetroDollarController } from './petrodollar.controller';
import { PetroDollarService } from './petrodollar.service';
import { PetroDollarPostingService } from './petrodollar-posting.service';
import { CashDeskModule } from '../cash-desk/cash-desk.module';
import { DeskReportsModule } from '../desk-reports/desk-reports.module';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { DeskPartyLinksService } from '../../common/services/desk-party-links.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    FuelReportingModule,
    CashDeskModule,
    DeskReportsModule,
    InventoryMovementsModule,
    AuditLogsModule,
  ],
  controllers: [PetroDollarController],
  providers: [
    PetroDollarService,
    PetroDollarPostingService,
    CompanyScopeService,
    OrganizationScopeService,
    DeskPartyLinksService,
  ],
})
export class PetroDollarModule {}
