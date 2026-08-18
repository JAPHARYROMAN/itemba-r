import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string;
  roles: string[];
  roleScopes?: string[];
  /** Synthesized highest-priority scope from {@link roleScopes}. */
  role?: { scope: string } | null;
  permissions: string[];
  companyId?: string | null;
  companyAccess?: Array<{ companyId: string; accessLevel: string }>;
  divisionAccess?: Array<{ divisionId: string; accessLevel: string }>;
  branchAccess?: Array<{ branchId: string; accessLevel: string }>;
  rawRefreshToken?: string;
  /** Active session id, if the access token was issued with one (P1-01). */
  sid?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser | undefined;
  },
);
