import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { MobilePosSessionAllowed } from '../../common/decorators/mobile-pos-session.decorator';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import {
  ApprovePosDraftDto,
  ConfirmReturnPosDraftDto,
  CorrectPosDraftDto,
  PosDraftRevisionDto,
  RejectPosDraftDto,
  SubmitPosDraftDto,
} from './pos-drafts.dto';
import { PosDraftsService } from './pos-drafts.service';

@Controller('pos-drafts')
export class PosDraftsController {
  constructor(private readonly service: PosDraftsService) {}
  @Get()
  @RequirePermissions('pos_drafts.view')
  @MobilePosSessionAllowed('CASHIER', 'STOCKIST')
  list(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.list(query, user);
  }
  @Get('scopes')
  @RequireAnyPermissions(
    'pos_drafts.view',
    'mobile_pos_lite.manage',
    'mobile_pos_onboarding.manage',
  )
  @MobilePosSessionAllowed('CASHIER', 'STOCKIST')
  scopes(@CurrentUser() user: AuthUser) {
    return this.service.scopes(user);
  }
  @Get('context')
  @RequirePermissions('pos_drafts.view')
  @MobilePosSessionAllowed('CASHIER', 'STOCKIST')
  context(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.context(query, user);
  }
  @Get('stock-baseline')
  @RequirePermissions('pos_drafts.view')
  @MobilePosSessionAllowed('CASHIER', 'STOCKIST')
  baseline(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.baseline(query, user);
  }
  @Get('outcome/:requestId')
  @RequirePermissions('pos_drafts.view')
  @MobilePosSessionAllowed('CASHIER', 'STOCKIST')
  outcome(@Param('requestId') requestId: string, @CurrentUser() user: AuthUser) {
    return this.service.outcome(requestId, user);
  }
  @Get('legacy-outcome')
  @RequirePermissions('pos_drafts.view', 'mobile_pos_lite.manage')
  legacyOutcome(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.legacyOutcome(query, user);
  }
  @Get(':id')
  @RequirePermissions('pos_drafts.view')
  @MobilePosSessionAllowed('CASHIER', 'STOCKIST')
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.detail(id, user);
  }
  @Get(':id/receipt')
  @RequirePermissions('pos_drafts.view')
  @MobilePosSessionAllowed('CASHIER', 'STOCKIST')
  receipt(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.receipt(id, user);
  }
  @Post()
  @RequirePermissions('pos_drafts.create')
  @MobilePosSessionAllowed('CASHIER', 'STOCKIST')
  submit(@Body() dto: SubmitPosDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.submit(dto, user);
  }
  @Patch(':id/correct')
  @RequirePermissions('pos_drafts.create')
  @MobilePosSessionAllowed('CASHIER', 'STOCKIST')
  correct(@Param('id') id: string, @Body() dto: CorrectPosDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.correct(id, dto, user);
  }
  @Post(':id/approve')
  @AgentExcluded()
  @RequirePermissions('pos_drafts.approve')
  approve(@Param('id') id: string, @Body() dto: ApprovePosDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, dto, user);
  }
  @Post(':id/prepare')
  @RequirePermissions('pos_drafts.dispatch')
  @MobilePosSessionAllowed('STOCKIST')
  prepare(
    @Param('id') id: string,
    @Body() dto: PosDraftRevisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.prepare(id, dto, user);
  }
  @Post(':id/reject')
  @AgentExcluded()
  @RequirePermissions('pos_drafts.reject')
  reject(@Param('id') id: string, @Body() dto: RejectPosDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, dto, user);
  }
  @Post(':id/confirm-return')
  @AgentExcluded()
  @RequirePermissions('pos_drafts.approve')
  confirmReturn(
    @Param('id') id: string,
    @Body() dto: ConfirmReturnPosDraftDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.confirmReturn(id, dto, user);
  }
  @Post(':id/direct-post')
  @AgentExcluded()
  @RequirePermissions('pos_drafts.direct_post')
  direct(@Param('id') id: string, @Body() dto: ApprovePosDraftDto, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, dto, user, true);
  }
}
