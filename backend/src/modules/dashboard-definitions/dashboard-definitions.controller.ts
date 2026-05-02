import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DashboardDefinitionsService } from './dashboard-definitions.service';
import { CreateDashboardDefinitionDto } from './dto/create-dashboard-definition.dto';

@ApiTags('Dashboard Definitions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bi/dashboards')
export class DashboardDefinitionsController {
  constructor(private readonly service: DashboardDefinitionsService) {}

  @Post()
  @RequirePermissions('dashboard_definitions.manage')
  create(@Body() dto: CreateDashboardDefinitionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('dashboard_definitions.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('dashboard_definitions.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('dashboard_definitions.manage')
  update(@Param('id') id: string, @Body() dto: Partial<CreateDashboardDefinitionDto>, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('dashboard_definitions.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
