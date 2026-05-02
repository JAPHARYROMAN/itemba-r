import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WestsidesDashboardService } from './westsides-dashboard.service';
import { QueryDashboardDto } from './dto/query-dashboard.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('westsides/dashboard')
@Controller('westsides/dashboard')
export class WestsidesDashboardController {
  constructor(private readonly service: WestsidesDashboardService) {}

  @Get('summary')
  @RequirePermissions('westsides.dashboard.view')
  @ApiOperation({ summary: 'Westsides dashboard summary' })
  getSummary(@Query() query: QueryDashboardDto, @CurrentUser() user: AuthUser) {
    return this.service.getSummary(query, user);
  }

  @Get('cockpit')
  @RequirePermissions('westsides.dashboard.view')
  @ApiOperation({ summary: 'Westsides Commercial Cockpit — single-shot KPI aggregate' })
  cockpit(
    @Query('companyId') companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.cockpit({ companyId, branchId }, user);
  }
}
