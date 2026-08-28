import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { BackupRunsQueryDto } from '../../common/dto/resource-query.dto';
import { BackupRunsService } from './backup-runs.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateBackupRunDto } from './dto/create-backup-run.dto';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';

@Controller('backup-runs')
export class BackupRunsController {
  constructor(private readonly service: BackupRunsService) {}

  @Get()
  @RequirePermissions('backup_runs.view')
  findAll(@Query() query: BackupRunsQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('backup_runs.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @AgentExcluded('asynchronous_effect_not_represented')
  @RequirePermissions('backup_runs.create')
  create(@Body() dto: CreateBackupRunDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Post('trigger')
  @AgentExcluded('asynchronous_effect_not_represented')
  @RequirePermissions('backup_runs.create')
  trigger(@Body() dto: CreateBackupRunDto, @CurrentUser() user: AuthUser) {
    return this.service.trigger(dto, user.id);
  }
}
