import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CompanyQueryDto } from '../../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { ComplianceDashboardService } from './compliance-dashboard.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance/dashboard')
export class ComplianceDashboardController {
  constructor(private readonly service: ComplianceDashboardService) {}

  @Get()
  @RequirePermissions('compliance.dashboard.view')
  getSummary(@CurrentUser() user: AuthUser, @Query() query: CompanyQueryDto) {
    return this.service.getSummary(user, query);
  }
}
