import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { RecordBookService } from './record-book.service';
import { RecordBookReportsService } from './record-book-reports.service';
import {
  CreateDailySaleDto,
  CreateRecordBookCategoryDto,
  CreateRecordBookExpenseDto,
  ExportRecordBookDto,
  ExportRecordBookReportDto,
  QueryRecordBookDto,
  QueryRecordBookReportDto,
  ReopenRecordBookDto,
  RecordBookExportAuditDto,
  UpdateDailySaleDto,
  UpdateRecordBookCategoryDto,
  UpdateRecordBookExpenseDto,
  VoidRecordBookDto,
} from './dto/record-book.dto';

@Controller('record-book')
export class RecordBookController {
  constructor(
    private readonly service: RecordBookService,
    private readonly reports: RecordBookReportsService,
  ) {}

  @Get('summary')
  @RequirePermissions('record_book.view')
  summary(@Query() query: QueryRecordBookDto, @CurrentUser() user: AuthUser) {
    return this.service.summary(query, user);
  }

  @Get('scope-options')
  @RequirePermissions('record_book.view')
  scopeOptions(@CurrentUser() user: AuthUser) {
    return this.service.scopeOptions(user);
  }

  @Get('export')
  @AgentExcluded('read_writes_audit_ledger')
  @RequirePermissions('record_book.export')
  export(@Query() query: ExportRecordBookDto, @CurrentUser() user: AuthUser, @Res() res: Response) {
    return this.service.export(query, user, res);
  }

  @Post('export-audit')
  @RequirePermissions('record_book.export')
  auditExport(@Body() dto: RecordBookExportAuditDto, @CurrentUser() user: AuthUser) {
    return this.reports.auditExport(dto, user);
  }

  @Get('reports/:reportKey/export')
  @AgentExcluded('read_writes_audit_ledger')
  @RequirePermissions('record_book.export')
  exportReport(
    @Param('reportKey') reportKey: string,
    @Query() query: ExportRecordBookReportDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    return this.reports.export(reportKey, query, user, res);
  }

  @Get('reports/:reportKey')
  @AgentExcluded('read_writes_audit_ledger')
  @RequirePermissions('record_book.view')
  runReport(
    @Param('reportKey') reportKey: string,
    @Query() query: QueryRecordBookReportDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reports.run(reportKey, query, user);
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
  @AgentExcluded('read_writes_audit_ledger')
  @RequirePermissions('record_book.view')
  findDailySale(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findDailySale(id, user);
  }

  @Patch('daily-sales/:id')
  @RequirePermissions('record_book.update')
  updateDailySale(
    @Param('id') id: string,
    @Body() dto: UpdateDailySaleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateDailySale(id, dto, user);
  }

  @Delete('daily-sales/:id')
  @RequirePermissions('record_book.delete')
  removeDailySale(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeDailySale(id, user);
  }

  @Patch('daily-sales/:id/restore')
  @RequirePermissions('record_book.admin')
  restoreDailySale(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.restoreDailySale(id, user);
  }

  @Patch('daily-sales/:id/finalize')
  @RequirePermissions('record_book.finalize')
  finalizeDailySale(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.finalizeDailySale(id, user);
  }

  @Patch('daily-sales/:id/reopen')
  @RequirePermissions('record_book.admin')
  reopenDailySale(
    @Param('id') id: string,
    @Body() dto: ReopenRecordBookDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reopenDailySale(id, dto, user);
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
  @AgentExcluded('read_writes_audit_ledger')
  @RequirePermissions('record_book.view')
  findExpense(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findExpense(id, user);
  }

  @Patch('expenses/:id')
  @RequirePermissions('record_book.update')
  updateExpense(
    @Param('id') id: string,
    @Body() dto: UpdateRecordBookExpenseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateExpense(id, dto, user);
  }

  @Delete('expenses/:id')
  @RequirePermissions('record_book.delete')
  removeExpense(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeExpense(id, user);
  }

  @Patch('expenses/:id/restore')
  @RequirePermissions('record_book.admin')
  restoreExpense(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.restoreExpense(id, user);
  }

  @Patch('expenses/:id/finalize')
  @RequirePermissions('record_book.finalize')
  finalizeExpense(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.finalizeExpense(id, user);
  }

  @Patch('expenses/:id/reopen')
  @RequirePermissions('record_book.admin')
  reopenExpense(
    @Param('id') id: string,
    @Body() dto: ReopenRecordBookDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reopenExpense(id, dto, user);
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

  @Get('expense-categories/:id')
  @AgentExcluded('read_writes_audit_ledger')
  @RequirePermissions('record_book.view')
  findCategory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findCategory(id, user);
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
  @RequirePermissions('record_book.delete')
  removeCategory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeCategory(id, user);
  }

  @Patch('expense-categories/:id/restore')
  @RequirePermissions('record_book.admin')
  restoreCategory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.restoreCategory(id, user);
  }
}
