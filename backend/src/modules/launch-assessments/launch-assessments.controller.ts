import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { LaunchAssessmentsService } from './launch-assessments.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('launch/assessments')
export class LaunchAssessmentsController {
  constructor(private readonly service: LaunchAssessmentsService) {}

  @Post()
  @RequirePermissions('launch.assessments.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('launch.assessments.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('launch.assessments.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('launch.assessments.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/start')
  @RequirePermissions('launch.assessments.manage')
  start(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'IN_PROGRESS', user.id);
  }

  @Patch(':id/calculate')
  @RequirePermissions('launch.assessments.manage')
  calculate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.calculate(id, user.id);
  }

  @Patch(':id/approve')
  @RequirePermissions('launch.assessments.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.id);
  }

  @Patch(':id/cancel')
  @RequirePermissions('launch.assessments.manage')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'CANCELLED', user.id);
  }

  @Post(':id/items')
  @RequirePermissions('launch.readiness_items.manage')
  addItem(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.addItem(id, dto, user.id);
  }
}
