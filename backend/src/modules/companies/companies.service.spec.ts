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

  const prisma = {
    company: {
      create: jest.fn(),
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

  return { service, prisma, auditLogs, permissionCache, companyCreate, accessUpsert };
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
