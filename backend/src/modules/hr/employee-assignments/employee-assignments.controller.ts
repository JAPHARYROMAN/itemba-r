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
import { EmployeeAssignmentsService } from './employee-assignments.service';
import { CreateEmployeeAssignmentDto } from './dto/create-employee-assignment.dto';
import { UpdateEmployeeAssignmentDto } from './dto/update-employee-assignment.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/employee-assignments')
export class EmployeeAssignmentsController {
  constructor(private readonly service: EmployeeAssignmentsService) {}

  @Get()
  @RequirePermissions('employees.assignments.manage')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('employees.assignments.manage')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('employees.assignments.manage')
  create(@Body() dto: CreateEmployeeAssignmentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('employees.assignments.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeAssignmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/approve-transfer-source-division')
  @RequirePermissions('employees.transfer.approve.division')
  approveTransferSourceDivision(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approveTransferSourceDivision(id, user);
  }

  @Patch(':id/approve-transfer-target-division')
  @RequirePermissions('employees.transfer.approve.division')
  approveTransferTargetDivision(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approveTransferTargetDivision(id, user);
  }

  @Patch(':id/approve-transfer-gm')
  @RequirePermissions('employees.transfer.approve.gm')
  approveTransferGm(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approveTransferGm(id, user);
  }

  @Patch(':id/approve-transfer-hr')
  @RequirePermissions('employees.transfer.approve.hr')
  approveTransferHr(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approveTransferHr(id, user);
  }

  @Patch(':id/approve-transfer-finance')
  @RequirePermissions('employees.transfer.approve.finance')
  approveTransferFinance(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approveTransferFinance(id, user);
  }

  @Delete(':id')
  @RequirePermissions('employees.assignments.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
