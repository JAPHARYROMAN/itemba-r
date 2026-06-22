import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { QueryCustomerDto } from './dto/query-customer.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  @RequirePermissions('customers.view')
  findAll(@Query() query: QueryCustomerDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('workbench-summary')
  @RequirePermissions('customers.view')
  workbenchSummary(@Query() query: QueryCustomerDto, @CurrentUser() user: AuthUser) {
    return this.service.workbenchSummary(query, user);
  }

  @Get(':id/control-center')
  @RequirePermissions('customers.view')
  controlCenter(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.controlCenter(id, user);
  }

  @Get(':id/ledger')
  @RequirePermissions('customers.view')
  ledger(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.ledger(id, user);
  }

  @Get(':id/sales-summary')
  @RequirePermissions('customers.view')
  salesSummary(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.salesSummary(id, user);
  }

  @Get(':id/receivables-summary')
  @RequirePermissions('customers.view')
  receivablesSummary(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.receivablesSummary(id, user);
  }

  @Get(':id/product-history')
  @RequirePermissions('customers.view')
  productHistory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.productHistory(id, user);
  }

  /** Customer 360° aggregate — credit, recent orders, top SKUs, payments. */
  @Get(':id/profile')
  @RequirePermissions('customers.view')
  profile(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.profile(id, user);
  }

  @Get(':id')
  @RequirePermissions('customers.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('customers.create')
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('customers.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('customers.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
