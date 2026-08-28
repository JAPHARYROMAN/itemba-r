import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { TaxAnomalyDetectionService, Severity } from './tax-anomaly-detection.service';

/**
 * Read-only anomaly scan. Pass `companyId` to scope; pass repeated
 * `severity` or `category` query params to narrow the result set.
 *
 * Used by the C5 cockpit's "what needs attention" panel.
 */
@Controller('tax-anomalies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TaxAnomalyDetectionController {
  constructor(private readonly service: TaxAnomalyDetectionService) {}

  @Get('scan')
  @RequirePermissions('finance.reports.view')
  scan(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('severity') severity?: string | string[],
    @Query('category') category?: string | string[],
  ) {
    const severities = severity
      ? ((Array.isArray(severity) ? severity : [severity]).filter(Boolean) as Severity[])
      : undefined;
    const categories = category
      ? ((Array.isArray(category) ? category : [category]).filter(Boolean) as string[])
      : undefined;
    return this.service.scan({ companyId, severities, categories }, user);
  }
}
