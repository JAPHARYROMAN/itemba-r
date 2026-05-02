import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SettingsCatalogService } from './settings-catalog.service';

/**
 * Master Settings catalog — non-sensitive metadata about every settings
 * entity surfaced through the master Settings hub. Auth-gated but no
 * specific permission required: each underlying settings page enforces its
 * own permission, so the catalog can safely tell every authenticated user
 * what exists.
 */
@Controller('settings/catalog')
@UseGuards(JwtAuthGuard)
export class SettingsCatalogController {
  constructor(private readonly service: SettingsCatalogService) {}

  @Get()
  list(
    @Query('category') category?: string,
    @Query('scope') scope?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.service.list({ category, scope, status, search });
  }
}
