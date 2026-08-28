import { Controller, Get, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PayrollEntriesQueryDto } from '../../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { PayrollEntriesService } from './payroll-entries.service';
import { UpdatePayrollEntryDto } from './dto/update-payroll-entry.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/payroll-entries')
export class PayrollEntriesController {
  constructor(private readonly service: PayrollEntriesService) {}

  @Get()
  @RequirePermissions('payroll.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: PayrollEntriesQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('payroll.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Put(':id')
  @RequirePermissions('payroll.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePayrollEntryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }
}
