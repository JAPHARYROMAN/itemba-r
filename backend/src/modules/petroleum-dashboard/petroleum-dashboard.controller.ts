import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PetroleumDashboardService } from './petroleum-dashboard.service';

@Controller('petroleum/dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PetroleumDashboardController {
  constructor(private readonly service: PetroleumDashboardService) {}

  @Get()
  @RequirePermissions('petroleum.dashboard.view')
  getDashboard(
    @Query() query: { companyId?: string; branchId?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getDashboard(query, user);
  }

  @Get('branch/:branchId')
  @RequirePermissions('petroleum.dashboard.view')
  getBranchDashboard(@Param('branchId') branchId: string, @CurrentUser() user: AuthUser) {
    return this.service.getBranchDashboard(branchId, user);
  }
}
