import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { SecurityEventSeverity, SecurityEventType } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHmac, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

export interface JwtPayload {
  sub: string;
  email: string;
  /** Unique token ID — ensures each refresh JWT is unique even within the same second */
  jti?: string;
  /** Set to 'twoFactor' for temporary 2FA challenge tokens */
  scope?: string;
  /**
   * Active session id (P1-01). When present, JwtStrategy verifies that the
   * referenced ActiveSession row is still ACTIVE before resolving the user.
   * Tokens issued before this field was introduced will be missing it; the
   * strategy treats absent `sid` as legacy and only soft-warns.
   */
  sid?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  roleScopes?: string[];
  permissions: string[];
  companyId: string | null;
  companyAccess?: Array<{ companyId: string; accessLevel: string }>;
}

const jwtExpiresIn = (value: string): JwtSignOptions['expiresIn'] =>
  value as JwtSignOptions['expiresIn'];

/**
 * Pre-computed argon2 hash for a random password. Used to keep login response
 * timing roughly constant regardless of whether the supplied email belongs to
 * a real user — running argon2.verify against this dummy hash takes the same
 * order of magnitude as verifying a real one. Without this, "user not found"
 * returned in microseconds while "wrong password" took ~50 ms — a measurable
 * enumeration oracle.
 *
 * The dummy hash is generated at module load with a random plaintext, so even
 * an attacker who somehow learned this hash cannot pre-compute against it.
 */
const DUMMY_ARGON2_HASH_PROMISE: Promise<string> = (async () => {
  const random = randomUUID() + randomUUID();
  return argon2.hash(random);
})();

const EMAIL_LOGIN_WINDOW_MS = 15 * 60_000;
const EMAIL_LOGIN_LOCK_MS = 15 * 60_000;
const EMAIL_LOGIN_MAX_FAILURES = 5;
// ITMB-051: 2FA challenge failures count toward the same per-account lockout as
// password failures so MFA cannot be worn down by distributed OTP brute force.
const TWO_FACTOR_MAX_FAILURES = 5;
const TWO_FACTOR_LOCK_MS = 15 * 60_000;
// Grace window during which a just-rotated refresh token may be presented again
// without being treated as theft. The web client legitimately drives several
// uncoordinated refresh paths (proactive on tab focus/visibility/timer, the
// reactive 401 retry, and the /api/backend proxy's own refresh) plus possible
// multi-instance replicas, so the same token can be presented to /auth/refresh
// more than once around an access-token expiry. A tight 60s window turned those
// benign concurrent refreshes into REUSE_DETECTED events that revoked the whole
// family and logged the user out ("Unauthorized"). 10 minutes tolerates the
// races while keeping a stolen token's replay window short.
const REFRESH_TOKEN_ROTATION_GRACE_MS = 10 * 60_000;
const DEFAULT_REFRESH_EXPIRES_IN = 'never';
const PERSISTENT_SESSION_EXPIRES_AT = new Date('9999-12-31T23:59:59.999Z');
// Password rotation window. After a successful change/reset the next expiry is
// pushed this far into the future so the freshly-set password is not instantly
// re-flagged as PASSWORD_EXPIRED. Configurable via PASSWORD_ROTATION_DAYS; 0 (or
// a non-positive value) disables expiry (passwordExpiresAt = null).
const DEFAULT_PASSWORD_ROTATION_DAYS = 90;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly emailLoginFailures = new Map<
    string,
    { count: number; resetAt: number; lockedUntil?: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogsService,
  ) {}

  async register(dto: RegisterDto, meta?: { ipAddress?: string; userAgent?: string }) {
    if (!this.publicRegistrationEnabled()) {
      await this.audit.log({
        action: 'PUBLIC_REGISTRATION_BLOCKED',
        entityType: 'User',
        metadata: { email: dto.email },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      throw new ForbiddenException(
        'Public registration is disabled. Ask an administrator to create your account.',
      );
    }

    // Canonicalize email so it matches what login() looks up (lowercased). The
    // RegisterDto @Transform already normalizes; this guards non-DTO callers.
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, fullName: dto.fullName },
    });

    await this.audit.log({
      action: 'USER_REGISTERED',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.issueTokens(user.id, user.email, meta);
  }

  async login(dto: LoginDto, meta?: { ipAddress?: string; userAgent?: string }) {
    const submittedEmail = dto.email.trim();
    const normalizedEmail = submittedEmail.toLowerCase();
    if (this.isEmailLoginLocked(normalizedEmail)) {
      await this.constantTimeVerify(undefined, dto.password);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Look up by the normalized (lowercased) email so mixed-case registrants can
    // log in with any casing and lookup matches the canonical form we store and
    // that the in-memory lockout key uses. The DTO @Transform normalizes too;
    // this is defense-in-depth for any non-DTO caller.
    let user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });

    // Tolerant fallback for legacy mixed-case rows: accounts created before email
    // was canonicalized to lowercase are stored with their original casing, so the
    // strict findUnique above misses them. A case-insensitive findFirst still
    // resolves the single matching row (email is unique per casing, and the DB is
    // not expected to hold two rows that differ only by case) so those users keep
    // authenticating. Skipped when the strict lookup already matched.
    if (!user) {
      user = await this.prisma.user.findFirst({
        where: { email: { equals: submittedEmail, mode: 'insensitive' } },
      });
    }

    // Admin/security lock: honor BOTH the login-tracking column (User.lockedUntil)
    // and the security-admin column (UserSecurityProfile.lockedUntil). The write
    // side (user-security-profiles) sets the profile column; without this check an
    // admin lock would be silently ignored. Fetched once here and reused below.
    const secProfile = user
      ? await this.prisma.userSecurityProfile.findUnique({ where: { userId: user.id } })
      : null;

    // Account lockout check (only meaningful when the user exists).
    if (user && this.isAccountLocked(user, secProfile)) {
      // Even on lockout, run the dummy verify so an attacker probing locked vs
      // active vs nonexistent accounts cannot use timing to distinguish them.
      await this.constantTimeVerify(undefined, dto.password);
      await this.logSecurityEvent('ACCOUNT_LOCKED', user.id, 'HIGH', meta);
      await this.audit.log({
        action: 'LOGIN_BLOCKED_ACCOUNT_LOCKED',
        entityType: 'User',
        entityId: user.id,
        userId: user.id,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // P1-10: ALWAYS run argon2.verify so response timing does not leak whether
    // the email is registered. When the user is missing or inactive, verify
    // against a dummy hash so the work performed and clock time are similar to
    // the real-user path.
    const ok = await this.constantTimeVerify(user?.passwordHash, dto.password);

    if (!user || user.status !== 'ACTIVE') {
      this.recordEmailLoginFailure(normalizedEmail);
      if (user) {
        await this.logSecurityEvent('LOGIN_FAILED', user.id, 'MEDIUM', meta);
        await this.audit.log({
          action: 'LOGIN_FAILED_INACTIVE',
          entityType: 'User',
          entityId: user.id,
          userId: user.id,
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!ok) {
      this.recordEmailLoginFailure(normalizedEmail);
      const attempts = user.failedLoginAttempts + 1;
      const locked = attempts >= 5;
      const lockData = locked ? { lockedUntil: new Date(Date.now() + 15 * 60_000) } : {};

      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: attempts, ...lockData },
      });

      if (locked) await this.logSecurityEvent('ACCOUNT_LOCKED', user.id, 'HIGH', meta);
      await this.logSecurityEvent('LOGIN_FAILED', user.id, 'MEDIUM', meta);
      await this.audit.log({
        action: 'LOGIN_FAILED_WRONG_PASSWORD',
        entityType: 'User',
        entityId: user.id,
        userId: user.id,
        metadata: { attempts },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failure counter on successful password verification
    this.clearEmailLoginFailure(normalizedEmail);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    // Check if 2FA is required — this MUST be evaluated BEFORE the
    // password-rotation gate. A 2FA-enrolled account has to clear the second
    // factor first; otherwise an attacker who knows only the password could,
    // for an account that also happens to be flagged for rotation (e.g. an
    // elapsed passwordExpiresAt or an admin-set forcePasswordChange), be handed
    // a `passwordChange`-scoped token, call POST /auth/change-password, and be
    // auto-logged-in with FULL tokens — a complete 2FA bypass. completeLogin2FA
    // re-checks the rotation gate AFTER verifying the code, so 2FA users still
    // hit the password-change flow, just on the correct (post-2FA) side.
    if (secProfile?.twoFactorEnabled) {
      const tempToken = await this.jwt.signAsync(
        { sub: user.id, email: user.email, scope: 'twoFactor' } as JwtPayload,
        { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '5m' },
      );
      await this.logSecurityEvent('TWO_FACTOR_CHALLENGE', user.id, 'LOW', meta);
      return { requires2FA: true, tempToken };
    }

    // Enforce password-rotation controls BEFORE issuing any session: if the
    // admin flagged the account for a forced change, or the password has
    // expired, the credentials are correct but we must NOT hand out a normal
    // session. Surface a must-change signal instead so the client drives the
    // reset flow. Uses User.mustChangePassword +
    // UserSecurityProfile.forcePasswordChange / passwordExpiresAt. Only reached
    // for non-2FA accounts (2FA users are routed above and re-checked after the
    // code in completeLogin2FA).
    const passwordChangeReason = this.passwordChangeRequiredReason(user, secProfile);
    if (passwordChangeReason) {
      await this.audit.log({
        action: 'LOGIN_REQUIRES_PASSWORD_CHANGE',
        entityType: 'User',
        entityId: user.id,
        userId: user.id,
        metadata: { reason: passwordChangeReason },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      // Scoped short-lived token that only authorizes the password-change flow —
      // it is NOT an access/refresh token, so no protected resource is reachable.
      const tempToken = await this.jwt.signAsync(
        { sub: user.id, email: user.email, scope: 'passwordChange' } as JwtPayload,
        { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
      );
      return { requiresPasswordChange: true, reason: passwordChangeReason, tempToken };
    }

    await this.logSecurityEvent('LOGIN_SUCCESS', user.id, 'LOW', meta);
    await this.audit.log({
      action: 'USER_LOGIN',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.issueTokens(user.id, user.email, meta);
  }

  /** Complete login after 2FA challenge. tempToken must have scope=twoFactor. */
  async completeLogin2FA(
    tempToken: string,
    code: string,
    twoFactorService: any,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(tempToken, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired challenge token');
    }

    if (payload.scope !== 'twoFactor') {
      throw new UnauthorizedException('Invalid challenge token scope');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Invalid credentials');

    const secProfile = await this.prisma.userSecurityProfile.findUnique({
      where: { userId: user.id },
    });

    // ITMB-051: re-check account lockout before verifying the 2FA code so a
    // locked account cannot be brute-forced through the 2FA challenge endpoint.
    // Honor both the login-tracking (User) and admin (UserSecurityProfile) locks.
    if (this.isAccountLocked(user, secProfile)) {
      await this.logSecurityEvent('ACCOUNT_LOCKED', user.id, 'HIGH', meta);
      await this.audit.log({
        action: 'TWO_FACTOR_BLOCKED_ACCOUNT_LOCKED',
        entityType: 'User',
        entityId: user.id,
        userId: user.id,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // ITMB-051: count 2FA challenge failures toward the per-account lockout.
    // verifyChallenge throws on an invalid code; treat that as a failed
    // authentication attempt and lock the account after too many bad codes.
    try {
      await twoFactorService.verifyChallenge(user.id, code, meta);
    } catch (err) {
      const attempts = user.failedLoginAttempts + 1;
      const locked = attempts >= TWO_FACTOR_MAX_FAILURES;
      const lockData = locked
        ? { lockedUntil: new Date(Date.now() + TWO_FACTOR_LOCK_MS) }
        : {};
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: attempts, ...lockData },
      });
      if (locked) await this.logSecurityEvent('ACCOUNT_LOCKED', user.id, 'HIGH', meta);
      await this.audit.log({
        action: 'TWO_FACTOR_CHALLENGE_FAILED',
        entityType: 'User',
        entityId: user.id,
        userId: user.id,
        metadata: { attempts },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      throw err;
    }

    // Successful 2FA — clear the failure counter and any expired lock state.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    // Enforce password-rotation controls after 2FA succeeds but before issuing a
    // session, mirroring the primary login path — a forced/expired password must
    // still block a full session even for 2FA users.
    const passwordChangeReason = this.passwordChangeRequiredReason(user, secProfile);
    if (passwordChangeReason) {
      await this.audit.log({
        action: 'LOGIN_REQUIRES_PASSWORD_CHANGE',
        entityType: 'User',
        entityId: user.id,
        userId: user.id,
        metadata: { reason: passwordChangeReason, method: '2FA' },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      const pwChangeToken = await this.jwt.signAsync(
        { sub: user.id, email: user.email, scope: 'passwordChange' } as JwtPayload,
        { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
      );
      return { requiresPasswordChange: true, reason: passwordChangeReason, tempToken: pwChangeToken };
    }

    await this.logSecurityEvent('LOGIN_SUCCESS', user.id, 'LOW', meta);
    await this.audit.log({
      action: 'USER_LOGIN',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      metadata: { method: '2FA' },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.issueTokens(user.id, user.email, meta);
  }

  /**
   * Recovery path for the password-rotation gate. login()/completeLogin2FA()
   * hand out a short-lived `passwordChange`-scoped tempToken when the account is
   * flagged (User.mustChangePassword / UserSecurityProfile.forcePasswordChange /
   * elapsed passwordExpiresAt); without a consumer for that token the account —
   * including the seeded admin@itemba.local — could verify its password yet
   * never obtain a session. This verifies the tempToken, sets the new password,
   * CLEARS the rotation flags, resets lockout counters, and auto-logs-in.
   */
  async changePassword(
    tempToken: string,
    newPassword: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(tempToken, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired password-change token');
    }

    if (payload.scope !== 'passwordChange') {
      throw new UnauthorizedException('Invalid password-change token scope');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Password policy: minimum length + no reuse of recent passwords (mirrors the
    // email-reset flow so both recovery paths enforce the same rules).
    if (newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long.');
    }

    const currentHashes = [
      user.passwordHash,
      ...(
        await this.prisma.passwordHistory.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })
      ).map((h) => h.passwordHash),
    ];
    for (const h of currentHashes) {
      try {
        if (await argon2.verify(h, newPassword)) {
          throw new BadRequestException('You cannot reuse a recent password.');
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        // Malformed/legacy hash — treat as non-match and continue.
      }
    }

    const newHash = await argon2.hash(newPassword);
    const now = new Date();
    const passwordExpiresAt = this.nextPasswordExpiry(now);

    // Apply everything atomically: set the new hash, CLEAR the rotation flags on
    // BOTH the User and UserSecurityProfile rows, refresh passwordExpiresAt, reset
    // lockout state, and record history. Upsert the profile so a user without one
    // still ends up with forcePasswordChange=false + a fresh expiry.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          passwordChangedAt: now,
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.userSecurityProfile.upsert({
        where: { userId: user.id },
        update: {
          forcePasswordChange: false,
          passwordChangedAt: now,
          passwordExpiresAt,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
        create: {
          userId: user.id,
          forcePasswordChange: false,
          passwordChangedAt: now,
          passwordExpiresAt,
        },
      }),
      this.prisma.passwordHistory.create({
        data: { userId: user.id, passwordHash: newHash },
      }),
    ]);

    // The changed password invalidates other authenticated surfaces, mirroring the
    // email-reset flow — drop existing refresh tokens and active sessions.
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'PASSWORD_CHANGE' },
    });
    await this.prisma.activeSession.updateMany({
      where: { userId: user.id, revokedAt: null, status: 'ACTIVE' },
      data: { revokedAt: now, status: 'REVOKED' },
    });

    await this.logSecurityEvent('PASSWORD_CHANGED', user.id, 'LOW', meta);
    await this.audit.log({
      action: 'PASSWORD_CHANGED_ON_LOGIN',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    // Auto-login: issue NORMAL access + refresh tokens so the user lands
    // authenticated instead of bouncing back to the login screen.
    return this.issueTokens(user.id, user.email, meta);
  }

  async logout(
    userId: string,
    rawToken?: string,
    meta?: { ipAddress?: string; userAgent?: string },
    sid?: string,
  ) {
    if (rawToken) {
      const matched = await this.findRefreshTokenByRawValue(userId, rawToken, {
        includeRevoked: false,
        requireUnexpired: false,
      });

      if (matched) {
        // Revoke this token AND its entire family — logging out from one device
        // should invalidate all rotated descendants of the same login.
        if (matched.familyId) {
          await this.prisma.refreshToken.updateMany({
            where: { familyId: matched.familyId, revokedAt: null },
            data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
          });
        } else {
          await this.prisma.refreshToken.update({
            where: { id: matched.id },
            data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
          });
        }
      }
    }

    // P1-01: revoke the bound ActiveSession so downstream access tokens stop
    // resolving to a live session. The cluster-wide permission cache is also
    // dropped so the revocation takes effect on every replica immediately.
    if (sid) {
      try {
        await this.prisma.activeSession.update({
          where: { id: sid },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokeReason: 'LOGOUT',
          },
        });
      } catch (err) {
        this.logger.warn(`Failed to revoke ActiveSession ${sid}: ${(err as Error).message}`);
      }
    }

    await this.logSecurityEvent('LOGOUT', userId, 'LOW', meta);
    await this.audit.log({
      action: 'USER_LOGOUT',
      entityType: 'User',
      entityId: userId,
      userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }

  async refresh(
    userId: string,
    rawToken: string,
    meta?: { ipAddress?: string; userAgent?: string },
    sid?: string,
  ) {
    const persistentRefresh = this.isNonExpiringDuration(this.getRefreshExpiresIn());
    // Reuse detection scans revoked tokens only for rotating refresh sessions.
    // Persistent sessions deliberately do not rotate, so a normal retry cannot
    // be misclassified as token replay and log the user out.
    const matched = await this.findRefreshTokenByRawValue(userId, rawToken, {
      includeRevoked: true,
      requireUnexpired: true,
    });

    if (!matched) throw new UnauthorizedException('Invalid or expired refresh token');

    if (persistentRefresh && matched.revokedAt && matched.revokedReason !== 'ROTATION') {
      throw new UnauthorizedException('Session is no longer active. Please log in again.');
    }

    if (!persistentRefresh && matched.revokedAt && !this.isRecentRefreshRotation(matched)) {
      // Reuse of a revoked token detected — kill the whole family.
      if (matched.familyId) {
        await this.prisma.refreshToken.updateMany({
          where: { familyId: matched.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
        });
      }
      await this.logSecurityEvent(SecurityEventType.SUSPICIOUS_ACTIVITY, userId, 'HIGH', meta);
      await this.audit.log({
        action: 'REFRESH_TOKEN_REUSE_DETECTED',
        entityType: 'User',
        entityId: userId,
        userId,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      throw new UnauthorizedException('Refresh token reuse detected. Please log in again.');
    }

    // Rotate within the same family.
    if (!persistentRefresh && !matched.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: matched.id },
        data: { revokedAt: new Date(), revokedReason: 'ROTATION' },
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');

    // P1-01: Block refresh when the bound session has been explicitly revoked
    // (e.g. admin clicked "Sign out everywhere" on this device). When sid is
    // missing (legacy tokens) we still issue, but stamp the new tokens with a
    // fresh session so subsequent revocations work.
    let preservedSid: string | undefined = sid;
    if (sid) {
      const session = await this.prisma.activeSession.findUnique({ where: { id: sid } });
      if (!session || session.status !== 'ACTIVE') {
        await this.audit.log({
          action: 'REFRESH_REJECTED_SESSION_REVOKED',
          entityType: 'ActiveSession',
          entityId: sid,
          userId,
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
        throw new UnauthorizedException('Session is no longer active. Please log in again.');
      }
      // Bump activity so idle session pruning has a real heartbeat.
      await this.prisma.activeSession.update({
        where: { id: sid },
        data: { lastActivityAt: new Date() },
      });
    } else {
      preservedSid = undefined;
    }

    if (persistentRefresh) {
      const accessToken = await this.jwt.signAsync({
        sub: userId,
        email: user.email,
        sid: preservedSid,
      });
      return { accessToken, refreshToken: rawToken, tokenType: 'Bearer' };
    }

    return this.issueTokens(userId, user.email, meta, matched.familyId ?? undefined, preservedSid);
  }

  /**
   * Verify current password and record the timestamp for recent-auth gate.
   * Used before sensitive operations (disable 2FA, API key generation, etc).
   */
  async verifyPassword(
    userId: string,
    password: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ verified: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      await this.logSecurityEvent('LOGIN_FAILED', userId, 'MEDIUM', meta);
      throw new UnauthorizedException('Incorrect password');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { lastPasswordVerifiedAt: new Date() },
    });

    return { verified: true };
  }

  async getMe(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
      },
    });

    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = Array.from(
      new Set(
        user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code)),
      ),
    );

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles,
      permissions,
      companyId: user.companyId,
    };
  }

  async validateRefreshToken(userId: string, rawToken: string): Promise<boolean> {
    const matched = await this.findRefreshTokenByRawValue(userId, rawToken, {
      includeRevoked: false,
      requireUnexpired: true,
    });
    return Boolean(matched);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  async issueTokens(
    userId: string,
    email: string,
    meta?: { ipAddress?: string; userAgent?: string },
    familyId?: string,
    /** When provided, reuse the existing session id (refresh path). */
    existingSid?: string,
  ) {
    // P1-01: Either reuse the caller's session (token rotation path) or create
    // a fresh ActiveSession (new login path). Tokens carry the session id so
    // JwtStrategy can verify the session is still ACTIVE on every request.
    let sid = existingSid;
    if (!sid) {
      const refreshExpiresIn = this.getRefreshExpiresIn();
      const session = await this.prisma.activeSession.create({
        data: {
          sessionCode: `SS-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
          userId,
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
          startedAt: new Date(),
          lastActivityAt: new Date(),
          expiresAt: this.refreshExpiresAt(refreshExpiresIn),
          status: 'ACTIVE',
        },
      });
      sid = session.id;
    }

    const payload: JwtPayload = { sub: userId, email, sid };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshExpiresIn = this.getRefreshExpiresIn();
    const refreshSignOptions: JwtSignOptions = {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
    };
    if (!this.isNonExpiringDuration(refreshExpiresIn)) {
      refreshSignOptions.expiresIn = jwtExpiresIn(refreshExpiresIn);
    }
    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti: randomUUID() },
      refreshSignOptions,
    );

    const tokenHash = this.hashRefreshToken(refreshToken);
    const expiresAt = this.refreshExpiresAt(refreshExpiresIn);
    // New login → new family. Refresh rotation → existing family is preserved.
    const tokenFamilyId = familyId ?? randomUUID();

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        familyId: tokenFamilyId,
        expiresAt,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      },
    });

    // Prune old expired tokens. Keep recently-revoked tokens long enough that
    // reuse detection still works on them.
    const replayWindow = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.deleteMany({
      where: {
        userId,
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: replayWindow } }],
      },
    });

    return { accessToken, refreshToken, tokenType: 'Bearer' };
  }

  private parseDuration(duration: string): number {
    const match = /^(\d+)([smhdw])$/.exec(duration);
    if (!match) {
      this.logger.warn(`Unsupported duration "${duration}", falling back to 3650d`);
      return 3650 * 24 * 60 * 60 * 1000;
    }
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const ms: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 7 * 86_400_000,
    };
    return n * (ms[unit] ?? 86_400_000);
  }

  private getRefreshExpiresIn(): string {
    return this.config.get<string>('JWT_REFRESH_EXPIRES_IN', DEFAULT_REFRESH_EXPIRES_IN).trim();
  }

  private isNonExpiringDuration(duration: string): boolean {
    return ['never', 'none', 'no-expiry', 'no_expiry', '0'].includes(duration.toLowerCase());
  }

  private refreshExpiresAt(refreshExpiresIn: string): Date {
    return this.isNonExpiringDuration(refreshExpiresIn)
      ? PERSISTENT_SESSION_EXPIRES_AT
      : new Date(Date.now() + this.parseDuration(refreshExpiresIn));
  }

  /**
   * True when the account is locked, honoring BOTH lock columns: the
   * login-tracking lock (User.lockedUntil, set by failed-attempt throttling and
   * cleared on success) and the security-admin lock
   * (UserSecurityProfile.lockedUntil, set via the admin PATCH route). Either one
   * being in the future locks the account.
   */
  private isAccountLocked(
    user: { lockedUntil?: Date | null } | null | undefined,
    secProfile: { lockedUntil?: Date | null } | null | undefined,
  ): boolean {
    const now = Date.now();
    const userLocked = !!user?.lockedUntil && user.lockedUntil.getTime() > now;
    const profileLocked = !!secProfile?.lockedUntil && secProfile.lockedUntil.getTime() > now;
    return userLocked || profileLocked;
  }

  /**
   * Returns a reason string when the user must change their password before a
   * normal session may be issued, else null. Honors User.mustChangePassword,
   * UserSecurityProfile.forcePasswordChange, and an elapsed
   * UserSecurityProfile.passwordExpiresAt. Returning a reason (rather than a
   * boolean) lets the caller surface why to the client and the audit log.
   */
  private passwordChangeRequiredReason(
    user: { mustChangePassword?: boolean | null } | null | undefined,
    secProfile:
      | { forcePasswordChange?: boolean | null; passwordExpiresAt?: Date | null }
      | null
      | undefined,
  ): 'MUST_CHANGE_PASSWORD' | 'FORCE_PASSWORD_CHANGE' | 'PASSWORD_EXPIRED' | null {
    if (user?.mustChangePassword) return 'MUST_CHANGE_PASSWORD';
    if (secProfile?.forcePasswordChange) return 'FORCE_PASSWORD_CHANGE';
    if (secProfile?.passwordExpiresAt && secProfile.passwordExpiresAt.getTime() <= Date.now()) {
      return 'PASSWORD_EXPIRED';
    }
    return null;
  }

  /**
   * Next password expiry after a change/reset: `from` + PASSWORD_ROTATION_DAYS.
   * Returns null when rotation is disabled (non-positive days) so the account's
   * password never auto-expires. Keeping the freshly-set password from being
   * instantly re-flagged as PASSWORD_EXPIRED is essential to the recovery path.
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

  private isEmailLoginLocked(email: string): boolean {
    const entry = this.emailLoginFailures.get(email);
    const now = Date.now();
    if (!entry) return false;
    if (entry.lockedUntil && entry.lockedUntil > now) return true;
    if (entry.resetAt <= now) this.emailLoginFailures.delete(email);
    return false;
  }

  private recordEmailLoginFailure(email: string) {
    const now = Date.now();
    const existing = this.emailLoginFailures.get(email);
    const entry =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + EMAIL_LOGIN_WINDOW_MS };

    entry.count += 1;
    if (entry.count >= EMAIL_LOGIN_MAX_FAILURES) {
      entry.lockedUntil = now + EMAIL_LOGIN_LOCK_MS;
    }
    this.emailLoginFailures.set(email, entry);
  }

  private clearEmailLoginFailure(email: string) {
    this.emailLoginFailures.delete(email);
  }

  private publicRegistrationEnabled(): boolean {
    const raw = this.config.get<string>('ALLOW_PUBLIC_REGISTRATION', 'false');
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
  }

  private hashRefreshToken(rawToken: string): string {
    const pepper =
      this.config.get<string>('REFRESH_TOKEN_PEPPER') ??
      this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    return createHmac('sha256', pepper).update(rawToken).digest('hex');
  }

  private isLegacyRefreshTokenHash(tokenHash: string): boolean {
    return tokenHash.startsWith('$argon2');
  }

  private isRecentRefreshRotation(token: {
    revokedAt: Date | null;
    revokedReason: string | null;
  }): boolean {
    return (
      token.revokedReason === 'ROTATION' &&
      token.revokedAt !== null &&
      Date.now() - token.revokedAt.getTime() <= REFRESH_TOKEN_ROTATION_GRACE_MS
    );
  }

  private async findRefreshTokenByRawValue(
    userId: string,
    rawToken: string,
    options: { includeRevoked: boolean; requireUnexpired: boolean },
  ) {
    const where = {
      userId,
      ...(options.includeRevoked ? {} : { revokedAt: null }),
      ...(options.requireUnexpired ? { expiresAt: { gt: new Date() } } : {}),
    };

    const lookupHash = this.hashRefreshToken(rawToken);
    const directMatch = await this.prisma.refreshToken.findFirst({
      where: { ...where, tokenHash: lookupHash },
    });
    if (directMatch) return directMatch;

    const legacyTokens = await this.prisma.refreshToken.findMany({ where });
    for (const token of legacyTokens) {
      if (!this.isLegacyRefreshTokenHash(token.tokenHash)) continue;
      try {
        if (await argon2.verify(token.tokenHash, rawToken)) return token;
      } catch {
        // Ignore malformed legacy hashes; a failed match is equivalent here.
      }
    }

    return null;
  }

  /**
   * Argon2 verify that runs in roughly the same time whether the supplied hash
   * is real or absent. Returns false in both "no user" and "wrong password"
   * cases, so the caller does not branch on it for "user exists" decisions.
   */
  private async constantTimeVerify(
    realHash: string | undefined,
    password: string,
  ): Promise<boolean> {
    if (realHash) {
      try {
        return await argon2.verify(realHash, password);
      } catch {
        return false;
      }
    }
    // Run argon2 against the dummy hash to consume similar CPU/wall time.
    try {
      const dummy = await DUMMY_ARGON2_HASH_PROMISE;
      await argon2.verify(dummy, password);
    } catch {
      // ignore — the goal is to spend the time, not to learn anything
    }
    return false;
  }

  private async logSecurityEvent(
    eventType: SecurityEventType,
    userId: string,
    severity: SecurityEventSeverity,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    try {
      await this.prisma.securityEvent.create({
        data: {
          eventNumber: `SE-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
          eventType,
          severity,
          status: 'OPEN',
          userId,
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      });
    } catch (err) {
      // Failure to persist a security event must NOT silently disappear — surface
      // it via the application logger so ops can see the alert in the log stream.
      this.logger.error(
        `Failed to persist SecurityEvent (eventType=${eventType}, userId=${userId})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
