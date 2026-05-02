import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { FarmInputApplicationsService } from './farm-input-applications.service';
import { CreateFarmInputApplicationDto } from './dto/create-farm-input-application.dto';
import { UpdateFarmInputApplicationDto } from './dto/update-farm-input-application.dto';

@Controller('agriculture/farm-input-applications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FarmInputApplicationsController {
  constructor(private service: FarmInputApplicationsService) {}

  @Post() @RequirePermissions('farm_inputs.apply')
  create(@Body() dto: CreateFarmInputApplicationDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('farm_inputs.view')
  findAll(@Query('cropSeasonId') cropSeasonId?: string, @Query('farmId') farmId?: string, @Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(cropSeasonId, farmId, companyId, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id') @RequirePermissions('farm_inputs.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Put(':id') @RequirePermissions('farm_inputs.apply')
  update(@Param('id') id: string, @Body() dto: UpdateFarmInputApplicationDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('farm_inputs.apply')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
