import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { AccountingPeriodsService } from './accounting-periods.service';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { UpdateAccountingPeriodDto } from './dto/update-accounting-period.dto';
import { QueryAccountingPeriodDto } from './dto/query-accounting-period.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('accounting-periods')
export class AccountingPeriodsController {
  constructor(private readonly service: AccountingPeriodsService) {}

  @Get()
  @RequirePermissions('accounting_periods.view')
  findAll(@Query() query: QueryAccountingPeriodDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('accounting_periods.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('accounting_periods.manage')
  create(@Body() dto: CreateAccountingPeriodDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('accounting_periods.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAccountingPeriodDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/close')
  @RequirePermissions('accounting_periods.manage')
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.close(id, user);
  }

  @Patch(':id/lock')
  @RequirePermissions('accounting_periods.manage')
  lock(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.lock(id, user);
  }
}
