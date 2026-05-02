import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportsCatalogService } from './reports-catalog.service';

/**
 * Master Reports catalog — non-sensitive metadata about every report
 * surfaced through the master Reports hub. Auth-gated but no specific
 * permission required: each underlying report endpoint enforces its own
 * permission, so the catalog can safely tell every authenticated user
 * what exists.
 */
@Controller('reports/catalog')
@UseGuards(JwtAuthGuard)
export class ReportsCatalogController {
  constructor(private readonly service: ReportsCatalogService) {}

  @Get()
  list(
    @Query('sector') sector?: string,
    @Query('scope') scope?: string,
    @Query('search') search?: string,
  ) {
    return this.service.list({ sector, scope, search });
  }
}
