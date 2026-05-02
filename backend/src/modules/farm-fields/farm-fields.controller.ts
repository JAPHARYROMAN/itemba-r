import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { FarmFieldsService } from './farm-fields.service';
import { CreateFarmFieldDto } from './dto/create-farm-field.dto';
import { UpdateFarmFieldDto } from './dto/update-farm-field.dto';

@Controller('agriculture/farm-fields')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FarmFieldsController {
  constructor(private service: FarmFieldsService) {}

  @Post() @RequirePermissions('farm_fields.manage')
  create(@Body() dto: CreateFarmFieldDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('farm_fields.view')
  findAll(@Query('farmId') farmId?: string, @Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(farmId, companyId, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id') @RequirePermissions('farm_fields.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Put(':id') @RequirePermissions('farm_fields.manage')
  update(@Param('id') id: string, @Body() dto: UpdateFarmFieldDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('farm_fields.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
