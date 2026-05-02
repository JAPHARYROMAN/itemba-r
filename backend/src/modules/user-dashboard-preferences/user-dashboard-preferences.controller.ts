import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UserDashboardPreferencesService } from './user-dashboard-preferences.service';
import { UpsertDashboardPreferenceDto } from './dto/upsert-dashboard-preference.dto';

@ApiTags('User Dashboard Preferences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bi/my-dashboards')
export class UserDashboardPreferencesController {
  constructor(private readonly service: UserDashboardPreferencesService) {}

  @Get()
  @RequirePermissions('dashboard_preferences.manage')
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Post(':dashboardId/preferences')
  @RequirePermissions('dashboard_preferences.manage')
  upsertCreate(@Param('dashboardId') dashboardId: string, @Body() dto: UpsertDashboardPreferenceDto, @CurrentUser() user: AuthUser) {
    return this.service.upsert(dashboardId, dto, user);
  }

  @Get(':dashboardId/preferences')
  @RequirePermissions('dashboard_preferences.manage')
  get(@Param('dashboardId') dashboardId: string, @CurrentUser() user: AuthUser) {
    return this.service.get(dashboardId, user);
  }

  @Patch(':dashboardId/preferences')
  @RequirePermissions('dashboard_preferences.manage')
  upsertUpdate(@Param('dashboardId') dashboardId: string, @Body() dto: UpsertDashboardPreferenceDto, @CurrentUser() user: AuthUser) {
    return this.service.upsert(dashboardId, dto, user);
  }

  @Post(':dashboardId/set-default')
  @RequirePermissions('dashboard_preferences.manage')
  setDefault(@Param('dashboardId') dashboardId: string, @CurrentUser() user: AuthUser) {
    return this.service.setDefault(dashboardId, user);
  }
}
