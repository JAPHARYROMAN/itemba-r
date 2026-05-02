import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgricultureDashboardService } from './agriculture-dashboard.service';

@Controller('agriculture/dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AgricultureDashboardController {
  constructor(private service: AgricultureDashboardService) {}

  @Get()
  @RequirePermissions('agriculture.dashboard.view')
  getSummary(@Query('companyId') companyId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.getSummary(companyId, user);
  }

  @Get('reports/season-profitability')
  @RequirePermissions('agriculture.dashboard.view')
  getSeasonProfitability(
    @Query('companyId') companyId: string,
    @Query('year') year: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getSeasonProfitabilityReport(
      companyId,
      year ? parseInt(year) : undefined,
      user,
    );
  }

  @Get('reports/yield-analysis')
  @RequirePermissions('agriculture.dashboard.view')
  getYieldAnalysis(@Query('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.service.getYieldAnalysisReport(companyId, user);
  }

  @Get('reports/input-cost')
  @RequirePermissions('agriculture.dashboard.view')
  getInputCost(
    @Query('companyId') companyId: string,
    @Query('cropSeasonId') cropSeasonId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getInputCostReport(companyId, cropSeasonId, user);
  }

  @Get('reports/labor-cost')
  @RequirePermissions('agriculture.dashboard.view')
  getLaborCost(@Query('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.service.getLaborCostReport(companyId, user);
  }
}
