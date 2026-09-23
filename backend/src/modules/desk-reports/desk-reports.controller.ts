import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { DeskReportsService } from './desk-reports.service';
import { DeskReportQuery } from './desk-reports.dto';
/**
 * `@AgentExcluded` — added by the ITEMBA OS redesign (4a155f19) and not yet
 * reviewed for agent eligibility. Every route here stays out of Msaidizi's tool
 * registry (fail closed) until it has reviewed positive evidence.
 */
@Controller('desk-reports')
@AgentExcluded()
export class DeskReportsController {
  constructor(private readonly service: DeskReportsService) {}
  @Get('sales') @RequirePermissions('sales_desk.view') sales(
    @CurrentUser() u: AuthUser,
    @Query() q: DeskReportQuery,
  ) {
    return this.service.sales(u, q);
  }
  @Get('purchases') @RequirePermissions('invoice_desk.view') purchases(
    @CurrentUser() u: AuthUser,
    @Query() q: DeskReportQuery,
  ) {
    return this.service.purchases(u, q);
  }
  @Get('cash') @RequirePermissions('cash_desk.view') cash(
    @CurrentUser() u: AuthUser,
    @Query() q: DeskReportQuery,
  ) {
    return this.service.cash(u, q);
  }
}
