import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../../common/decorators/agent-excluded.decorator';
import { CcmNoticesService } from './ccm-notices.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/ccm-notices')
export class CcmNoticesController {
  constructor(private readonly service: CcmNoticesService) {}

  @Get('termination/:employeeId')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('employees.view')
  termination(@Param('employeeId') employeeId: string) {
    return this.service.terminationNotice(employeeId);
  }

  @Get('cma-referral/:disputeId')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('employees.view')
  cmaReferral(@Param('disputeId') disputeId: string) {
    return this.service.cmaReferralForm(disputeId);
  }
}
