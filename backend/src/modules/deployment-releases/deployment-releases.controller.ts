import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { DeploymentReleasesService } from './deployment-releases.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('deployment-releases')
export class DeploymentReleasesController {
  constructor(private readonly service: DeploymentReleasesService) {}

  @Get()
  @RequirePermissions('deployment.releases.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('deployment.releases.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('deployment.releases.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Put(':id')
  @RequirePermissions('deployment.releases.manage')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Put(':id/deploy')
  @RequirePermissions('deployment.releases.manage')
  deploy(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deploy(id, user.id);
  }

  @Put(':id/fail')
  @RequirePermissions('deployment.releases.manage')
  fail(@Param('id') id: string) {
    return this.service.fail(id);
  }

  @Put(':id/rollback')
  @RequirePermissions('deployment.releases.rollback')
  rollback(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.rollback(id, user.id);
  }

  @Delete(':id')
  @RequirePermissions('deployment.releases.manage')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
