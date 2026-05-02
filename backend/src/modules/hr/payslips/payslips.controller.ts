import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PayslipsService } from './payslips.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/payslips')
export class PayslipsController {
  constructor(private readonly service: PayslipsService) {}

  @Get(':id')
  @RequirePermissions('payroll.view')
  getOne(@Param('id') id: string) {
    return this.service.getPayslip(id);
  }

  @Get('run/:payrollRunId')
  @RequirePermissions('payroll.view')
  getForRun(@Param('payrollRunId') payrollRunId: string) {
    return this.service.getPayslipsForRun(payrollRunId);
  }
}
