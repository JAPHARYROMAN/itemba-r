import { Controller, Get, Param, Query } from '@nestjs/common';
import { PartyBalanceService } from './party-balance.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';

const asOfDate = (value?: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
};

/** Read-only: the one balance per party. Green tier; lists already expose these figures. */
@Controller('party-balance')
export class PartyBalanceController {
  constructor(private readonly service: PartyBalanceService) {}

  @Get('suppliers/:id')
  // Agent-excluded until its Msaidizi evidence fixture is authored: the capability manifest
  // must stay closed over positive fixtures and explicit exclusions (path read).
  @AgentExcluded()
  @RequirePermissions('suppliers.view')
  supplier(
    @Param('id') id: string,
    @Query('asOf') asOf: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.supplier(user, id, asOfDate(asOf));
  }

  @Get('customers/:id')
  // Agent-excluded until its Msaidizi evidence fixture is authored: the capability manifest
  // must stay closed over positive fixtures and explicit exclusions (path read).
  @AgentExcluded()
  @RequirePermissions('customers.view')
  customer(
    @Param('id') id: string,
    @Query('asOf') asOf: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.customer(user, id, asOfDate(asOf));
  }
}
