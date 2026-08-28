import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { CustomerCreditProfilesQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CustomerCreditProfilesService } from './customer-credit-profiles.service';
import {
  CreateCustomerCreditProfileDto,
  UpdateCustomerCreditProfileDto,
} from './dto/customer-credit-profile.dto';

@Controller('customer-credit-profiles')
export class CustomerCreditProfilesController {
  constructor(private readonly service: CustomerCreditProfilesService) {}

  @Get()
  @RequirePermissions('credit_profiles.list')
  findAll(@Query() query: CustomerCreditProfilesQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('credit_profiles.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('credit_profiles.create')
  create(@Body() dto: CreateCustomerCreditProfileDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('credit_profiles.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerCreditProfileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }
}
