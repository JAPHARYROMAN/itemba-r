import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { TaxAutoApplyService } from './tax-auto-apply.service';

/**
 * Manual triggers for the tax auto-apply pass. Useful for backfilling the
 * TaxTransaction ledger over historical orders that pre-date C2, and for
 * smoke-testing the wiring without enabling the global env flag.
 *
 * The same idempotency rules as the auto-call apply — calling repeatedly
 * is safe.
 */
@Controller('tax-auto-apply')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TaxAutoApplyController {
  constructor(private readonly service: TaxAutoApplyService) {}

  @Post('sales-order/:id')
  @RequirePermissions('finance.reports.view')
  applySalesOrder(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.applyForSalesOrder(id, user.id);
  }

  @Post('purchase-order/:id')
  @RequirePermissions('finance.reports.view')
  applyPurchaseOrder(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.applyForPurchaseOrder(id, user.id);
  }
}
