import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CashDeskService } from './cash-desk.service';
import {
  CashAccountDto,
  CashExpenseQuery,
  CashMovementDto,
  CashQuery,
  CashReverseDto,
} from './cash-desk.dto';

@Controller('cash-desk')
@RequirePermissions('cash_desk.view')
export class CashDeskController {
  constructor(private readonly service: CashDeskService) {}
  @Get('directory') directory(@CurrentUser() u: AuthUser) {
    return this.service.directory(u);
  }
  @Get('accounts') accounts(@CurrentUser() u: AuthUser, @Query() q: CashQuery) {
    return this.service.accounts(u, q);
  }
  @Get('overview') overview(@CurrentUser() u: AuthUser, @Query() q: CashQuery) {
    return this.service.overview(u, q);
  }
  @Get('movements') movements(@CurrentUser() u: AuthUser, @Query() q: CashQuery) {
    return this.service.movements(u, q);
  }
  @Get('movements/:id') movement(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.movement(u, id);
  }
  @Get('loans') loans(@CurrentUser() u: AuthUser, @Query() q: CashQuery) {
    return this.service.loans(u, q);
  }
  @Get('loans/:id') loan(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.loan(u, id);
  }
  @Get('expenses') expenses(@CurrentUser() u: AuthUser, @Query() q: CashExpenseQuery) {
    return this.service.expenses(u, q);
  }
  @Post('accounts')
  @RequirePermissions('cash_desk.view', 'cash_desk.manage')
  create(@CurrentUser() u: AuthUser, @Body() d: CashAccountDto) {
    return this.service.createAccount(u, d);
  }
  @Post('movements')
  @RequirePermissions('cash_desk.view', 'cash_desk.record')
  record(@CurrentUser() u: AuthUser, @Body() d: CashMovementDto) {
    return this.service.record(u, d);
  }
  @Post('movements/:id/reverse')
  @RequirePermissions('cash_desk.view', 'cash_desk.reverse')
  reverse(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: CashReverseDto,
  ) {
    return this.service.reverse(u, id, d);
  }
}
