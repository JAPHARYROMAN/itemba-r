import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { StockDamageService } from './stock-damage.service';

/**
 * Focused coverage for StockDamageService.post GL posting.
 *
 * The regression under test (GL follow-up): post() must post the EXACT inventory
 * relief measured from the subledger (totalValue before - after the DAMAGE
 * movement) as the GL swing, NOT a re-derived min(qty*avgCost, totalValue). We
 * drive the two FOR UPDATE reads (before/after) via $queryRaw.mockResolvedValueOnce
 * and assert the JE credit to INVENTORY_ASSET equals the measured delta.
 */
function makeService(overrides: { damage?: any } = {}) {
  const damage = {
    id: 'dmg-1',
    damageNumber: 'DMG-2026-00001',
    companyId: 'company-1',
    productId: 'product-1',
    branchId: 'branch-1',
    unitId: 'unit-1',
    batchId: null,
    quantity: new Prisma.Decimal(10),
    status: 'APPROVED',
    ...overrides.damage,
  };

  const tx = {
    stockDamage: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(async ({ data }: any) => ({ ...damage, ...data })),
    },
    branch: {
      findFirst: jest.fn().mockResolvedValue({ divisionId: 'division-1' }),
    },
    productBatch: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    // before/after inventory_balances totalValue reads (FOR UPDATE). Each test
    // seeds these with mockResolvedValueOnce so the measured delta is explicit.
    $queryRaw: jest.fn(),
  } as any;

  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    stockDamage: {
      findFirst: jest.fn().mockResolvedValue(damage),
    },
  } as any;

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const inventoryMovements = {
    createMovement: jest.fn().mockResolvedValue(undefined),
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const postingEngine = {
    postLines: jest.fn().mockResolvedValue({ id: 'je-1', journalNumber: 'JE-1' }),
  } as any;
  const accountResolver = {
    resolveMany: jest.fn(async (_companyId: string, roles: string[]) =>
      Object.fromEntries(
        roles.map((role) => [role, { id: `acct-${role}`, accountCode: role, accountName: role }]),
      ),
    ),
  } as any;

  const service = new StockDamageService(
    prisma,
    auditLogs,
    inventoryMovements,
    companyScope,
    postingEngine,
    accountResolver,
  );

  return { service, prisma, tx, inventoryMovements, postingEngine, accountResolver };
}

const user = { id: 'user-1' } as any;

/** Pull the two-legged JE lines out of the single postLines call. */
function legs(postLines: jest.Mock) {
  const call = postLines.mock.calls[0][0];
  return call.lines as Array<{ accountId: string; debit: any; credit: any }>;
}

describe('StockDamageService.post GL swing', () => {
  it('posts the EXACT measured relief (before - after), not a re-derived qty*avgCost', async () => {
    const { service, tx, postingEngine, inventoryMovements } = makeService();
    // Subledger: totalValue 1000.00 before the DAMAGE, 550.25 after.
    // Measured relief = 449.75. A naive min(qty*avgCost, totalValue) could differ.
    tx.$queryRaw
      .mockResolvedValueOnce([{ totalValue: new Prisma.Decimal('1000.00') }])
      .mockResolvedValueOnce([{ totalValue: new Prisma.Decimal('550.25') }]);

    await service.post('dmg-1', user);

    // Movement applied exactly once, between the two FOR UPDATE reads.
    expect(inventoryMovements.createMovement).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);

    const lines = legs(postingEngine.postLines);
    const expense = lines.find((l) => l.accountId === 'acct-GENERAL_EXPENSE')!;
    const inventory = lines.find((l) => l.accountId === 'acct-INVENTORY_ASSET')!;

    // CR INVENTORY_ASSET == measured subledger reduction (449.75), to the cent.
    expect(new Prisma.Decimal(inventory.credit).equals('449.75')).toBe(true);
    expect(new Prisma.Decimal(inventory.debit).equals(0)).toBe(true);
    // DR GENERAL_EXPENSE == same magnitude (balanced JE).
    expect(new Prisma.Decimal(expense.debit).equals('449.75')).toBe(true);
    expect(new Prisma.Decimal(expense.credit).equals(0)).toBe(true);
  });

  it('relieves the FULL remaining value when the DAMAGE zeroes the balance (after = 0)', async () => {
    // Edge case that the old min(qty*avg, totalValue) formula could under-relieve:
    // the movement forces totalValue to 0 when qty hits zero, so the true relief
    // is the ENTIRE existing value regardless of qty*avgCost.
    const { service, tx, postingEngine } = makeService();
    tx.$queryRaw
      .mockResolvedValueOnce([{ totalValue: new Prisma.Decimal('730.00') }])
      .mockResolvedValueOnce([{ totalValue: new Prisma.Decimal('0') }]);

    await service.post('dmg-1', user);

    const inventory = legs(postingEngine.postLines).find(
      (l) => l.accountId === 'acct-INVENTORY_ASSET',
    )!;
    expect(new Prisma.Decimal(inventory.credit).equals('730.00')).toBe(true);
  });

  it('skips the GL entry entirely when there is no cost basis (before == after)', async () => {
    const { service, tx, postingEngine, accountResolver } = makeService();
    tx.$queryRaw
      .mockResolvedValueOnce([{ totalValue: new Prisma.Decimal('0') }])
      .mockResolvedValueOnce([{ totalValue: new Prisma.Decimal('0') }]);

    await service.post('dmg-1', user);

    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(accountResolver.resolveMany).not.toHaveBeenCalled();
  });

  it('treats a missing balance row (no rows) as zero value on both reads', async () => {
    const { service, tx, postingEngine } = makeService();
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await service.post('dmg-1', user);

    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('reads the before-value BEFORE applying the movement and the after-value AFTER', async () => {
    const { service, tx, inventoryMovements } = makeService();
    const order: string[] = [];
    tx.$queryRaw
      .mockImplementationOnce(async () => {
        order.push('before');
        return [{ totalValue: new Prisma.Decimal('500.00') }];
      })
      .mockImplementationOnce(async () => {
        order.push('after');
        return [{ totalValue: new Prisma.Decimal('100.00') }];
      });
    inventoryMovements.createMovement.mockImplementation(async () => {
      order.push('movement');
    });

    await service.post('dmg-1', user);

    expect(order).toEqual(['before', 'movement', 'after']);
  });

  it('rejects posting a record that is not APPROVED', async () => {
    const { service } = makeService({ damage: { status: 'DRAFT' } });
    await expect(service.post('dmg-1', user)).rejects.toBeInstanceOf(BadRequestException);
  });
});
