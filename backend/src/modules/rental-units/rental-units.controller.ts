import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RentalUnitsService } from './rental-units.service';
import { CreateRentalUnitDto } from './dto/create-rental-unit.dto';
import { UpdateRentalUnitDto } from './dto/update-rental-unit.dto';

@Controller('rental-units')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RentalUnitsController {
  constructor(private service: RentalUnitsService) {}

  @Get()
  @RequirePermissions('rental_units.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('propertyId') propertyId?: string,
    @Query('status') status?: string,
    @Query('unitType') unitType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(companyId, propertyId, status, unitType, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id')
  @RequirePermissions('rental_units.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('rental_units.manage')
  create(@Body() dto: CreateRentalUnitDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('rental_units.manage')
  update(@Param('id') id: string, @Body() dto: UpdateRentalUnitDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('rental_units.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
