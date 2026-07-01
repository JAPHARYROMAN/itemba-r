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
  const companyCreate = jest.fn().mockResolvedValue(createdCompany);
  const accessUpsert = jest.fn().mockResolvedValue({
    userId: 'user-1',
    companyId: 'company-new',
    accessLevel: AccessLevel.MANAGE,
  });

  const companyFindMany = jest.fn().mockResolvedValue([]);
  const companyCount = jest.fn().mockResolvedValue(0);

  const prisma = {
    company: {
      create: jest.fn(),
      findMany: companyFindMany,
      count: companyCount,
    },
    userCompanyAccess: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        company: { create: companyCreate },
        userCompanyAccess: { upsert: accessUpsert },
      }),
    ),
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
    companyFindMany,
    companyCount,
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
