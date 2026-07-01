import { Controller, Get, Param, Query } from '@nestjs/common';
import { FinancialReportsService } from './financial-reports.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { IsOptional, IsString } from 'class-validator';

class ReportQueryDto {
  @IsOptional() @IsString() periodId?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @IsString() periodStart?: string;
  @IsOptional() @IsString() periodEnd?: string;
  @IsOptional() @IsString() year?: string;
  @IsOptional() @IsString() month?: string;
  @IsOptional() @IsString() fromMonth?: string;
  @IsOptional() @IsString() toMonth?: string;
  @IsOptional() @IsString() asOf?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
}

function resolvePeriodRange(q: ReportQueryDto) {
  const currentYear = new Date().getUTCFullYear();
  const parsedYear = Number(q.year);
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 3000
      ? parsedYear
      : currentYear;

  const parseMonth = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : fallback;
  };

  const requestedFromMonth = parseMonth(q.fromMonth ?? q.month, 1);
  const requestedToMonth = parseMonth(q.toMonth ?? q.month, requestedFromMonth);
  const fromMonth = Math.min(requestedFromMonth, requestedToMonth);
  const toMonth = Math.max(requestedFromMonth, requestedToMonth);
  const monthStart = `${year}-${String(fromMonth).padStart(2, '0')}-01`;
  const monthEnd = new Date(Date.UTC(year, toMonth, 0)).toISOString().slice(0, 10);

  return {
    periodStart: q.periodStart ?? q.dateFrom ?? monthStart,
    periodEnd: q.periodEnd ?? q.dateTo ?? monthEnd,
  };
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
    return this.service.getTrialBalance(companyId, q.periodId, q.dateFrom, q.dateTo, user, {
      divisionId: q.divisionId,
      branchId: q.branchId,
    });
  }

  @Get('profit-and-loss/:companyId')
  @RequirePermissions('finance.reports.view')
  getProfitAndLoss(
    @Param('companyId') companyId: string,
    @Query() q: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getProfitAndLoss(companyId, q.dateFrom, q.dateTo, user, {
      divisionId: q.divisionId,
      branchId: q.branchId,
    });
  }

  @Get('balance-sheet/:companyId')
  @RequirePermissions('finance.reports.view')
  getBalanceSheet(
    @Param('companyId') companyId: string,
    @Query() q: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getBalanceSheet(companyId, q.asOf, user, {
      divisionId: q.divisionId,
      branchId: q.branchId,
    });
  }

  @Get('cash-flow/:companyId')
  @RequirePermissions('finance.reports.view')
  getCashFlow(
    @Param('companyId') companyId: string,
    @Query() q: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const { periodStart, periodEnd } = resolvePeriodRange(q);
    return this.service.getCashFlow(companyId, periodStart, periodEnd, user, {
      divisionId: q.divisionId,
      branchId: q.branchId,
    });
  }

  @Get('scope-rollup/:companyId')
  @RequirePermissions('finance.reports.view')
  getScopeRollup(
    @Param('companyId') companyId: string,
    @Query() q: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getScopeRollup(companyId, q.dateFrom, q.dateTo, user);
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

  @Get('customer-aging/:companyId')
  @RequirePermissions('finance.reports.view')
  getCustomerAging(@Param('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.service.getCustomerAging(companyId, user);
  }

  @Get('customer-aging-detail/:companyId/:customerId')
  @RequirePermissions('finance.reports.view')
  getCustomerAgingDetail(
    @Param('companyId') companyId: string,
    @Param('customerId') customerId: string,
    @Query() q: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getCustomerAgingDetail(companyId, customerId, q.asOf, user);
  }

  @Get('supplier-aging/:companyId')
  @RequirePermissions('finance.reports.view')
  getSupplierAging(@Param('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.service.getSupplierAging(companyId, user);
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

  @Get('group/consolidated/profit-and-loss')
  @RequirePermissions('finance.reports.view')
  getConsolidatedProfitAndLoss(@Query() q: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getConsolidatedProfitAndLoss(q.dateFrom, q.dateTo, user);
  }

  @Get('group/consolidated/balance-sheet')
  @RequirePermissions('finance.reports.view')
  getConsolidatedBalanceSheet(@Query() q: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getConsolidatedBalanceSheet(q.asOf, user);
  }

  @Get('group/consolidated/cash-flow')
  @RequirePermissions('finance.reports.view')
  getConsolidatedCashFlow(@Query() q: ReportQueryDto, @CurrentUser() user: AuthUser) {
    const { periodStart, periodEnd } = resolvePeriodRange(q);
    return this.service.getConsolidatedCashFlow(periodStart, periodEnd, user);
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
