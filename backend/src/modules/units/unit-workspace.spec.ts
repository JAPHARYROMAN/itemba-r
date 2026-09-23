import { ForbiddenException } from '@nestjs/common';
import { UnitsService } from './units.service';
describe('Unit conversion workspace reads', () => {
  function setup() {
    const prisma = {
      unitConversion: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(41),
      },
    };
    const scope = {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
      accessibleCompanyIds: jest.fn().mockResolvedValue(['allowed']),
    };
    const service = new UnitsService(prisma as any, {} as any, scope as any);
    return { prisma, scope, service };
  }
  it('combines company, shared records, search and status without changing total scope', async () => {
    const { prisma, scope, service } = setup();
    const result = await service.findAllConversions(
      { companyId: 'allowed', search: 'kg', status: 'INACTIVE', page: 2, limit: 20 },
      {},
    );
    const args = prisma.unitConversion.findMany.mock.calls[0][0];
    expect(scope.assertCanAccessCompany).toHaveBeenCalledWith({}, 'allowed');
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        deletedAt: null,
        AND: [{ OR: [{ companyId: 'allowed' }, { companyId: null }] }],
        isActive: false,
      },
    });
    expect(args.where.OR).toHaveLength(5);
    expect(args.where.OR).toContainEqual({
      toUnit: { symbol: { contains: 'kg', mode: 'insensitive' } },
    });
    expect(prisma.unitConversion.count).toHaveBeenCalledWith({ where: args.where });
    expect(result).toMatchObject({ total: 41, totalPages: 3 });
  });
  it('does not read records after company scope denial', async () => {
    const { prisma, scope, service } = setup();
    scope.assertCanAccessCompany.mockRejectedValue(new ForbiddenException());
    await expect(service.findAllConversions({ companyId: 'forbidden' }, {})).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.unitConversion.findMany).not.toHaveBeenCalled();
    expect(prisma.unitConversion.count).not.toHaveBeenCalled();
  });
  it('retains accessible company boundaries for unfiltered reads', async () => {
    const { prisma, service } = setup();
    await service.findAllConversions({}, {});
    expect(prisma.unitConversion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          AND: [{ OR: [{ companyId: null }, { companyId: { in: ['allowed'] } }] }],
        },
      }),
    );
  });
  it('limits accounts without company access to shared records', async () => {
    const { prisma, scope, service } = setup();
    scope.accessibleCompanyIds.mockResolvedValue([]);
    await service.findAllConversions({ status: 'ACTIVE' }, {});
    expect(prisma.unitConversion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, AND: [{ companyId: null }], isActive: true },
      }),
    );
  });
});
