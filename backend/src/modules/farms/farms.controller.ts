import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { FarmsService } from './farms.service';
import { CreateFarmDto } from './dto/create-farm.dto';
import { UpdateFarmDto } from './dto/update-farm.dto';

@Controller('agriculture/farms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FarmsController {
  constructor(private service: FarmsService) {}

  @Post() @RequirePermissions('farms.manage')
  create(@Body() dto: CreateFarmDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('farms.view')
  findAll(@Query('companyId') companyId?: string, @Query('divisionId') divisionId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(companyId, divisionId, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id') @RequirePermissions('farms.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Put(':id') @RequirePermissions('farms.manage')
  update(@Param('id') id: string, @Body() dto: UpdateFarmDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('farms.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
