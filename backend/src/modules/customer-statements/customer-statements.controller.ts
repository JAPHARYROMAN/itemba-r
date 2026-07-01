import { Controller, Get, Post, Body, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CustomerStatementsService } from './customer-statements.service';
import { GenerateCustomerStatementDto } from './dto/generate-customer-statement.dto';
import { QueryCustomerStatementDto } from './dto/query-customer-statement.dto';
import { DetailStatementQueryDto } from './dto/detail-statement.dto';
import { ExportStatementDto } from './dto/export-statement.dto';
import { EmailStatementDto } from './dto/email-statement.dto';

@Controller('customer-statements')
export class CustomerStatementsController {
  constructor(private readonly service: CustomerStatementsService) {}

  @Get()
  @RequirePermissions('customer_statements.list')
  findAll(@Query() query: QueryCustomerStatementDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  /**
   * Professional statement of account for one customer over a date range:
   * openingBalance, chronological lines with running balance, closingBalance,
   * and an aging summary as of dateTo. Read-only.
   */
  @Get('detail')
  @RequirePermissions('customer_statements.view')
  getDetail(@Query() query: DetailStatementQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getDetail(query, user);
  }

  @Post('export/pdf')
  @RequirePermissions('customer_statements.view')
  async exportPdf(
    @Body() dto: ExportStatementDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.service.exportPdf(dto, user);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    if (result.documentId) res.setHeader('X-Generated-Document-Id', result.documentId);
    res.send(result.buffer);
  }

  @Post('export/excel')
  @RequirePermissions('customer_statements.view')
  async exportExcel(
    @Body() dto: ExportStatementDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.service.exportExcel(dto, user);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    if (result.documentId) res.setHeader('X-Generated-Document-Id', result.documentId);
    res.send(result.buffer);
  }

  @Post('email')
  @RequirePermissions('customer_statements.generate')
  emailToCustomer(@Body() dto: EmailStatementDto, @CurrentUser() user: AuthUser) {
    return this.service.emailToCustomer(dto, user);
  }

  @Post('generate')
  @RequirePermissions('customer_statements.generate')
  generate(@Body() dto: GenerateCustomerStatementDto, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }

  @Get(':id')
  @RequirePermissions('customer_statements.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }
}
