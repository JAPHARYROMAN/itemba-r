import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { CacheManagementQueryDto } from '../../common/dto/resource-query.dto';
import { CacheManagementService } from './cache-management.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SetCacheEntryDto } from './dto/set-cache-entry.dto';

@Controller('cache')
export class CacheManagementController {
  constructor(private readonly service: CacheManagementService) {}

  @Get('stats')
  @RequirePermissions('cache.stats.view')
  getStats(@CurrentUser() user: AuthUser) {
    return this.service.getStats(user);
  }

  @Get()
  @RequirePermissions('cache.view')
  findAll(@Query() query: CacheManagementQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('cache.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Delete('invalidate-company/:companyId')
  @RequirePermissions('cache.invalidate')
  invalidateByCompany(@Param('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.service.invalidateByCompany(companyId, user);
  }

  @Delete('invalidate-prefix/:prefix')
  @RequirePermissions('cache.invalidate')
  invalidateByPrefix(@Param('prefix') prefix: string, @CurrentUser() user: AuthUser) {
    return this.service.invalidateByPrefix(prefix, user);
  }

  @Delete(':id')
  @RequirePermissions('cache.invalidate')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }

  @Post('set')
  @RequirePermissions('cache.manage')
  set(@Body() dto: SetCacheEntryDto, @CurrentUser() user: AuthUser) {
    return this.service.set(dto, user);
  }
}
