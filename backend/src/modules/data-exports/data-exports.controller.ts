import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { DataExportsQueryDto } from '../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DataExportsService } from './data-exports.service';
import { CreateDataExportDto } from './dto/create-data-export.dto';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('data-exports')
export class DataExportsController {
  constructor(private readonly service: DataExportsService) {}

  @Get()
  @RequirePermissions('data_exports.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: DataExportsQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('data_exports.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @AgentExcluded('asynchronous_effect_not_represented')
  @RequirePermissions('data_exports.manage')
  create(@Body() dto: CreateDataExportDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }
}
