import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReportsCatalogService } from './reports-catalog.service';

/**
 * Enterprise reporting layer endpoints. These endpoints aggregate the report
 * catalog, BI assets, governance signals, packs, metrics, and viewer metadata
 * into the surfaces consumed by the rebuilt Reports module.
 */
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsEnterpriseController {
  constructor(private readonly service: ReportsCatalogService) {}

  @Get('command-center')
  commandCenter(@CurrentUser() user: AuthUser) {
    return this.service.commandCenter(user);
  }

  @Get('data-catalog')
  dataCatalog() {
    return this.service.dataCatalog();
  }

  @Get('data-quality-surface')
  dataQualitySurface(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.service.dataQualitySurface(user, undefined, query ?? {});
  }

  @Get('integration-readiness')
  integrationReadiness() {
    return this.service.integrationReadiness();
  }

  @Get('report-packs')
  reportPacks() {
    return this.service.reportPacks();
  }

  @Get('governance')
  governance() {
    return this.service.governance();
  }

  @Get('admin')
  admin() {
    return this.service.admin();
  }

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

  @Post('report-packs/:packKey/generate')
  generateReportPack(
    @Param('packKey') packKey: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.generateReportPack(packKey, body ?? {}, user);
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

  @Patch('governance/:reportId/lifecycle')
  updateLifecycle(
    @Param('reportId') reportId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateLifecycle(reportId, body ?? {}, user);
  }
}
