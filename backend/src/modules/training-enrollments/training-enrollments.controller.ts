import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { TrainingEnrollmentsService } from './training-enrollments.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
@Controller('training')
export class TrainingEnrollmentsController {
  constructor(private readonly service: TrainingEnrollmentsService) {}
  @Post('enrollments') @RequirePermissions('training.enrollments.manage') create(@Body() dto: any, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }
  @Get('enrollments') @RequirePermissions('training.enrollments.view') findAll(@Query() query: any) { return this.service.findAll(query); }
  @Get('enrollments/me') @RequirePermissions('training.enrollments.view') findMine(@CurrentUser() user: AuthUser) { return this.service.findMine(user.id); }
  @Get('enrollments/:id') @RequirePermissions('training.enrollments.view') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Patch('enrollments/:id/start') @RequirePermissions('training.enrollments.manage') start(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.startEnrollment(id, user.id); }
  @Patch('enrollments/:id/complete') @RequirePermissions('training.enrollments.manage') complete(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.completeEnrollment(id, user.id); }
  @Patch('lesson-progress/:id/start') @RequirePermissions('training.progress.view') startLesson(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.startLessonProgress(id, user.id); }
  @Patch('lesson-progress/:id/complete') @RequirePermissions('training.progress.view') completeLesson(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.completeLessonProgress(id, user.id); }
  @Patch('lesson-progress/:id/fail') @RequirePermissions('training.progress.view') failLesson(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.failLessonProgress(id, user.id); }
}
