import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { GroupReportsService } from './group-reports.service';

/**
 * Group-level cross-sector reports (Sprint R4). Reads only — no writes.
 * Permission: `group.reports.view` (umbrella). Falls back to
 * `finance.reports.view` since group rollups are a finance-leaning concept.
 */
@Controller('group-reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GroupReportsController {
  constructor(private readonly service: GroupReportsService) {}

  @Get('sales')
  @RequirePermissions('finance.reports.view')
  groupSales(
    @CurrentUser() user: AuthUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.groupSales(user, dateFrom, dateTo);
  }

  @Get('activity-feed')
  @RequirePermissions('finance.reports.view')
  groupActivityFeed(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
    @Query('severity') severity?: string,
  ) {
    return this.service.groupActivityFeed(user, limit ? Number(limit) : 50, severity);
  }

  @Get('audit-trail')
  @RequirePermissions('finance.reports.view')
  groupAuditTrail(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('userId') userId?: string,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
    @Query('severity') severity?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.groupAuditTrail(user, {
      companyId,
      userId,
      entityType,
      action,
      severity,
      dateFrom,
      dateTo,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
