import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AccountAdjustmentsService } from './account-adjustments.service';
import { CreateAccountAdjustmentDto } from './dto/create-account-adjustment.dto';
import { ReverseAccountAdjustmentDto } from './dto/reverse-account-adjustment.dto';

@Controller()
export class AccountAdjustmentsController {
  constructor(private readonly service: AccountAdjustmentsService) {}

  @Get('receivables/:id/adjustments')
  @AgentExcluded()
  @RequirePermissions('receivables.view')
  listReceivable(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.list('receivable', id, user);
  }

  @Get('receivables/:id/adjustments/offset-accounts')
  @AgentExcluded()
  @RequirePermissions('receivables.manage')
  offsetAccountsReceivable(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.offsetAccounts('receivable', id, user);
  }

  @Post('receivables/:id/adjustments')
  @AgentExcluded()
  @RequirePermissions('receivables.manage')
  createReceivable(
    @Param('id') id: string,
    @Body() dto: CreateAccountAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create('receivable', id, dto, user);
  }

  @Patch('receivables/:id/adjustments/:adjustmentId/reverse')
  @AgentExcluded()
  @RequirePermissions('receivables.manage')
  reverseReceivable(
    @Param('id') id: string,
    @Param('adjustmentId') adjustmentId: string,
    @Body() dto: ReverseAccountAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reverse('receivable', id, adjustmentId, dto, user);
  }

  @Get('payables/:id/adjustments')
  @AgentExcluded()
  @RequirePermissions('payables.view')
  listPayable(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.list('payable', id, user);
  }

  @Get('payables/:id/adjustments/offset-accounts')
  @AgentExcluded()
  @RequirePermissions('payables.manage')
  offsetAccountsPayable(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.offsetAccounts('payable', id, user);
  }

  @Post('payables/:id/adjustments')
  @AgentExcluded()
  @RequirePermissions('payables.manage')
  createPayable(
    @Param('id') id: string,
    @Body() dto: CreateAccountAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create('payable', id, dto, user);
  }

  @Patch('payables/:id/adjustments/:adjustmentId/reverse')
  @AgentExcluded()
  @RequirePermissions('payables.manage')
  reversePayable(
    @Param('id') id: string,
    @Param('adjustmentId') adjustmentId: string,
    @Body() dto: ReverseAccountAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reverse('payable', id, adjustmentId, dto, user);
  }
}
