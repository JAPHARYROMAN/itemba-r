import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtPayload } from '../auth.service';
import {
  PermissionCacheService,
  CachedAuthPayload,
} from '../../../common/services';

const SCOPE_PRIORITY = ['GROUP', 'COMPANY', 'BRANCH', 'DIVISION'] as const;

function pickHighestScope(scopes: string[]): { scope: string } | null {
  for (const s of SCOPE_PRIORITY) {
    if (scopes.includes(s)) return { scope: s };
  }
  return scopes.length > 0 ? { scope: scopes[0] } : null;
}

const PERMISSION_CACHE_TTL_MS = 60_000; // 60s — short enough that revocations propagate fast

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly permissionCache: PermissionCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<CachedAuthPayload & { sid?: string }> {
    // Reject 2FA challenge tokens — they only authorize the /2fa/challenge endpoint.
    if (payload.scope === 'twoFactor') {
      throw new UnauthorizedException('Challenge token cannot be used for API access');
    }

    // P1-01: When the token carries a session id, verify the bound
    // ActiveSession is still ACTIVE. Tokens minted before this field was
    // introduced may lack `sid`; for backwards compatibility we permit them
    // until the rotation window expires.
    if (payload.sid) {
      const session = await this.prisma.activeSession.findUnique({
        where: { id: payload.sid },
        select: { status: true, expiresAt: true },
      });
      if (!session || session.status !== 'ACTIVE') {
        throw new UnauthorizedException('Session is no longer active');
      }
      if (session.expiresAt && session.expiresAt < new Date()) {
        throw new UnauthorizedException('Session has expired');
      }
    }

    const cached = this.permissionCache.get(payload.sub);
    if (cached) return { ...cached, sid: payload.sid };

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
        companyAccess: {
          select: { companyId: true, accessLevel: true },
        },
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      // Do not return null silently — explicit failure is clearer for callers
      // and keeps cache state predictable when an account is disabled.
      throw new UnauthorizedException('Account is not active');
    }

    const roles = user.userRoles.map((ur) => ur.role.name);
    const roleScopes = Array.from(new Set(user.userRoles.map((ur) => ur.role.scope)));
    const permissions = Array.from(
      new Set(
        user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code)),
      ),
    );
    const result: CachedAuthPayload = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles,
      roleScopes,
      role: pickHighestScope(roleScopes),
      permissions,
      companyId: user.companyId,
      companyAccess: user.companyAccess,
    };

    this.permissionCache.set(payload.sub, result, PERMISSION_CACHE_TTL_MS);

    return { ...result, sid: payload.sid };
  }

  /**
   * Drop a cached entry across the cluster so the next request re-resolves
   * roles/permissions/company-access from the database. Call this whenever a
   * user's roles, permissions, or company access are mutated.
   */
  async invalidate(userId: string): Promise<void> {
    await this.permissionCache.invalidate(userId);
  }
}
