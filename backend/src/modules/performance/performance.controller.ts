import { Controller, Get } from '@nestjs/common';
import { PerformanceDashboardService } from './performance.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('performance')
export class PerformanceDashboardController {
  constructor(private readonly service: PerformanceDashboardService) {}

  @Get('dashboard')
  @RequirePermissions('performance.dashboard.view')
  getDashboard() {
    return this.service.getDashboard();
  }
}
