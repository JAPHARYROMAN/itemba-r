import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ConstructionLabourCostService } from './construction-labour-cost.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('construction/labour-cost')
export class ConstructionLabourCostController {
  constructor(private readonly service: ConstructionLabourCostService) {}

  @Get('report')
  @RequirePermissions('construction.dashboard.view')
  report(
    @Query('companyId') companyId: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.report({ companyId, periodStart, periodEnd, projectId });
  }

  @Get('projects/:projectId/allocations')
  @RequirePermissions('construction.dashboard.view')
  listAllocations(
    @Param('projectId') projectId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listAllocations(projectId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}
