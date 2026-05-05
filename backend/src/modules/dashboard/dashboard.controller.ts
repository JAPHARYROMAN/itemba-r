import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  /**
   * Full executive summary. Sensitive figures are scoped and permission-gated
   * on the backend because this payload is used by both dashboard surfaces.
   */
  @Get('executive-summary')
  @RequirePermissions('group-control.view')
  getExecutiveSummary(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.service.getExecutiveSummary(user, companyId);
  }
}
