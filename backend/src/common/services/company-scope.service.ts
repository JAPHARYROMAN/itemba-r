import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../decorators/current-user.decorator';

export type CompanyScopedWhere = {
  companyId?: string | { in: string[] };
  id?: { in: string[] };
};

const ACCESS_RANK: Record<AccessLevel, number> = {
  READ: 1,
  WRITE: 2,
  MANAGE: 3,
};

export function isGroupScopedUser(user: Pick<AuthUser, 'roleScopes'>): boolean {
  return user.roleScopes?.includes('GROUP') ?? false;
}

export function accessibleCompanyIdsFromUser(user: AuthUser): string[] {
  const companyIds = new Set<string>();

  if (user.companyId) companyIds.add(user.companyId);

  for (const entry of user.companyAccess ?? []) {
    companyIds.add(entry.companyId);
  }

  return Array.from(companyIds);
}

export function assertCanAccessCompanyFromUser(
  user: AuthUser,
  companyId: string | null | undefined,
  minimum: AccessLevel = AccessLevel.READ,
) {
  if (!companyId) {
    if (!isGroupScopedUser(user)) {
      throw new ForbiddenException('Group-scoped role required to access group-level records');
    }
    return;
  }

  if (isGroupScopedUser(user)) return;

  const access = new Map<string, AccessLevel>();
  if (user.companyId) access.set(user.companyId, AccessLevel.MANAGE);
  for (const entry of user.companyAccess ?? []) {
    const next = entry.accessLevel as AccessLevel;
    const current = access.get(entry.companyId);
    access.set(
      entry.companyId,
      !current || ACCESS_RANK[next] > ACCESS_RANK[current] ? next : current,
    );
  }

  const granted = access.get(companyId);
  if (!granted || ACCESS_RANK[granted] < ACCESS_RANK[minimum]) {
    throw new ForbiddenException('You do not have access to this company');
  }
}

export function companyWhereForUser(
  user: AuthUser | undefined,
  requestedCompanyId?: string | null,
): CompanyScopedWhere {
  if (!user) {
    throw new ForbiddenException('Authenticated user required for company-scoped access');
  }

  if (isGroupScopedUser(user)) {
    return requestedCompanyId ? { companyId: requestedCompanyId } : {};
  }

  if (requestedCompanyId) {
    assertCanAccessCompanyFromUser(user, requestedCompanyId);
    return { companyId: requestedCompanyId };
  }

  const companyIds = accessibleCompanyIdsFromUser(user);
  if (companyIds.length === 0) {
    return { id: { in: [] } };
  }

  return { companyId: { in: companyIds } };
}

export function applyCompanyScopeWhere(
  where: Record<string, unknown>,
  user: AuthUser | undefined,
  requestedCompanyId?: string | null,
) {
  Object.assign(where, companyWhereForUser(user, requestedCompanyId));
  return where;
}

@Injectable()
export class CompanyScopeService {
  constructor(private readonly prisma: PrismaService) {}

  isGroupScoped(user: Pick<AuthUser, 'roleScopes'>): boolean {
    return isGroupScopedUser(user);
  }

  assertGroupScoped(user: AuthUser, action = 'access this resource') {
    if (!this.isGroupScoped(user)) {
      throw new ForbiddenException(`Group-scoped role required to ${action}`);
    }
  }

  async assertCanAccessCompany(
    user: AuthUser,
    companyId: string | null | undefined,
    minimum: AccessLevel = AccessLevel.READ,
  ) {
    if (!companyId) {
      this.assertGroupScoped(user, 'access group-level records');
      return;
    }

    if (this.isGroupScoped(user)) return;

    const accessible = await this.getAccessibleCompanyAccess(user);
    const match = accessible.find((a) => a.companyId === companyId);
    if (!match || ACCESS_RANK[match.accessLevel] < ACCESS_RANK[minimum]) {
      throw new ForbiddenException('You do not have access to this company');
    }
  }

  async companyWhereFor(
    user: AuthUser,
    requestedCompanyId?: string | null,
  ): Promise<CompanyScopedWhere> {
    if (this.isGroupScoped(user)) {
      return requestedCompanyId ? { companyId: requestedCompanyId } : {};
    }

    const accessible = await this.getAccessibleCompanyAccess(user);
    const companyIds = accessible.map((a) => a.companyId);

    if (requestedCompanyId) {
      await this.assertCanAccessCompany(user, requestedCompanyId);
      return { companyId: requestedCompanyId };
    }

    if (companyIds.length === 0) {
      return { id: { in: [] } };
    }

    return { companyId: { in: companyIds } };
  }

  async accessibleCompanyIds(user: AuthUser): Promise<string[] | null> {
    if (this.isGroupScoped(user)) return null;
    return (await this.getAccessibleCompanyAccess(user)).map((a) => a.companyId);
  }

  private async getAccessibleCompanyAccess(
    user: AuthUser,
  ): Promise<Array<{ companyId: string; accessLevel: AccessLevel }>> {
    const access = new Map<string, AccessLevel>();

    if (user.companyId) access.set(user.companyId, AccessLevel.MANAGE);

    for (const entry of user.companyAccess ?? []) {
      access.set(
        entry.companyId,
        this.maxAccess(access.get(entry.companyId), entry.accessLevel as AccessLevel),
      );
    }

    if (user.companyAccess !== undefined) {
      return Array.from(access.entries()).map(([companyId, accessLevel]) => ({
        companyId,
        accessLevel,
      }));
    }

    const rows = await this.prisma.userCompanyAccess.findMany({
      where: { userId: user.id },
      select: { companyId: true, accessLevel: true },
    });

    for (const row of rows) {
      access.set(row.companyId, this.maxAccess(access.get(row.companyId), row.accessLevel));
    }

    return Array.from(access.entries()).map(([companyId, accessLevel]) => ({
      companyId,
      accessLevel,
    }));
  }

  private maxAccess(current: AccessLevel | undefined, next: AccessLevel): AccessLevel {
    if (!current) return next;
    return ACCESS_RANK[next] > ACCESS_RANK[current] ? next : current;
  }
}
