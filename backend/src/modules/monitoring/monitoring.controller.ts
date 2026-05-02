import { Controller, Get } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly service: MonitoringService) {}

  @Get('dashboard')
  @RequirePermissions('monitoring.dashboard.view')
  dashboard() {
    return this.service.getDashboard();
  }

  @Get('readiness')
  @RequirePermissions('monitoring.dashboard.view')
  readiness() {
    return this.service.getOperationalReadiness();
  }
}
