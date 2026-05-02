import { Controller, Get } from '@nestjs/common';
import { LaunchReadinessService } from './launch-readiness.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('launch')
export class LaunchReadinessController {
  constructor(private readonly service: LaunchReadinessService) {}

  @Get('dashboard/summary')
  @RequirePermissions('launch.dashboard.view')
  getDashboardSummary() {
    return this.service.getDashboardSummary();
  }
}
