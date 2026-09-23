import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StockDamageService } from './stock-damage.service';
import { QueryStockDamageDto } from './dto/query-stock-damage.dto';
const user = {
  id: 'user',
  companyId: 'company',
  roleScopes: ['COMPANY'],
  roles: ['Company User'],
  permissions: ['stock_damage.view'],
  companyAccess: [],
} as any;
function setup() {
  const stockDamage = {
    findMany: jest.fn().mockResolvedValue([{ id: 'damage' }]),
    count: jest.fn().mockResolvedValue(121),
    findFirst: jest.fn().mockResolvedValue({ id: 'damage', companyId: 'company' }),
  };
  const scope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) };
  const service = new StockDamageService(
    { stockDamage } as any,
    {} as any,
    {} as any,
    scope as any,
    {} as any,
    {} as any,
  );
  return { stockDamage, scope, service };
}
describe('Damage workspace queries', () => {
  it('combines scoped search, product, type, branch and division with matching total and stable paging', async () => {
    const { service, stockDamage } = setup();
    expect(
      await service.findAll(
        {
          companyId: 'company',
          divisionId: 'division',
          branchId: 'branch',
          productId: 'product',
          search: ' Water ',
          damageType: 'BREAKAGE',
          status: 'APPROVED',
          page: 6,
          limit: 20,
        },
        user,
      ),
    ).toEqual({ data: [{ id: 'damage' }], total: 121, page: 6, limit: 20 });
    const request = stockDamage.findMany.mock.calls[0][0];
    expect(request).toMatchObject({
      skip: 100,
      take: 20,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: {
        deletedAt: null,
        companyId: 'company',
        branchId: 'branch',
        branch: { divisionId: 'division' },
        productId: 'product',
        status: 'APPROVED',
        damageType: 'BREAKAGE',
        AND: [
          {
            OR: expect.arrayContaining([
              { product: { name: { contains: 'Water', mode: 'insensitive' } } },
              { batch: { batchNumber: { contains: 'Water', mode: 'insensitive' } } },
            ]),
          },
        ],
      },
      include: {
        company: { select: { name: true } },
        reportedBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
        unit: { select: { symbol: true } },
        branch: { select: { divisionId: true } },
      },
    });
    expect(stockDamage.count).toHaveBeenCalledWith({ where: request.where });
  });
  it('denies another company before queries and fails closed with no accessible membership', async () => {
    const { service, stockDamage } = setup();
    await expect(service.findAll({ companyId: 'other' }, user)).rejects.toThrow();
    expect(stockDamage.findMany).not.toHaveBeenCalled();
    expect(stockDamage.count).not.toHaveBeenCalled();
    await service.findAll({ search: 'water' }, { ...user, companyId: null });
    expect(stockDamage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: [] } }) }),
    );
  });
  it('includes named detail relations while retaining company authorization', async () => {
    const { service, stockDamage, scope } = setup();
    await service.findOne('damage', user);
    expect(scope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company', 'READ');
    expect(stockDamage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'damage', deletedAt: null },
        include: expect.objectContaining({ reportedBy: { select: { id: true, fullName: true } } }),
      }),
    );
    scope.assertCanAccessCompany.mockRejectedValue(new Error('Company denied'));
    await expect(service.findOne('damage', user)).rejects.toThrow('Company denied');
  });
  it('validates new query fields and existing pagination at the boundary', async () => {
    expect(
      await validate(
        plainToInstance(QueryStockDamageDto, {
          divisionId: 'b63a0242-7e3d-40ed-9093-9b166bb9f9aa',
          damageType: 'EXPIRED',
          search: 'bottles',
          page: '2',
          limit: '20',
        }),
      ),
    ).toEqual([]);
    for (const value of [
      { damageType: 'FAKE' },
      { divisionId: 'invalid' },
      { search: 42 },
      { page: '0' },
      { limit: '5001' },
    ])
      expect((await validate(plainToInstance(QueryStockDamageDto, value))).length).toBeGreaterThan(
        0,
      );
  });
});
