import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { KpiIndicatorsService } from './kpi-indicators.service';
import { CreateKpiIndicatorDto } from './dto/create-kpi-indicator.dto';
import { UpdateKpiIndicatorDto } from './dto/update-kpi-indicator.dto';

@ApiTags('KPI Indicators')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bi/kpis')
export class KpiIndicatorsController {
  constructor(private readonly service: KpiIndicatorsService) {}

  @Post()
  @RequirePermissions('kpis.manage')
  create(@Body() dto: CreateKpiIndicatorDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('kpis.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('kpis.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('kpis.manage')
  update(@Param('id') id: string, @Body() dto: UpdateKpiIndicatorDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/activate')
  @RequirePermissions('kpis.manage')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.activate(id, user);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('kpis.manage')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deactivate(id, user);
  }

  @Delete(':id')
  @RequirePermissions('kpis.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
