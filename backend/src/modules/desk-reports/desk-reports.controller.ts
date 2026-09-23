import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DeskReportsService } from './desk-reports.service';
import { DeskReportQuery } from './desk-reports.dto';
@Controller('desk-reports')
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
