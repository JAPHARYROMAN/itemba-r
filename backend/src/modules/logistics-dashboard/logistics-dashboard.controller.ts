import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LogisticsDashboardService } from './logistics-dashboard.service';

@Controller('logistics/dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LogisticsDashboardController {
  constructor(private service: LogisticsDashboardService) {}

  @Get()
  @RequirePermissions('logistics.dashboard.view')
  getSummary(@Query('companyId') companyId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.getSummary(companyId, user);
  }

  @Get('reports/trip-profitability')
  @RequirePermissions('logistics.reports.view')
  getReportTripProfitability(
    @Query('companyId') companyId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.getReportTripProfitability(companyId, from, to, user);
  }

  @Get('reports/fleet-utilization')
  @RequirePermissions('logistics.reports.view')
  getReportFleetUtilization(
    @Query('companyId') companyId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getReportFleetUtilization(companyId, user);
  }

  @Get('reports/fuel-efficiency')
  @RequirePermissions('logistics.reports.view')
  getReportFuelEfficiency(
    @Query('companyId') companyId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getReportFuelEfficiency(companyId, user);
  }

  @Get('reports/maintenance-schedule')
  @RequirePermissions('logistics.reports.view')
  getReportMaintenanceSchedule(
    @Query('companyId') companyId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getReportMaintenanceSchedule(companyId, user);
  }
}
