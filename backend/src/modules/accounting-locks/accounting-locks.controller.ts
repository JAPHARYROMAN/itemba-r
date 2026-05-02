import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AccountingLocksService } from './accounting-locks.service';

@Controller('accounting-locks')
export class AccountingLocksController {
  constructor(private readonly service: AccountingLocksService) {}

  @Get()
  @RequirePermissions('accounting_locks.list')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('accounting_locks.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('accounting_locks.create')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Post(':id/release')
  @RequirePermissions('accounting_locks.release')
  release(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.release(id, user);
  }
}
