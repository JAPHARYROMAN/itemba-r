import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { ComplianceReportsService } from './compliance-reports.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance/reports')
export class ComplianceReportsController {
  constructor(private readonly service: ComplianceReportsService) {}

  @Get('obligations-summary')
  @RequirePermissions('compliance.reports.view')
  getObligationsSummary(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.getObligationsSummary(user, query);
  }

  @Get('tax-transactions-summary')
  @RequirePermissions('compliance.reports.view')
  getTaxTransactionsSummary(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.getTaxTransactionsSummary(user, query);
  }

  @Get('document-status-summary')
  @RequirePermissions('compliance.reports.view')
  getDocumentStatusSummary(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.getDocumentStatusSummary(user, query);
  }
}
