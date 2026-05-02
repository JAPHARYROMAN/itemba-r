import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { GroupControlService } from './group-control.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SensitiveAccessInterceptor } from '../../common/interceptors/sensitive-access.interceptor';

@Controller('group-control')
@UseInterceptors(SensitiveAccessInterceptor)
export class GroupControlController {
  constructor(private readonly service: GroupControlService) {}

  @Get('summary')
  @RequirePermissions('group-control.view')
  getSummary(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.service.getSummary(user, companyId);
  }

  @Get('audit-trail')
  @RequirePermissions('audit-logs.read')
  getAuditTrail(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.service.getAuditTrail(user, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      companyId,
    });
  }
}
