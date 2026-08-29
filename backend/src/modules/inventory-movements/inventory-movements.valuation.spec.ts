import { BadRequestException } from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
import { InventoryMovementsService } from './inventory-movements.service';

/**
 * WAC valuation + reserved-stock guard regression (audit findings #3, #13, #25).
 *
 * #3  — outbound must relieve totalValue ADDITIVELY (existing total minus
 *       quantity * averageCost), never via a multiplicative newQty * averageCost
 *       recompute that can INCREASE value once the qty*avg invariant is broken.
 * #13 — all WAC math is done in Prisma.Decimal and written into the Decimal
 *       columns, so successive movements do not accumulate IEEE-754 drift.
 * #25 — the reserved-availability guard applies to SALE_ISSUE only; other
 *       outbound types (DAMAGE, WASTAGE, ADJUSTMENT_OUT, TRANSFER_OUT, ...) may
 *       draw against on-hand even when stock is reserved.
 *
 * The tests drive createMovement with an injected transaction client so the
 * private applyMovementToBalance path runs end-to-end and we can capture the
 * exact data written to inventoryBalance.update.
 */

type BalanceRow = {
  id: string;
  quantityOnHand: Prisma.Decimal;
  quantityReserved: Prisma.Decimal;
  averageCost: Prisma.Decimal;
  totalValue: Prisma.Decimal;
};

function makeService() {
  const prisma = { $transaction: jest.fn() } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const codes = { next: jest.fn().mockResolvedValue('IM-1') } as any;
  const companyScope = {
    companyWhereFor: jest.fn().mockResolvedValue({}),
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const profit = {
    assertInventoryMovementHasCost: jest.fn().mockResolvedValue(undefined),
  } as any;
  const service = new InventoryMovementsService(prisma, auditLogs, codes, companyScope, profit);
  return { service, auditLogs };
}

/**
 * Build a transaction-client mock seeded with a single balance row. The
 * inventoryBalance.update call captures the written data; $queryRaw (the
 * FOR UPDATE lock) returns the seeded row.
 */
function makeTx(balance: BalanceRow) {
  const updateCalls: any[] = [];
  const tx: any = {
    branch: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'branch-1',
        code: 'B1',
        name: 'Branch 1',
        isActive: true,
        divisionId: 'div-1',
        division: { companyId: 'company-A' },
      }),
    },
    product: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'product-1',
        companyId: 'company-A',
        name: 'Product 1',
      }),
    },
    unitOfMeasure: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'unit-1',
        companyId: 'company-A',
        name: 'Each',
        status: 'ACTIVE',
      }),
    },
    inventoryMovement: {
      create: jest.fn().mockImplementation(({ data }: any) => ({
        id: 'mov-1',
        ...data,
        quantity: new Prisma.Decimal(data.quantity),
        unitCost: data.unitCost != null ? new Prisma.Decimal(data.unitCost) : null,
      })),
    },
    inventoryBalance: {
      upsert: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockImplementation((args: any) => {
        updateCalls.push(args);
        return args;
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([balance]),
  };
  return { tx, updateCalls };
}

const base = {
  companyId: 'company-A',
  productId: 'product-1',
  branchId: 'branch-1',
  unitId: 'unit-1',
  movementDate: new Date('2026-05-01'),
  createdById: 'user-1',
};

function row(over: Partial<BalanceRow> = {}): BalanceRow {
  return {
    id: 'bal-1',
    quantityOnHand: new Prisma.Decimal(0),
    quantityReserved: new Prisma.Decimal(0),
    averageCost: new Prisma.Decimal(0),
    totalValue: new Prisma.Decimal(0),
    ...over,
  };
}

describe('InventoryMovementsService WAC valuation (#3, #13)', () => {
  it('relieves outbound totalValue ADDITIVELY (does not increase value on outbound)', async () => {
    // Reproduces the finding scenario: qty=10, averageCost=8, but totalValue is
    // only 40 (invariant broken by a prior cost-less inbound). A SALE_ISSUE of 4
    // must give 40 - 4*8 = 8, NOT the multiplicative 6*8 = 48.
    const { service } = makeService();
    const { tx, updateCalls } = makeTx(
      row({
        quantityOnHand: new Prisma.Decimal(10),
        averageCost: new Prisma.Decimal(8),
        totalValue: new Prisma.Decimal(40),
      }),
    );

    await service.createMovement({
      ...base,
      quantity: 4,
      movementType: 'SALE_ISSUE' as InventoryMovementType,
      tx,
    });

    const written = updateCalls[0].data;
    expect(Number(written.quantityOnHand)).toBe(6);
    expect(Number(written.totalValue)).toBe(8); // additive, not 48
    expect(Number(written.averageCost)).toBe(8); // average unchanged on outbound
  });

  it('floors outbound totalValue at zero and zeroes value when quantity hits zero', async () => {
    const { service } = makeService();
    const { tx, updateCalls } = makeTx(
      row({
        quantityOnHand: new Prisma.Decimal(5),
        averageCost: new Prisma.Decimal(8),
        totalValue: new Prisma.Decimal(40),
      }),
    );

    await service.createMovement({
      ...base,
      quantity: 5,
      movementType: 'SALE_ISSUE' as InventoryMovementType,
      tx,
    });

    const written = updateCalls[0].data;
    expect(Number(written.quantityOnHand)).toBe(0);
    expect(Number(written.totalValue)).toBe(0);
  });

  it('rolls cost-bearing inbound into the running average additively (Decimal-safe)', async () => {
    const { service } = makeService();
    const { tx, updateCalls } = makeTx(
      row({
        quantityOnHand: new Prisma.Decimal(5),
        averageCost: new Prisma.Decimal(8),
        totalValue: new Prisma.Decimal(40),
      }),
    );

    await service.createMovement({
      ...base,
      quantity: 5,
      unitCost: 12,
      movementType: 'PURCHASE_RECEIPT' as InventoryMovementType,
      tx,
    });

    const written = updateCalls[0].data;
    expect(Number(written.quantityOnHand)).toBe(10);
    expect(Number(written.totalValue)).toBe(100); // 40 + 5*12, additive
    expect(Number(written.averageCost)).toBe(10); // 100 / 10
  });

  it('holds totalValue/averageCost on a cost-less inbound', async () => {
    const { service } = makeService();
    const { tx, updateCalls } = makeTx(
      row({
        quantityOnHand: new Prisma.Decimal(5),
        averageCost: new Prisma.Decimal(8),
        totalValue: new Prisma.Decimal(40),
      }),
    );

    await service.createMovement({
      ...base,
      quantity: 5,
      movementType: 'PURCHASE_RECEIPT' as InventoryMovementType, // no unitCost
      tx,
    });

    const written = updateCalls[0].data;
    expect(Number(written.quantityOnHand)).toBe(10);
    expect(Number(written.totalValue)).toBe(40); // held
    expect(Number(written.averageCost)).toBe(8); // held
  });

  it('writes Prisma.Decimal instances (not raw floats) into the balance columns', async () => {
    const { service } = makeService();
    const { tx, updateCalls } = makeTx(
      row({
        quantityOnHand: new Prisma.Decimal(5),
        averageCost: new Prisma.Decimal(8),
        totalValue: new Prisma.Decimal(40),
      }),
    );

    await service.createMovement({
      ...base,
      quantity: 4,
      movementType: 'SALE_ISSUE' as InventoryMovementType,
      tx,
    });

    const written = updateCalls[0].data;
    expect(Prisma.Decimal.isDecimal(written.totalValue)).toBe(true);
    expect(Prisma.Decimal.isDecimal(written.averageCost)).toBe(true);
  });
});

describe('InventoryMovementsService reserved-stock guard (#25)', () => {
  it('blocks a SALE_ISSUE that draws against reserved stock', async () => {
    const { service } = makeService();
    const { tx } = makeTx(
      row({
        quantityOnHand: new Prisma.Decimal(10),
        quantityReserved: new Prisma.Decimal(10),
        averageCost: new Prisma.Decimal(5),
        totalValue: new Prisma.Decimal(50),
      }),
    );

    await expect(
      service.createMovement({
        ...base,
        quantity: 5,
        movementType: 'SALE_ISSUE' as InventoryMovementType,
        tx,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a DAMAGE movement against reserved stock when on-hand is sufficient', async () => {
    const { service } = makeService();
    const { tx, updateCalls } = makeTx(
      row({
        quantityOnHand: new Prisma.Decimal(10),
        quantityReserved: new Prisma.Decimal(10),
        averageCost: new Prisma.Decimal(5),
        totalValue: new Prisma.Decimal(50),
      }),
    );

    await service.createMovement({
      ...base,
      quantity: 5,
      movementType: 'DAMAGE' as InventoryMovementType,
      tx,
    });

    const written = updateCalls[0].data;
    expect(Number(written.quantityOnHand)).toBe(5);
    expect(Number(written.totalValue)).toBe(25); // 50 - 5*5, additive relief
  });

  it('allows ADJUSTMENT_OUT / TRANSFER_OUT against reserved stock but still enforces negative-stock', async () => {
    const { service } = makeService();
    const { tx } = makeTx(
      row({
        quantityOnHand: new Prisma.Decimal(3),
        quantityReserved: new Prisma.Decimal(3),
        averageCost: new Prisma.Decimal(5),
        totalValue: new Prisma.Decimal(15),
      }),
    );

    // 3 on hand, request 5 -> newQty negative -> still rejected by the
    // negative-stock guard even though it is not a SALE_ISSUE.
    await expect(
      service.createMovement({
        ...base,
        quantity: 5,
        movementType: 'ADJUSTMENT_OUT' as InventoryMovementType,
        tx,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('InventoryMovementsService negative-stock bypass for compensating movements', () => {
  // A void that unwinds a prior inbound (e.g. a credit-note return restock)
  // must post its compensating ADJUSTMENT_OUT even when interim sales already
  // consumed the restocked units — otherwise the reversal (and the whole void
  // transaction it belongs to) becomes permanently impossible. The bypass is
  // explicit opt-in per call; nothing changes for ordinary callers.
  it('allows a compensating ADJUSTMENT_OUT to drive on-hand negative when allowNegativeOnHand is set', async () => {
    const { service } = makeService();
    // Restock +3 happened at issue time, then the 3 units were re-sold: on-hand 0.
    const { tx, updateCalls } = makeTx(
      row({
        quantityOnHand: new Prisma.Decimal(0),
        quantityReserved: new Prisma.Decimal(0),
        averageCost: new Prisma.Decimal(5),
        totalValue: new Prisma.Decimal(0),
      }),
    );

    await service.createMovement({
      ...base,
      quantity: 3,
      movementType: 'ADJUSTMENT_OUT' as InventoryMovementType,
      allowNegativeOnHand: true,
      tx,
    });

    const written = updateCalls[0].data;
    // The truthful position: the compensated restock never happened, so the
    // interim sale was the over-issue — on-hand goes negative.
    expect(Number(written.quantityOnHand)).toBe(-3);
    // Value is floored at zero once quantity is non-positive.
    expect(Number(written.totalValue)).toBe(0);
  });

  it('still blocks the same movement without the flag (guard intact by default)', async () => {
    const { service } = makeService();
    const { tx } = makeTx(
      row({
        quantityOnHand: new Prisma.Decimal(0),
        averageCost: new Prisma.Decimal(5),
        totalValue: new Prisma.Decimal(0),
      }),
    );

    await expect(
      service.createMovement({
        ...base,
        quantity: 3,
        movementType: 'ADJUSTMENT_OUT' as InventoryMovementType,
        tx,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not leak allowNegativeOnHand into the persisted movement row', async () => {
    const { service } = makeService();
    const { tx } = makeTx(
      row({
        quantityOnHand: new Prisma.Decimal(0),
        averageCost: new Prisma.Decimal(5),
        totalValue: new Prisma.Decimal(0),
      }),
    );

    await service.createMovement({
      ...base,
      quantity: 3,
      movementType: 'ADJUSTMENT_OUT' as InventoryMovementType,
      allowNegativeOnHand: true,
      tx,
    });

    const createArgs = (tx.inventoryMovement.create as jest.Mock).mock.calls[0][0];
    expect(createArgs.data).not.toHaveProperty('allowNegativeOnHand');
  });
});
