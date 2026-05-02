import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { QaTestCasesService } from './qa-test-cases.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('qa/test-cases')
export class QaTestCasesController {
  constructor(private readonly service: QaTestCasesService) {}

  @Post()
  @RequirePermissions('qa.test_cases.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('qa.test_cases.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('qa.test_cases.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('qa.test_cases.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/activate')
  @RequirePermissions('qa.test_cases.manage')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'ACTIVE', user.id);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('qa.test_cases.manage')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'INACTIVE', user.id);
  }

  @Patch(':id/archive')
  @RequirePermissions('qa.test_cases.manage')
  archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'ARCHIVED', user.id);
  }

  @Delete(':id')
  @RequirePermissions('qa.test_cases.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
