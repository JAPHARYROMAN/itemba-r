import { Controller, Get, Put, Param, Query } from '@nestjs/common';
import { DataIsolationIssueStatus } from '@prisma/client';
import { DataIsolationIssuesService } from './data-isolation-issues.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { QueryDataIsolationIssueDto } from './dto/data-isolation-issue.dto';

@Controller('data-isolation-issues')
export class DataIsolationIssuesController {
  constructor(private readonly service: DataIsolationIssuesService) {}

  @Get()
  @RequirePermissions('data_isolation.view')
  findAll(@Query() query: QueryDataIsolationIssueDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('data_isolation.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Put(':id/acknowledge')
  @RequirePermissions('data_isolation.resolve_issues')
  acknowledge(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, DataIsolationIssueStatus.ACKNOWLEDGED, user);
  }

  @Put(':id/resolve')
  @RequirePermissions('data_isolation.resolve_issues')
  resolve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, DataIsolationIssueStatus.RESOLVED, user);
  }

  @Put(':id/dismiss')
  @RequirePermissions('data_isolation.resolve_issues')
  dismiss(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, DataIsolationIssueStatus.DISMISSED, user);
  }
}
