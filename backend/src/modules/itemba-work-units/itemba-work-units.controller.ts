import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ItembaWorkUnitsService } from './itemba-work-units.service';
import { CreateItembaWorkUnitDto } from './dto/create-itemba-work-unit.dto';
import { UpdateItembaWorkUnitDto } from './dto/update-itemba-work-unit.dto';

@Controller('itemba/work-units')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ItembaWorkUnitsController {
  constructor(private service: ItembaWorkUnitsService) {}

  @Post()
  @RequirePermissions('itemba.work_units.manage')
  create(@Body() dto: CreateItembaWorkUnitDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('itemba.work_units.view')
  findAll(@Query('companyId') companyId?: string, @Query('divisionId') divisionId?: string, @Query('page') page?: string, @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser) {
    return this.service.findAll(companyId, divisionId, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id')
  @RequirePermissions('itemba.work_units.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('itemba.work_units.manage')
  update(@Param('id') id: string, @Body() dto: UpdateItembaWorkUnitDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('itemba.work_units.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
