import { Controller, Get, Patch, Post, Body, Param, Query } from '@nestjs/common';
import { QaTestResultsService } from './qa-test-results.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('qa/test-results')
export class QaTestResultsController {
  constructor(private readonly service: QaTestResultsService) {}

  @Get()
  @RequirePermissions('qa.test_results.manage')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('qa.test_results.manage')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('qa.test_results.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/create-blocker')
  @RequirePermissions('launch.blockers.manage')
  createBlocker(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.createBlocker(id, dto, user.id);
  }
}
