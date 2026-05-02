import { Controller, Get, Param, Query } from '@nestjs/common';
import { FinancialReportsService } from './financial-reports.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { IsOptional, IsString } from 'class-validator';

class ReportQueryDto {
  @IsOptional() @IsString() periodId?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @IsString() asOf?: string;
}

@Controller('financial-reports')
export class FinancialReportsController {
  constructor(private readonly service: FinancialReportsService) {}

  @Get('company-summary/:companyId')
  @RequirePermissions('finance.reports.view')
  getCompanySummary(@Param('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.service.getCompanySummary(companyId, user);
  }

  @Get('group-summary')
  @RequirePermissions('finance.reports.view')
  getGroupSummary(@CurrentUser() user: AuthUser) {
    return this.service.getGroupSummary(user);
  }

  @Get('trial-balance/:companyId')
  @RequirePermissions('finance.reports.view')
  getTrialBalance(
    @Param('companyId') companyId: string,
    @Query() q: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getTrialBalance(companyId, q.periodId, q.dateFrom, q.dateTo, user);
  }

  @Get('profit-and-loss/:companyId')
  @RequirePermissions('finance.reports.view')
  getProfitAndLoss(
    @Param('companyId') companyId: string,
    @Query() q: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getProfitAndLoss(companyId, q.dateFrom, q.dateTo, user);
  }

  @Get('balance-sheet/:companyId')
  @RequirePermissions('finance.reports.view')
  getBalanceSheet(
    @Param('companyId') companyId: string,
    @Query() q: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getBalanceSheet(companyId, q.asOf, user);
  }

  @Get('cash-flow/:companyId')
  @RequirePermissions('finance.reports.view')
  getCashFlow(
    @Param('companyId') companyId: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getCashFlow(companyId, periodStart, periodEnd, user);
  }

  @Get('receivables-aging/:companyId')
  @RequirePermissions('finance.reports.view')
  getReceivablesAging(@Param('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.service.getReceivablesAging(companyId, user);
  }

  @Get('payables-aging/:companyId')
  @RequirePermissions('finance.reports.view')
  getPayablesAging(@Param('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.service.getPayablesAging(companyId, user);
  }

  @Get('intercompany-balances')
  @RequirePermissions('finance.reports.view')
  getIntercompanyBalances(@CurrentUser() user: AuthUser) {
    return this.service.getIntercompanyBalances(user);
  }

  // ── Sprint R2 — Group-wide rollups ───────────────────────────────────────

  @Get('group/trial-balance')
  @RequirePermissions('finance.reports.view')
  getGroupTrialBalance(@Query() q: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getGroupTrialBalance(q.periodId, q.dateFrom, q.dateTo, user);
  }

  @Get('group/profit-and-loss')
  @RequirePermissions('finance.reports.view')
  getGroupProfitAndLoss(@Query() q: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getGroupProfitAndLoss(q.dateFrom, q.dateTo, user);
  }

  @Get('group/balance-sheet')
  @RequirePermissions('finance.reports.view')
  getGroupBalanceSheet(@Query() q: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getGroupBalanceSheet(q.asOf, user);
  }

  @Get('group/receivables-aging')
  @RequirePermissions('finance.reports.view')
  getGroupReceivablesAging(@CurrentUser() user: AuthUser) {
    return this.service.getGroupReceivablesAging(user);
  }

  @Get('group/payables-aging')
  @RequirePermissions('finance.reports.view')
  getGroupPayablesAging(@CurrentUser() user: AuthUser) {
    return this.service.getGroupPayablesAging(user);
  }

  @Get('group/cash-position')
  @RequirePermissions('finance.reports.view')
  getGroupCashPosition(@CurrentUser() user: AuthUser) {
    return this.service.getGroupCashPosition(user);
  }
}
