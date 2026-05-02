import { Controller, Get, Post, Put, Delete, Body, Param, Query, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ConstructionProjectsService } from './construction-projects.service';
import { CreateConstructionProjectDto } from './dto/create-construction-project.dto';
import { UpdateConstructionProjectDto } from './dto/update-construction-project.dto';
import { ConstructionProjectStatus } from '@prisma/client';

@Controller('construction/projects')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConstructionProjectsController {
  constructor(private service: ConstructionProjectsService) {}

  @Post() @RequirePermissions('construction_projects.manage')
  create(@Body() dto: CreateConstructionProjectDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('construction_projects.view')
  findAll(@Query('companyId') companyId?: string, @Query('status') status?: ConstructionProjectStatus, @Query('page') page?: string, @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser) {
    return this.service.findAll(companyId, status, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id') @RequirePermissions('construction_projects.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Get(':id/profitability') @RequirePermissions('construction.reports.view')
  getProfitability(@Param('id') id: string) { return this.service.getProfitability(id); }

  @Patch(':id/status') @RequirePermissions('construction_projects.manage')
  updateStatus(@Param('id') id: string, @Body() body: { status: ConstructionProjectStatus }, @CurrentUser() user: AuthUser) {
    return this.service.updateStatus(id, body.status, user.id);
  }

  @Put(':id') @RequirePermissions('construction_projects.manage')
  update(@Param('id') id: string, @Body() dto: UpdateConstructionProjectDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('construction_projects.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
