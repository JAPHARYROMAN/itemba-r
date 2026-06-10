import {
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
const REFRESH_TOKEN_ROTATION_GRACE_MS = 60_000;
const DEFAULT_REFRESH_EXPIRES_IN = 'never';
const PERSISTENT_SESSION_EXPIRES_AT = new Date('9999-12-31T23:59:59.999Z');

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

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, fullName: dto.fullName },
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

    const user = await this.prisma.user.findUnique({ where: { email: submittedEmail } });

    // Account lockout check (only meaningful when the user exists).
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
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

    // Check if 2FA is required
    const secProfile = await this.prisma.userSecurityProfile.findUnique({
      where: { userId: user.id },
    });
    if (secProfile?.twoFactorEnabled) {
      const tempToken = await this.jwt.signAsync(
        { sub: user.id, email: user.email, scope: 'twoFactor' } as JwtPayload,
        { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: '5m' },
      );
      await this.logSecurityEvent('TWO_FACTOR_CHALLENGE', user.id, 'LOW', meta);
      return { requires2FA: true, tempToken };
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

    // ITMB-051: re-check account lockout before verifying the 2FA code so a
    // locked account cannot be brute-forced through the 2FA challenge endpoint.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
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
