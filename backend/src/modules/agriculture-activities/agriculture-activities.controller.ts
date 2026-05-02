import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgricultureActivitiesService } from './agriculture-activities.service';
import { CreateAgricultureActivityDto } from './dto/create-agriculture-activity.dto';
import { UpdateAgricultureActivityDto } from './dto/update-agriculture-activity.dto';

@Controller('agriculture/activities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AgricultureActivitiesController {
  constructor(private service: AgricultureActivitiesService) {}

  @Post() @RequirePermissions('agriculture_activities.manage')
  create(@Body() dto: CreateAgricultureActivityDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('agriculture_activities.view')
  findAll(@Query('farmId') farmId?: string, @Query('cropSeasonId') cropSeasonId?: string, @Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(farmId, cropSeasonId, companyId, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id') @RequirePermissions('agriculture_activities.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Put(':id') @RequirePermissions('agriculture_activities.manage')
  update(@Param('id') id: string, @Body() dto: UpdateAgricultureActivityDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('agriculture_activities.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
