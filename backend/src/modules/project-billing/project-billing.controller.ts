import { Controller, Get, Post, Put, Body, Param, Query, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ProjectBillingService } from './project-billing.service';
import { CreateProjectBillingDto } from './dto/create-project-billing.dto';
import { UpdateProjectBillingDto } from './dto/update-project-billing.dto';

@Controller('construction/billing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProjectBillingController {
  constructor(private service: ProjectBillingService) {}

  @Post() @RequirePermissions('project_billing.manage')
  create(@Body() dto: CreateProjectBillingDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('project_billing.view')
  findAll(@Query('projectId') projectId?: string, @Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser) {
    return this.service.findAll(projectId, companyId, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id') @RequirePermissions('project_billing.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Patch(':id/send') @RequirePermissions('project_billing.manage')
  send(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.send(id, user.id); }

  @Patch(':id/approve') @RequirePermissions('project_billing.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.approve(id, user); }

  @Patch(':id/paid') @RequirePermissions('project_billing.approve')
  markPaid(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.markPaid(id, user.id); }

  @Patch(':id/cancel') @RequirePermissions('project_billing.manage')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.cancel(id, user.id); }

  @Put(':id') @RequirePermissions('project_billing.manage')
  update(@Param('id') id: string, @Body() dto: UpdateProjectBillingDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }
}
