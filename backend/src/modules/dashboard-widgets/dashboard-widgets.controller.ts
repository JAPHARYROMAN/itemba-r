import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DashboardWidgetsService } from './dashboard-widgets.service';
import { CreateDashboardWidgetDto } from './dto/create-dashboard-widget.dto';

@ApiTags('Dashboard Widgets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bi/dashboards/:dashboardId/widgets')
export class DashboardWidgetsController {
  constructor(private readonly service: DashboardWidgetsService) {}

  @Post()
  @RequirePermissions('bi.widgets.manage')
  create(@Param('dashboardId') dashboardId: string, @Body() dto: CreateDashboardWidgetDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dashboardId, dto, user);
  }

  @Get()
  @RequirePermissions('bi.widgets.manage')
  findAll(@Param('dashboardId') dashboardId: string, @CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(dashboardId, user, query);
  }

  @Get(':widgetId')
  @RequirePermissions('bi.widgets.manage')
  findOne(@Param('dashboardId') dashboardId: string, @Param('widgetId') widgetId: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(dashboardId, widgetId, user);
  }

  @Patch(':widgetId')
  @RequirePermissions('bi.widgets.manage')
  update(@Param('dashboardId') dashboardId: string, @Param('widgetId') widgetId: string, @Body() dto: Partial<CreateDashboardWidgetDto>, @CurrentUser() user: AuthUser) {
    return this.service.update(dashboardId, widgetId, dto, user);
  }

  @Delete(':widgetId')
  @RequirePermissions('bi.widgets.manage')
  remove(@Param('dashboardId') dashboardId: string, @Param('widgetId') widgetId: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(dashboardId, widgetId, user);
  }
}
