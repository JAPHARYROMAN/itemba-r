import { ForbiddenException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { OrganizationScopeService } from './organization-scope.service';

const narrowUser: any = {
  id: 'user-1',
  roleScopes: ['BRANCH'],
  divisionAccess: [],
  branchAccess: [{ branchId: 'branch-1', accessLevel: AccessLevel.WRITE }],
};

describe('OrganizationScopeService', () => {
  const prisma: any = {
    userDivisionAccess: { findMany: jest.fn() },
    userBranchAccess: { findMany: jest.fn() },
  };
  const service = new OrganizationScopeService(prisma);

  it('leaves organization filtering to company scope for broad roles', async () => {
    await expect(
      service.recordWhereFor({ ...narrowUser, roleScopes: ['COMPANY'] }),
    ).resolves.toEqual({});
  });

  it('limits branch-scoped users to explicitly granted branches', async () => {
    await expect(service.recordWhereFor(narrowUser)).resolves.toEqual({
      OR: [{ branchId: { in: ['branch-1'] } }],
    });
  });

  it('accepts a granted branch and rejects another branch', async () => {
    await expect(
      service.assertCanAccessScope(narrowUser, 'division-1', 'branch-1', AccessLevel.WRITE),
    ).resolves.toBeUndefined();

    await expect(
      service.assertCanAccessScope(narrowUser, 'division-1', 'branch-2', AccessLevel.WRITE),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforces the requested access level', async () => {
    await expect(service.recordWhereFor(narrowUser, AccessLevel.MANAGE)).resolves.toEqual({
      id: { in: [] },
    });
  });
});
