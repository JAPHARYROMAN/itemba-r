import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../../common/decorators/agent-excluded.decorator';
import { CcmNoticesService } from './ccm-notices.service';
import { AuthUser, CurrentUser } from '../../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/ccm-notices')
export class CcmNoticesController {
  constructor(private readonly service: CcmNoticesService) {}

  @Get('termination/:employeeId')
  @AgentExcluded()
  @RequirePermissions('employees.view')
  termination(@Param('employeeId') employeeId: string, @CurrentUser() user: AuthUser) {
    return this.service.terminationNotice(employeeId, user);
  }

  @Get('cma-referral/:disputeId')
  @AgentExcluded()
  @RequirePermissions('employees.view')
  cmaReferral(@Param('disputeId') disputeId: string, @CurrentUser() user: AuthUser) {
    return this.service.cmaReferralForm(disputeId, user);
  }
}
