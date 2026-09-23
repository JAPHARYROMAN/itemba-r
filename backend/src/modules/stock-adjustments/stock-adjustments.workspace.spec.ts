import { StockAdjustmentsService } from './stock-adjustments.service';
function setup() {
  const prisma = {
    stockAdjustment: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(42),
    },
  };
  const scope = {
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: { in: ['company'] } }),
  };
  const service = new StockAdjustmentsService(
    prisma as any,
    {} as any,
    {} as any,
    scope as any,
    {} as any,
    {} as any,
  );
  return { prisma, scope, service };
}
describe('Stock adjustment workspace queries', () => {
  it('combines scoped search, branch, division, dates and stable pagination for rows and total', async () => {
    const { prisma, service } = setup();
    expect(
      await service.findAll(
        {
          companyId: 'company',
          divisionId: 'division',
          branchId: 'branch',
          search: ' count ',
          status: 'APPROVED',
          dateFrom: '2026-09-01T00:00:00Z',
          dateTo: '2026-09-18T23:59:59.999Z',
          page: 2,
          limit: 20,
        },
        {} as any,
      ),
    ).toEqual({ data: [], total: 42, page: 2, limit: 20, totalPages: 3 });
    const query = prisma.stockAdjustment.findMany.mock.calls[0][0];
    expect(query).toMatchObject({
      skip: 20,
      take: 20,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: {
        deletedAt: null,
        companyId: { in: ['company'] },
        divisionId: 'division',
        branchId: 'branch',
        status: 'APPROVED',
        createdAt: { lte: new Date('2026-09-18T23:59:59.999Z') },
        AND: [
          { OR: expect.arrayContaining([{ reason: { contains: 'count', mode: 'insensitive' } }]) },
        ],
      },
      include: { division: { select: { id: true, name: true } } },
    });
    expect(prisma.stockAdjustment.count).toHaveBeenCalledWith({ where: query.where });
  });
  it('denies inaccessible companies before reading adjustments', async () => {
    const { service, scope, prisma } = setup();
    scope.companyWhereFor.mockRejectedValue(new Error('Company denied'));
    await expect(service.findAll({}, {} as any)).rejects.toThrow('Company denied');
    expect(prisma.stockAdjustment.findMany).not.toHaveBeenCalled();
    expect(prisma.stockAdjustment.count).not.toHaveBeenCalled();
  });
  it('rejects invalid and reversed dates without record reads, retaining legacy location filtering', async () => {
    const { service, prisma } = setup();
    for (const query of [
      { dateFrom: 'invalid' },
      { dateTo: 'invalid' },
      { dateFrom: '2026-10-01', dateTo: '2026-09-01' },
    ])
      await expect(service.findAll(query, {} as any)).rejects.toThrow('valid date range');
    expect(prisma.stockAdjustment.findMany).not.toHaveBeenCalled();
    await service.findAll({ locationId: 'legacy' }, {} as any);
    expect(prisma.stockAdjustment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ branchId: 'legacy' }) }),
    );
  });
});
