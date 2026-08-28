import { ProductBatchesService } from './product-batches.service';

const user = {
  id: 'user-1',
  email: 'user@example.com',
  roles: ['Company User'],
  roleScopes: ['COMPANY'],
  permissions: ['product_batches.view'],
  companyId: 'company-1',
  companyAccess: [],
} as any;

function makeService() {
  const productBatch = {
    findMany: jest.fn(),
  };
  const prisma = { productBatch } as any;
  const service = new ProductBatchesService(prisma, { log: jest.fn() } as any, {} as any);
  return { service, productBatch };
}

describe('ProductBatchesService date filters', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses a closed 30-day window starting at the same deterministic instant', async () => {
    const { service, productBatch } = makeService();
    productBatch.findMany.mockResolvedValue([]);

    await service.findExpiring('company-1', user);

    expect(productBatch.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        expiryDate: {
          gte: new Date('2026-08-26T12:00:00.000Z'),
          lte: new Date('2026-09-25T12:00:00.000Z'),
          not: null,
        },
        deletedAt: null,
        companyId: 'company-1',
      },
      orderBy: { expiryDate: 'asc' },
    });
  });

  it('excludes expired and beyond-30-day rows while retaining both window boundaries', async () => {
    const { service, productBatch } = makeService();
    const rows = [
      { id: 'expired', expiryDate: new Date('2026-08-26T11:59:59.999Z') },
      { id: 'starts-now', expiryDate: new Date('2026-08-26T12:00:00.000Z') },
      { id: 'inside-window', expiryDate: new Date('2026-09-01T00:00:00.000Z') },
      { id: 'at-cutoff', expiryDate: new Date('2026-09-25T12:00:00.000Z') },
      { id: 'beyond-cutoff', expiryDate: new Date('2026-09-25T12:00:00.001Z') },
    ];
    productBatch.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        rows.filter(
          (row) => row.expiryDate >= where.expiryDate.gte && row.expiryDate <= where.expiryDate.lte,
        ),
      ),
    );

    const result = await service.findExpiring('company-1', user);

    expect(result.map((row: { id: string }) => row.id)).toEqual([
      'starts-now',
      'inside-window',
      'at-cutoff',
    ]);
  });

  it('findExpired uses a strict past-date filter and retains company scope', async () => {
    const { service, productBatch } = makeService();
    productBatch.findMany.mockResolvedValue([]);

    await service.findExpired('company-1', user);

    expect(productBatch.findMany).toHaveBeenCalledWith({
      where: {
        expiryDate: { lt: new Date('2026-08-26T12:00:00.000Z') },
        status: { in: ['ACTIVE', 'EXPIRED'] },
        deletedAt: null,
        companyId: 'company-1',
      },
      orderBy: { expiryDate: 'asc' },
    });
  });
});
