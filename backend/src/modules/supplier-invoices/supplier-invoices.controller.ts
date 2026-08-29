import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SupplierInvoicesService } from './supplier-invoices.service';
import { CreateSupplierInvoiceDto } from './dto/create-supplier-invoice.dto';
import { UpdateSupplierInvoiceDto } from './dto/update-supplier-invoice.dto';
import { QuerySupplierInvoiceDto } from './dto/query-supplier-invoice.dto';
import { ApproveSupplierInvoiceDto } from './dto/approve-supplier-invoice.dto';
import { VoidSupplierInvoiceDto } from './dto/void-supplier-invoice.dto';

@Controller('supplier-invoices')
export class SupplierInvoicesController {
  constructor(private readonly service: SupplierInvoicesService) {}

  @Get()
  @RequirePermissions('supplier_invoices.list')
  findAll(@Query() query: QuerySupplierInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('supplier_invoices.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('supplier_invoices.create')
  create(@Body() dto: CreateSupplierInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('supplier_invoices.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierInvoiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/run-match')
  @RequirePermissions('supplier_invoices.approve')
  runMatch(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.runMatch(id, user);
  }

  @Post(':id/approve')
  @RequirePermissions('supplier_invoices.approve')
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveSupplierInvoiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.approve(id, dto, user);
  }

  @Patch(':id/void')
  @RequirePermissions('supplier_invoices.void')
  void(
    @Param('id') id: string,
    @Body() dto: VoidSupplierInvoiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.void(id, dto, user);
  }
}
