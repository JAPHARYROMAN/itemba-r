import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { CacheManagementService } from './cache-management.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('cache')
export class CacheManagementController {
  constructor(private readonly service: CacheManagementService) {}

  @Get('stats')
  @RequirePermissions('cache.view')
  getStats() {
    return this.service.getStats();
  }

  @Get()
  @RequirePermissions('cache.view')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('cache.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Delete('invalidate-company/:companyId')
  @RequirePermissions('cache.invalidate')
  invalidateByCompany(@Param('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.service.invalidateByCompany(companyId, user.id);
  }

  @Delete('invalidate-prefix/:prefix')
  @RequirePermissions('cache.invalidate')
  invalidateByPrefix(@Param('prefix') prefix: string, @CurrentUser() user: AuthUser) {
    return this.service.invalidateByPrefix(prefix, user.id);
  }

  @Delete(':id')
  @RequirePermissions('cache.invalidate')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }

  @Post('set')
  @RequirePermissions('cache.manage')
  set(@Body() dto: any) {
    return this.service.set(dto);
  }
}
