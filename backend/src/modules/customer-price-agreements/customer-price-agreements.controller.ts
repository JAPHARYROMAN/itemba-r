import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CustomerPriceAgreementsService } from './customer-price-agreements.service';
import { CreateCustomerPriceAgreementDto } from './dto/create-customer-price-agreement.dto';
import { UpdateCustomerPriceAgreementDto } from './dto/update-customer-price-agreement.dto';
import { QueryCustomerPriceAgreementDto } from './dto/query-customer-price-agreement.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('westsides/customer-price-agreements')
@Controller('westsides/customer-price-agreements')
export class CustomerPriceAgreementsController {
  constructor(private readonly service: CustomerPriceAgreementsService) {}

  @Post()
  @RequirePermissions('customer_price_agreements.manage')
  @ApiOperation({ summary: 'Create customer price agreement' })
  create(@Body() dto: CreateCustomerPriceAgreementDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('customer_price_agreements.view')
  @ApiOperation({ summary: 'List customer price agreements' })
  findAll(@Query() query: QueryCustomerPriceAgreementDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('customer_price_agreements.view')
  @ApiOperation({ summary: 'Get customer price agreement by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/approve')
  @RequirePermissions('customer_price_agreements.approve')
  @ApiOperation({ summary: 'Approve customer price agreement' })
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.id);
  }

  @Patch(':id')
  @RequirePermissions('customer_price_agreements.manage')
  @ApiOperation({ summary: 'Update customer price agreement' })
  update(@Param('id') id: string, @Body() dto: UpdateCustomerPriceAgreementDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('customer_price_agreements.manage')
  @ApiOperation({ summary: 'Soft delete customer price agreement' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
