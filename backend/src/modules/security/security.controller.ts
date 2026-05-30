import { Controller, Get } from '@nestjs/common';
import { SecurityService } from './security.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('security')
export class SecurityController {
  constructor(private readonly service: SecurityService) {}

  @Get('dashboard')
  @RequirePermissions('security.dashboard.view')
  dashboard() {
    return this.service.getDashboard();
  }

  @Get('summary')
  @RequirePermissions('security.dashboard.view')
  summary() {
    return this.service.getSummary();
  }

  @Get('readiness')
  @RequirePermissions('security.dashboard.view')
  readiness() {
    return this.service.getReadiness();
  }
}
