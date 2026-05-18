import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../decorators/current-user.decorator';

export type CompanyScopedWhere = {
  companyId?: string | { in: string[] };
  id?: { in: string[] };
};

/**
 * Phase 1 — hierarchy-aware scope clause. Used by services querying entities
 * that carry optional `divisionId` / `branchId` columns (Receivable, Payable,
 * SupplierInvoice, GRN, etc.). Each axis is applied independently:
 *  - companyId: enforced as today (required for non-group users).
 *  - divisionId: if the requested division is bound, scope to it; otherwise
 *    if the user has any UserDivisionAccess grants AND no group/company-wide
 *    grant, restrict to their accessible divisions.
 *  - branchId: same logic, one level down.
 *
 * Group-scoped users see everything they have company access to. Non-group
 * users with NO division/branch grants fall back to their company access
 * (so a Company-level user sees the whole company; this preserves existing
 * behavior for entities where division/branch is optional).
 */
export type HierarchyScopedWhere = CompanyScopedWhere & {
  divisionId?: string | { in: string[] };
  branchId?: string | { in: string[] };
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

/** Phase 1 — explicit Division access IDs from the user payload. */
export function accessibleDivisionIdsFromUser(user: AuthUser): string[] {
  return Array.from(new Set((user.divisionAccess ?? []).map((entry) => entry.divisionId)));
}

/** Phase 1 — explicit Branch access IDs from the user payload. */
export function accessibleBranchIdsFromUser(user: AuthUser): string[] {
  return Array.from(new Set((user.branchAccess ?? []).map((entry) => entry.branchId)));
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
    if (requestedCompanyId) {
      assertCanAccessCompanyFromUser(user, requestedCompanyId);
      return { companyId: requestedCompanyId };
    }
    const companyIds = accessibleCompanyIdsFromUser(user);
    return companyIds.length > 0 ? { companyId: { in: companyIds } } : { id: { in: [] } };
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
      if (requestedCompanyId) {
        await this.assertCanAccessCompany(user, requestedCompanyId);
        return { companyId: requestedCompanyId };
      }
      const accessible = await this.getAccessibleCompanyAccess(user);
      const companyIds = accessible.map((a) => a.companyId);
      return companyIds.length > 0 ? { companyId: { in: companyIds } } : { id: { in: [] } };
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

  async accessibleCompanyIds(user: AuthUser): Promise<string[]> {
    return (await this.getAccessibleCompanyAccess(user)).map((a) => a.companyId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 1 — Division & Branch scope helpers
  // ───────────────────────────────────────────────────────────────────────────

  /** True if the user has any explicit Division grants. */
  hasDivisionGrants(user: AuthUser): boolean {
    return (user.divisionAccess?.length ?? 0) > 0;
  }

  /** True if the user has any explicit Branch grants. */
  hasBranchGrants(user: AuthUser): boolean {
    return (user.branchAccess?.length ?? 0) > 0;
  }

  /** Resolved accessible Division IDs from the user payload. */
  accessibleDivisionIds(user: AuthUser): string[] {
    return accessibleDivisionIdsFromUser(user);
  }

  /** Resolved accessible Branch IDs from the user payload. */
  accessibleBranchIds(user: AuthUser): string[] {
    return accessibleBranchIdsFromUser(user);
  }

  /**
   * Assert the user has at least `minimum` access to the requested Division.
   * Group-scoped users skip the per-division check (they're covered by the
   * company-level assertion); non-group users with explicit divisionAccess
   * must list the requested division at the required level.
   */
  assertCanAccessDivision(
    user: AuthUser,
    divisionId: string,
    minimum: AccessLevel = AccessLevel.READ,
  ) {
    if (isGroupScopedUser(user)) return;

    const grant = (user.divisionAccess ?? []).find((d) => d.divisionId === divisionId);
    // If the user has NO division grants at all, fall through to company-level access
    // (preserves existing behavior for entities where division scope is optional).
    if (!this.hasDivisionGrants(user)) return;

    if (!grant || ACCESS_RANK[grant.accessLevel as AccessLevel] < ACCESS_RANK[minimum]) {
      throw new ForbiddenException('You do not have access to this division');
    }
  }

  /**
   * Assert the user has at least `minimum` access to the requested Branch.
   * Same fall-through logic as {@link assertCanAccessDivision}.
   */
  assertCanAccessBranch(
    user: AuthUser,
    branchId: string,
    minimum: AccessLevel = AccessLevel.READ,
  ) {
    if (isGroupScopedUser(user)) return;

    const grant = (user.branchAccess ?? []).find((b) => b.branchId === branchId);
    if (!this.hasBranchGrants(user)) return;

    if (!grant || ACCESS_RANK[grant.accessLevel as AccessLevel] < ACCESS_RANK[minimum]) {
      throw new ForbiddenException('You do not have access to this branch');
    }
  }

  /**
   * Build a hierarchy-scoped Prisma where clause spanning company, division,
   * and branch. Used by entities that carry optional `divisionId` / `branchId`
   * columns (Phase 1 tables: Receivable, Payable, SupplierInvoice, GRN,
   * InventoryBalance, RFQ, SupplierQuotation, BidComparison, CashAccount,
   * BankAccount).
   *
   * Each axis is enforced only when the user has explicit grants at that
   * level. A user with company access but no division/branch grants sees
   * the full company. A user with branch grants sees only their branches.
   */
  async scopedWhereFor(
    user: AuthUser,
    requested?: {
      companyId?: string | null;
      divisionId?: string | null;
      branchId?: string | null;
    },
  ): Promise<HierarchyScopedWhere> {
    const baseCompanyClause = await this.companyWhereFor(user, requested?.companyId);
    const where: HierarchyScopedWhere = { ...baseCompanyClause };

    // Division axis
    if (requested?.divisionId) {
      this.assertCanAccessDivision(user, requested.divisionId);
      where.divisionId = requested.divisionId;
    } else if (!isGroupScopedUser(user) && this.hasDivisionGrants(user)) {
      const ids = this.accessibleDivisionIds(user);
      where.divisionId = ids.length > 0 ? { in: ids } : { in: [] };
    }

    // Branch axis
    if (requested?.branchId) {
      this.assertCanAccessBranch(user, requested.branchId);
      where.branchId = requested.branchId;
    } else if (!isGroupScopedUser(user) && this.hasBranchGrants(user)) {
      const ids = this.accessibleBranchIds(user);
      where.branchId = ids.length > 0 ? { in: ids } : { in: [] };
    }

    return where;
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
