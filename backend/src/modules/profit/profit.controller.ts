import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermissions } from '../../common/decorators/require-permissions.decorator';
import { ProfitService, ValidateSaleLinesInput } from './profit.service';

@Controller('profit')
export class ProfitController {
  constructor(private readonly profit: ProfitService) {}

  @Get('product-summary')
  @RequireAnyPermissions('profit.view', 'operations.reports.view')
  productSummary(@Query() query: Record<string, string | undefined>, @CurrentUser() user: AuthUser) {
    return this.profit.productSummary(query, user);
  }

  @Get('cost-gaps')
  @RequireAnyPermissions('profit.view', 'operations.reports.view')
  costGaps(@Query() query: Record<string, string | undefined>, @CurrentUser() user: AuthUser) {
    return this.profit.costGaps(query, user);
  }

  @Get('below-cost-attempts')
  @RequireAnyPermissions('profit.audit', 'profit.view')
  belowCostAttempts(@Query() query: Record<string, string | undefined>, @CurrentUser() user: AuthUser) {
    return this.profit.belowCostAttempts(query, user);
  }

  @Get('export')
  @RequireAnyPermissions('profit.view', 'operations.reports.view')
  exportReport(@Query() query: Record<string, string | undefined>, @CurrentUser() user: AuthUser) {
    return this.profit.exportReport(query, user);
  }

  @Get('products/:productId/ledger')
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
  validateSaleLines(@Body() body: ValidateSaleLinesInput, @CurrentUser() user: AuthUser) {
    return this.profit.validateSaleLinesForUser(body, user);
  }

  @Patch('products/:productId/cost')
  @RequireAnyPermissions('profit.manage_costs')
  fixCostGap(
    @Param('productId') productId: string,
    @Body() body: Record<string, string | number | null | undefined>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.profit.fixCostGap(productId, body, user);
  }

  @Post('backfill-sales')
  @RequireAnyPermissions('profit.manage_costs')
  backfillSales(@Query() query: Record<string, string | undefined>, @CurrentUser() user: AuthUser) {
    return this.profit.backfillHistoricalSales(query, user);
  }
}
