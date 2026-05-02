import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { BackupRunsService } from './backup-runs.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('backup-runs')
export class BackupRunsController {
  constructor(private readonly service: BackupRunsService) {}

  @Get()
  @RequirePermissions('backup_runs.view')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('backup_runs.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('backup_runs.create')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Post('trigger')
  @RequirePermissions('backup_runs.create')
  trigger(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.trigger(dto, user.id);
  }
}
