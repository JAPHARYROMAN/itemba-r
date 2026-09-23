import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SensitiveAccess } from '../../common/decorators/sensitive-access.decorator';
import { SensitiveAccessInterceptor } from '../../common/interceptors/sensitive-access.interceptor';
import { DeskReportQuery } from './desk-reports.dto';
import { FinancingReportsService } from './financing.service';
@Controller('desk-reports/financing')
export class FinancingReportsController {
  constructor(private readonly service: FinancingReportsService) {}
  @Get('borrowings')
  @RequirePermissions('loans.read', 'loan_schedules.list')
  @SensitiveAccess('Loans')
  @UseInterceptors(SensitiveAccessInterceptor)
  borrowings(@CurrentUser() user: AuthUser, @Query() q: DeskReportQuery) {
    return this.service.borrowings(user, q);
  }
  @Get('internal')
  @RequirePermissions('cash_desk.view')
  internal(@CurrentUser() user: AuthUser, @Query() q: DeskReportQuery) {
    return this.service.internal(user, q);
  }
}
