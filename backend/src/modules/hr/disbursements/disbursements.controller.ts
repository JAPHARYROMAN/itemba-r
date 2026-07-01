import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { DisbursementsService } from './disbursements.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/payroll-runs')
export class DisbursementsController {
  constructor(private readonly service: DisbursementsService) {}

  /**
   * Generate disbursement files for a payroll run.
   * Returns a manifest containing each file as inline content (CSV string), so
   * the frontend can offer per-file downloads. Files are NOT persisted to disk.
   */
  @Post(':id/disbursement-files')
  @RequirePermissions('payroll.pay')
  generate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.generateForRun(id, user);
  }
}
