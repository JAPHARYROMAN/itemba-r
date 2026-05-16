import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * Global permissions guard.
 * If an endpoint declares @RequirePermissions(...), every listed permission
 * must exist in req.user.permissions. If it declares @RequireAnyPermissions(...),
 * at least one listed permission must exist.
 *
 * GROUP CONTROL RULE: permissions prefixed with group-controlled modules
 * (bank-accounts, loans, debts, contracts, fixed-assets, company-profiles)
 * are only ever assigned to GROUP-scoped roles in the seed, so the standard
 * permission check is sufficient — no extra guard is needed.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Skip for public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No permissions declared — allow (auth is enforced separately by JwtAuthGuard)
    if ((!required || required.length === 0) && (!requiredAny || requiredAny.length === 0)) {
      return true;
    }

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new UnauthorizedException('Authentication required');

    const missing = (required ?? []).filter((p) => !user.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Access denied. Missing permission(s): ${missing.join(', ')}`,
      );
    }

    if (requiredAny?.length && !requiredAny.some((p) => user.permissions.includes(p))) {
      throw new ForbiddenException(
        `Access denied. Requires one of: ${requiredAny.join(', ')}`,
      );
    }

    return true;
  }
}
