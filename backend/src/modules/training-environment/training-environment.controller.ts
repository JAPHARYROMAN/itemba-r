import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { TrainingEnvironmentService } from './training-environment.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
@Controller('training/environments')
export class TrainingEnvironmentController {
  constructor(private readonly service: TrainingEnvironmentService) {}
  @Post() @RequirePermissions('training_environment.manage') create(@Body() dto: any, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }
  @Get() @RequirePermissions('training_environment.view') findAll() { return this.service.findAll(); }
  @Get(':id') @RequirePermissions('training_environment.view') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Patch(':id') @RequirePermissions('training_environment.manage') update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }
  @Patch(':id/activate') @RequirePermissions('training_environment.manage') activate(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.setStatus(id, 'ACTIVE', user.id); }
  @Patch(':id/pause') @RequirePermissions('training_environment.manage') pause(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.setStatus(id, 'PAUSED', user.id); }
  @Post(':id/reset-demo-data') @RequirePermissions('training_environment.reset') resetDemoData(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.resetDemoData(id, user.id); }
  @Delete(':id') @RequirePermissions('training_environment.manage') remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
