import { AccessLevel, AuditSeverity } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { CompaniesService } from './companies.service';

function groupUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'admin@itemba.local',
    fullName: 'Group Admin',
    roles: ['GROUP_SUPER_ADMIN'],
    roleScopes: ['GROUP'],
    permissions: ['companies.create'],
    companyId: null,
    companyAccess: [],
    ...overrides,
  };
}

function companyUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-2',
    email: 'clerk@itemba.local',
    fullName: 'Company Clerk',
    roles: ['COMPANY_ACCOUNTANT'],
    roleScopes: ['COMPANY'],
    permissions: ['companies.view'],
    companyId: 'company-a',
    companyAccess: [{ companyId: 'company-a', accessLevel: AccessLevel.READ }],
    ...overrides,
  };
}

function makeHarness() {
  const createdCompany = {
    id: 'company-new',
    groupId: 'group-1',
    name: 'New Company Ltd',
    code: 'NEW',
    status: 'ACTIVE',
  };
  const existingCompany = {
    id: 'company-seeded',
    groupId: 'group-1',
    name: 'Seeded Company Ltd',
    code: 'SEEDED',
    status: 'ACTIVE',
    industryType: 'Retail',
  };
  const companyCreate = jest.fn().mockResolvedValue(createdCompany);
  const companyFindFirst = jest.fn().mockResolvedValue(existingCompany);
  const companyUpdate = jest.fn().mockResolvedValue({
    ...existingCompany,
    name: 'Updated Seeded Company Ltd',
  });
  const accessUpsert = jest.fn().mockResolvedValue({
    userId: 'user-1',
    companyId: 'company-new',
    accessLevel: AccessLevel.MANAGE,
  });

  const companyFindMany = jest.fn().mockResolvedValue([]);
  const companyCount = jest.fn().mockResolvedValue(0);
  const companyProfileUpsert = jest.fn().mockResolvedValue({
    id: 'profile-1',
    companyId: 'company-seeded',
    registeredName: 'Seeded Company Limited',
  });

  const prisma = {
    company: {
      create: jest.fn(),
      findFirst: companyFindFirst,
      findMany: companyFindMany,
      count: companyCount,
      update: companyUpdate,
    },
    companyProfile: {
      upsert: companyProfileUpsert,
    },
    branch: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    division: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userCompanyAccess: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg({
          company: { create: companyCreate },
          userCompanyAccess: { upsert: accessUpsert },
        });
      }
      return Promise.all(arg);
    }),
  } as any;

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const permissionCache = { invalidate: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new CompaniesService(
    prisma,
    new CompanyScopeService(prisma),
    auditLogs,
    permissionCache,
  );

  return {
    service,
    prisma,
    auditLogs,
    permissionCache,
    companyCreate,
    accessUpsert,
    companyFindFirst,
    companyFindMany,
    companyCount,
    companyUpdate,
    companyProfileUpsert,
  };
}

describe('CompaniesService.create', () => {
  beforeEach(() => jest.clearAllMocks());

  it('grants the creator MANAGE access and invalidates cached company scope', async () => {
    const harness = makeHarness();
    const user = groupUser();

    const company = await harness.service.create(
      {
        groupId: 'group-1',
        name: 'New Company Ltd',
        code: 'NEW',
        status: 'ACTIVE',
      },
      user,
    );

    expect(company).toEqual(expect.objectContaining({ id: 'company-new' }));
    expect(harness.companyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ groupId: 'group-1', code: 'NEW' }),
    });
    expect(harness.accessUpsert).toHaveBeenCalledWith({
      where: { userId_companyId: { userId: 'user-1', companyId: 'company-new' } },
      update: { accessLevel: AccessLevel.MANAGE, grantedById: 'user-1' },
      create: {
        userId: 'user-1',
        companyId: 'company-new',
        accessLevel: AccessLevel.MANAGE,
        grantedById: 'user-1',
      },
    });
    expect(harness.permissionCache.invalidate).toHaveBeenCalledWith('user-1');
    expect(harness.auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'COMPANY_CREATED',
        entityType: 'Company',
        entityId: 'company-new',
        userId: 'user-1',
        companyId: 'company-new',
        severity: AuditSeverity.HIGH,
      }),
    );
  });
});

describe('CompaniesService registry administration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows a GROUP-scoped company administrator to update seeded companies without explicit company access', async () => {
    const harness = makeHarness();
    const user = groupUser({
      companyId: null,
      companyAccess: [],
      permissions: ['companies.update'],
    });

    await expect(
      harness.service.update('company-seeded', { name: 'Updated Seeded Company Ltd' }, user),
    ).resolves.toEqual(expect.objectContaining({ id: 'company-seeded' }));

    expect(harness.companyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'company-seeded', deletedAt: null } }),
    );
    expect(harness.companyUpdate).toHaveBeenCalledWith({
      where: { id: 'company-seeded' },
      data: { name: 'Updated Seeded Company Ltd' },
    });
  });

  it('allows a GROUP-scoped company administrator to delete seeded companies without explicit company access', async () => {
    const harness = makeHarness();
    const user = groupUser({
      companyId: null,
      companyAccess: [],
      permissions: ['companies.delete'],
    });

    await expect(harness.service.remove('company-seeded', user)).resolves.toEqual(
      expect.objectContaining({ id: 'company-seeded' }),
    );

    expect(harness.prisma.branch.updateMany).toHaveBeenCalledWith({
      where: { deletedAt: null, division: { companyId: 'company-seeded' } },
      data: expect.objectContaining({ isActive: false }),
    });
    expect(harness.prisma.division.updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company-seeded', deletedAt: null },
      data: expect.objectContaining({ isActive: false }),
    });
    expect(harness.companyUpdate).toHaveBeenCalledWith({
      where: { id: 'company-seeded' },
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    });
  });

  it('still requires MANAGE access for non-group users', async () => {
    const harness = makeHarness();
    const user = companyUser({
      companyId: null,
      companyAccess: [{ companyId: 'company-seeded', accessLevel: AccessLevel.READ }],
      permissions: ['companies.update'],
    });

    await expect(
      harness.service.update('company-seeded', { name: 'Blocked Update Ltd' }, user),
    ).rejects.toThrow();

    expect(harness.companyUpdate).not.toHaveBeenCalled();
  });

  it('attributes one audit row after a legal profile upsert succeeds', async () => {
    const harness = makeHarness();
    const user = groupUser({ permissions: ['companies.update'] });

    await harness.service.upsertProfile(
      'company-seeded',
      {
        registeredName: 'Seeded Company Limited',
        brelaRegNumber: 'BRELA-1',
        tin: 'TIN-1',
        registeredAddress: 'Dar es Salaam',
      },
      user,
    );

    expect(harness.companyProfileUpsert).toHaveBeenCalledTimes(1);
    expect(harness.auditLogs.log).toHaveBeenCalledTimes(1);
    expect(harness.auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LEGAL_PROFILE_UPDATE',
        entityType: 'CompanyProfile',
        entityId: 'profile-1',
        userId: 'user-1',
        companyId: 'company-seeded',
      }),
    );
  });

  it('does not claim profile audit evidence when the upsert fails', async () => {
    const harness = makeHarness();
    harness.companyProfileUpsert.mockRejectedValueOnce(new Error('database rejected mutation'));

    await expect(
      harness.service.upsertProfile(
        'company-seeded',
        {
          registeredName: 'Seeded Company Limited',
          brelaRegNumber: 'BRELA-1',
          tin: 'TIN-1',
          registeredAddress: 'Dar es Salaam',
        },
        groupUser({ permissions: ['companies.update'] }),
      ),
    ).rejects.toThrow('database rejected mutation');
    expect(harness.auditLogs.log).not.toHaveBeenCalled();
  });
});

describe('CompaniesService.findAll', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists all companies for a GROUP-scoped user with no explicit access grants', async () => {
    const harness = makeHarness();
    // Seeded GROUP_SUPER_ADMIN: no home company, no UserCompanyAccess grants.
    const user = groupUser({ companyId: null, companyAccess: [] });

    await harness.service.findAll({}, user);

    // The where clause must NOT contain an id filter (which would be `id: { in: [] }`
    // and hide every seeded company) — group-scoped users see all non-deleted rows.
    const where = harness.companyFindMany.mock.calls[0][0].where;
    expect(where).toEqual({ deletedAt: null });
    expect(where).not.toHaveProperty('id');
    expect(harness.companyCount).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it('restricts a non-group user to their explicitly-granted companies', async () => {
    const harness = makeHarness();
    const user = companyUser();

    await harness.service.findAll({}, user);

    const where = harness.companyFindMany.mock.calls[0][0].where;
    expect(where).toEqual({
      deletedAt: null,
      id: { in: ['company-a'] },
    });
  });

  it('keeps other filters alongside the group-scoped listing', async () => {
    const harness = makeHarness();
    const user = groupUser({ companyId: null, companyAccess: [] });

    await harness.service.findAll({ status: 'ACTIVE', search: 'itemba' }, user);

    const where = harness.companyFindMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        deletedAt: null,
        status: 'ACTIVE',
      }),
    );
    expect(where).not.toHaveProperty('id');
  });
});
