import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
}
