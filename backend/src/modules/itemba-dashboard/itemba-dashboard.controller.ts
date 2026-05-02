import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ItembaDashboardService } from './itemba-dashboard.service';

@Controller('itemba/dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ItembaDashboardController {
  constructor(private service: ItembaDashboardService) {}

  @Get()
  @RequirePermissions('itemba.dashboard.view')
  getSummary(@Query('companyId') companyId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.getSummary(companyId, user);
  }

  @Get('cockpit')
  @RequirePermissions('itemba.dashboard.view')
  cockpit(
    @Query('companyId') companyId: string,
    @Query('divisionId') divisionId?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.cockpit({ companyId, divisionId }, user);
  }
}
