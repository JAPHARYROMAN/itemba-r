import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ProductionReadinessService } from './production-readiness.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('production-readiness')
export class ProductionReadinessController {
  constructor(private readonly service: ProductionReadinessService) {}

  @Get()
  @RequirePermissions('production_readiness.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('production_readiness.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('production_readiness.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('production_readiness.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/complete')
  @RequirePermissions('production_readiness.approve')
  complete(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.markComplete(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('production_readiness.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
