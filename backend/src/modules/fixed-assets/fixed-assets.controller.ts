import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put, Query,
  UseInterceptors,
} from '@nestjs/common';
import { FixedAssetsService } from './fixed-assets.service';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import { QueryFixedAssetDto } from './dto/query-fixed-asset.dto';
import { DisposeAssetDto } from './dto/dispose-asset.dto';
import { MarkCollateralDto } from './dto/mark-collateral.dto';
import { CapitalizeFixedAssetDto } from './dto/capitalize-fixed-asset.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SensitiveAccessInterceptor } from '../../common/interceptors/sensitive-access.interceptor';

@Controller('fixed-assets')
@UseInterceptors(SensitiveAccessInterceptor)
export class FixedAssetsController {
  constructor(private readonly service: FixedAssetsService) {}

  @Get('summary')
  @RequirePermissions('fixed-assets.read')
  getSummary(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.service.getSummary(user, companyId);
  }

  @Get()
  @RequirePermissions('fixed-assets.read')
  findAll(@Query() query: QueryFixedAssetDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('fixed-assets.read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Get(':id/audit-history')
  @RequirePermissions('fixed-assets.read')
  getAuditHistory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getAuditHistory(id, user);
  }

  @Post()
  @RequirePermissions('fixed-assets.create')
  create(@Body() dto: CreateFixedAssetDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('fixed-assets.update')
  update(@Param('id') id: string, @Body() dto: UpdateFixedAssetDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('fixed-assets.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }

  @Patch(':id/dispose')
  @RequirePermissions('fixed-assets.update')
  dispose(@Param('id') id: string, @Body() dto: DisposeAssetDto, @CurrentUser() user: AuthUser) {
    return this.service.dispose(id, dto, user);
  }

  @Patch(':id/collateral')
  @RequirePermissions('fixed-assets.update')
  markCollateral(@Param('id') id: string, @Body() dto: MarkCollateralDto, @CurrentUser() user: AuthUser) {
    return this.service.markCollateral(id, dto, user);
  }

  @Post(':id/capitalize')
  @RequirePermissions('fixed-assets.update')
  capitalize(@Param('id') id: string, @Body() dto: CapitalizeFixedAssetDto, @CurrentUser() user: AuthUser) {
    return this.service.capitalize(id, dto, user);
  }
}
