import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { TrainingLessonsService } from './training-lessons.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
@Controller('training')
export class TrainingLessonsController {
  constructor(private readonly service: TrainingLessonsService) {}
  @Post('courses/:courseId/lessons') @RequirePermissions('training.lessons.manage') create(@Param('courseId') courseId: string, @Body() dto: any, @CurrentUser() user: AuthUser) { return this.service.create(courseId, dto, user.id); }
  @Get('courses/:courseId/lessons') @RequirePermissions('training.courses.view') findByCourse(@Param('courseId') courseId: string) { return this.service.findByCourse(courseId); }
  @Get('lessons/:id') @RequirePermissions('training.courses.view') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Patch('lessons/:id') @RequirePermissions('training.lessons.manage') update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }
  @Patch('lessons/:id/activate') @RequirePermissions('training.lessons.manage') activate(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.setStatus(id, 'ACTIVE', user.id); }
  @Patch('lessons/:id/deactivate') @RequirePermissions('training.lessons.manage') deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.setStatus(id, 'INACTIVE', user.id); }
  @Delete('lessons/:id') @RequirePermissions('training.lessons.manage') remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
