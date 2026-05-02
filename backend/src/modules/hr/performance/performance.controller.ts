import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { PerformanceService } from './performance.service';
import { CreatePerformanceRecordDto } from './dto/create-performance.dto';
import { UpdatePerformanceRecordDto } from './dto/update-performance.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/performance')
export class PerformanceController {
  constructor(private readonly service: PerformanceService) {}

  @Get()
  @RequirePermissions('performance.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('performance.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('performance.manage')
  create(@Body() dto: CreatePerformanceRecordDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('performance.manage')
  update(@Param('id') id: string, @Body() dto: UpdatePerformanceRecordDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('performance.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
