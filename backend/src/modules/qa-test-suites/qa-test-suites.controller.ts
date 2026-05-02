import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { QaTestSuitesService } from './qa-test-suites.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('qa/test-suites')
export class QaTestSuitesController {
  constructor(private readonly service: QaTestSuitesService) {}

  @Post()
  @RequirePermissions('qa.test_suites.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('qa.test_suites.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('qa.test_suites.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('qa.test_suites.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/activate')
  @RequirePermissions('qa.test_suites.manage')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'ACTIVE', user.id);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('qa.test_suites.manage')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'INACTIVE', user.id);
  }

  @Patch(':id/archive')
  @RequirePermissions('qa.test_suites.manage')
  archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'ARCHIVED', user.id);
  }

  @Delete(':id')
  @RequirePermissions('qa.test_suites.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }

  @Get(':suiteId/test-cases')
  @RequirePermissions('qa.test_cases.view')
  getTestCases(@Param('suiteId') suiteId: string, @Query() query: any) {
    return this.service.getTestCases(suiteId, query);
  }
}
