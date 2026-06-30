import { BadRequestException } from '@nestjs/common';
import { AccessLevel, UnitType } from '@prisma/client';
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
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'unit-new', companyId: data.companyId ?? null, ...data }),
      ),
      update: jest.fn().mockImplementation(({ where, data }: any) =>
        Promise.resolve({ id: where.id, companyId: null, ...data }),
      ),
    },
    unitConversion: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'conv-new', companyId: data.companyId ?? null, ...data }),
      ),
      update: jest.fn().mockImplementation(({ where, data }: any) =>
        Promise.resolve({ id: where.id, companyId: null, ...data }),
      ),
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

describe('UnitsService base unit guard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects creating a second base unit for the same company + unitType', async () => {
    const { service, prisma } = makeHarness();
    // First findFirst (name/symbol uniqueness) → none; second (base unit guard) → existing base.
    prisma.unitOfMeasure.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'unit-base', name: 'Kilogram' });

    await expect(
      service.createUnit(
        { name: 'Gram', symbol: 'g', unitType: UnitType.WEIGHT, isBaseUnit: true },
        user(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.unitOfMeasure.create).not.toHaveBeenCalled();
    expect(prisma.unitOfMeasure.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          companyId: 'company-1',
          unitType: UnitType.WEIGHT,
          isBaseUnit: true,
        }),
      }),
    );
  });

  it('allows creating a base unit when no other base exists for that unitType', async () => {
    const { service, prisma } = makeHarness();
    prisma.unitOfMeasure.findFirst.mockResolvedValue(null);

    await expect(
      service.createUnit(
        { name: 'Kilogram', symbol: 'kg', unitType: UnitType.WEIGHT, isBaseUnit: true },
        user(),
      ),
    ).resolves.toMatchObject({ isBaseUnit: true });

    expect(prisma.unitOfMeasure.create).toHaveBeenCalled();
  });

  it('excludes the unit being updated from the base unit guard', async () => {
    const { service, prisma } = makeHarness();
    prisma.unitOfMeasure.findFirst
      // findOneUnit lookup → the unit being updated
      .mockResolvedValueOnce({
        id: 'unit-1',
        companyId: 'company-1',
        unitType: UnitType.WEIGHT,
        isSystemUnit: false,
      })
      // base unit guard → no *other* base unit
      .mockResolvedValueOnce(null);

    await service.updateUnit('unit-1', { isBaseUnit: true }, user());

    expect(prisma.unitOfMeasure.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isBaseUnit: true,
          id: { not: 'unit-1' },
        }),
      }),
    );
    expect(prisma.unitOfMeasure.update).toHaveBeenCalled();
  });
});

describe('UnitsService conversionFactor precision', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a conversionFactor with more than 6 decimal places on create', async () => {
    const { service, prisma } = makeHarness();

    await expect(
      service.createConversion(
        { fromUnitId: 'unit-1', toUnitId: 'unit-2', conversionFactor: 1.1234567 },
        user(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.unitConversion.create).not.toHaveBeenCalled();
  });

  it('rejects an over-precise conversionFactor on update', async () => {
    const { service, prisma } = makeHarness();
    prisma.unitConversion.findFirst.mockResolvedValue({
      id: 'conv-1',
      companyId: 'company-1',
    });

    await expect(
      service.updateConversion('conv-1', { conversionFactor: 2.0000001 }, user()),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.unitConversion.update).not.toHaveBeenCalled();
  });

  it('accepts a conversionFactor with 6 or fewer decimal places', async () => {
    const { service, prisma } = makeHarness();
    // Both referenced units are usable by the resolved company.
    prisma.unitOfMeasure.findMany.mockResolvedValue([
      { id: 'unit-1', companyId: 'company-1' },
      { id: 'unit-2', companyId: 'company-1' },
    ]);

    await expect(
      service.createConversion(
        { fromUnitId: 'unit-1', toUnitId: 'unit-2', conversionFactor: 1.123456 },
        user(),
      ),
    ).resolves.toMatchObject({ conversionFactor: 1.123456 });

    expect(prisma.unitConversion.create).toHaveBeenCalled();
  });
});
