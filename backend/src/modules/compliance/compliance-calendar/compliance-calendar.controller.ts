import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { ComplianceCalendarService } from './compliance-calendar.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance/calendar')
export class ComplianceCalendarController {
  constructor(private readonly service: ComplianceCalendarService) {}

  @Get()
  @RequirePermissions('compliance_calendar.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get('overdue')
  @RequirePermissions('compliance_calendar.view')
  findOverdue(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findOverdue(user, query);
  }

  @Get('upcoming')
  @RequirePermissions('compliance_calendar.view')
  findUpcoming(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findUpcoming(user, query);
  }
}
