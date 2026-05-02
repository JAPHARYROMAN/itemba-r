import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Patch } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { SalaryAdvancesService } from './salary-advances.service';
import { CreateSalaryAdvanceDto } from './dto/create-salary-advance.dto';
import { UpdateSalaryAdvanceDto } from './dto/update-salary-advance.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/salary-advances')
export class SalaryAdvancesController {
  constructor(private readonly service: SalaryAdvancesService) {}

  @Get()
  @RequirePermissions('salary_advances.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('salary_advances.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('salary_advances.create')
  create(@Body() dto: CreateSalaryAdvanceDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('salary_advances.create')
  update(@Param('id') id: string, @Body() dto: UpdateSalaryAdvanceDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/approve')
  @RequirePermissions('salary_advances.approve')
  approve(@Param('id') id: string, @Body() body: { approvedAmount?: number }, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, body.approvedAmount, user);
  }

  @Patch(':id/pay')
  @RequirePermissions('salary_advances.pay')
  pay(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.pay(id, user);
  }

  @Delete(':id')
  @RequirePermissions('salary_advances.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
