import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CustomerSegmentsService } from './customer-segments.service';
import { CreateCustomerSegmentDto } from './dto/create-customer-segment.dto';
import { UpdateCustomerSegmentDto } from './dto/update-customer-segment.dto';
import { QueryCustomerSegmentDto } from './dto/query-customer-segment.dto';
import { AddSegmentMemberDto } from './dto/add-member.dto';

@Controller('customer-segments')
export class CustomerSegmentsController {
  constructor(private readonly service: CustomerSegmentsService) {}

  @Get()
  @RequirePermissions('customer_segments.list')
  findAll(@Query() query: QueryCustomerSegmentDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('customer_segments.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('customer_segments.create')
  create(@Body() dto: CreateCustomerSegmentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('customer_segments.update')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerSegmentDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('customer_segments.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }

  @Post(':id/members')
  @RequirePermissions('customer_segments.manage_members')
  addMember(@Param('id') id: string, @Body() dto: AddSegmentMemberDto, @CurrentUser() user: AuthUser) {
    return this.service.addMember(id, dto, user);
  }

  @Delete(':id/members/:customerId')
  @RequirePermissions('customer_segments.manage_members')
  removeMember(@Param('id') id: string, @Param('customerId') customerId: string, @CurrentUser() user: AuthUser) {
    return this.service.removeMember(id, customerId, user);
  }
}
