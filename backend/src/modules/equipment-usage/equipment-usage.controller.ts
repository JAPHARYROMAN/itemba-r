import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { EquipmentUsageService } from './equipment-usage.service';
import { CreateEquipmentUsageDto } from './dto/create-equipment-usage.dto';
import { UpdateEquipmentUsageDto } from './dto/update-equipment-usage.dto';

@Controller('itemba/equipment-usage')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EquipmentUsageController {
  constructor(private service: EquipmentUsageService) {}

  @Post()
  @RequirePermissions('equipment_usage.manage')
  create(@Body() dto: CreateEquipmentUsageDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('equipment_usage.view')
  findAll(@Query('companyId') companyId?: string, @Query('divisionId') divisionId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(companyId, divisionId, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequirePermissions('equipment_usage.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('equipment_usage.manage')
  update(@Param('id') id: string, @Body() dto: UpdateEquipmentUsageDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('equipment_usage.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
