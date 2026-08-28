import { Controller, Get } from '@nestjs/common';
import { SecurityService } from './security.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('security')
export class SecurityController {
  constructor(private readonly service: SecurityService) {}

  @Get('dashboard')
  @RequirePermissions('security.dashboard.view')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.service.getDashboard(user);
  }

  @Get('summary')
  @RequirePermissions('security.dashboard.view')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.getSummary(user);
  }

  @Get('readiness')
  @RequirePermissions('security.dashboard.view')
  readiness(@CurrentUser() user: AuthUser) {
    return this.service.getReadiness(user);
  }
}
