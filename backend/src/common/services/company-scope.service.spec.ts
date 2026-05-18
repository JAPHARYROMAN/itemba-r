import { ForbiddenException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import {
  applyCompanyScopeWhere,
  companyWhereForUser,
  CompanyScopeService,
} from './company-scope.service';
import { AuthUser } from '../decorators/current-user.decorator';

const prisma = {
  userCompanyAccess: {
    findMany: jest.fn(),
  },
};

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    roles: ['Company User'],
    roleScopes: ['COMPANY'],
    permissions: [],
    companyId: 'company-1',
    companyAccess: [],
    ...overrides,
  };
}

describe('CompanyScopeService', () => {
  let service: CompanyScopeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CompanyScopeService(prisma as any);
  });

  it('allows group-scoped users to access group-level records', async () => {
    await expect(
      service.assertCanAccessCompany(user({ roleScopes: ['GROUP'], companyId: null }), null),
    ).resolves.toBeUndefined();
  });

  it('denies non-group users from group-level records', async () => {
    await expect(service.assertCanAccessCompany(user(), null)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows a user to access their primary company', async () => {
    await expect(service.assertCanAccessCompany(user(), 'company-1')).resolves.toBeUndefined();
  });

  it('allows explicitly granted company access', async () => {
    const scopedUser = user({
      companyId: null,
      companyAccess: [{ companyId: 'company-2', accessLevel: AccessLevel.WRITE }],
    });

    await expect(
      service.assertCanAccessCompany(scopedUser, 'company-2', AccessLevel.READ),
    ).resolves.toBeUndefined();
  });

  it('requires group-scoped users to have explicit company access for company records', async () => {
    await expect(
      service.assertCanAccessCompany(
        user({ roleScopes: ['GROUP'], companyId: null, companyAccess: [] }),
        'company-2',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires the requested minimum access level', async () => {
    const scopedUser = user({
      companyId: null,
      companyAccess: [{ companyId: 'company-2', accessLevel: AccessLevel.READ }],
    });

    await expect(
      service.assertCanAccessCompany(scopedUser, 'company-2', AccessLevel.WRITE),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('falls back to database company access when JWT access is not present', async () => {
    prisma.userCompanyAccess.findMany.mockResolvedValue([
      { companyId: 'company-3', accessLevel: AccessLevel.MANAGE },
    ]);

    await expect(
      service.assertCanAccessCompany(
        user({ companyId: null, companyAccess: undefined }),
        'company-3',
      ),
    ).resolves.toBeUndefined();
  });

  it('builds a multi-company filter from the authenticated user payload', () => {
    expect(
      companyWhereForUser(
        user({
          companyAccess: [
            { companyId: 'company-2', accessLevel: AccessLevel.READ },
            { companyId: 'company-3', accessLevel: AccessLevel.WRITE },
          ],
        }),
      ),
    ).toEqual({ companyId: { in: ['company-1', 'company-2', 'company-3'] } });
  });

  it('does not turn an unbounded group-scoped query into all companies', () => {
    expect(companyWhereForUser(user({ roleScopes: ['GROUP'], companyId: null }))).toEqual({
      id: { in: [] },
    });
  });

  it('returns explicit company ids for async group-scoped filters', async () => {
    await expect(
      service.accessibleCompanyIds(
        user({
          roleScopes: ['GROUP'],
          companyId: null,
          companyAccess: [{ companyId: 'company-2', accessLevel: AccessLevel.READ }],
        }),
      ),
    ).resolves.toEqual(['company-2']);
  });

  it('rejects an explicit query override outside the user company scope', () => {
    expect(() => companyWhereForUser(user(), 'company-2')).toThrow(ForbiddenException);
  });

  it('mutates an existing where object with the safe company scope', () => {
    const where: Record<string, unknown> = { deletedAt: null, status: 'ACTIVE' };

    applyCompanyScopeWhere(where, user(), null);

    expect(where).toEqual({
      deletedAt: null,
      status: 'ACTIVE',
      companyId: { in: ['company-1'] },
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1 — hierarchy scope (division/branch) regressions
  // ─────────────────────────────────────────────────────────────────────────

  it('Phase 1: branch-scoped user sees only branches they were granted', async () => {
    const branchUser = user({
      roleScopes: ['BRANCH'],
      companyId: 'company-1',
      companyAccess: [{ companyId: 'company-1', accessLevel: AccessLevel.WRITE }],
      branchAccess: [
        { branchId: 'branch-A', accessLevel: AccessLevel.WRITE },
        { branchId: 'branch-B', accessLevel: AccessLevel.READ },
      ],
    });

    await expect(service.scopedWhereFor(branchUser)).resolves.toEqual({
      companyId: { in: ['company-1'] },
      branchId: { in: ['branch-A', 'branch-B'] },
    });
  });

  it('Phase 1: division-scoped user sees only divisions they were granted', async () => {
    const divisionUser = user({
      roleScopes: ['DIVISION'],
      companyId: 'company-1',
      divisionAccess: [{ divisionId: 'div-A', accessLevel: AccessLevel.WRITE }],
    });

    await expect(service.scopedWhereFor(divisionUser)).resolves.toEqual({
      companyId: { in: ['company-1'] },
      divisionId: { in: ['div-A'] },
    });
  });

  it('Phase 1: group-scoped user sees everything across granted companies (no division/branch filter)', async () => {
    const groupUser = user({
      roleScopes: ['GROUP'],
      companyId: null,
      companyAccess: [
        { companyId: 'company-1', accessLevel: AccessLevel.MANAGE },
        { companyId: 'company-2', accessLevel: AccessLevel.MANAGE },
      ],
      branchAccess: [{ branchId: 'branch-A', accessLevel: AccessLevel.READ }],
    });

    const where = await service.scopedWhereFor(groupUser);
    expect(where.companyId).toEqual({ in: ['company-1', 'company-2'] });
    // Group users are NOT restricted to their branchAccess list.
    expect(where.branchId).toBeUndefined();
    expect(where.divisionId).toBeUndefined();
  });

  it('Phase 1: company-level user without branch grants sees the whole company', async () => {
    const companyUser = user({
      roleScopes: ['COMPANY'],
      companyId: 'company-1',
      // No divisionAccess, no branchAccess.
    });

    const where = await service.scopedWhereFor(companyUser);
    expect(where.companyId).toEqual({ in: ['company-1'] });
    expect(where.divisionId).toBeUndefined();
    expect(where.branchId).toBeUndefined();
  });

  it('Phase 1: rejects requested branch the user has no access to', async () => {
    const branchUser = user({
      roleScopes: ['BRANCH'],
      companyId: 'company-1',
      branchAccess: [{ branchId: 'branch-A', accessLevel: AccessLevel.WRITE }],
    });

    await expect(
      service.scopedWhereFor(branchUser, { branchId: 'branch-B' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('Phase 1: rejects requested division the user has no access to', async () => {
    const divisionUser = user({
      roleScopes: ['DIVISION'],
      companyId: 'company-1',
      divisionAccess: [{ divisionId: 'div-A', accessLevel: AccessLevel.WRITE }],
    });

    await expect(
      service.scopedWhereFor(divisionUser, { divisionId: 'div-B' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('Phase 1: assertCanAccessBranch / Division enforce minimum access level', () => {
    const u = user({
      roleScopes: ['BRANCH'],
      branchAccess: [{ branchId: 'branch-A', accessLevel: AccessLevel.READ }],
      divisionAccess: [{ divisionId: 'div-A', accessLevel: AccessLevel.READ }],
    });

    expect(() => service.assertCanAccessBranch(u, 'branch-A', AccessLevel.WRITE)).toThrow(
      ForbiddenException,
    );
    expect(() => service.assertCanAccessDivision(u, 'div-A', AccessLevel.WRITE)).toThrow(
      ForbiddenException,
    );
    expect(() =>
      service.assertCanAccessBranch(u, 'branch-A', AccessLevel.READ),
    ).not.toThrow();
  });

  it('Phase 1: empty branchAccess for a user with no branch grants does NOT restrict — falls through to company scope', async () => {
    // A user without ANY branch grants is implicitly company-level for branch-aware tables.
    // Scoping ONLY kicks in when they have explicit grants (otherwise everyone needs
    // to be tagged everywhere, which is operationally impossible).
    const u = user({
      roleScopes: ['COMPANY'],
      companyId: 'company-1',
      branchAccess: [],
    });

    const where = await service.scopedWhereFor(u);
    expect(where.branchId).toBeUndefined();
  });
});
