import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { TrainingCoursesService } from './training-courses.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
@Controller('training/courses')
export class TrainingCoursesController {
  constructor(private readonly service: TrainingCoursesService) {}
  @Post() @RequirePermissions('training.courses.manage') create(@Body() dto: any, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }
  @Get() @RequirePermissions('training.courses.view') findAll(@Query() query: any) { return this.service.findAll(query); }
  @Get(':id') @RequirePermissions('training.courses.view') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Patch(':id') @RequirePermissions('training.courses.manage') update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }
  @Patch(':id/activate') @RequirePermissions('training.courses.manage') activate(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.setStatus(id, 'ACTIVE', user.id); }
  @Patch(':id/deactivate') @RequirePermissions('training.courses.manage') deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.setStatus(id, 'INACTIVE', user.id); }
  @Patch(':id/archive') @RequirePermissions('training.courses.manage') archive(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.setStatus(id, 'ARCHIVED', user.id); }
  @Delete(':id') @RequirePermissions('training.courses.manage') remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
