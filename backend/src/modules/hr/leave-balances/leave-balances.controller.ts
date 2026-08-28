import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { LeaveBalancesQueryDto } from '../../../common/dto/resource-query.dto';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { LeaveBalancesService } from './leave-balances.service';
import { IsInt, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

class LeaveBalanceAllocationDto {
  @IsUUID()
  companyId!: string;

  @IsUUID()
  employeeId!: string;

  @IsUUID()
  leaveTypeId!: string;

  @IsInt()
  year!: number;

  @IsOptional()
  @IsNumber()
  allocatedDays?: number;

  @IsOptional()
  @IsNumber()
  carriedForwardDays?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/leave-balances')
export class LeaveBalancesController {
  constructor(private readonly service: LeaveBalancesService) {}

  @Get()
  @RequirePermissions('leave_balances.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: LeaveBalancesQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('leave_balances.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('leave_balances.manage')
  upsertAllocation(@Body() body: LeaveBalanceAllocationDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertAllocation(body, user);
  }
}
