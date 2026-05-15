import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { BackupJobsService } from './backup-jobs.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateBackupJobDto, QueryBackupJobDto, UpdateBackupJobDto } from './dto/backup-job.dto';

@Controller('backup-jobs')
export class BackupJobsController {
  constructor(private readonly service: BackupJobsService) {}

  @Get()
  @RequirePermissions('backup_jobs.view')
  findAll(@Query() query: QueryBackupJobDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('backup_jobs.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('backup_jobs.manage')
  create(@Body() dto: CreateBackupJobDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('backup_jobs.manage')
  update(@Param('id') id: string, @Body() dto: UpdateBackupJobDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('backup_jobs.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
