import { Controller, Get, Post, Put, Delete, Body, Param, Query, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CropSeasonsService } from './crop-seasons.service';
import { CreateCropSeasonDto } from './dto/create-crop-season.dto';
import { UpdateCropSeasonDto } from './dto/update-crop-season.dto';
import { CropSeasonStatus } from '@prisma/client';

@Controller('agriculture/crop-seasons')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CropSeasonsController {
  constructor(private service: CropSeasonsService) {}

  @Post() @RequirePermissions('crop_seasons.manage')
  create(@Body() dto: CreateCropSeasonDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('crop_seasons.view')
  findAll(@Query('farmId') farmId?: string, @Query('companyId') companyId?: string, @Query('status') status?: CropSeasonStatus, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(farmId, companyId, status, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id') @RequirePermissions('crop_seasons.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Patch(':id/status') @RequirePermissions('crop_seasons.manage')
  updateStatus(@Param('id') id: string, @Body() body: { status: CropSeasonStatus }, @CurrentUser() user: AuthUser) {
    return this.service.updateStatus(id, body.status, user.id);
  }

  @Put(':id') @RequirePermissions('crop_seasons.manage')
  update(@Param('id') id: string, @Body() dto: UpdateCropSeasonDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('crop_seasons.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
