import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { BackgroundJobsService } from './background-jobs.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('background-jobs')
export class BackgroundJobsController {
  constructor(private readonly service: BackgroundJobsService) {}

  @Get('stats')
  @RequirePermissions('background_jobs.view')
  getStats(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.getStats(user, query);
  }

  @Get()
  @RequirePermissions('background_jobs.view')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('background_jobs.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('background_jobs.manage')
  enqueue(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.enqueue(dto, user);
  }

  @Put(':id/retry')
  @RequirePermissions('background_jobs.retry')
  retry(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.retry(id, user);
  }

  @Put(':id/cancel')
  @RequirePermissions('background_jobs.cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user);
  }

  @Put(':id/dead-letter')
  @RequirePermissions('background_jobs.manage')
  deadLetter(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deadLetter(id, user);
  }
}
