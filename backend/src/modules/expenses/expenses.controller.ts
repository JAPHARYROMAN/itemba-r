import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { RejectExpenseDto } from './dto/reject-expense.dto';
import { PayExpenseDto } from './dto/pay-expense.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}

  @Get()
  @RequirePermissions('expenses.view')
  findAll(@Query() query: QueryExpenseDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('expenses.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('expenses.create')
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('expenses.create')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/submit')
  @RequirePermissions('expenses.approve')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user);
  }

  @Patch(':id/approve')
  @RequirePermissions('expenses.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Patch(':id/reject')
  @RequirePermissions('expenses.approve')
  reject(@Param('id') id: string, @Body() dto: RejectExpenseDto, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, dto, user);
  }

  @Patch(':id/pay')
  @RequirePermissions('expenses.pay')
  pay(@Param('id') id: string, @Body() dto: PayExpenseDto, @CurrentUser() user: AuthUser) {
    return this.service.pay(id, dto, user);
  }

  @Get(':id/payment-options')
  @RequirePermissions('expenses.pay')
  paymentOptions(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.paymentOptions(id, user);
  }

  @Delete(':id')
  @RequirePermissions('expenses.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
