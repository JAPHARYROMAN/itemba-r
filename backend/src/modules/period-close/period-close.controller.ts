import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PeriodCloseService } from './period-close.service';
import { CreatePeriodCloseDto, QueryPeriodCloseDto } from './dto/period-close.dto';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AcknowledgeDifferencesDto } from '../accounting-periods/dto/acknowledge-differences.dto';

@Controller('period-close')
export class PeriodCloseController {
  constructor(private readonly service: PeriodCloseService) {}

  @Get()
  @RequirePermissions('period_close.list')
  findAll(@Query() query: QueryPeriodCloseDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('period_close.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('period_close.create')
  create(@Body() dto: CreatePeriodCloseDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Post(':id/close')
  @RequirePermissions('period_close.close')
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.close(id, user);
  }

  // Party linkage (Phase 3): the three routes below are agent-excluded until their Msaidizi
  // evidence fixtures are authored; the plain close keeps its pinned body-less fixture, so the
  // acknowledged close is its own route rather than an optional body on the same one.
  @Get(':id/party-check')
  @AgentExcluded()
  @RequirePermissions('period_close.view')
  partyCheck(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.partyCheck(id, user);
  }

  @Get(':id/party-snapshots')
  @AgentExcluded()
  @RequirePermissions('period_close.view')
  partySnapshots(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.partySnapshots(id, user);
  }

  @Post(':id/close-acknowledged')
  @AgentExcluded()
  @RequirePermissions('period_close.close')
  closeAcknowledged(
    @Param('id') id: string,
    @Body() dto: AcknowledgeDifferencesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.close(id, user, { reason: dto.reason });
  }

  @Post(':id/reopen')
  @RequirePermissions('period_close.reopen')
  reopen(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reopen(id, user);
  }
}
