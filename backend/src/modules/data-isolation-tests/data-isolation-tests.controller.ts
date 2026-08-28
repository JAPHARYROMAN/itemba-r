import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { DataIsolationTestsQueryDto } from '../../common/dto/resource-query.dto';
import { DataIsolationTestsService } from './data-isolation-tests.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AddDataIsolationIssueDto,
  CompleteDataIsolationTestDto,
  CreateDataIsolationTestDto,
} from './dto/data-isolation-test.dto';

@Controller('data-isolation-tests')
export class DataIsolationTestsController {
  constructor(private readonly service: DataIsolationTestsService) {}

  @Get()
  @RequirePermissions('data_isolation.view')
  findAll(@Query() query: DataIsolationTestsQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('data_isolation.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Get(':id/issues')
  @RequirePermissions('data_isolation.view')
  getIssues(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getIssues(id, user);
  }

  @Post()
  @RequirePermissions('data_isolation.run_tests')
  create(@Body() dto: CreateDataIsolationTestDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id/complete')
  @RequirePermissions('data_isolation.run_tests')
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteDataIsolationTestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.complete(id, dto, user);
  }

  @Post(':id/issues')
  @RequirePermissions('data_isolation.run_tests')
  addIssue(
    @Param('id') id: string,
    @Body() dto: AddDataIsolationIssueDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addIssue(id, dto, user);
  }
}
