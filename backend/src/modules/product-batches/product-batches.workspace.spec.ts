import { ProductBatchesService } from './product-batches.service';

const user = {
  id: 'user',
  companyId: 'company',
  roleScopes: ['COMPANY'],
  roles: ['Company User'],
  permissions: ['product_batches.view'],
  companyAccess: [],
} as any;
function setup() {
  const productBatch = {
    findMany: jest.fn().mockResolvedValue([{ id: 'batch' }]),
    count: jest.fn().mockResolvedValue(121),
  };
  const service = new ProductBatchesService({ productBatch } as any, {} as any, {} as any);
  return { productBatch, service };
}
describe('Batch workspace register', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-09-18T12:00:00Z')));
  afterEach(() => jest.useRealTimers());
  it('paginates beyond the old first hundred with matching counts and readable relation fields', async () => {
    const { service, productBatch } = setup();
    const result = await service.findAll(
      {
        companyId: 'company',
        branchId: 'branch',
        divisionId: 'division',
        productId: 'product',
        search: ' Milk ',
        status: 'QUARANTINED',
        page: 6,
        limit: 20,
      },
      user,
    );
    expect(result).toEqual({ data: [{ id: 'batch' }], total: 121, page: 6, limit: 20 });
    const request = productBatch.findMany.mock.calls[0][0];
    expect(request.where).toMatchObject({
      deletedAt: null,
      companyId: 'company',
      branchId: 'branch',
      branch: { divisionId: 'division' },
      productId: 'product',
      status: 'QUARANTINED',
    });
    expect(request.where.OR).toContainEqual({
      supplier: { name: { contains: 'Milk', mode: 'insensitive' } },
    });
    expect(request.where.OR).toContainEqual({
      product: { barcode: { contains: 'Milk', mode: 'insensitive' } },
    });
    expect(request).toMatchObject({
      skip: 100,
      take: 20,
      include: {
        product: { select: { name: true } },
        supplier: { select: { name: true } },
        unit: { select: { symbol: true } },
        branch: { select: { divisionId: true } },
      },
    });
    expect(productBatch.count).toHaveBeenCalledWith({ where: request.where });
  });
  it('retains branch/product/status filters and the inclusive active 30-day rule together', async () => {
    const { service, productBatch } = setup();
    await service.findAll(
      {
        companyId: 'company',
        productId: 'product',
        branchId: 'branch',
        status: 'DAMAGED',
        review: 'expiring',
      },
      user,
    );
    const request = productBatch.findMany.mock.calls[0][0];
    expect(request.where).toMatchObject({
      companyId: 'company',
      productId: 'product',
      branchId: 'branch',
      status: 'DAMAGED',
      AND: [{ status: 'ACTIVE' }],
      expiryDate: {
        gte: new Date('2026-09-18T12:00:00Z'),
        lte: new Date('2026-10-18T12:00:00Z'),
        not: null,
      },
    });
    expect(request.orderBy).toEqual([{ expiryDate: 'asc' }, { id: 'asc' }]);
    expect(productBatch.count).toHaveBeenCalledWith({ where: request.where });
  });
  it('preserves the strict past boundary and original expired status eligibility', async () => {
    const { service, productBatch } = setup();
    await service.findAll({ review: 'expired', divisionId: 'division' }, user);
    expect(productBatch.findMany.mock.calls[0][0].where).toMatchObject({
      companyId: { in: ['company'] },
      branch: { divisionId: 'division' },
      expiryDate: { lt: new Date('2026-09-18T12:00:00Z') },
      AND: [{ status: { in: ['ACTIVE', 'EXPIRED'] } }],
    });
  });
  it('rejects another company before reading or counting batches', async () => {
    const { service, productBatch } = setup();
    await expect(service.findAll({ companyId: 'other' }, user)).rejects.toThrow();
    expect(productBatch.findMany).not.toHaveBeenCalled();
    expect(productBatch.count).not.toHaveBeenCalled();
  });
});
