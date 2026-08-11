import { BadRequestException } from '@nestjs/common';
import { ThreeWayMatchingService } from './three-way-matching.service';

function makeService(overrides: { existingMatch?: any; purchaseOrder?: any; grn?: any } = {}) {
  const purchaseOrder = {
    id: 'po-1',
    companyId: 'company-1',
    supplierId: 'supplier-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    lines: [{ productId: 'p1', quantity: 10, unitCost: 5, lineTotal: 50 }],
  };
  const supplierInvoice = {
    id: 'inv-1',
    companyId: 'company-1',
    supplierId: 'supplier-1',
    totalAmount: 50,
    lines: [
      {
        productId: 'p1',
        quantity: 10,
        unitPrice: 5,
        lineTotal: 50,
        discountAmount: 0,
        taxAmount: 0,
      },
    ],
  };

  const prisma = {
    threeWayMatch: {
      // First call is the duplicate guard (defaults to no duplicate), then the create.
      findFirst: jest.fn().mockResolvedValue(overrides.existingMatch ?? null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'twm-1', ...data })),
    },
    purchaseOrder: {
      findFirst: jest.fn().mockResolvedValue(overrides.purchaseOrder ?? purchaseOrder),
    },
    supplierInvoice: { findFirst: jest.fn().mockResolvedValue(supplierInvoice) },
    goodsReceivedNote: { findFirst: jest.fn().mockResolvedValue(overrides.grn ?? null) },
  } as any;
  // create() now wraps the duplicate guard + compute + insert in one interactive
  // transaction; run the callback against the same mock client.
  prisma.$transaction = jest.fn().mockImplementation(async (fn: any) => fn(prisma));

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const accountResolver = { resolve: jest.fn() } as any;
  const postingEngine = { postLines: jest.fn() } as any;
  const codes = { next: jest.fn().mockResolvedValue('TWM-2026-000007') } as any;

  const service = new ThreeWayMatchingService(
    prisma,
    auditLogs,
    companyScope,
    accountResolver,
    postingEngine,
    codes,
  );

  return { service, prisma, codes, postingEngine };
}

const user = { id: 'user-1' } as any;
const dto = {
  matchNumber: 'CLIENT-SUPPLIED-999',
  companyId: 'company-1',
  purchaseOrderId: 'po-1',
  supplierInvoiceId: 'inv-1',
} as any;

describe('ThreeWayMatchingService.create', () => {
  it('server-generates matchNumber via codes.next and ignores the client field', async () => {
    const { service, prisma, codes } = makeService();

    const result = await service.create(dto, user);

    expect(codes.next).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ThreeWayMatch',
        companyId: 'company-1',
      }),
    );
    expect(prisma.threeWayMatch.create).toHaveBeenCalledTimes(1);
    const created = prisma.threeWayMatch.create.mock.calls[0][0].data;
    expect(created.matchNumber).toBe('TWM-2026-000007');
    expect(result.matchNumber).toBe('TWM-2026-000007');
  });

  it('rejects a second active match for the same supplier invoice', async () => {
    const { service, prisma, codes } = makeService({
      existingMatch: { id: 'twm-existing' },
    });

    await expect(service.create(dto, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.threeWayMatch.create).not.toHaveBeenCalled();
    expect(codes.next).not.toHaveBeenCalled();
  });

  it('runs the duplicate guard inside the create transaction (atomic check-then-create)', async () => {
    const { service, prisma } = makeService();

    await service.create(dto, user);

    // The whole create path is wrapped in a single interactive transaction so the
    // duplicate guard and the insert cannot be straddled by a concurrent create.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Duplicate guard scopes by company + supplier invoice and ran before create.
    expect(prisma.threeWayMatch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          supplierInvoiceId: 'inv-1',
          deletedAt: null,
        }),
      }),
    );
    const findOrder = prisma.threeWayMatch.findFirst.mock.invocationCallOrder[0];
    const createOrder = prisma.threeWayMatch.create.mock.invocationCallOrder[0];
    expect(findOrder).toBeLessThan(createOrder);
  });

  it('scopes the GRN by the invoice supplier and rejects a foreign-supplier GRN (finding #18)', async () => {
    // goodsReceivedNote.findFirst returns null when the GRN does not belong to the
    // invoice's supplier — the service must surface that as a BadRequest, not value
    // the match off an unrelated supplier's receipt.
    const { service, prisma } = makeService({ grn: null });
    const grnDto = { ...dto, goodsReceivedNoteId: 'grn-foreign' } as any;

    await expect(service.create(grnDto, user)).rejects.toBeInstanceOf(BadRequestException);

    // The GRN lookup must be scoped by supplierId (mirrors the authoritative matcher).
    expect(prisma.goodsReceivedNote.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'grn-foreign',
          companyId: 'company-1',
          supplierId: 'supplier-1',
          deletedAt: null,
        }),
      }),
    );
    expect(prisma.threeWayMatch.create).not.toHaveBeenCalled();
  });

  it('rejects when the PO belongs to a different supplier than the invoice (finding #18)', async () => {
    const { service, prisma } = makeService({
      purchaseOrder: {
        id: 'po-1',
        companyId: 'company-1',
        supplierId: 'supplier-OTHER',
        lines: [{ productId: 'p1', quantity: 10, unitCost: 5, lineTotal: 50 }],
      },
    });

    await expect(service.create(dto, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.threeWayMatch.create).not.toHaveBeenCalled();
  });

  it('keeps the computed variance intact (MATCHED with zero variance for an equal invoice)', async () => {
    const { service, prisma } = makeService();

    await service.create(dto, user);

    const created = prisma.threeWayMatch.create.mock.calls[0][0].data;
    expect(created.matchStatus).toBe('MATCHED');
    expect(Number(created.quantityVariance)).toBe(0);
    expect(Number(created.amountVariance)).toBe(0);
  });
});

describe('ThreeWayMatchingService.approve', () => {
  it('approves a variance match WITHOUT posting a journal entry (avoids AP double-count)', async () => {
    const { service, prisma, postingEngine } = makeService();
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'twm-1',
      companyId: 'company-1',
      matchStatus: 'VARIANCE',
      approvedAt: null,
      supplierInvoiceId: 'inv-1',
      purchaseOrderId: 'po-1',
      goodsReceivedNoteId: null,
      amountVariance: 100,
      matchDate: new Date('2026-01-15T00:00:00.000Z'),
    } as any);
    const tx = {
      threeWayMatch: {
        update: jest.fn().mockResolvedValue({ id: 'twm-1', approvedAt: new Date() }),
      },
    };
    prisma.$transaction = jest.fn().mockImplementation(async (fn: any) => fn(tx));

    await service.approve('twm-1', user);

    // The match is approved...
    expect(tx.threeWayMatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'twm-1' },
        data: expect.objectContaining({ approvedAt: expect.any(Date) }),
      }),
    );
    // ...but the mis-modeled variance JE (which double-counted AP against the
    // supplier-invoice payable JE, and posted the wrong direction for an
    // under-charge) must NOT be posted.
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });
});
