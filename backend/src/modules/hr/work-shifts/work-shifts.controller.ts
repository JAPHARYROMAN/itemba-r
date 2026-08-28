import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SearchCompanyPageLimitQueryDto } from '../../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { WorkShiftsService } from './work-shifts.service';
import { CreateWorkShiftDto } from './dto/create-work-shift.dto';
import { UpdateWorkShiftDto } from './dto/update-work-shift.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/work-shifts')
export class WorkShiftsController {
  constructor(private readonly service: WorkShiftsService) {}

  @Get()
  @RequirePermissions('shifts.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: SearchCompanyPageLimitQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('shifts.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('shifts.manage')
  create(@Body() dto: CreateWorkShiftDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('shifts.manage')
  update(@Param('id') id: string, @Body() dto: UpdateWorkShiftDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('shifts.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
