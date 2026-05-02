import { Controller, Get, Patch, Body, Param, Query } from '@nestjs/common';
import { ErrorLogsService } from './error-logs.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('error-logs')
export class ErrorLogsController {
  constructor(private readonly service: ErrorLogsService) {}

  @Get()
  @RequirePermissions('error_logs.view')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('error_logs.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id/acknowledge')
  @RequirePermissions('error_logs.resolve')
  acknowledge(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.updateStatus(id, 'ACKNOWLEDGED', user.id);
  }

  @Patch(':id/resolve')
  @RequirePermissions('error_logs.resolve')
  resolve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.updateStatus(id, 'RESOLVED', user.id);
  }

  @Patch(':id/ignore')
  @RequirePermissions('error_logs.resolve')
  ignore(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.updateStatus(id, 'IGNORED', user.id);
  }
}
