import { Controller, Get, Put, Param, Query } from '@nestjs/common';
import { DataIsolationIssuesService } from './data-isolation-issues.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('data-isolation-issues')
export class DataIsolationIssuesController {
  constructor(private readonly service: DataIsolationIssuesService) {}

  @Get()
  @RequirePermissions('data_isolation.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('data_isolation.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id/acknowledge')
  @RequirePermissions('data_isolation.resolve_issues')
  acknowledge(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'ACKNOWLEDGED', user.id);
  }

  @Put(':id/resolve')
  @RequirePermissions('data_isolation.resolve_issues')
  resolve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'RESOLVED', user.id);
  }

  @Put(':id/dismiss')
  @RequirePermissions('data_isolation.resolve_issues')
  dismiss(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'DISMISSED', user.id);
  }
}
