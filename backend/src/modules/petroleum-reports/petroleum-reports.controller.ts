import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PetroleumReportsService } from './petroleum-reports.service';

@Controller('petroleum/reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PetroleumReportsController {
  constructor(private readonly service: PetroleumReportsService) {}

  @Get('fuel-stock')
  @RequirePermissions('petroleum.reports.view')
  getFuelStock(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.getFuelStock(query, user);
  }

  @Get('shift-summary')
  @RequirePermissions('petroleum.reports.view')
  getShiftSummary(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.getShiftSummary(query, user);
  }

  @Get('deliveries-summary')
  @RequirePermissions('petroleum.reports.view')
  getDeliveriesSummary(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.getDeliveriesSummary(query, user);
  }

  @Get('credit-sales')
  @RequirePermissions('petroleum.reports.view')
  getCreditSalesReport(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.getCreditSalesReport(query, user);
  }

  @Get('tank-dips')
  @RequirePermissions('petroleum.reports.view')
  getTankDipsReport(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.getTankDipsReport(query, user);
  }

  @Get('reconciliation-history')
  @RequirePermissions('petroleum.reports.view')
  getReconciliationHistory(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.getReconciliationHistory(query, user);
  }
}
