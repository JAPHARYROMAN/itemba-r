import { Controller, Get, Query } from '@nestjs/common';
import { CashBookService } from './cash-book.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';

/** Read-only views for the one-cash-book rule: mapped balances and unmapped ERP accounts. */
@Controller('cash-book')
export class CashBookController {
  constructor(private readonly service: CashBookService) {}

  @Get('reconciliation')
  // Agent-excluded until its Msaidizi evidence fixture is authored: the capability manifest
  // must stay closed over positive fixtures and explicit exclusions (collection read).
  @AgentExcluded()
  @RequirePermissions('cash_desk.view')
  reconciliation(@Query('companyId') companyId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.reconciliation(user, companyId || undefined);
  }

  @Get('unmapped')
  // Agent-excluded until its Msaidizi evidence fixture is authored: the capability manifest
  // must stay closed over positive fixtures and explicit exclusions (collection read).
  @AgentExcluded()
  @RequirePermissions('cash_desk.view')
  unmapped(@Query('companyId') companyId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.unmapped(user, companyId || undefined);
  }
}
