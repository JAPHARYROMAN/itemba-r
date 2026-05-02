import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { SystemHealthService } from './system-health.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('system-health')
export class SystemHealthController {
  constructor(private readonly service: SystemHealthService) {}

  @Get()
  @RequirePermissions('system_health.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('system_health.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('system_health.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('system_health.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Post('run-all')
  @RequirePermissions('system_health.run')
  runAll(@CurrentUser() user: AuthUser) {
    return this.service.runAll(user.id);
  }

  @Post(':id/run')
  @RequirePermissions('system_health.run')
  run(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.runCheck(id, user.id);
  }

  @Delete(':id')
  @RequirePermissions('system_health.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
