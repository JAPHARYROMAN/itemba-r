import { StockAdjustmentsService } from './stock-adjustments.service';
import { Prisma } from '@prisma/client';

function makeService() {
  const prisma = {
    mobilePosEnrollment: { findFirst: jest.fn().mockResolvedValue(null) },
    mobilePosBranchSetup: { findFirst: jest.fn().mockResolvedValue(null) },
    mobilePosTerminal: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    stockAdjustment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'sa-1', ...data, lines: [] })),
      findFirst: jest.fn(async () => ({
        id: 'sa-1',
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        status: 'APPROVED',
        approvedById: 'approver-1',
        approvedAt: new Date('2026-06-17T00:00:00.000Z'),
        postedAt: null,
        updatedAt: new Date('2026-10-13T12:00:00Z'),
        lines: [],
      })),
      update: jest.fn(async ({ data }: any) => ({ id: 'sa-1', companyId: 'company-1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'sa-1', companyId: 'company-1', status: 'PENDING_APPROVAL' }),
    },
    inventoryMovement: {
      count: jest.fn(async () => 0),
    },
    division: {
      findFirst: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    },
    branch: {
      findFirst: jest.fn(async () => ({
        divisionId: 'division-1',
        division: { companyId: 'company-1' },
      })),
    },
    product: {
      findMany: jest.fn(async () => [
        {
          id: 'product-1',
          companyId: 'company-1',
          baseUnitId: 'unit-1',
          trackInventory: true,
          productType: 'STOCK_ITEM',
          status: 'ACTIVE',
        },
      ]),
    },
    unitOfMeasure: {
      findMany: jest.fn(async () => [{ id: 'unit-1', companyId: 'company-1' }]),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    auditLog: { findFirst: jest.fn().mockResolvedValue(null) },
  } as any;
  prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
  const auditLogs = {
    log: jest.fn().mockResolvedValue(undefined),
    logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
  } as any;
  const inventoryMovements = { createMovement: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) } as any;
  const postingEngine = {
    postLines: jest.fn().mockResolvedValue({ id: 'je-1', journalNumber: 'JE-1' }),
  } as any;
  const accountResolver = {
    resolve: jest.fn(async (_companyId: string, role: string) => ({
      id: `acct-${role}`,
      accountCode: role,
      accountName: role,
    })),
  } as any;
  const service = new StockAdjustmentsService(
    prisma,
    auditLogs,
    inventoryMovements,
    companyScope,
    postingEngine,
    accountResolver,
    { assertCanAccessScope: jest.fn().mockResolvedValue(undefined) } as any,
  );
  return { service, prisma, auditLogs, postingEngine, accountResolver, inventoryMovements };
}

const user = { id: 'user-1', permissions: ['inventory.adjustments.create'] } as any;

describe('StockAdjustmentsService aliases', () => {
  it('normalizes legacy quantity aliases before saving adjustment lines', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValue([
      { quantityOnHand: new Prisma.Decimal(60), physicalRevision: 2 },
    ]);

    await service.create(
      {
        companyId: 'company-1',
        branchId: 'branch-1',
        reason: 'Stock take correction',
        lines: [
          {
            productId: 'product-1',
            systemQty: 60,
            countedQty: 30,
            unitId: 'unit-1',
          },
        ],
      } as any,
      user,
    );

    expect(prisma.stockAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: {
            create: [
              expect.objectContaining({
                systemQuantity: new Prisma.Decimal(60),
                countedQuantity: 30,
                varianceQuantity: new Prisma.Decimal(-30),
              }),
            ],
          },
        }),
      }),
    );
  });

  it('persists unit cost on positive stock adjustment lines', async () => {
    const { service, prisma } = makeService();

    await service.create(
      {
        companyId: 'company-1',
        branchId: 'branch-1',
        reason: 'Opening stock capture',
        lines: [
          {
            productId: 'product-1',
            systemQty: 0,
            countedQty: 20,
            unitId: 'unit-1',
            unitCost: 12500,
          },
        ],
      } as any,
      user,
    );

    expect(prisma.stockAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: {
            create: [
              expect.objectContaining({
                varianceQuantity: new Prisma.Decimal(20),
                unitCost: 12500,
              }),
            ],
          },
        }),
      }),
    );
  });
});

describe('Authoritative physical counts and submission', () => {
  const dto = {
    companyId: 'company-1',
    branchId: 'branch-1',
    reason: 'Count',
    lines: [{ productId: 'product-1', unitId: 'unit-1', countedQuantity: 8, expectedRevision: 4 }],
  };
  it('captures book stock rather than requiring a client book quantity', async () => {
    const { service, prisma, auditLogs } = makeService();
    prisma.$queryRaw.mockResolvedValue([
      { quantityOnHand: new Prisma.Decimal(10), physicalRevision: 4 },
    ]);
    await service.create(dto, user);
    const saved = prisma.stockAdjustment.create.mock.calls[0][0].data.lines.create[0];
    expect(saved.systemQuantity.toString()).toBe('10');
    expect(saved.varianceQuantity.toString()).toBe('-2');
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'STOCK_ADJUSTMENT_CREATE',
        metadata: {
          requestFingerprintSha256: expect.any(Array),
          capturedFingerprintSha256: expect.any(Array),
        },
      }),
    );
    expect(prisma.$queryRaw.mock.calls[0][0].strings.join('')).toContain('FROM products');
  });
  it('rejects stale revision even when quantity changed away and back', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValue([
      { quantityOnHand: new Prisma.Decimal(10), physicalRevision: 5 },
    ]);
    await expect(service.create(dto, user)).rejects.toThrow('Stock changed');
    expect(prisma.stockAdjustment.create).not.toHaveBeenCalled();
  });
  it('treats an absent tuple as zero/revision zero and enforces the base unit', async () => {
    const { service, prisma } = makeService();
    await service.create({ ...dto, lines: [{ ...dto.lines[0], expectedRevision: 0 }] }, user);
    expect(
      prisma.stockAdjustment.create.mock.calls[0][0].data.lines.create[0].systemQuantity.toString(),
    ).toBe('0');
    await expect(
      service.create({ ...dto, lines: [{ ...dto.lines[0], unitId: 'another-unit' }] }, user),
    ).rejects.toThrow('base unit');
  });
  it.each([
    { lines: [] },
    { lines: [{ productId: 'product-1', unitId: 'unit-1', countedQuantity: -1 }] },
    { lines: [dto.lines[0], dto.lines[0]] },
    { lines: [{ productId: 'product-1', unitId: 'unit-1', countedQuantity: 1.00001 }] },
  ])('rejects invalid count sets before writing', async ({ lines }) => {
    const { service, prisma } = makeService();
    await expect(service.create({ ...dto, lines }, user)).rejects.toThrow();
    expect(prisma.stockAdjustment.create).not.toHaveBeenCalled();
  });
  it('replays an identical key without recapturing later stock and rejects a changed payload', async () => {
    const { service, prisma, auditLogs } = makeService();
    const keyed = {
      ...dto,
      idempotencyKey: 'count-key',
      lines: [{ ...dto.lines[0], expectedRevision: 0 }],
    };
    prisma.stockAdjustment.findFirst.mockResolvedValue(null);
    await service.create(keyed, user);
    const metadata = auditLogs.logStrictInTransaction.mock.calls[0][1].metadata;
    prisma.stockAdjustment.findFirst.mockResolvedValue({
      id: 'sa-1',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      lines: [],
      reason: keyed.reason,
    });
    prisma.auditLog.findFirst.mockResolvedValue({ userId: user.id, metadata });
    prisma.$queryRaw.mockRejectedValue(new Error('Must not recapture stock'));
    expect((await service.create(keyed, user)).id).toBe('sa-1');
    await expect(service.create({ ...keyed, reason: 'Different count' }, user)).rejects.toThrow(
      'different stock count',
    );
    prisma.stockAdjustment.findFirst.mockResolvedValue({
      id: 'sa-1',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      reason: 'Edited elsewhere',
      lines: [],
    });
    await expect(service.create(keyed, user)).rejects.toThrow('different stock count');
    expect(prisma.stockAdjustment.create).toHaveBeenCalledTimes(1);
  });
  it('rolls mandatory CREATE audit failure into its transaction failure', async () => {
    const { service, auditLogs } = makeService();
    auditLogs.logStrictInTransaction.mockRejectedValue(new Error('strict audit unavailable'));
    await expect(
      service.create({ ...dto, lines: [{ ...dto.lines[0], expectedRevision: 0 }] }, user),
    ).rejects.toThrow('strict audit unavailable');
  });
  it('submits with a draft/version CAS and rejects stale or lost races', async () => {
    const { service, prisma, auditLogs } = makeService();
    const updatedAt = new Date('2026-10-13T12:00:00Z');
    prisma.stockAdjustment.findFirst.mockResolvedValue({
      ...dto,
      id: 'sa-1',
      status: 'DRAFT',
      updatedAt,
      divisionId: 'division-1',
    });
    await service.submit('sa-1', user, { expectedUpdatedAt: updatedAt.toISOString() });
    expect(prisma.stockAdjustment.updateMany).toHaveBeenCalledWith({
      where: { id: 'sa-1', deletedAt: null, status: 'DRAFT', updatedAt },
      data: { status: 'PENDING_APPROVAL' },
    });
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'STOCK_ADJUSTMENT_SUBMIT' }),
    );
    await expect(
      service.submit('sa-1', user, { expectedUpdatedAt: '2026-10-12T12:00:00Z' }),
    ).rejects.toThrow('changed');
    prisma.stockAdjustment.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.submit('sa-1', user)).rejects.toThrow('changed');
  });
});

describe('StockAdjustmentsService approval revert', () => {
  it('reverts an approved unposted adjustment back to draft and clears approval metadata', async () => {
    const { service, prisma } = makeService();

    await service.revertApproval('sa-1', user);

    expect(prisma.inventoryMovement.count).toHaveBeenCalledWith({
      where: {
        referenceType: 'StockAdjustment',
        referenceId: 'sa-1',
      },
    });
    expect(prisma.stockAdjustment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'sa-1',
        status: 'APPROVED',
        updatedAt: new Date('2026-10-13T12:00:00Z'),
        postedAt: null,
        deletedAt: null,
      },
      data: {
        status: 'DRAFT',
        approvedById: null,
        approvedAt: null,
      },
    });
  });

  it('blocks revert when inventory movements already exist', async () => {
    const { service, prisma } = makeService();
    prisma.inventoryMovement.count.mockResolvedValue(1);

    await expect(service.revertApproval('sa-1', user)).rejects.toThrow(
      'already has inventory movements',
    );
    expect(prisma.stockAdjustment.update).not.toHaveBeenCalled();
  });
});

describe('Stock adjustment transitions cannot overwrite a concurrent post', () => {
  it.each([
    { action: 'approve', status: 'PENDING_APPROVAL' },
    { action: 'reject', status: 'PENDING_APPROVAL' },
    { action: 'revertApproval', status: 'APPROVED' },
    { action: 'remove', status: 'DRAFT' },
  ])(
    'guards $action on the original status/version and unposted state',
    async ({ action, status }) => {
      const { service, prisma, auditLogs } = makeService();
      const updatedAt = new Date('2026-10-13T12:00:00Z');
      prisma.stockAdjustment.findFirst.mockResolvedValue({
        id: 'sa-1',
        companyId: 'company-1',
        branchId: 'branch-1',
        divisionId: 'division-1',
        status,
        updatedAt,
        postedAt: null,
        lines: [],
      });
      prisma.stockAdjustment.updateMany.mockResolvedValue({ count: 0 });
      const call =
        action === 'reject'
          ? service.reject('sa-1', { reason: 'Rejected after review' }, user)
          : (
              service[action as 'approve' | 'revertApproval' | 'remove'] as (
                id: string,
                actor: typeof user,
              ) => Promise<unknown>
            ).call(service, 'sa-1', user);
      await expect(call).rejects.toThrow('changed');
      expect(prisma.stockAdjustment.updateMany.mock.calls[0][0].where).toEqual({
        id: 'sa-1',
        status,
        updatedAt,
        postedAt: null,
        deletedAt: null,
      });
      expect(prisma.stockAdjustment.update).not.toHaveBeenCalled();
      expect(auditLogs.logStrictInTransaction).not.toHaveBeenCalled();
    },
  );
});

describe('StockAdjustmentsService post durability', () => {
  it.each([{ trackInventory: false }, { baseUnitId: 'changed-unit' }, { productType: 'SERVICE' }])(
    'rejects a changed current stock definition after locking and before posting',
    async (changed) => {
      const { service, prisma, inventoryMovements, auditLogs } = makeService();
      prisma.stockAdjustment.findFirst.mockResolvedValue({
        id: 'sa-1',
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        status: 'APPROVED',
        lines: [
          {
            productId: 'product-1',
            unitId: 'unit-1',
            systemQuantity: new Prisma.Decimal(0),
            countedQuantity: new Prisma.Decimal(5),
            varianceQuantity: new Prisma.Decimal(5),
          },
        ],
      });
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'product-1',
          baseUnitId: 'unit-1',
          trackInventory: true,
          productType: 'STOCK_ITEM',
          ...changed,
        },
      ]);
      await expect(service.post('sa-1', user)).rejects.toThrow('stock definition changed');
      expect(prisma.$queryRaw.mock.calls[0][0].strings.join('')).toContain('FROM products');
      expect(prisma.stockAdjustment.updateMany).not.toHaveBeenCalled();
      expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
      expect(auditLogs.logStrictInTransaction).not.toHaveBeenCalled();
    },
  );
  it('opens the posting transaction with an explicit long timeout, not Prisma 5s default', async () => {
    const { service, prisma, auditLogs } = makeService();
    // A count of a few hundred lines runs ~10 round-trips per line inside this
    // one transaction. On Prisma's 5s interactive default it dies with P2028
    // partway through, which rolls back correctly but leaves the adjustment at
    // APPROVED — a stranded, hand-postable orphan of exactly the shape the
    // Mobile POS Lite count wrapper exists to make impossible.
    const tx = {
      stockAdjustment: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({ id: 'sa-1', companyId: 'company-1', status: 'POSTED' })),
      },
    };
    prisma.$transaction = jest.fn(async (callback: any) => callback(tx));

    await service.post('sa-1', user);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 60_000 });
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'STOCK_ADJUSTMENT_POST',
        entityId: 'sa-1',
        companyId: 'company-1',
      }),
    );
  });

  it('fails the posting transaction when its mandatory audit append fails', async () => {
    const { service, prisma, auditLogs } = makeService();
    const failure = new Error('audit append unavailable');
    auditLogs.logStrictInTransaction.mockRejectedValueOnce(failure);
    const tx = {
      stockAdjustment: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({ id: 'sa-1', companyId: 'company-1', status: 'POSTED' })),
      },
    };
    prisma.$transaction = jest.fn(async (callback: any) => callback(tx));

    await expect(service.post('sa-1', user)).rejects.toBe(failure);
    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STOCK_ADJUSTMENT_POST' }),
    );
  });
});
