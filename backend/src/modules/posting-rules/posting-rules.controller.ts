import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { CompanyPageLimitQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingRulesService } from './posting-rules.service';
import {
  CreatePostingRuleDto,
  CreatePostingRuleLineDto,
  UpdatePostingRuleDto,
} from './dto/posting-rule.dto';

@Controller('posting-rules')
export class PostingRulesController {
  constructor(private readonly service: PostingRulesService) {}

  @Get()
  @RequirePermissions('posting_rules.list')
  findAll(@Query() query: CompanyPageLimitQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('posting_rules.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('posting_rules.create')
  create(@Body() dto: CreatePostingRuleDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('posting_rules.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePostingRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('posting_rules.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }

  @Get(':id/lines')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('posting_rules.view')
  getLines(@Param('id') id: string) {
    return this.service.getLines(id);
  }

  @Post(':id/lines')
  @RequirePermissions('posting_rules.update')
  addLine(
    @Param('id') id: string,
    @Body() dto: CreatePostingRuleLineDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addLine(id, dto, user);
  }
}
