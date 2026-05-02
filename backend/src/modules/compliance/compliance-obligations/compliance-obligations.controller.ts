import { Controller, Get, Post, Put, Delete, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { ComplianceObligationsService } from './compliance-obligations.service';
import { CreateComplianceObligationDto } from './dto/create-compliance-obligation.dto';
import { UpdateComplianceObligationDto } from './dto/update-compliance-obligation.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance/obligations')
export class ComplianceObligationsController {
  constructor(private readonly service: ComplianceObligationsService) {}

  @Get()
  @RequirePermissions('compliance_obligations.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('compliance_obligations.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('compliance_obligations.manage')
  create(@Body() dto: CreateComplianceObligationDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('compliance_obligations.manage')
  update(@Param('id') id: string, @Body() dto: UpdateComplianceObligationDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/complete')
  @RequirePermissions('compliance_obligations.manage')
  complete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.complete(id, user);
  }

  @Delete(':id')
  @RequirePermissions('compliance_obligations.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
