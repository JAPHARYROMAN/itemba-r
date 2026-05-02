import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { EnvironmentConfigChecksService } from './environment-config-checks.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('environment-config-checks')
export class EnvironmentConfigChecksController {
  constructor(private readonly service: EnvironmentConfigChecksService) {}

  @Get()
  @RequirePermissions('environment_checks.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('environment_checks.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('environment_checks.run')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('environment_checks.run')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Post('run')
  @RequirePermissions('environment_checks.run')
  run(@CurrentUser() user: AuthUser) {
    return this.service.runChecks(user.id);
  }
}
