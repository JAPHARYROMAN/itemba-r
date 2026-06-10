import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LaborRecordsService } from './labor-records.service';
import { CreateLaborRecordDto } from './dto/create-labor-record.dto';
import { UpdateLaborRecordDto } from './dto/update-labor-record.dto';
import { LaborPaymentStatus } from '@prisma/client';

@Controller('itemba/labor-records')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LaborRecordsController {
  constructor(private service: LaborRecordsService) {}

  @Post()
  @RequirePermissions('labor_records.manage')
  create(@Body() dto: CreateLaborRecordDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('labor_records.view')
  findAll(@Query('companyId') companyId?: string, @Query('divisionId') divisionId?: string, @Query('paymentStatus') paymentStatus?: LaborPaymentStatus, @Query('page') page?: string, @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser) {
    return this.service.findAll(companyId, divisionId, paymentStatus, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id')
  @RequirePermissions('labor_records.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('labor_records.manage')
  update(@Param('id') id: string, @Body() dto: UpdateLaborRecordDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('labor_records.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
