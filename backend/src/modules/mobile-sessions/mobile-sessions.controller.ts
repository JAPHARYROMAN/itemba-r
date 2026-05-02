import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { MobileSessionsService } from './mobile-sessions.service';
import { QueryMobileSessionDto } from './dto/query-mobile-session.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('mobile-sessions')
export class MobileSessionsController {
  constructor(private readonly service: MobileSessionsService) {}

  @Get()
  @RequirePermissions('mobile_sessions.view')
  findAll(@Query() query: QueryMobileSessionDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('mobile_sessions.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Delete(':id/revoke')
  @RequirePermissions('mobile_sessions.revoke')
  revoke(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.revoke(id, user.id);
  }
}
