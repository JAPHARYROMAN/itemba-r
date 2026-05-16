import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { UnitsService } from './units.service';

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'ops@itemba.local',
    fullName: 'Ops User',
    roles: ['COMPANY_MANAGER'],
    roleScopes: ['COMPANY'],
    permissions: ['units.view'],
    companyId: 'company-1',
    companyAccess: [],
    ...overrides,
  };
}

function makeHarness() {
  const prisma = {
    unitOfMeasure: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    userCompanyAccess: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
  const service = new UnitsService(
    prisma,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    new CompanyScopeService(prisma),
  );

  return { service, prisma };
}

describe('UnitsService.findAllUnits', () => {
  beforeEach(() => jest.clearAllMocks());

  it('includes system units together with all companies accessible to the user', async () => {
    const { service, prisma } = makeHarness();

    await service.findAllUnits(
      { limit: 200 },
      user({
        companyAccess: [{ companyId: 'company-2', accessLevel: AccessLevel.READ }],
      }),
    );

    expect(prisma.unitOfMeasure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          AND: [
            {
              OR: [{ companyId: null }, { companyId: { in: ['company-1', 'company-2'] } }],
            },
          ],
        }),
      }),
    );
  });

  it('includes system units when filtering by one selected company', async () => {
    const { service, prisma } = makeHarness();

    await service.findAllUnits(
      { companyId: 'company-2', limit: 200 },
      user({
        companyId: null,
        companyAccess: [{ companyId: 'company-2', accessLevel: AccessLevel.READ }],
      }),
    );

    expect(prisma.unitOfMeasure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          AND: [{ OR: [{ companyId: 'company-2' }, { companyId: null }] }],
        }),
      }),
    );
  });
});
