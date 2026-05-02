import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { DataArchiveJobsService } from './data-archive-jobs.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('data-archive-jobs')
export class DataArchiveJobsController {
  constructor(private readonly service: DataArchiveJobsService) {}

  @Get()
  @RequirePermissions('archive_jobs.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('archive_jobs.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('archive_jobs.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('archive_jobs.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/approve')
  @RequirePermissions('archive_jobs.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.id);
  }

  @Delete(':id')
  @RequirePermissions('archive_jobs.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
