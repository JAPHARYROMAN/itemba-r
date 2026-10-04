import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MobilePosSessionAllowed } from '../../common/decorators/mobile-pos-session.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { MobilePosAuthService } from './mobile-pos-auth.service';
import {
  MobilePosAdminLinkDto,
  MobilePosApproveDto,
  MobilePosBranchSetupDto,
  MobilePosInviteDto,
  MobilePosLoginDto,
  MobilePosReasonDto,
  MobilePosRefreshDto,
  MobilePosRegistrationDto,
  MobilePosResetDto,
  MobilePosSetupDto,
} from './mobile-pos-auth.dto';

@Controller('mobile-pos-auth')
export class MobilePosAuthController {
  constructor(private readonly service: MobilePosAuthService) {}
  @Public()
  @Get('invite/:token')
  @AgentExcluded()
  invite(@Param('token') token: string) {
    return this.service.inviteInfo(token);
  }
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('invite/:token')
  @AgentExcluded()
  register(@Param('token') token: string, @Body() dto: MobilePosRegistrationDto) {
    return this.service.register(token, dto);
  }
  @Public()
  @Get('enrollment/:claimToken')
  @AgentExcluded()
  enrollment(@Param('claimToken') claimToken: string) {
    return this.service.enrollmentInfo(claimToken);
  }
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('setup')
  @AgentExcluded()
  setup(@Body() dto: MobilePosSetupDto) {
    return this.service.setup(dto);
  }
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('login')
  @AgentExcluded()
  login(@Body() dto: MobilePosLoginDto) {
    return this.service.login(dto);
  }
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('refresh')
  @AgentExcluded()
  refresh(@Body() dto: MobilePosRefreshDto) {
    return this.service.refresh(dto.refreshToken, dto.deviceSecret);
  }
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('reset-pin')
  @AgentExcluded()
  reset(@Body() dto: MobilePosResetDto) {
    return this.service.resetPin(dto);
  }
  @Get('me')
  @AgentExcluded()
  @MobilePosSessionAllowed('CASHIER', 'STOCKIST')
  me(@CurrentUser() user: AuthUser) {
    return this.service.me(user);
  }
  @Post('logout')
  @MobilePosSessionAllowed('CASHIER', 'STOCKIST')
  @AgentExcluded()
  logout(@CurrentUser() user: AuthUser) {
    return this.service.logout(user);
  }
}

@Controller('mobile-pos-onboarding')
@RequirePermissions('mobile_pos_onboarding.manage')
export class MobilePosOnboardingController {
  constructor(private readonly service: MobilePosAuthService) {}
  // These reads are part of a human device-enrollment ceremony. Its branch
  // custody and enrollment scope have no reviewed agent execution contract.
  @Get('branch-options')
  @AgentExcluded('mobile_pos_onboarding_not_represented')
  branchOptions(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId: string,
    @Query('divisionId') divisionId: string,
    @Query('branchId') branchId: string,
  ) {
    return this.service.branchOptions(user, companyId, divisionId, branchId);
  }
  @Get('branch-setups')
  @AgentExcluded('mobile_pos_onboarding_not_represented')
  setups(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.service.listBranchSetups(user, companyId);
  }
  @Post('branch-setups')
  @AgentExcluded()
  setup(@Body() dto: MobilePosBranchSetupDto, @CurrentUser() user: AuthUser) {
    return this.service.saveBranchSetup(dto, user);
  }
  @Post('invites')
  @AgentExcluded()
  invite(@Body() dto: MobilePosInviteDto, @CurrentUser() user: AuthUser) {
    return this.service.createInvite(dto.branchSetupId, user);
  }
  @Get('enrollments')
  @AgentExcluded('mobile_pos_onboarding_not_represented')
  enrollments(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.listEnrollments(user, companyId, branchId);
  }
  @Post('enrollments/:id/approve')
  @AgentExcluded()
  approve(
    @Param('id') id: string,
    @Body() dto: MobilePosApproveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.approve(id, dto, user);
  }
  @Post('enrollments/:id/admin-link')
  @AgentExcluded()
  adminLink(
    @Param('id') id: string,
    @Body() dto: MobilePosAdminLinkDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.adminLink(id, dto.claimToken, user);
  }
  @Post('enrollments/:id/reject')
  @AgentExcluded()
  reject(@Param('id') id: string, @Body() dto: MobilePosReasonDto, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, dto.reason, user);
  }
  @Post('enrollments/:id/reset-pin')
  @AgentExcluded()
  reset(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.issueReset(id, user);
  }
  @Post('enrollments/:id/revoke')
  @AgentExcluded()
  revoke(@Param('id') id: string, @Body() dto: MobilePosReasonDto, @CurrentUser() user: AuthUser) {
    return this.service.revoke(id, dto.reason, user);
  }
}
