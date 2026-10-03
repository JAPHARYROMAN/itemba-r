import { Controller, Get, Param } from '@nestjs/common';
import { PartyProfileService } from './party-profile.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';

/**
 * Read-only profile sections (party linkage, Phase 2 PR-4). The profile permission opens
 * the route; each section also requires the permission of the register it reads from.
 */
@Controller('party-profile')
export class PartyProfileController {
  constructor(private readonly service: PartyProfileService) {}

  @Get('suppliers/:id/:section')
  // Agent-excluded until its Msaidizi evidence fixture is authored: the capability manifest
  // must stay closed over positive fixtures and explicit exclusions (path read).
  @AgentExcluded()
  @RequirePermissions('suppliers.view')
  supplier(
    @Param('id') id: string,
    @Param('section') section: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.supplier(user, id, section);
  }

  @Get('customers/:id/:section')
  // Agent-excluded until its Msaidizi evidence fixture is authored: the capability manifest
  // must stay closed over positive fixtures and explicit exclusions (path read).
  @AgentExcluded()
  @RequirePermissions('customers.view')
  customer(
    @Param('id') id: string,
    @Param('section') section: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.customer(user, id, section);
  }
}
