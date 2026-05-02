import { Controller, Get, Post, Put, Body, Param, Query, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ProjectProgressService } from './project-progress.service';
import { CreateProjectProgressDto } from './dto/create-project-progress.dto';
import { UpdateProjectProgressDto } from './dto/update-project-progress.dto';

@Controller('construction/progress')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProjectProgressController {
  constructor(private service: ProjectProgressService) {}

  @Post() @RequirePermissions('project_progress.submit')
  create(@Body() dto: CreateProjectProgressDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('project_progress.view')
  findAll(@Query('projectId') projectId?: string, @Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(projectId, companyId, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id') @RequirePermissions('project_progress.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Patch(':id/submit') @RequirePermissions('project_progress.submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.submit(id, user.id); }

  @Patch(':id/approve') @RequirePermissions('project_progress.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.approve(id, user.id); }

  @Patch(':id/reject') @RequirePermissions('project_progress.approve')
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.reject(id, user.id); }

  @Put(':id') @RequirePermissions('project_progress.submit')
  update(@Param('id') id: string, @Body() dto: UpdateProjectProgressDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }
}
