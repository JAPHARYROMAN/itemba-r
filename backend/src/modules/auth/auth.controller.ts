import {
  Body,
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { PasswordResetService } from './password-reset.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  TwoFactorVerifyDto,
  TwoFactorChallengeDto,
  DisableTwoFactorDto,
} from './dto/two-factor.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyPasswordDto } from './dto/verify-password.dto';
import { Public } from '../../common/decorators/public.decorator';
import { JwtRefresh } from '../../common/decorators/jwt-refresh.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RecentAuth } from '../../common/decorators/recent-auth.decorator';
import { RecentAuthGuard } from '../../common/guards/recent-auth.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('login')
  @ApiOperation({ summary: 'Authenticate and obtain JWT tokens' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @JwtRefresh()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate refresh token and obtain new access token' })
  refresh(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const rawToken = (req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
    return this.auth.refresh(
      user.id,
      rawToken,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
      user.sid,
    );
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @ApiOperation({ summary: 'Revoke current refresh token session' })
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const rawToken = req.body?.refreshToken as string | undefined;
    if (!rawToken && !user.sid) {
      throw new BadRequestException('Refresh token is required for logout');
    }
    await this.auth.logout(
      user.id,
      rawToken,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
      user.sid,
    );
    return { message: 'Logged out successfully' };
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.getMe(user.id);
  }

  // ─── Password Reset ───────────────────────────────────────────────────────

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('password-reset/request')
  @ApiOperation({ summary: 'Request a password reset email' })
  requestPasswordReset(@Body() dto: RequestPasswordResetDto, @Req() req: Request) {
    return this.passwordReset.requestReset(dto.email, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('password-reset/reset')
  @ApiOperation({ summary: 'Complete a password reset using a valid token' })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.passwordReset.resetPassword(dto.token, dto.newPassword, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // ─── Verify Password (Recent Auth gate) ──────────────────────────────────

  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('verify-password')
  @ApiOperation({ summary: 'Verify current password to satisfy recent-auth requirement' })
  verifyPassword(
    @Body() dto: VerifyPasswordDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.auth.verifyPassword(user.id, dto.password, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // ─── Two-Factor Authentication ────────────────────────────────────────────

  @ApiBearerAuth()
  @UseGuards(RecentAuthGuard)
  @RecentAuth(15)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('2fa/setup')
  @ApiOperation({ summary: 'Begin 2FA TOTP setup — returns secret and QR code URI' })
  twoFactorSetup(@CurrentUser() user: AuthUser) {
    return this.twoFactor.startSetup(user.id);
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Post('2fa/verify')
  @ApiOperation({ summary: 'Verify TOTP code and enable 2FA' })
  twoFactorVerify(
    @Body() dto: TwoFactorVerifyDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.twoFactor.verifyAndEnable(user.id, dto.code, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('2fa/challenge')
  @ApiOperation({ summary: 'Submit 2FA code after initial password authentication' })
  twoFactorChallenge(@Body() dto: TwoFactorChallengeDto, @Req() req: Request) {
    return this.auth.completeLogin2FA(dto.tempToken, dto.code, this.twoFactor, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @ApiBearerAuth()
  @UseGuards(RecentAuthGuard)
  @RecentAuth(15)
  @HttpCode(HttpStatus.OK)
  @Post('2fa/disable')
  @ApiOperation({ summary: 'Disable 2FA (requires recent password verification)' })
  twoFactorDisable(
    @Body() dto: DisableTwoFactorDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.twoFactor.disable(user.id, dto.code, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @ApiBearerAuth()
  @UseGuards(RecentAuthGuard)
  @RecentAuth(15)
  @Post('2fa/backup-codes/regenerate')
  @ApiOperation({ summary: 'Regenerate backup codes (requires recent password verification)' })
  regenerateBackupCodes(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.twoFactor.regenerateBackupCodes(user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  /**
   * P1-03: One-shot admin endpoint that re-encrypts every legacy
   * AES-CBC TOTP secret to the new versioned AES-GCM-with-AAD format.
   * Idempotent — already-v2 ciphertexts are skipped. Run once after the
   * upgrade lands; subsequent calls are safe but no-ops.
   */
  @ApiBearerAuth()
  @UseGuards(RecentAuthGuard)
  @RecentAuth(15)
  @RequirePermissions('users.assign_roles')
  @HttpCode(HttpStatus.OK)
  @Post('2fa/admin/reencrypt-legacy')
  @ApiOperation({
    summary:
      'Re-encrypt legacy TOTP secrets to AES-GCM (admin, requires recent password verification)',
  })
  reencryptLegacyTotp() {
    return this.twoFactor.reencryptLegacyTotpSecrets();
  }
}
