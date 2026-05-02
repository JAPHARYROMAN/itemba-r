import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { LoadTestsService } from './load-tests.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('load-tests')
export class LoadTestsController {
  constructor(private readonly service: LoadTestsService) {}

  @Get()
  @RequirePermissions('load_tests.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('load_tests.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('load_tests.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Put(':id/start')
  @RequirePermissions('load_tests.run')
  start(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.start(id, user.id);
  }

  @Put(':id/complete')
  @RequirePermissions('load_tests.manage')
  complete(@Param('id') id: string, @Body() dto: any) {
    return this.service.complete(id, dto);
  }

  @Put(':id/fail')
  @RequirePermissions('load_tests.manage')
  fail(@Param('id') id: string) {
    return this.service.fail(id);
  }

  @Put(':id/cancel')
  @RequirePermissions('load_tests.manage')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Delete(':id')
  @RequirePermissions('load_tests.manage')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
