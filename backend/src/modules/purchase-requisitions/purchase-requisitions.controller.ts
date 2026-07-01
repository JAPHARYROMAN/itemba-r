import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';

@Controller('purchase-requisitions')
export class PurchaseRequisitionsController {
  constructor(private readonly service: PurchaseRequisitionsService) {}

  @Get()
  @RequirePermissions('purchase_requisitions.list')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('purchase_requisitions.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('purchase_requisitions.create')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('purchase_requisitions.update')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/submit')
  @RequirePermissions('purchase_requisitions.update')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user);
  }

  @Post(':id/approve')
  @RequirePermissions('purchase_requisitions.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Post(':id/reject')
  @RequirePermissions('purchase_requisitions.approve')
  reject(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, dto, user);
  }
}
