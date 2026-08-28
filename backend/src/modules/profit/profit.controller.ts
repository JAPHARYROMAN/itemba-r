import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ProfitBelowCostAttemptsQueryDto,
  ProfitCostGapsQueryDto,
  ProfitExportQueryDto,
  ProfitProductSummaryQueryDto,
} from '../../common/dto/resource-query.dto';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { RequireAnyPermissions } from '../../common/decorators/require-permissions.decorator';
import { ProfitService } from './profit.service';
import {
  BackfillProfitSalesQueryDto,
  FixProfitCostGapDto,
  ValidateSaleLinesDto,
} from './dto/profit-action.dto';

@Controller('profit')
export class ProfitController {
  constructor(private readonly profit: ProfitService) {}

  @Get('product-summary')
  @RequireAnyPermissions('profit.view', 'operations.reports.view')
  productSummary(@Query() query: ProfitProductSummaryQueryDto, @CurrentUser() user: AuthUser) {
    return this.profit.productSummary(query, user);
  }

  // Company-scoped via the path param, merged into the query object so it flows
  // through the same companyWhereFor scoping as product-summary. companyScope still
  // asserts the user can access this company, so the path param cannot be used to
  // read another tenant's data.
  @Get('customer-summary/:companyId')
  @AgentExcluded('query_schema_not_strict')
  @RequireAnyPermissions('profit.view', 'operations.reports.view')
  customerSummary(
    @Param('companyId') companyId: string,
    @Query() query: Record<string, string | undefined>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profit.customerSummary({ ...query, companyId }, user);
  }

  @Get('cost-gaps')
  @RequireAnyPermissions('profit.view', 'operations.reports.view')
  costGaps(@Query() query: ProfitCostGapsQueryDto, @CurrentUser() user: AuthUser) {
    return this.profit.costGaps(query, user);
  }

  @Get('below-cost-attempts')
  @RequireAnyPermissions('profit.audit', 'profit.view')
  belowCostAttempts(
    @Query() query: ProfitBelowCostAttemptsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profit.belowCostAttempts(query, user);
  }

  @Get('export')
  @AgentExcluded('read_writes_audit_ledger')
  @RequireAnyPermissions('profit.view', 'operations.reports.view')
  exportReport(@Query() query: ProfitExportQueryDto, @CurrentUser() user: AuthUser) {
    return this.profit.exportReport(query, user);
  }

  @Get('products/:productId/ledger')
  @AgentExcluded('query_schema_not_strict')
  @RequireAnyPermissions('profit.view', 'operations.reports.view')
  productLedger(
    @Param('productId') productId: string,
    @Query() query: Record<string, string | undefined>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profit.productLedger(productId, query, user);
  }

  @Post('validate-sale-lines')
  @RequireAnyPermissions('profit.view', 'sales.create', 'pos.create')
  validateSaleLines(@Body() body: ValidateSaleLinesDto, @CurrentUser() user: AuthUser) {
    return this.profit.validateSaleLinesForUser(body, user);
  }

  @Patch('products/:productId/cost')
  @RequireAnyPermissions('profit.manage_costs')
  fixCostGap(
    @Param('productId') productId: string,
    @Body() body: FixProfitCostGapDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profit.fixCostGap(productId, body, user);
  }

  @Post('backfill-sales')
  @RequireAnyPermissions('profit.manage_costs')
  backfillSales(
    @Query() query: BackfillProfitSalesQueryDto,
    @Query('companyId') companyId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profit.backfillHistoricalSales({ ...query, companyId }, user);
  }
}
