import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { KpiSnapshotsService } from './kpi-snapshots.service';
import { GenerateSnapshotDto } from './dto/generate-snapshot.dto';
import { QueryKpiSnapshotDto } from './dto/query-kpi-snapshot.dto';

@ApiTags('KPI Snapshots')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bi/kpi-snapshots')
export class KpiSnapshotsController {
  constructor(private readonly service: KpiSnapshotsService) {}

  @Post('generate')
  @RequirePermissions('kpi_snapshots.generate')
  generate(@Body() dto: GenerateSnapshotDto, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }

  @Get()
  @RequirePermissions('kpi_snapshots.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryKpiSnapshotDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('kpi_snapshots.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Delete(':id')
  @RequirePermissions('kpi_snapshots.generate')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
