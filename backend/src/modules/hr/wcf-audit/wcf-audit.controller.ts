import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { AuthUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { WcfAuditService } from './wcf-audit.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/wcf-audit')
export class WcfAuditController {
  constructor(private readonly service: WcfAuditService) {}

  @Get('exposure')
  @RequirePermissions('payroll.view')
  exposure(
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('fromMonth') fromMonth: string,
    @Query('toMonth') toMonth: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.exposureRegister(
      {
        companyId,
        year: Number(year),
        fromMonth: Number(fromMonth),
        toMonth: Number(toMonth),
      },
      user,
    );
  }
}
