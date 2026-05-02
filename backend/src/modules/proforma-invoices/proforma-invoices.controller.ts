import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProformaInvoicesService } from './proforma-invoices.service';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';
import { UpdateProformaInvoiceDto } from './dto/update-proforma-invoice.dto';
import { QueryProformaInvoiceDto } from './dto/query-proforma-invoice.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('westsides/proforma-invoices')
@Controller('westsides/proforma-invoices')
export class ProformaInvoicesController {
  constructor(private readonly service: ProformaInvoicesService) {}

  @Post()
  @RequirePermissions('proformas.create')
  @ApiOperation({ summary: 'Create proforma invoice with lines' })
  create(@Body() dto: CreateProformaInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('proformas.view')
  @ApiOperation({ summary: 'List proforma invoices' })
  findAll(@Query() query: QueryProformaInvoiceDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('proformas.view')
  @ApiOperation({ summary: 'Get proforma invoice with lines' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/send')
  @RequirePermissions('proformas.update')
  @ApiOperation({ summary: 'Send proforma (DRAFT → SENT)' })
  send(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.send(id, user.id);
  }

  @Patch(':id/convert-to-sales-order')
  @RequirePermissions('proformas.convert')
  @ApiOperation({ summary: 'Convert proforma to sales order (ACCEPTED → CONVERTED)' })
  convertToSalesOrder(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.convertToSalesOrder(id, user.id);
  }

  @Patch(':id')
  @RequirePermissions('proformas.update')
  @ApiOperation({ summary: 'Update proforma (DRAFT only)' })
  update(@Param('id') id: string, @Body() dto: UpdateProformaInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('proformas.create')
  @ApiOperation({ summary: 'Soft delete proforma (DRAFT only)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
