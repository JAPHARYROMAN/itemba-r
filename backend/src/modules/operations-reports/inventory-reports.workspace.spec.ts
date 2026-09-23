import { OperationsReportsService } from './operations-reports.service';
import { WestsidesReportsService } from '../westsides-reports/westsides-reports.service';
import { QueryInventoryReportDto, QueryReportDto } from '../westsides-reports/dto/query-report.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

const user = { id: 'operator' } as any;
const query = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
function setup() {
  const prisma = {
    productBatch: { findMany: jest.fn().mockResolvedValue([]) },
    stockDamage: { groupBy: jest.fn().mockResolvedValue([]) },
    product: {
      findMany: jest.fn().mockResolvedValue([{ id: 'water', productCode: 'WATER', name: 'Water' }]),
    },
    unitOfMeasure: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'bottle', name: 'Bottle', symbol: 'btl' },
        { id: 'case', name: 'Case', symbol: 'cs' },
      ]),
    },
    stockAdjustmentLine: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1040),
    },
    inventoryMovement: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1040),
    },
  };
  const scope = { companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company' }) };
  return {
    prisma,
    scope,
    operations: new OperationsReportsService(prisma as any, scope as any),
    westsides: new WestsidesReportsService(prisma as any, scope as any, {} as any),
  };
}
describe('Inventory report workspace contracts', () => {
  it('applies company, branch and division to batch snapshots and keeps company authorization', async () => {
    const { westsides, prisma, scope } = setup();
    await westsides.batchStatus(query, user);
    expect(scope.companyWhereFor).toHaveBeenCalledWith(user, 'company');
    expect(prisma.productBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company',
          deletedAt: null,
          branchId: 'branch',
          branch: { divisionId: 'division' },
        },
      }),
    );
    scope.companyWhereFor.mockRejectedValue(new Error('Company forbidden'));
    await expect(westsides.batchStatus(query, user)).rejects.toThrow('Company forbidden');
    expect(prisma.productBatch.findMany).toHaveBeenCalledTimes(1);
  });
  it('keeps unlike damage units separate, names groups and preserves missing estimates', async () => {
    const { westsides, prisma } = setup();
    prisma.stockDamage.groupBy.mockResolvedValue([
      {
        productId: 'water',
        unitId: 'bottle',
        damageType: 'BREAKAGE',
        status: 'APPROVED',
        _sum: { quantity: 2.0001, estimatedValue: null },
        _count: { id: 1, estimatedValue: 0 },
      },
      {
        productId: 'water',
        unitId: 'case',
        damageType: 'BREAKAGE',
        status: 'APPROVED',
        _sum: { quantity: 3, estimatedValue: 0 },
        _count: { id: 2, estimatedValue: 2 },
      },
    ] as never);
    const rows = await westsides.stockDamageReport(query, user);
    expect(prisma.stockDamage.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['damageType', 'status', 'productId', 'unitId'],
        where: {
          companyId: 'company',
          deletedAt: null,
          branchId: 'branch',
          branch: { divisionId: 'division' },
        },
      }),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        product: 'Water',
        unit: 'btl',
        quantity: 2.0001,
        estimatedValue: null,
      }),
      expect.objectContaining({ product: 'Water', unit: 'cs', quantity: 3, estimatedValue: 0 }),
    ]);
    expect(rows[0].missingEstimateCount).toBe(1);
    expect(rows[0]._reportMeta.readiness?.message).toContain('recorded estimates only');
  });
  it('supports complete paginated adjustment reports while preserving legacy array responses', async () => {
    const { operations, prisma } = setup();
    const result = await operations.getStockAdjustments(
      { ...query, page: '3', pageSize: '20' },
      user,
    );
    expect(result).toMatchObject({ rows: [], total: 1040, page: 3, pageSize: 20 });
    const request = prisma.stockAdjustmentLine.findMany.mock.calls[0][0];
    expect(request).toMatchObject({
      take: 20,
      skip: 40,
      where: { stockAdjustment: { ...query, deletedAt: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(prisma.stockAdjustmentLine.count).toHaveBeenCalledWith({ where: request.where });
    expect(await operations.getStockAdjustments(query, user)).toEqual([]);
    expect(prisma.stockAdjustmentLine.count).toHaveBeenCalledTimes(1);
    expect(prisma.stockAdjustmentLine.findMany.mock.calls[1][0]).not.toHaveProperty('skip');
  });
  it('uses stable movement ordering and consistent count scope for exports beyond one page', async () => {
    const { operations, prisma } = setup();
    expect(
      await operations.getInventoryMovements(
        'company',
        undefined,
        'branch',
        undefined,
        undefined,
        2,
        1000,
        'division',
        user,
      ),
    ).toMatchObject({ total: 1040, page: 2, pageSize: 1000 });
    expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: query,
        skip: 1000,
        take: 1000,
        orderBy: [{ movementDate: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(prisma.inventoryMovement.count).toHaveBeenCalledWith({ where: query });
  });
  it('accepts inventory division scope without accepting unsupported location fields or changing other reports', async () => {
    const valid = {
      companyId: 'b63a0242-7e3d-40ed-9093-9b166bb9f9aa',
      divisionId: 'b63a0242-7e3d-40ed-9093-9b166bb9f9ab',
    };
    expect(
      await validate(plainToInstance(QueryInventoryReportDto, valid), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toEqual([]);
    expect(
      (
        await validate(
          plainToInstance(QueryInventoryReportDto, { ...valid, locationId: 'branch' }),
          { whitelist: true, forbidNonWhitelisted: true },
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(plainToInstance(QueryReportDto, valid), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length,
    ).toBeGreaterThan(0);
  });
});
