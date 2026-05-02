import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { LaunchBlockersService } from './launch-blockers.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('launch/blockers')
export class LaunchBlockersController {
  constructor(private readonly service: LaunchBlockersService) {}

  @Post()
  @RequirePermissions('launch.blockers.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('launch.blockers.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('launch.blockers.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('launch.blockers.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/start')
  @RequirePermissions('launch.blockers.manage')
  start(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'IN_PROGRESS', user.id);
  }

  @Patch(':id/resolve')
  @RequirePermissions('launch.blockers.manage')
  resolve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.resolve(id, user.id);
  }

  @Patch(':id/accept-risk')
  @RequirePermissions('launch.blockers.accept_risk')
  acceptRisk(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.acceptRisk(id, dto, user.id);
  }

  @Patch(':id/defer')
  @RequirePermissions('launch.blockers.manage')
  defer(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'DEFERRED', user.id);
  }

  @Patch(':id/cancel')
  @RequirePermissions('launch.blockers.manage')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'CANCELLED', user.id);
  }

  @Delete(':id')
  @RequirePermissions('launch.blockers.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
