import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CrmService } from './crm.service';

@Controller('crm')
export class CrmController {
  constructor(private readonly service: CrmService) {}

  @Get('summary')
  @RequirePermissions('crm.dashboard')
  getSummary(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.getSummary(query, user);
  }

  @Get('readiness')
  @RequirePermissions('crm.dashboard')
  getReadiness(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.getReadiness(query, user);
  }
}
