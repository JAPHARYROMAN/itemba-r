import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { ShiftSchedulesService } from './shift-schedules.service';
import { CreateShiftScheduleDto } from './dto/create-shift-schedule.dto';
import { UpdateShiftScheduleDto } from './dto/update-shift-schedule.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/shift-schedules')
export class ShiftSchedulesController {
  constructor(private readonly service: ShiftSchedulesService) {}

  @Get()
  @RequirePermissions('shift_schedules.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('shift_schedules.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('shift_schedules.manage')
  create(@Body() dto: CreateShiftScheduleDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('shift_schedules.manage')
  update(@Param('id') id: string, @Body() dto: UpdateShiftScheduleDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('shift_schedules.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
