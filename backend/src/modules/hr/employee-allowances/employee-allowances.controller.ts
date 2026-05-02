import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { EmployeeAllowancesService } from './employee-allowances.service';
import { CreateEmployeeAllowanceDto } from './dto/create-employee-allowance.dto';
import { UpdateEmployeeAllowanceDto } from './dto/update-employee-allowance.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/employee-allowances')
export class EmployeeAllowancesController {
  constructor(private readonly service: EmployeeAllowancesService) {}

  @Get()
  @RequirePermissions('allowances.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('allowances.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('allowances.manage')
  create(@Body() dto: CreateEmployeeAllowanceDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('allowances.manage')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeAllowanceDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('allowances.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
