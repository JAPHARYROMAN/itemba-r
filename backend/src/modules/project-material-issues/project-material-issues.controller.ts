import { Controller, Get, Post, Put, Delete, Body, Param, Query, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ProjectMaterialIssuesService } from './project-material-issues.service';
import { CreateProjectMaterialIssueDto } from './dto/create-project-material-issue.dto';
import { UpdateProjectMaterialIssueDto } from './dto/update-project-material-issue.dto';

@Controller('construction/material-issues')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProjectMaterialIssuesController {
  constructor(private service: ProjectMaterialIssuesService) {}

  @Post() @RequirePermissions('project_materials.manage')
  create(@Body() dto: CreateProjectMaterialIssueDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('project_materials.view')
  findAll(@Query('projectId') projectId?: string, @Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser) {
    return this.service.findAll(projectId, companyId, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id') @RequirePermissions('project_materials.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Patch(':id/submit') @RequirePermissions('project_materials.manage')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.submit(id, user.id); }

  @Patch(':id/approve') @RequirePermissions('project_materials.manage')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.approve(id, user.id); }

  @Patch(':id/post') @RequirePermissions('project_materials.post')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.post(id, user.id); }

  @Patch(':id/reject') @RequirePermissions('project_materials.manage')
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.reject(id, user.id); }

  @Patch(':id/cancel') @RequirePermissions('project_materials.manage')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.cancel(id, user.id); }

  @Put(':id') @RequirePermissions('project_materials.manage')
  update(@Param('id') id: string, @Body() dto: UpdateProjectMaterialIssueDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }
}
