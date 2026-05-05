import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QueryQuotationDto } from './dto/query-quotation.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('westsides/quotations')
@Controller('westsides/quotations')
export class QuotationsController {
  constructor(private readonly service: QuotationsService) {}

  @Post()
  @RequirePermissions('quotations.create')
  @ApiOperation({ summary: 'Create quotation with lines' })
  create(@Body() dto: CreateQuotationDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('quotations.view')
  @ApiOperation({ summary: 'List quotations' })
  findAll(@Query() query: QueryQuotationDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('quotations.view')
  @ApiOperation({ summary: 'Get quotation with lines' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id/send')
  @RequirePermissions('quotations.update')
  @ApiOperation({ summary: 'Send quotation (DRAFT → SENT)' })
  send(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.send(id, user.id);
  }

  @Patch(':id/accept')
  @RequirePermissions('quotations.approve')
  @ApiOperation({ summary: 'Accept quotation (SENT → ACCEPTED)' })
  accept(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.accept(id, user.id);
  }

  @Patch(':id/reject')
  @RequirePermissions('quotations.approve')
  @ApiOperation({ summary: 'Reject quotation (SENT → REJECTED)' })
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, user.id);
  }

  @Patch(':id/convert-to-sales-order')
  @RequirePermissions('quotations.convert')
  @ApiOperation({ summary: 'Convert quotation to sales order (ACCEPTED → CONVERTED)' })
  convertToSalesOrder(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.convertToSalesOrder(id, user.id);
  }

  @Patch(':id')
  @RequirePermissions('quotations.update')
  @ApiOperation({ summary: 'Update quotation (DRAFT or SENT)' })
  update(@Param('id') id: string, @Body() dto: UpdateQuotationDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('quotations.create')
  @ApiOperation({ summary: 'Soft delete quotation (DRAFT only)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
