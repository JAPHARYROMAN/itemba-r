import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { DepartmentsQueryDto } from '../../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/departments')
export class DepartmentsController {
  constructor(private readonly service: DepartmentsService) {}

  @Get()
  @RequirePermissions('departments.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: DepartmentsQueryDto) {
    return this.service.findAll(user, query);
  }

  /** Preview the next auto-generated department code for a company. */
  @Get('next-code')
  @RequirePermissions('departments.view')
  async nextCode(@Query('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return { departmentCode: await this.service.previewNextDepartmentCode(companyId, user) };
  }

  @Get(':id')
  @RequirePermissions('departments.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('departments.manage')
  create(@Body() dto: CreateDepartmentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('departments.manage')
  update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('departments.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
