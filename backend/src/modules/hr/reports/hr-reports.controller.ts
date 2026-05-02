import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { HrReportsService } from './hr-reports.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/reports')
export class HrReportsController {
  constructor(private readonly service: HrReportsService) {}

  @Get('employees')
  @RequirePermissions('hr.reports.view')
  employeeReport(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.employeeReport(user, query);
  }

  @Get('attendance')
  @RequirePermissions('hr.reports.view')
  attendanceReport(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.attendanceReport(user, query);
  }

  @Get('payroll')
  @RequirePermissions('hr.reports.view')
  payrollReport(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.payrollReport(user, query);
  }

  @Get('leave')
  @RequirePermissions('hr.reports.view')
  leaveReport(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.leaveReport(user, query);
  }
}
