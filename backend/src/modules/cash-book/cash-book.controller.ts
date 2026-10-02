import { Controller, Get, Query } from '@nestjs/common';
import { CashBookService } from './cash-book.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

/** Read-only views for the one-cash-book rule: mapped balances and unmapped ERP accounts. */
@Controller('cash-book')
export class CashBookController {
  constructor(private readonly service: CashBookService) {}

  @Get('reconciliation')
  @RequirePermissions('cash_desk.view')
  reconciliation(@Query('companyId') companyId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.reconciliation(user, companyId || undefined);
  }

  @Get('unmapped')
  @RequirePermissions('cash_desk.view')
  unmapped(@Query('companyId') companyId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.unmapped(user, companyId || undefined);
  }
}
