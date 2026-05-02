import { Controller, Get, Query } from '@nestjs/common';
import { HelpCenterService } from './help-center.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('help')
export class HelpCenterController {
  constructor(private readonly service: HelpCenterService) {}

  @Get('search')
  @RequirePermissions('help_center.view')
  search(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.search(query, user);
  }

  @Get()
  @RequirePermissions('help_center.view')
  getOverview(@CurrentUser() user: AuthUser) {
    return this.service.getOverview(user);
  }
}
