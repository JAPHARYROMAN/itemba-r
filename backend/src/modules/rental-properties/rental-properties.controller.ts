import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RentalPropertiesService } from './rental-properties.service';
import { CreateRentalPropertyDto } from './dto/create-rental-property.dto';
import { UpdateRentalPropertyDto } from './dto/update-rental-property.dto';

@Controller('rental-properties')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RentalPropertiesController {
  constructor(private service: RentalPropertiesService) {}

  @Get()
  @RequirePermissions('rental_properties.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('divisionId') divisionId?: string,
    @Query('status') status?: string,
    @Query('propertyType') propertyType?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(companyId, divisionId, status, propertyType, search, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id')
  @RequirePermissions('rental_properties.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('rental_properties.manage')
  create(@Body() dto: CreateRentalPropertyDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('rental_properties.manage')
  update(@Param('id') id: string, @Body() dto: UpdateRentalPropertyDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('rental_properties.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
