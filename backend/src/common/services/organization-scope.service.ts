import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

const ACCESS_RANK: Record<AccessLevel, number> = {
  [AccessLevel.READ]: 1,
  [AccessLevel.WRITE]: 2,
  [AccessLevel.MANAGE]: 3,
};

export interface OrganizationScopeIds {
  unrestricted: boolean;
  divisionIds: string[];
  branchIds: string[];
}

export type OrganizationRecordWhere =
  | { OR: Array<{ divisionId: { in: string[] } } | { branchId: { in: string[] } }> }
  | { id: { in: string[] } }
  | Record<string, never>;

@Injectable()
export class OrganizationScopeService {
  constructor(private readonly prisma: PrismaService) {}

  isUnrestricted(user: AuthUser) {
    const scopes = user.roleScopes ?? [];
    return scopes.includes('GROUP') || scopes.includes('COMPANY');
  }

  async accessibleIds(
    user: AuthUser,
    minimum: AccessLevel = AccessLevel.READ,
  ): Promise<OrganizationScopeIds> {
    if (this.isUnrestricted(user)) {
      return { unrestricted: true, divisionIds: [], branchIds: [] };
    }

    const [divisionAccess, branchAccess] = await Promise.all([
      user.divisionAccess !== undefined
        ? Promise.resolve(user.divisionAccess)
        : this.prisma.userDivisionAccess.findMany({
            where: { userId: user.id },
            select: { divisionId: true, accessLevel: true },
          }),
      user.branchAccess !== undefined
        ? Promise.resolve(user.branchAccess)
        : this.prisma.userBranchAccess.findMany({
            where: { userId: user.id },
            select: { branchId: true, accessLevel: true },
          }),
    ]);

    return {
      unrestricted: false,
      divisionIds: divisionAccess
        .filter((entry) => this.meetsMinimum(entry.accessLevel, minimum))
        .map((entry) => entry.divisionId),
      branchIds: branchAccess
        .filter((entry) => this.meetsMinimum(entry.accessLevel, minimum))
        .map((entry) => entry.branchId),
    };
  }

  async recordWhereFor(
    user: AuthUser,
    minimum: AccessLevel = AccessLevel.READ,
  ): Promise<OrganizationRecordWhere> {
    const scope = await this.accessibleIds(user, minimum);
    if (scope.unrestricted) return {};

    const filters: Array<{ divisionId: { in: string[] } } | { branchId: { in: string[] } }> = [];
    if (scope.divisionIds.length) filters.push({ divisionId: { in: scope.divisionIds } });
    if (scope.branchIds.length) filters.push({ branchId: { in: scope.branchIds } });
    return filters.length ? { OR: filters } : { id: { in: [] } };
  }

  async assertCanAccessScope(
    user: AuthUser,
    divisionId: string | null | undefined,
    branchId: string | null | undefined,
    minimum: AccessLevel = AccessLevel.READ,
  ) {
    if (this.isUnrestricted(user)) return;
    if (!divisionId && !branchId) {
      throw new ForbiddenException('A division or branch is required for your role scope');
    }

    const scope = await this.accessibleIds(user, minimum);
    if (branchId && scope.branchIds.includes(branchId)) return;
    if (divisionId && scope.divisionIds.includes(divisionId)) return;
    throw new ForbiddenException('You do not have access to this division or branch');
  }

  private meetsMinimum(value: string, minimum: AccessLevel) {
    const level = value as AccessLevel;
    return (ACCESS_RANK[level] ?? 0) >= ACCESS_RANK[minimum];
  }
}
