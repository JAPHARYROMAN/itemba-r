import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { SecurityPoliciesQueryDto } from '../../common/dto/resource-query.dto';
import { SecurityPoliciesService } from './security-policies.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateSecurityPolicyDto, UpdateSecurityPolicyDto } from './dto/security-policy.dto';

@Controller('security-policies')
export class SecurityPoliciesController {
  constructor(private readonly service: SecurityPoliciesService) {}

  @Get()
  @RequirePermissions('security.policies.view')
  findAll(@Query() query: SecurityPoliciesQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('security.policies.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('security.policies.manage')
  create(@Body() dto: CreateSecurityPolicyDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('security.policies.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSecurityPolicyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('security.policies.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
