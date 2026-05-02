import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { HrDashboardService } from './hr-dashboard.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/dashboard')
export class HrDashboardController {
  constructor(private readonly service: HrDashboardService) {}

  @Get()
  @RequirePermissions('hr.dashboard.view')
  getDashboard(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.service.getDashboard(user, companyId);
  }
}
