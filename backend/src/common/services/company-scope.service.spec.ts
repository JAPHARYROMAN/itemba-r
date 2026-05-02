import { ForbiddenException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { CompanyScopeService } from './company-scope.service';
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
      service.assertCanAccessCompany(user({ companyId: null, companyAccess: undefined }), 'company-3'),
    ).resolves.toBeUndefined();
  });
});
