import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RecordBookService } from './record-book.service';
import {
  CreateDailySaleDto,
  CreateRecordBookCategoryDto,
  CreateRecordBookExpenseDto,
  ExportRecordBookDto,
  QueryRecordBookDto,
  UpdateDailySaleDto,
  UpdateRecordBookCategoryDto,
  UpdateRecordBookExpenseDto,
  VoidRecordBookDto,
} from './dto/record-book.dto';

@Controller('record-book')
export class RecordBookController {
  constructor(private readonly service: RecordBookService) {}

  @Get('summary')
  @RequirePermissions('record_book.view')
  summary(@Query() query: QueryRecordBookDto, @CurrentUser() user: AuthUser) {
    return this.service.summary(query, user);
  }

  @Get('export')
  @RequirePermissions('record_book.export')
  export(
    @Query() query: ExportRecordBookDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    return this.service.export(query, user, res);
  }

  @Get('daily-sales')
  @RequirePermissions('record_book.view')
  findDailySales(@Query() query: QueryRecordBookDto, @CurrentUser() user: AuthUser) {
    return this.service.findDailySales(query, user);
  }

  @Post('daily-sales')
  @RequirePermissions('record_book.create')
  createDailySale(@Body() dto: CreateDailySaleDto, @CurrentUser() user: AuthUser) {
    return this.service.createDailySale(dto, user);
  }

  @Get('daily-sales/:id')
  @RequirePermissions('record_book.view')
  findDailySale(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findDailySale(id, user);
  }

  @Patch('daily-sales/:id')
  @RequireAnyPermissions('record_book.update', 'record_book.create')
  updateDailySale(
    @Param('id') id: string,
    @Body() dto: UpdateDailySaleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateDailySale(id, dto, user);
  }

  @Patch('daily-sales/:id/finalize')
  @RequirePermissions('record_book.finalize')
  finalizeDailySale(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.finalizeDailySale(id, user);
  }

  @Patch('daily-sales/:id/reopen')
  @RequirePermissions('record_book.admin')
  reopenDailySale(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reopenDailySale(id, user);
  }

  @Patch('daily-sales/:id/void')
  @RequirePermissions('record_book.void')
  voidDailySale(
    @Param('id') id: string,
    @Body() dto: VoidRecordBookDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.voidDailySale(id, dto, user);
  }

  @Get('expenses')
  @RequirePermissions('record_book.view')
  findExpenses(@Query() query: QueryRecordBookDto, @CurrentUser() user: AuthUser) {
    return this.service.findExpenses(query, user);
  }

  @Post('expenses')
  @RequirePermissions('record_book.create')
  createExpense(@Body() dto: CreateRecordBookExpenseDto, @CurrentUser() user: AuthUser) {
    return this.service.createExpense(dto, user);
  }

  @Get('expenses/:id')
  @RequirePermissions('record_book.view')
  findExpense(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findExpense(id, user);
  }

  @Patch('expenses/:id')
  @RequireAnyPermissions('record_book.update', 'record_book.create')
  updateExpense(
    @Param('id') id: string,
    @Body() dto: UpdateRecordBookExpenseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateExpense(id, dto, user);
  }

  @Patch('expenses/:id/finalize')
  @RequirePermissions('record_book.finalize')
  finalizeExpense(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.finalizeExpense(id, user);
  }

  @Patch('expenses/:id/reopen')
  @RequirePermissions('record_book.admin')
  reopenExpense(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reopenExpense(id, user);
  }

  @Patch('expenses/:id/void')
  @RequirePermissions('record_book.void')
  voidExpense(
    @Param('id') id: string,
    @Body() dto: VoidRecordBookDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.voidExpense(id, dto, user);
  }

  @Get('expense-categories')
  @RequirePermissions('record_book.view')
  findCategories(@Query() query: QueryRecordBookDto, @CurrentUser() user: AuthUser) {
    return this.service.findCategories(query, user);
  }

  @Post('expense-categories')
  @RequirePermissions('record_book.create')
  createCategory(@Body() dto: CreateRecordBookCategoryDto, @CurrentUser() user: AuthUser) {
    return this.service.createCategory(dto, user);
  }

  @Patch('expense-categories/:id')
  @RequirePermissions('record_book.update')
  updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateRecordBookCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateCategory(id, dto, user);
  }

  @Delete('expense-categories/:id')
  @RequirePermissions('record_book.update')
  removeCategory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeCategory(id, user);
  }
}
