import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/employees')
export class EmployeesController {
  constructor(private readonly service: EmployeesService) {}

  @Get()
  @RequirePermissions('employees.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  /**
   * Preview the next auto-generated employee code for a company. Used by
   * the create form to show the operator what the code will be before they
   * submit. Returns `{ employeeCode: string }`.
   */
  @Get('next-code')
  @RequirePermissions('employees.view')
  async nextCode(@Query('companyId') companyId: string) {
    return { employeeCode: await this.service.nextEmployeeCode(companyId) };
  }

  @Get(':id')
  @RequirePermissions('employees.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('employees.create')
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('employees.update')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/request-termination')
  @RequirePermissions('employees.termination.request')
  requestTermination(
    @Param('id') id: string,
    @Body() body: { reason?: string; terminationDate?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.requestTermination(id, body, user);
  }

  @Patch(':id/approve-termination-hr')
  @RequirePermissions('employees.termination.approve.hr')
  approveTerminationHr(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approveTerminationHr(id, user);
  }

  @Patch(':id/approve-termination-gm')
  @RequirePermissions('employees.termination.approve.gm')
  approveTerminationGm(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approveTerminationGm(id, user);
  }

  @Delete(':id')
  @RequirePermissions('employees.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
