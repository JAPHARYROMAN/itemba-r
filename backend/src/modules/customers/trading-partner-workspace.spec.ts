import { CustomersService } from './customers.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
const user: AuthUser = {
  id: 'user',
  email: 'user@example.test',
  companyId: 'company',
  companyAccess: [],
  permissions: [],
  roles: [],
};
describe.each(['customer', 'supplier'] as const)('%s directory workspace', (kind) => {
  function setup() {
    const groupBy = jest.fn().mockResolvedValue([
      {
        status: 'ACTIVE',
        _count: { _all: 6001 },
        _sum: { currentBalance: '2000', creditLimit: '3000' },
      },
      {
        status: 'BLOCKED',
        _count: { _all: 2 },
        _sum: { currentBalance: '500', creditLimit: '1000' },
      },
    ]);
    const aggregate = jest
      .fn()
      .mockResolvedValueOnce({ _sum: { outstandingAmount: '2500' } })
      .mockResolvedValueOnce({ _sum: { outstandingAmount: '400' } });
    const directory = {
      groupBy,
      findMany: jest.fn().mockResolvedValue([{ id: 'partner' }]),
      count: jest.fn().mockResolvedValue(6003),
    };
    const prisma = {
      [kind]: directory,
      [kind === 'customer' ? 'receivable' : 'payable']: { aggregate },
    };
    const scope = new CompanyScopeService(prisma as any);
    const service =
      kind === 'customer'
        ? new CustomersService(prisma as any, { log: jest.fn() } as any, scope)
        : new SuppliersService(prisma as any, { log: jest.fn() } as any, scope);
    return { prisma, service, groupBy, aggregate, directory };
  }
  const query = {
    companyId: 'company',
    divisionId: 'division',
    search: 'Acacia',
    status: 'ACTIVE',
    page: 2,
    limit: 20,
  };
  it('aggregates beyond 5000 and applies the same company and search filters to every balance', async () => {
    const { service, groupBy, aggregate } = setup();
    const result = await service.workbenchSummary(query as any, user);
    expect(result).toEqual(
      expect.objectContaining({
        total: 6003,
        active: 6001,
        blocked: 2,
        inactive: 0,
        currentBalance: 2500,
        [kind === 'customer' ? 'openReceivableBalance' : 'openPayableBalance']: 2500,
        [kind === 'customer' ? 'overdueReceivableBalance' : 'overduePayableBalance']: 400,
      }),
    );
    const where = groupBy.mock.calls[0][0].where;
    expect(where).toMatchObject({
      deletedAt: null,
      companyId: 'company',
      divisionId: 'division',
      status: 'ACTIVE',
      OR: expect.arrayContaining([{ name: { contains: 'Acacia', mode: 'insensitive' } }]),
    });
    expect(groupBy.mock.calls[0][0]).not.toHaveProperty('take');
    expect(groupBy.mock.calls[0][0]).not.toHaveProperty('skip');
    for (const [args] of aggregate.mock.calls)
      expect(args.where).toMatchObject({
        [kind]: { is: where },
        deletedAt: null,
        status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
      });
    expect(aggregate.mock.calls[1][0].where).toMatchObject({
      dueDate: { lt: expect.any(Date) },
      outstandingAmount: { gt: 0 },
    });
  });
  it('keeps list pagination separate from full-directory summaries and preserves scope details', async () => {
    const { service, directory } = setup();
    await service.findAll(
      { ...query, [kind === 'customer' ? 'branchId' : 'productCategoryId']: 'scope' } as any,
      user,
    );
    const call = directory.findMany.mock.calls[0][0];
    expect(call).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        companyId: 'company',
        divisionId: 'division',
        ...(kind === 'customer'
          ? { branchId: 'scope' }
          : { productCategories: { some: { productCategoryId: 'scope' } } }),
      },
      include: { company: expect.any(Object), division: expect.any(Object) },
    });
    expect(directory.count).toHaveBeenCalledWith({ where: call.where });
  });
  it('rejects inaccessible company before directory or accounting queries', async () => {
    const { service, groupBy, aggregate, directory } = setup();
    await expect(service.workbenchSummary({ companyId: 'foreign' }, user)).rejects.toThrow();
    await expect(service.findAll({ companyId: 'foreign' }, user)).rejects.toThrow();
    expect(groupBy).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
    expect(directory.findMany).not.toHaveBeenCalled();
  });
  it('returns real empty totals without invented balances', async () => {
    const { service, groupBy, aggregate } = setup();
    groupBy.mockResolvedValue([]);
    aggregate.mockReset().mockResolvedValue({ _sum: { outstandingAmount: null } });
    expect(await service.workbenchSummary({}, user)).toMatchObject({
      total: 0,
      active: 0,
      blocked: 0,
      inactive: 0,
      currentBalance: 0,
    });
  });
});
