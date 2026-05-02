import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { DisasterRecoveryService } from './disaster-recovery.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('disaster-recovery')
export class DisasterRecoveryController {
  constructor(private readonly service: DisasterRecoveryService) {}

  @Get()
  @RequirePermissions('disaster_recovery.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('disaster_recovery.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('disaster_recovery.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('disaster_recovery.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/approve')
  @RequirePermissions('disaster_recovery.approve')
  approve(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('disaster_recovery.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
