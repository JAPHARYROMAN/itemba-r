import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateSupplierOrderDraftDto,
  QuerySupplierOrderDraftDto,
  SupplierOrderDraftExportAuditDto,
  SupplierOrderDraftEmailDto,
  UpdateSupplierOrderDraftDto,
} from './dto/supplier-order-draft.dto';
import { SupplierOrderDraftsService } from './supplier-order-drafts.service';
import { SupplierOrderDraftSharingService } from './supplier-order-draft-sharing.service';

@Controller('supplier-order-drafts')
export class SupplierOrderDraftsController {
  constructor(
    private readonly service: SupplierOrderDraftsService,
    private readonly sharing: SupplierOrderDraftSharingService,
  ) {}

  @Get()
  @RequirePermissions('supplier_order_drafts.view')
  findAll(@Query() query: QuerySupplierOrderDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('supplier_order_drafts.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('supplier_order_drafts.create')
  create(@Body() dto: CreateSupplierOrderDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('supplier_order_drafts.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierOrderDraftDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/duplicate')
  @RequirePermissions('supplier_order_drafts.create')
  duplicate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.duplicate(id, user);
  }

  @Post(':id/share/email')
  @AgentExcluded('external_egress_not_represented')
  @RequirePermissions('supplier_order_drafts.export')
  emailPdf(
    @Param('id') id: string,
    @Body() dto: SupplierOrderDraftEmailDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.sharing.emailPdf(id, dto, user, req.ip);
  }

  @Patch(':id/send')
  @RequirePermissions('supplier_order_drafts.send')
  send(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.send(id, user);
  }

  @Patch(':id/reopen')
  @RequirePermissions('supplier_order_drafts.manage')
  reopen(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reopen(id, user);
  }

  @Patch(':id/accept')
  @RequirePermissions('supplier_order_drafts.manage')
  accept(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.accept(id, user);
  }

  @Patch(':id/decline')
  @RequirePermissions('supplier_order_drafts.manage')
  decline(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.decline(id, user);
  }

  @Patch(':id/cancel')
  @RequirePermissions('supplier_order_drafts.manage')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user);
  }

  @Post(':id/export-audit')
  @RequirePermissions('supplier_order_drafts.export')
  auditExport(
    @Param('id') id: string,
    @Body() dto: SupplierOrderDraftExportAuditDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.auditExport(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('supplier_order_drafts.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
