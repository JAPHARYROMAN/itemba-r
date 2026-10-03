import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ExportRemittanceDto } from './dto/export-remittance.dto';
import { SupplierPaymentsService } from './supplier-payments.service';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { QuerySupplierPaymentDto } from './dto/query-supplier-payment.dto';
import { ReverseSupplierPaymentDto } from './dto/reverse-supplier-payment.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';

@Controller('supplier-payments')
export class SupplierPaymentsController {
  constructor(private readonly service: SupplierPaymentsService) {}

  @Get()
  // Agent-excluded until its Msaidizi evidence fixture is authored: the capability manifest
  // must stay closed over positive fixtures and explicit exclusions (collection read).
  @AgentExcluded()
  @RequirePermissions('supplier-payments.view')
  findAll(@Query() query: QuerySupplierPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  // Agent-excluded until its Msaidizi evidence fixture is authored: the capability manifest
  // must stay closed over positive fixtures and explicit exclusions (path read).
  @AgentExcluded()
  @RequirePermissions('supplier-payments.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Get(':id/remittance')
  // Party linkage (Phase 3): agent-excluded until its Msaidizi evidence fixture is authored.
  @AgentExcluded()
  @RequirePermissions('supplier-payments.view')
  async remittance(
    @Param('id') id: string,
    @Query() _q: ExportRemittanceDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.service.remittance(id, user);
    res.set({
      'Content-Type': result.mimeType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(result.buffer);
  }

  @Post()
  @AgentExcluded()
  @RequirePermissions('supplier-payments.manage')
  create(@Body() dto: CreateSupplierPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id/reverse')
  @AgentExcluded()
  @RequirePermissions('supplier-payments.manage')
  reverse(
    @Param('id') id: string,
    @Body() dto: ReverseSupplierPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reverse(id, dto, user);
  }
}
