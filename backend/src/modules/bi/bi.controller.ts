import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { BiService } from './bi.service';

@ApiTags('BI Gateway')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bi')
export class BiController {
  constructor(private readonly service: BiService) {}

  @Get('executive-summary')
  @RequirePermissions('bi.executive.view')
  getExecutiveSummary(@CurrentUser() user: AuthUser) {
    return this.service.getExecutiveSummary(user);
  }

  @Get('group-summary')
  @RequirePermissions('bi.group.view')
  getGroupSummary(@CurrentUser() user: AuthUser) {
    return this.service.getGroupSummary(user);
  }

  @Post('datasets/:datasetKey/query')
  @RequirePermissions('advanced_reports.view')
  queryDataset(@Param('datasetKey') datasetKey: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.queryDataset(datasetKey, body, user);
  }
}
