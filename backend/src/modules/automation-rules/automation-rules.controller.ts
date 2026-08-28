import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { CompanyStatusPageLimitQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AutomationRulesService } from './automation-rules.service';
import { CreateAutomationRuleDto, UpdateAutomationRuleDto } from './dto/automation-rule.dto';

@Controller('automation-rules')
export class AutomationRulesController {
  constructor(private readonly service: AutomationRulesService) {}

  @Get()
  @RequirePermissions('automation_rules.list')
  findAll(@Query() query: CompanyStatusPageLimitQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('automation_rules.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('automation_rules.create')
  create(@Body() dto: CreateAutomationRuleDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('automation_rules.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAutomationRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('automation_rules.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }

  @Post(':id/activate')
  @RequirePermissions('automation_rules.activate')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'ACTIVE', user);
  }

  @Post(':id/pause')
  @RequirePermissions('automation_rules.activate')
  pause(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'PAUSED', user);
  }
}
