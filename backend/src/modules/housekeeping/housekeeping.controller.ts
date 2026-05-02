import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { HousekeepingService } from './housekeeping.service';
import { CreateHousekeepingTaskDto } from './dto/create-housekeeping-task.dto';
import { UpdateHousekeepingTaskDto } from './dto/update-housekeeping-task.dto';
import { HousekeepingTaskStatus, HousekeepingTaskType } from '@prisma/client';

@Controller('housekeeping')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HousekeepingController {
  constructor(private service: HousekeepingService) {}

  @Post()
  @RequirePermissions('housekeeping.manage')
  create(@Body() dto: CreateHousekeepingTaskDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('housekeeping.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('hospitalityFacilityId') hospitalityFacilityId?: string,
    @Query('roomId') roomId?: string,
    @Query('status') status?: HousekeepingTaskStatus,
    @Query('taskType') taskType?: HousekeepingTaskType,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(companyId, hospitalityFacilityId, roomId, status, taskType, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequirePermissions('housekeeping.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('housekeeping.manage')
  update(@Param('id') id: string, @Body() dto: UpdateHousekeepingTaskDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('housekeeping.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
