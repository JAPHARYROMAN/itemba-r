import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { CompanyStatusPageLimitQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ProcurementPlansService } from './procurement-plans.service';
import { CreateProcurementPlanDto, UpdateProcurementPlanDto } from './dto/procurement-plan.dto';

@Controller('procurement-plans')
export class ProcurementPlansController {
  constructor(private readonly service: ProcurementPlansService) {}

  @Get()
  @RequirePermissions('procurement_plans.list')
  findAll(@Query() query: CompanyStatusPageLimitQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('procurement_plans.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('procurement_plans.create')
  create(@Body() dto: CreateProcurementPlanDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('procurement_plans.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProcurementPlanDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/approve')
  @RequirePermissions('procurement_plans.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }
}
