import { Controller, Get, Post, Put, Delete, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { TaxReturnsService } from './tax-returns.service';
import { CreateTaxReturnDto } from './dto/create-tax-return.dto';
import { UpdateTaxReturnDto } from './dto/update-tax-return.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tax/returns')
export class TaxReturnsController {
  constructor(private readonly service: TaxReturnsService) {}

  @Get()
  @RequirePermissions('tax_returns.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('tax_returns.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('tax_returns.manage')
  create(@Body() dto: CreateTaxReturnDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('tax_returns.manage')
  update(@Param('id') id: string, @Body() dto: UpdateTaxReturnDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/prepare')
  @RequirePermissions('tax_returns.manage')
  prepare(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.prepare(id, user);
  }

  /**
   * Phase 4 — auto-compute return totals from posted TaxTransactions in the
   * filing period. Transitions DRAFT → PREPARED with computed sums.
   * Idempotent: re-running overwrites.
   */
  @Patch(':id/auto-compute')
  @RequirePermissions('tax_returns.manage')
  autoCompute(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.autoComputeFromTransactions(id, user);
  }

  @Patch(':id/review')
  @RequirePermissions('tax_returns.manage')
  review(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.review(id, user);
  }

  @Patch(':id/approve')
  @RequirePermissions('tax_returns.manage')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Patch(':id/submit')
  @RequirePermissions('tax_returns.manage')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user);
  }

  @Patch(':id/mark-paid')
  @RequirePermissions('tax_returns.manage')
  markPaid(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.markPaid(id, user);
  }

  @Patch(':id/cancel')
  @RequirePermissions('tax_returns.manage')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user);
  }

  @Delete(':id')
  @RequirePermissions('tax_returns.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
