import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { OshaRegistrationsService } from './osha-registrations.service';
import { CreateOshaRegistrationDto } from './dto/create-osha-registration.dto';
import { UpdateOshaRegistrationDto } from './dto/update-osha-registration.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/osha-registrations')
export class OshaRegistrationsController {
  constructor(private readonly service: OshaRegistrationsService) {}

  @Get()
  @RequirePermissions('compliance.dashboard.view')
  findAll(@Query() query: Record<string, string>) {
    return this.service.findAll({
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      companyId: query.companyId,
      branchId: query.branchId,
      status: query.status,
      expiringDays: query.expiringDays ? Number(query.expiringDays) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('compliance.dashboard.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('compliance_obligations.manage')
  create(@Body() dto: CreateOshaRegistrationDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('compliance_obligations.manage')
  update(@Param('id') id: string, @Body() dto: UpdateOshaRegistrationDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('compliance_obligations.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
