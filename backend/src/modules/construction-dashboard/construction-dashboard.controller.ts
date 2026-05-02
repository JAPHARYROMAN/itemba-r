import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ConstructionDashboardService } from './construction-dashboard.service';

@Controller('construction/dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConstructionDashboardController {
  constructor(private service: ConstructionDashboardService) {}

  @Get()
  @RequirePermissions('construction.dashboard.view')
  getSummary(@Query('companyId') companyId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.getSummary(companyId, user);
  }
}
