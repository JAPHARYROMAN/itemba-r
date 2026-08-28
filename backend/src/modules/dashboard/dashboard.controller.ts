import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermissions } from '../../common/decorators/require-permissions.decorator';
import { DashboardService } from './dashboard.service';
import { SensitiveAccess } from '../../common/decorators/sensitive-access.decorator';
import { SensitiveAccessInterceptor } from '../../common/interceptors/sensitive-access.interceptor';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  /**
   * Full command-centre summary. The payload is company-scoped and designed for
   * the app home dashboard, so any major dashboard/report permission can open it.
   */
  @Get('executive-summary')
  @SensitiveAccess('Dashboard')
  @UseInterceptors(SensitiveAccessInterceptor)
  @RequireAnyPermissions(
    'group-control.view',
    'operations.dashboard.view',
    'operations.reports.view',
    'finance.view',
    'finance.reports.view',
    'receivables.view',
    'payables.view',
    'procurement.dashboard',
    'westsides.dashboard.view',
    'petroleum.dashboard.view',
    'hr.dashboard.view',
    'compliance.dashboard.view',
    'approvals.dashboard.view',
    'profit.view',
  )
  getExecutiveSummary(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.service.getExecutiveSummary(user, companyId);
  }
}
