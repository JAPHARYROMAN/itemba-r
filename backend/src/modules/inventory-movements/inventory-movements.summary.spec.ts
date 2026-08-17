import { InventoryMovementType } from '@prisma/client';
import { InventoryMovementsService } from './inventory-movements.service';

/**
 * Summary aggregate — register-wide stat cards.
 *
 * The summary endpoint groups movements by movementType and sums quantity +
 * totalCost over the SAME `where` as findAll, then folds the per-type rows into
 * direction-aware (inbound vs outbound) roll-ups. These tests pin the
 * direction classification, the Decimal-to-number coercion, and the net
 * quantity math so a future refactor cannot silently regress them.
 */

function makeService(opts: { grouped: any[]; totals: any; companyWhere?: any }) {
  const prisma = {
    inventoryMovement: {
      groupBy: jest.fn().mockResolvedValue(opts.grouped),
      aggregate: jest.fn().mockResolvedValue(opts.totals),
    },
  } as any;
  const auditLogs = { log: jest.fn() } as any;
  const codes = { next: jest.fn() } as any;
  const companyScope = {
    companyWhereFor: jest.fn().mockResolvedValue(opts.companyWhere ?? {}),
  } as any;
  const profit = {} as any;
  const service = new InventoryMovementsService(prisma, auditLogs, codes, companyScope, profit);
  return { service, prisma, companyScope };
}

const groupedRow = (
  movementType: InventoryMovementType,
  quantity: number,
  totalCost: number,
  count: number,
) => ({
  movementType,
  _sum: { quantity, totalCost },
  _count: { _all: count },
});

describe('InventoryMovementsService.summary', () => {
  const user = { id: 'user-1' } as any;

  it('classifies direction and rolls up inbound/outbound + net quantity', async () => {
    const { service } = makeService({
      grouped: [
        groupedRow('PURCHASE_RECEIPT' as InventoryMovementType, 100, 500, 4),
        groupedRow('SALE_ISSUE' as InventoryMovementType, 30, 210, 6),
        groupedRow('PURCHASE_RETURN' as InventoryMovementType, 5, 25, 1),
      ],
      totals: { _sum: { quantity: 135, totalCost: 735 }, _count: { _all: 11 } },
    });

    const result = await service.summary({}, user);

    expect(result.totalMovements).toBe(11);
    expect(result.totalQuantity).toBe(135);
    expect(result.totalCost).toBe(735);
    // PURCHASE_RECEIPT is inbound; SALE_ISSUE + PURCHASE_RETURN are outbound.
    expect(result.inboundQuantity).toBe(100);
    expect(result.outboundQuantity).toBe(35);
    expect(result.netQuantity).toBe(65);
    expect(result.inboundCost).toBe(500);
    expect(result.outboundCost).toBe(235);

    const byType = Object.fromEntries(result.byType.map((r) => [r.movementType, r]));
    expect(byType['PURCHASE_RECEIPT'].direction).toBe('INBOUND');
    expect(byType['SALE_ISSUE'].direction).toBe('OUTBOUND');
    expect(byType['PURCHASE_RETURN'].direction).toBe('OUTBOUND');
    expect(byType['SALE_ISSUE'].count).toBe(6);
  });

  it('coerces null _sum aggregates to zero (empty register slice)', async () => {
    const { service } = makeService({
      grouped: [],
      totals: { _sum: { quantity: null, totalCost: null }, _count: { _all: 0 } },
    });

    const result = await service.summary({}, user);

    expect(result.totalMovements).toBe(0);
    expect(result.totalQuantity).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.netQuantity).toBe(0);
    expect(result.byType).toEqual([]);
  });

  it('groups + aggregates over the same company-scoped where as findAll', async () => {
    const companyWhere = { companyId: 'company-A' };
    const { service, prisma, companyScope } = makeService({
      grouped: [groupedRow('PURCHASE_RECEIPT' as InventoryMovementType, 10, 40, 1)],
      totals: { _sum: { quantity: 10, totalCost: 40 }, _count: { _all: 1 } },
      companyWhere,
    });

    await service.summary(
      {
        companyId: 'company-A',
        divisionId: 'division-1',
        branchId: 'branch-1',
        productId: 'product-9',
        movementType: 'PURCHASE_RECEIPT' as InventoryMovementType,
      },
      user,
    );

    expect(companyScope.companyWhereFor).toHaveBeenCalledWith(user, 'company-A');
    const expectedWhere = {
      companyId: 'company-A',
      divisionId: 'division-1',
      branchId: 'branch-1',
      productId: 'product-9',
      movementType: 'PURCHASE_RECEIPT',
    };
    expect(prisma.inventoryMovement.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['movementType'], where: expectedWhere }),
    );
    expect(prisma.inventoryMovement.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
  });
});
