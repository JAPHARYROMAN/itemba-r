import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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
}
