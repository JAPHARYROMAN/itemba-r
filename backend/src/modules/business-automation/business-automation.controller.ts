import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { BusinessAutomationService } from './business-automation.service';

@Controller('business-automation')
export class BusinessAutomationController {
  constructor(private readonly service: BusinessAutomationService) {}

  @Get('summary')
  @RequirePermissions('business_automation.dashboard')
  getSummary(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.getSummary(query, user);
  }
}
