import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LeaseAgreementsService } from './lease-agreements.service';
import { CreateLeaseAgreementDto } from './dto/create-lease-agreement.dto';
import { UpdateLeaseAgreementDto } from './dto/update-lease-agreement.dto';

@Controller('lease-agreements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LeaseAgreementsController {
  constructor(private service: LeaseAgreementsService) {}

  @Get()
  @RequirePermissions('leases.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('propertyId') propertyId?: string,
    @Query('rentalUnitId') rentalUnitId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(companyId, propertyId, rentalUnitId, tenantId, status, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequirePermissions('leases.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('leases.create')
  create(@Body() dto: CreateLeaseAgreementDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('leases.approve')
  update(@Param('id') id: string, @Body() dto: UpdateLeaseAgreementDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/approve')
  @RequirePermissions('leases.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.id);
  }

  @Post(':id/terminate')
  @RequirePermissions('leases.terminate')
  terminate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.terminate(id, user.id);
  }

  @Delete(':id')
  @RequirePermissions('leases.approve')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
