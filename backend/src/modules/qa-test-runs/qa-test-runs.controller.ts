import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { QaTestRunsService } from './qa-test-runs.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('qa/test-runs')
export class QaTestRunsController {
  constructor(private readonly service: QaTestRunsService) {}

  @Post()
  @RequirePermissions('qa.test_runs.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('qa.test_runs.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('qa.test_runs.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/start')
  @RequirePermissions('qa.test_runs.manage')
  start(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.start(id, user.id);
  }

  @Patch(':id/complete')
  @RequirePermissions('qa.test_runs.manage')
  complete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.complete(id, user.id);
  }

  @Patch(':id/cancel')
  @RequirePermissions('qa.test_runs.manage')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user.id);
  }

  @Post(':id/results')
  @RequirePermissions('qa.test_results.manage')
  addResult(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.addResult(id, dto, user.id);
  }

  @Get(':id/results')
  @RequirePermissions('qa.test_runs.view')
  getResults(@Param('id') id: string, @Query() query: any) {
    return this.service.getResults(id, query);
  }
}
