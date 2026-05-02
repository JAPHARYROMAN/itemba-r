import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { RetentionPoliciesService } from './retention-policies.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('retention-policies')
export class RetentionPoliciesController {
  constructor(private readonly service: RetentionPoliciesService) {}

  @Get()
  @RequirePermissions('retention_policies.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('retention_policies.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('retention_policies.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('retention_policies.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/approve')
  @RequirePermissions('retention_policies.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.id);
  }

  @Delete(':id')
  @RequirePermissions('retention_policies.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
