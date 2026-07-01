import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const RESET_TOKEN_TTL_MINUTES = 30;
// Password rotation window used to refresh passwordExpiresAt after a reset so the
// freshly-set password is not instantly re-flagged as expired. Configurable via
// PASSWORD_ROTATION_DAYS; a non-positive value disables expiry (null).
const DEFAULT_PASSWORD_ROTATION_DAYS = 90;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Request a password reset. Always returns the same generic response
   * regardless of whether the email exists — prevents user enumeration.
   */
  async requestReset(
    email: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user && user.status === 'ACTIVE') {
      // Generate a cryptographically random token
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = this.hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);

      // Invalidate existing reset tokens for this user
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      // Log the event
      await this.logSecurityEvent('PASSWORD_RESET_REQUESTED', user.id, meta);
      await this.audit.log({
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'User',
        entityId: user.id,
        userId: user.id,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      // Attempt to send email (non-blocking — dev works without SMTP)
      await this.sendResetEmail(user.email, user.fullName, rawToken);
    }

    // Always return the same message (no user enumeration)
    return {
      message: 'If an account with that email exists, a password reset link has been sent.',
    };
  }

  /**
   * Complete a password reset with a valid token.
   */
  async resetPassword(
    rawToken: string,
    newPassword: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ message: string }> {
    const matched = await this.findResetTokenByRawValue(rawToken);

    if (!matched) {
      throw new BadRequestException('Invalid or expired password reset token.');
    }

    const user = matched.user;
    if (!user || user.status !== 'ACTIVE') {
      throw new BadRequestException('Invalid or expired password reset token.');
    }

    // Validate password policy (minimum 8 characters)
    if (newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long.');
    }

    // Check password history (last 5 passwords)
    const history = await this.prisma.passwordHistory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    for (const h of history) {
      if (await argon2.verify(h.passwordHash, newPassword)) {
        throw new BadRequestException('You cannot reuse a recent password.');
      }
    }

    const newHash = await argon2.hash(newPassword);
    const changedAt = new Date();
    const passwordExpiresAt = this.nextPasswordExpiry(changedAt);

    // Apply the reset atomically so this is a complete recovery path: mark the
    // token used, set the new hash and CLEAR the rotation flags on BOTH the User
    // (mustChangePassword) and UserSecurityProfile (forcePasswordChange) rows,
    // refresh passwordExpiresAt so the new password is not instantly re-flagged as
    // expired, reset lockout counters, and record history. Upsert the profile so a
    // user without one still ends up with forcePasswordChange=false + fresh expiry.
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: matched.id },
        data: { usedAt: changedAt },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          passwordChangedAt: changedAt,
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.userSecurityProfile.upsert({
        where: { userId: user.id },
        update: {
          forcePasswordChange: false,
          passwordChangedAt: changedAt,
          passwordExpiresAt,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
        create: {
          userId: user.id,
          forcePasswordChange: false,
          passwordChangedAt: changedAt,
          passwordExpiresAt,
        },
      }),
      this.prisma.passwordHistory.create({
        data: { userId: user.id, passwordHash: newHash },
      }),
    ]);

    // Invalidate all existing refresh tokens AND active sessions: a password
    // reset must drop every authenticated surface the user had.
    const now = new Date();
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'PASSWORD_RESET' },
    });
    await this.prisma.activeSession.updateMany({
      where: { userId: user.id, revokedAt: null, status: 'ACTIVE' },
      data: { revokedAt: now, status: 'REVOKED' },
    });

    await this.logSecurityEvent('PASSWORD_RESET_COMPLETED', user.id, meta);
    await this.audit.log({
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Password reset successfully. Please log in with your new password.' };
  }

  private async findResetTokenByRawValue(rawToken: string) {
    const where = { usedAt: null, expiresAt: { gt: new Date() } };
    const directMatch = await this.prisma.passwordResetToken.findFirst({
      where: { ...where, tokenHash: this.hashResetToken(rawToken) },
      include: { user: true },
    });
    if (directMatch) return directMatch;

    // Existing reset tokens were stored as Argon2 hashes. Keep a temporary
    // fallback so users who requested a reset before this deploy can complete it.
    const candidates = await this.prisma.passwordResetToken.findMany({
      where: { ...where, tokenHash: { startsWith: '$argon2' } },
      include: { user: true },
    });
    for (const t of candidates) {
      try {
        if (await argon2.verify(t.tokenHash, rawToken)) return t;
      } catch {
        // Ignore malformed legacy hashes; a failed match is equivalent here.
      }
    }

    return null;
  }

  /**
   * Next password expiry after a reset: `from` + PASSWORD_ROTATION_DAYS. Returns
   * null when rotation is disabled (non-positive days) so the password never
   * auto-expires. Kept in sync with AuthService.nextPasswordExpiry.
   */
  private nextPasswordExpiry(from: Date = new Date()): Date | null {
    const raw = this.config.get<string>('PASSWORD_ROTATION_DAYS');
    const days =
      raw === undefined || raw === null || `${raw}`.trim() === ''
        ? DEFAULT_PASSWORD_ROTATION_DAYS
        : Number(`${raw}`.trim());
    if (!Number.isFinite(days) || days <= 0) return null;
    return new Date(from.getTime() + days * 86_400_000);
  }

  private hashResetToken(rawToken: string): string {
    const pepper = this.config.getOrThrow<string>('APP_ENCRYPTION_KEY');
    return crypto.createHmac('sha256', pepper).update(rawToken).digest('hex');
  }

  // ─── Email ────────────────────────────────────────────────────────────────

  private async sendResetEmail(email: string, name: string, rawToken: string): Promise<void> {
    const smtpHost = this.config.get<string>('SMTP_HOST');
    const smtpUser = this.config.get<string>('SMTP_USER');
    const smtpPass = this.config.get<string>('SMTP_PASS');
    const appUrl =
      this.config.get<string>('APP_URL') ??
      this.config.get<string>('FRONTEND_URL') ??
      'http://localhost:3009';

    if (!smtpHost || !smtpUser || !smtpPass) {
      // Dev mode: log a short token preview, never the reset URL or full token.
      this.logger.warn(
        `[DEV] Password reset requested for ${email}. ` +
          `Reset token preview: ${rawToken.substring(0, 8)}... ` +
          `Configure SMTP to deliver reset links from ${appUrl}.`,
      );
      return;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: this.config.get<number>('SMTP_PORT', 587),
        secure: this.config.get<boolean>('SMTP_SECURE', false),
        auth: { user: smtpUser, pass: smtpPass },
      });

      const resetUrl = `${appUrl}/auth/reset-password?token=${rawToken}`;

      await transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM', `"ITEMBA-R" <no-reply@itemba.local>`),
        to: email,
        subject: 'ITEMBA-R — Password Reset Request',
        html: `
          <p>Hello ${name},</p>
          <p>A password reset was requested for your ITEMBA-R account.</p>
          <p>
            <a href="${resetUrl}" style="padding:10px 20px;background:#2563eb;color:white;border-radius:6px;text-decoration:none;">
              Reset Password
            </a>
          </p>
          <p>This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes.</p>
          <p>If you did not request this, you can safely ignore this email.</p>
          <hr/>
          <p style="font-size:12px;color:#666">ITEMBA-R Enterprise Platform</p>
        `,
      });
    } catch (err) {
      // Log but don't throw — email failure should not break the reset flow
      this.logger.error('Failed to send password reset email', err);
    }
  }

  // ─── Security Event helper ────────────────────────────────────────────────

  private async logSecurityEvent(
    eventType: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    try {
      await this.prisma.securityEvent.create({
        data: {
          eventNumber: `SE-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
          eventType: eventType as any,
          severity: 'MEDIUM',
          status: 'OPEN',
          userId,
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      });
    } catch {
      // Non-blocking
    }
  }
}
