import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReportsCatalogService } from './reports-catalog.service';

/**
 * Per-report metadata endpoints consumed by the report runner (/reports/run):
 * viewer manifest, lineage, data-quality warnings, explain, and export-audit.
 *
 * The aspirational "enterprise BI" surface (command-center, governance,
 * semantic query, self-service builder, report-packs, data-catalog) was removed
 * in the Westsides tone-down — it was never called by the UI and depended on
 * deleted modules. Keep this controller scoped to what the runner actually uses.
 */
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsEnterpriseController {
  constructor(private readonly service: ReportsCatalogService) {}

  @Get('viewer/:reportId')
  viewerMetadata(@Param('reportId') reportId: string) {
    return this.service.viewerMetadata(reportId);
  }

  @Post('viewer/:reportId/run-manifest')
  recordViewerRun(
    @Param('reportId') reportId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.recordViewerRun(reportId, body ?? {}, user);
  }

  @Get('lineage/:reportId')
  lineage(
    @Param('reportId') reportId: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.lineage(reportId, user, query ?? {});
  }

  @Get('data-quality-warnings/:reportId')
  dataQualityWarnings(
    @Param('reportId') reportId: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.dataQualityWarnings(reportId, user, query ?? {});
  }

  @Get('explain/:reportId')
  explain(
    @Param('reportId') reportId: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.explain(reportId, user, query ?? {});
  }

  @Post('export-audit')
  recordExportAudit(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.service.recordExportAudit(body ?? {}, user);
  }

  @Get('export-audit/:reportId')
  exportAuditHistory(
    @Param('reportId') reportId: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.exportAuditHistory(reportId, user, query ?? {});
  }
}
