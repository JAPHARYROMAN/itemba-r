import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  CompanyPageLimitQueryDto,
  ComplianceCalendarQueryDto,
} from '../../../common/dto/resource-query.dto';
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
  findAll(@CurrentUser() user: AuthUser, @Query() query: ComplianceCalendarQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get('overdue')
  @RequirePermissions('compliance_calendar.view')
  findOverdue(@CurrentUser() user: AuthUser, @Query() query: CompanyPageLimitQueryDto) {
    return this.service.findOverdue(user, query);
  }

  @Get('upcoming')
  @RequirePermissions('compliance_calendar.view')
  findUpcoming(@CurrentUser() user: AuthUser, @Query() query: CompanyPageLimitQueryDto) {
    return this.service.findUpcoming(user, query);
  }
}
