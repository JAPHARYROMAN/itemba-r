import { Controller, Get, Query } from '@nestjs/common';
import { SupportService } from './support.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('support')
export class SupportController {
  constructor(private readonly service: SupportService) {}

  @Get('summary')
  @RequirePermissions('support.tickets.view')
  getSummary(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.getSummary(query, user);
  }
}
