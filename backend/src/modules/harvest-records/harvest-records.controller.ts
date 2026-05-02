import { Controller, Get, Post, Put, Delete, Body, Param, Query, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { HarvestRecordsService } from './harvest-records.service';
import { CreateHarvestRecordDto } from './dto/create-harvest-record.dto';
import { UpdateHarvestRecordDto } from './dto/update-harvest-record.dto';

@Controller('agriculture/harvest-records')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HarvestRecordsController {
  constructor(private service: HarvestRecordsService) {}

  @Post() @RequirePermissions('harvests.create')
  create(@Body() dto: CreateHarvestRecordDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('harvests.view')
  findAll(@Query('cropSeasonId') cropSeasonId?: string, @Query('farmId') farmId?: string, @Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(cropSeasonId, farmId, companyId, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id') @RequirePermissions('harvests.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Patch(':id/submit') @RequirePermissions('harvests.create')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.submit(id, user.id); }

  @Patch(':id/approve') @RequirePermissions('harvests.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.approve(id, user.id); }

  @Patch(':id/post') @RequirePermissions('harvests.post')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.post(id, user.id); }

  @Patch(':id/reject') @RequirePermissions('harvests.approve')
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.reject(id, user.id); }

  @Put(':id') @RequirePermissions('harvests.create')
  update(@Param('id') id: string, @Body() dto: UpdateHarvestRecordDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('harvests.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
