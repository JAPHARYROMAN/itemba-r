import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { MobilePosLiteService } from './mobile-pos-lite.service';
import { MobilePosLiteController } from './mobile-pos-lite.controller';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';

const DEVICE_SECRET = 'device-secret-device-secret-0001';
const TERMINAL_CODE = 'MPL-TEST0001';
const IDEMPOTENCY_KEY = 'offline-purchase-key-0001';
const COUNT_KEY = 'offline-count-key-000001';

function repUser(): AuthUser {
  return {
    id: 'rep-1',
    email: 'rep@example.com',
    roles: [],
    permissions: ['mobile_pos_lite.use', 'mobile_pos_lite.purchase'],
    companyId: 'company-1',
    companyAccess: [],
  };
}

function terminalRow() {
  return {
    id: 'terminal-1',
    terminalCode: TERMINAL_CODE,
    name: 'Counter 1',
    status: 'ACTIVE',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    assignedUserId: 'rep-1',
    deviceSecretHash: createHash('sha256').update(DEVICE_SECRET).digest('hex'),
    configVersion: 1,
    creditEnabled: false,
    offlineCashEnabled: true,
    company: { id: 'company-1', name: 'Company', code: 'CO' },
    division: { id: 'division-1', name: 'Division', code: 'DV' },
    branch: { id: 'branch-1', name: 'Branch', code: 'BR' },
    assignedUser: { id: 'rep-1', fullName: 'Rep One', status: 'ACTIVE' },
    salesperson: { id: 'employee-1', fullName: 'Rep One', employeeCode: 'EMP-1' },
    generalCustomer: { id: 'customer-1', name: 'Walk-in', customerCode: 'CUST-1' },
    paymentMethods: [],
  };
}

function stockProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    name: 'Maize Flour',
    baseUnitId: 'unit-1',
    productType: 'FINISHED_GOODS',
    trackInventory: true,
    defaultPurchasePrice: '1500',
    productFamily: null,
    ...overrides,
  };
}

function chainOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    supplierId: 'supplier-1',
    status: 'CONFIRMED',
    purchaseOrderNumber: 'PO-2026-000001',
    totalAmount: '6000',
    lines: [{ productId: 'product-1', unitId: 'unit-1', quantity: '4', unitCost: '1500' }],
    ...overrides,
  };
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/**
 * What the company-scoped unique index raises when the idempotency key was
 * already claimed by another request — the whole point of the stamp: the loser
 * of a create race is chosen by the database, not by which of two reads ran
 * first.
 */
function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

/** Row shape the count chain reads back from a StockAdjustment (spec-inventory §1.2). */
function countAdjustment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sa-1',
    companyId: 'company-1',
    status: 'DRAFT',
    adjustmentNumber: 'SA-2026-ABC123',
    // The capture's age. post() applies the variance frozen at create, so the
    // wrapper bounds how old that freeze may be before it will drive it
    // (STOCK_COUNT_MAX_CAPTURE_AGE_HOURS); a fresh row is the ordinary case.
    createdAt: hoursAgo(0),
    lines: [
      { productId: 'product-1', systemQuantity: '7', countedQuantity: '5', varianceQuantity: '-2' },
    ],
    ...overrides,
  };
}

function makeService() {
  const prisma: any = {
    mobilePosTerminal: {
      findFirst: jest.fn().mockResolvedValue(terminalRow()),
      update: jest.fn().mockResolvedValue({}),
    },
    supplier: {
      findFirst: jest.fn().mockResolvedValue({ id: 'supplier-1' }),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([stockProduct()]),
    },
    inventoryBalance: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    purchaseOrder: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([{ id: 'po-1' }]),
      // The idempotency stamp: the create path claims the key on the row it
      // just made, and the company-scoped unique index — not a read — decides
      // who owns it. Resolving means "we own this key".
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    goodsReceivedNote: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    stockAdjustment: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([{ id: 'sa-1' }]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // The evidence the post-failure path reads: post() writes every movement it
    // applies inside the same transaction that claims APPROVED -> POSTED, so
    // zero rows here proves nothing committed (default for a rolled-back post).
    inventoryMovement: {
      count: jest.fn().mockResolvedValue(0),
    },
    documentNumberSequence: {
      findFirst: jest.fn().mockResolvedValue({ id: 'seq-1' }),
      create: jest.fn().mockResolvedValue({}),
    },
    customer: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    salesOrder: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const companyScope: any = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    assertGroupScoped: jest.fn(),
  };
  const auditLogs: any = { log: jest.fn().mockResolvedValue(undefined) };
  const salesOrders: any = {
    mobilePosLiteQuickSale: jest.fn().mockResolvedValue({ id: 'so-1' }),
  };
  const purchaseOrders: any = {
    create: jest.fn().mockResolvedValue(chainOrder({ status: 'DRAFT' })),
    confirm: jest.fn().mockResolvedValue(chainOrder()),
  };
  const goodsReceivedNotes: any = {
    create: jest
      .fn()
      .mockResolvedValue({ id: 'grn-1', status: 'DRAFT', grnNumber: 'GRN-2026-000001' }),
    approve: jest.fn().mockResolvedValue({ id: 'grn-1', status: 'APPROVED' }),
    post: jest.fn().mockResolvedValue({ id: 'grn-1', status: 'POSTED' }),
  };
  const codes: any = { next: jest.fn().mockResolvedValue('GRN-2026-000001') };
  const generatedDocuments: any = {
    renderLetterheadPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
  };
  const stockAdjustments: any = {
    create: jest.fn().mockResolvedValue(countAdjustment()),
    submit: jest.fn().mockResolvedValue(countAdjustment({ status: 'PENDING_APPROVAL' })),
    approve: jest.fn().mockResolvedValue(countAdjustment({ status: 'APPROVED' })),
    post: jest.fn().mockResolvedValue(countAdjustment({ status: 'POSTED' })),
  };

  const service = new MobilePosLiteService(
    prisma,
    companyScope,
    auditLogs,
    salesOrders,
    purchaseOrders,
    goodsReceivedNotes,
    codes,
    generatedDocuments,
    stockAdjustments,
  );

  return {
    service,
    prisma,
    salesOrders,
    purchaseOrders,
    goodsReceivedNotes,
    codes,
    auditLogs,
    generatedDocuments,
    stockAdjustments,
  };
}

function purchaseDto(overrides: Record<string, unknown> = {}) {
  return {
    supplierId: 'supplier-1',
    idempotencyKey: IDEMPOTENCY_KEY,
    lines: [{ productId: 'product-1', quantity: 4 }],
    ...overrides,
  } as any;
}

describe('MobilePosLiteService createPurchase', () => {
  it('runs the full PO -> GRN chain and defaults the unit cost from the product', async () => {
    const { service, prisma, purchaseOrders, goodsReceivedNotes } = makeService();

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(purchaseOrders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        supplierId: 'supplier-1',
        purchaseType: 'STOCK_PURCHASE',
        notes: expect.stringContaining(`[MPL-PURCHASE:${IDEMPOTENCY_KEY}]`),
        lines: [
          expect.objectContaining({
            productId: 'product-1',
            quantity: 4,
            unitId: 'unit-1',
            unitCost: 1500,
          }),
        ],
      }),
      expect.objectContaining({ id: 'rep-1' }),
    );
    expect(purchaseOrders.confirm).toHaveBeenCalledWith('po-1', expect.anything());
    expect(goodsReceivedNotes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        purchaseOrderId: 'po-1',
        supplierId: 'supplier-1',
        grnNumber: 'GRN-2026-000001',
        lines: [
          expect.objectContaining({
            productId: 'product-1',
            receivedQuantity: 4,
            acceptedQuantity: 4,
            rejectedQuantity: 0,
            unitCost: 1500,
          }),
        ],
      }),
      expect.anything(),
    );
    expect(goodsReceivedNotes.approve).toHaveBeenCalledWith('grn-1', expect.anything());
    expect(goodsReceivedNotes.post).toHaveBeenCalledWith('grn-1', expect.anything());
    expect(prisma.mobilePosTerminal.update).toHaveBeenCalled();
    expect(result).toEqual({
      id: 'po-1',
      purchaseOrderNumber: 'PO-2026-000001',
      grnNumber: 'GRN-2026-000001',
      totalAmount: 6000,
    });
  });

  it('replays a completed purchase without creating or receiving anything again', async () => {
    const { service, prisma, purchaseOrders, goodsReceivedNotes } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'RECEIVED' }));
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      id: 'grn-1',
      status: 'POSTED',
      grnNumber: 'GRN-2026-000001',
    });

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(purchaseOrders.create).not.toHaveBeenCalled();
    expect(purchaseOrders.confirm).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.create).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.approve).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.post).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: 'po-1',
      purchaseOrderNumber: 'PO-2026-000001',
      grnNumber: 'GRN-2026-000001',
      totalAmount: 6000,
    });
  });

  it('resumes an interrupted chain from its recorded state (approved GRN -> post only)', async () => {
    const { service, prisma, purchaseOrders, goodsReceivedNotes } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'CONFIRMED' }));
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      id: 'grn-1',
      status: 'APPROVED',
      grnNumber: 'GRN-2026-000001',
    });

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(purchaseOrders.create).not.toHaveBeenCalled();
    expect(purchaseOrders.confirm).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.create).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.approve).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.post).toHaveBeenCalledWith('grn-1', expect.anything());
    expect(result.grnNumber).toBe('GRN-2026-000001');
  });

  it('never receives again when the PO was already received outside this flow', async () => {
    const { service, prisma, goodsReceivedNotes } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'RECEIVED' }));
    prisma.goodsReceivedNote.findFirst.mockResolvedValue(null);

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(goodsReceivedNotes.create).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.post).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ id: 'po-1', grnNumber: null, totalAmount: 6000 }),
    );
  });

  it('drops its duplicate DRAFT and resumes the winner when the unique index says it lost the create race', async () => {
    const { service, prisma, purchaseOrders } = makeService();
    purchaseOrders.create.mockResolvedValue(chainOrder({ id: 'po-2', status: 'DRAFT' }));
    // Pre-check misses, both requests create, and the DATABASE decides: our
    // stamp hits the company-scoped unique index the other request already
    // claimed. The read-ordered twin check this replaced could not decide it —
    // Postgres stamps createdAt at transaction START, so the request that
    // started earlier can commit later and each side can read a set in which it
    // is the winner, leaving two live orders under one key and one lorry
    // received twice.
    prisma.purchaseOrder.update.mockRejectedValue(uniqueViolation());
    prisma.purchaseOrder.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(chainOrder({ id: 'po-1', status: 'CONFIRMED' }));
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      id: 'grn-1',
      status: 'POSTED',
      grnNumber: 'GRN-2026-000001',
    });

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po-2' },
      data: { idempotencyKey: IDEMPOTENCY_KEY },
    });
    expect(prisma.purchaseOrder.delete).toHaveBeenCalledWith({ where: { id: 'po-2' } });
    expect(purchaseOrders.confirm).not.toHaveBeenCalled();
    expect(result.id).toBe('po-1');
  });

  it('keeps its own live order when the key is taken by a row that is no longer there', async () => {
    const { service, prisma, purchaseOrders, goodsReceivedNotes } = makeService();
    purchaseOrders.create.mockResolvedValue(chainOrder({ id: 'po-2', status: 'DRAFT' }));
    // The index says the key is claimed, but no live order carries it — the
    // holder was deleted. Refusing here would strand a lorry standing at the
    // door behind a key nothing can ever resolve; our own order received
    // nothing twice, so drive it.
    prisma.purchaseOrder.update.mockRejectedValue(uniqueViolation());
    prisma.purchaseOrder.findFirst.mockResolvedValue(null);

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(prisma.purchaseOrder.delete).not.toHaveBeenCalled();
    expect(purchaseOrders.confirm).toHaveBeenCalledWith('po-2', expect.anything());
    expect(goodsReceivedNotes.post).toHaveBeenCalledWith('grn-1', expect.anything());
    expect(result.id).toBe('po-2');
  });

  it('stamps the key on the order it created, so replay protection is the database’s job', async () => {
    const { service, prisma } = makeService();

    await service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser());

    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      data: { idempotencyKey: IDEMPOTENCY_KEY },
    });
  });

  it('resolves a key by the stamped column, and by notes only for a row that carries no key of its own', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'RECEIVED' }));

    await service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser());

    // The notes arm is the fallback for orders recorded before the column
    // existed. Scoping it to unstamped rows is what stops a marker planted in
    // somebody's free text from taking a stamped order's place.
    expect(prisma.purchaseOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          OR: [
            { idempotencyKey: IDEMPOTENCY_KEY },
            {
              AND: [
                { idempotencyKey: null },
                { notes: { contains: `[MPL-PURCHASE:${IDEMPOTENCY_KEY}]` } },
              ],
            },
          ],
        },
        // Stamped first, not oldest first: the loser of a create race is the
        // EARLIER row by definition (it committed second), so if its own delete
        // ever failed, oldest-first would hand a later retry the stockless twin
        // and receive the lorry a second time.
        orderBy: [
          { idempotencyKey: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
      }),
    );
  });

  it('strips marker-shaped text out of the manager’s note, so a terminal cannot plant another terminal’s key', async () => {
    const { service, purchaseOrders } = makeService();
    // A compromised terminal writing another terminal's marker into its own
    // slip could otherwise make that key resolve to ITS order: the victim's
    // next POKEA either 409s over a delivery she has nothing to do with, or is
    // driven to receive the attacker's lines instead of the lorry in front of
    // her. The payload may not write the token that protects it.
    const victimKey = 'victim-purchase-key-0002';

    await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto({
        notes: `Sukari 10 [MPL-PURCHASE:${victimKey}] [MPL-COUNT:${victimKey}] [MPL-PURCHASE-CONTENT:deadbeef]`,
      }),
      repUser(),
    );

    const notes: string = purchaseOrders.create.mock.calls[0][0].notes;
    expect(notes).not.toContain(victimKey);
    expect(notes).not.toContain('[MPL-PURCHASE-CONTENT:deadbeef]');
    // The manager's own text survives, and this order's real markers still do.
    expect(notes).toContain('Sukari 10');
    expect(notes).toContain(`[MPL-PURCHASE:${IDEMPOTENCY_KEY}]`);
    expect(notes).toContain('[MPL-PURCHASE-CONTENT:');
  });

  it('refuses to replay a marker whose recorded delivery has different lines', async () => {
    const { service, prisma, purchaseOrders, goodsReceivedNotes } = makeService();
    // The lost-response-then-correct case: PO-1 was created and received from
    // the first tap, the response died, the manager added the sack of unga she
    // had forgotten and sent again. Whether the phone froze its key or re-minted
    // it, one of replay-the-old-slip or receive-the-delivery-twice is wrong —
    // so the server refuses both and points at the office.
    prisma.product.findMany.mockResolvedValue([
      stockProduct(),
      stockProduct({ id: 'product-2', name: 'Unga' }),
    ]);
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'RECEIVED' }));

    await expect(
      service.createPurchase(
        TERMINAL_CODE,
        DEVICE_SECRET,
        purchaseDto({
          lines: [
            { productId: 'product-1', quantity: 4 },
            { productId: 'product-2', quantity: 1 },
          ],
        }),
        repUser(),
      ),
    ).rejects.toThrow('The earlier slip for this delivery was already received');

    expect(purchaseOrders.create).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.create).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.post).not.toHaveBeenCalled();
  });

  it('refuses to replay a marker recorded against a different supplier', async () => {
    const { service, prisma, goodsReceivedNotes } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      chainOrder({ status: 'RECEIVED', supplierId: 'supplier-2' }),
    );

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('check with the office before recording it again');
    expect(goodsReceivedNotes.post).not.toHaveBeenCalled();
  });

  it('refuses to replay a marker whose recorded quantity differs', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'RECEIVED' }));

    await expect(
      service.createPurchase(
        TERMINAL_CODE,
        DEVICE_SECRET,
        purchaseDto({ lines: [{ productId: 'product-1', quantity: 5 }] }),
        repUser(),
      ),
    ).rejects.toThrow('The earlier slip for this delivery was already received');
  });

  it('refuses to replay a marker whose recorded cost differs from a cost the manager typed', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'RECEIVED' }));

    await expect(
      service.createPurchase(
        TERMINAL_CODE,
        DEVICE_SECRET,
        purchaseDto({ lines: [{ productId: 'product-1', quantity: 4, unitCost: 1600 }] }),
        repUser(),
      ),
    ).rejects.toThrow('The earlier slip for this delivery was already received');
  });

  it('still replays when only the SERVER-resolved cost moved (the office repriced the product)', async () => {
    const { service, prisma } = makeService();
    // The body carried no unitCost, so the recorded 1500 came from the product
    // default at create time. The office changing that default must never turn
    // a legitimate lost-response retry into a conflict.
    prisma.product.findMany.mockResolvedValue([stockProduct({ defaultPurchasePrice: '1800' })]);
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'RECEIVED' }));
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      id: 'grn-1',
      status: 'POSTED',
      grnNumber: 'GRN-2026-000001',
    });

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(result.grnNumber).toBe('GRN-2026-000001');
  });

  it('replays a received delivery even after the products and supplier stopped validating', async () => {
    const { service, prisma, purchaseOrders, goodsReceivedNotes } = makeService();
    // The lost-response case, then overnight the office deactivates the unga SKU
    // and moves the supplier to another branch. Re-validating BEFORE the marker
    // lookup turned this into a 400 for crates the branch already has — and the
    // documented way out (empty the form) drops the frozen key, so the next send
    // received the same lorry a second time. Idempotency resolution comes first.
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'RECEIVED' }));
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      id: 'grn-1',
      status: 'POSTED',
      grnNumber: 'GRN-2026-000001',
    });
    prisma.supplier.findFirst.mockResolvedValue(null);
    prisma.product.findMany.mockResolvedValue([]);

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(result.grnNumber).toBe('GRN-2026-000001');
    expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(purchaseOrders.create).not.toHaveBeenCalled();
    expect(goodsReceivedNotes.create).not.toHaveBeenCalled();
  });

  it('refuses a replay that CLEARED a unit cost the recorded slip carries', async () => {
    const { service, prisma, purchaseOrders } = makeService();
    // Phase 1: she types 50000 instead of 5000 and taps POKEA; the response is
    // lost. The order records what she typed, plus a fingerprint of it.
    const typed = purchaseDto({
      lines: [{ productId: 'product-1', quantity: 4, unitCost: 50000 }],
    });
    await service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, typed, repUser());
    const recordedNotes = purchaseOrders.create.mock.calls[0][0].notes;
    expect(recordedNotes).toContain('[MPL-PURCHASE-CONTENT:');

    // Phase 2: she spots the typo, CLEARS the cost field so the office default
    // applies, and taps POKEA again under the frozen key. Comparing only the
    // costs the retry STATES made this vacuously true — the guard passed, the
    // muhuri stamped, and the delivery replayed at 50000 with the branch's
    // weighted-average cost inflated tenfold and no trace of the correction.
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      chainOrder({
        status: 'RECEIVED',
        notes: recordedNotes,
        lines: [{ productId: 'product-1', unitId: 'unit-1', quantity: '4', unitCost: '50000' }],
      }),
    );

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('The earlier slip for this delivery was already received');
  });

  it('still replays a marker-and-content match after the office repriced the product', async () => {
    const { service, prisma, purchaseOrders, goodsReceivedNotes } = makeService();
    // Same slip, no cost typed either time. The fingerprint covers what she
    // typed and never a server-resolved cost, so the office moving the default
    // between the two taps still replays instead of 409-ing.
    await service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser());
    const recordedNotes = purchaseOrders.create.mock.calls[0][0].notes;

    prisma.product.findMany.mockResolvedValue([stockProduct({ defaultPurchasePrice: '1800' })]);
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      chainOrder({ status: 'RECEIVED', notes: recordedNotes }),
    );
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      id: 'grn-1',
      status: 'POSTED',
      grnNumber: 'GRN-2026-000001',
    });
    goodsReceivedNotes.create.mockClear();

    const result = await service.createPurchase(
      TERMINAL_CODE,
      DEVICE_SECRET,
      purchaseDto(),
      repUser(),
    );

    expect(result.grnNumber).toBe('GRN-2026-000001');
    expect(goodsReceivedNotes.create).not.toHaveBeenCalled();
  });

  it('rejects a supplier outside the terminal company/branch scope', async () => {
    const { service, prisma, purchaseOrders } = makeService();
    prisma.supplier.findFirst.mockResolvedValue(null);

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(purchaseOrders.create).not.toHaveBeenCalled();
  });

  it('rejects products that are unavailable for the terminal', async () => {
    const { service, prisma, purchaseOrders } = makeService();
    prisma.product.findMany.mockResolvedValue([]);

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('One or more products are unavailable for this terminal');
    expect(purchaseOrders.create).not.toHaveBeenCalled();
  });

  it('rejects non-stock products', async () => {
    const { service, prisma, purchaseOrders } = makeService();
    prisma.product.findMany.mockResolvedValue([stockProduct({ productType: 'SERVICE' })]);

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('is not a stock item');
    expect(purchaseOrders.create).not.toHaveBeenCalled();
  });

  it('rejects lines whose product has no resolvable purchase cost', async () => {
    const { service, prisma, purchaseOrders } = makeService();
    prisma.product.findMany.mockResolvedValue([
      stockProduct({ defaultPurchasePrice: null, productFamily: null }),
    ]);

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('does not have a purchase cost');
    expect(purchaseOrders.create).not.toHaveBeenCalled();
  });
});

/**
 * An interrupted delivery is not a lost request — it is a CONFIRMED purchase
 * order with an unfinished goods-received note sitting behind it, and that GRN
 * is indistinguishable on the desktop from any other receipt awaiting a post.
 * The office posts it as routine; meanwhile the phone's documented way out of a
 * stuck slip is to empty the form, which drops the frozen key, so the same
 * lorry is re-typed under a new key and received a second time. The audit row
 * is what lets the office tell the two apart, and before this the purchase
 * chain wrote none at all — it rethrew silently from five different places.
 */
describe('MobilePosLiteService createPurchase abandonment log', () => {
  it('names the step and the receipt left behind when the GRN approve dies mid-chain', async () => {
    const { service, prisma, goodsReceivedNotes, auditLogs } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'CONFIRMED' }));
    goodsReceivedNotes.approve.mockRejectedValue(new Error('Connection reset by peer'));
    prisma.goodsReceivedNote.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: 'DRAFT' });

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('Connection reset by peer');

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_PURCHASE_NOT_RECEIVED',
        entityType: 'PurchaseOrder',
        entityId: 'po-1',
        severity: 'HIGH',
        newValue: expect.objectContaining({
          stoppedAt: 'approve',
          purchaseOrderNumber: 'PO-2026-000001',
          grnId: 'grn-1',
          grnNumber: 'GRN-2026-000001',
          grnStatus: 'DRAFT',
          failedBecause: 'Connection reset by peer',
        }),
      }),
    );
    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MOBILE_POS_LITE_PURCHASE_COMPLETED' }),
    );
  });

  it('names the post step and the APPROVED receipt a desk will otherwise post as routine', async () => {
    const { service, prisma, goodsReceivedNotes, auditLogs } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'CONFIRMED' }));
    prisma.goodsReceivedNote.findFirst
      .mockResolvedValueOnce({ id: 'grn-1', status: 'APPROVED', grnNumber: 'GRN-2026-000001' })
      .mockResolvedValueOnce({ status: 'APPROVED' });
    goodsReceivedNotes.post.mockRejectedValue(new Error('Connection terminated unexpectedly'));

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('Connection terminated unexpectedly');

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_PURCHASE_NOT_RECEIVED',
        newValue: expect.objectContaining({ stoppedAt: 'post', grnStatus: 'APPROVED' }),
      }),
    );
  });

  it('records a chain that stopped at confirm, with no receipt to name', async () => {
    const { service, prisma, purchaseOrders, auditLogs } = makeService();
    prisma.purchaseOrder.findFirst
      .mockResolvedValueOnce(chainOrder({ status: 'DRAFT' }))
      .mockResolvedValueOnce({ status: 'DRAFT' });
    purchaseOrders.confirm.mockRejectedValue(new Error('Connection reset by peer'));

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('Connection reset by peer');

    // Nothing was received, so this row needs no desk at all — which is exactly
    // what the office has to be able to read off the log.
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_PURCHASE_NOT_RECEIVED',
        newValue: expect.objectContaining({ stoppedAt: 'confirm', grnId: null, grnNumber: null }),
      }),
    );
  });

  it('records the chain conflicts too, so no exit from the chain is silent', async () => {
    const { service, prisma, auditLogs } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'CANCELLED' }));

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('was cancelled');

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_PURCHASE_NOT_RECEIVED',
        oldValue: { status: 'CANCELLED' },
        newValue: expect.objectContaining({ stoppedAt: 'resume' }),
      }),
    );
  });

  it('writes the idempotency marker into the GRN notes, so an abandoned receipt names its key', async () => {
    const { service, goodsReceivedNotes } = makeService();

    await service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser());

    expect(goodsReceivedNotes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: expect.stringContaining(`[MPL-PURCHASE:${IDEMPOTENCY_KEY}]`),
      }),
      expect.anything(),
    );
  });

  it('never replaces the manager’s failure with the audit write’s own', async () => {
    const { service, prisma, goodsReceivedNotes, auditLogs } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'CONFIRMED' }));
    prisma.goodsReceivedNote.findFirst
      .mockResolvedValueOnce({ id: 'grn-1', status: 'APPROVED', grnNumber: 'GRN-2026-000001' })
      .mockResolvedValueOnce({ status: 'APPROVED' });
    goodsReceivedNotes.post.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    auditLogs.log.mockRejectedValue(new Error('Timed out fetching a new connection'));

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('Connection terminated unexpectedly');
  });

  it('writes no abandonment row for a delivery that completed', async () => {
    const { service, auditLogs } = makeService();

    await service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser());

    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MOBILE_POS_LITE_PURCHASE_NOT_RECEIVED' }),
    );
  });

  it('records the content-mismatch refusal, because its copy sends the manager to the office', async () => {
    const { service, prisma, auditLogs } = makeService();
    // She sent a lorry, the response was lost, she spotted a missing sack and
    // added it. The content marker disagrees and she is told to ask the office
    // — and the office sees an ordinary POSTED receipt with no signal at all
    // that a terminal is disputing it. The refusal names a desk, so the desk
    // has to be able to see the dispute; the count path settles this identical
    // case, and the purchase chain's contract is that every exit which is not a
    // received delivery is settled first.
    prisma.product.findMany.mockResolvedValue([
      stockProduct(),
      stockProduct({ id: 'product-2', name: 'Unga' }),
    ]);
    prisma.purchaseOrder.findFirst.mockResolvedValue(chainOrder({ status: 'RECEIVED' }));

    await expect(
      service.createPurchase(
        TERMINAL_CODE,
        DEVICE_SECRET,
        purchaseDto({
          lines: [
            { productId: 'product-1', quantity: 4 },
            { productId: 'product-2', quantity: 1 },
          ],
        }),
        repUser(),
      ),
    ).rejects.toThrow('check with the office before recording it again');

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_PURCHASE_NOT_RECEIVED',
        entityType: 'PurchaseOrder',
        entityId: 'po-1',
        severity: 'HIGH',
        oldValue: { status: 'RECEIVED' },
        newValue: expect.objectContaining({
          stoppedAt: 'resume',
          purchaseOrderNumber: 'PO-2026-000001',
          failedBecause: expect.stringContaining('already received'),
        }),
      }),
    );
  });

  it('records the content-mismatch refusal against the WINNER of a create race too', async () => {
    const { service, prisma, purchaseOrders, auditLogs } = makeService();
    purchaseOrders.create.mockResolvedValue(chainOrder({ id: 'po-2', status: 'DRAFT' }));
    prisma.purchaseOrder.update.mockRejectedValue(uniqueViolation());
    prisma.purchaseOrder.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        chainOrder({ id: 'po-1', status: 'RECEIVED', supplierId: 'supplier-2' }),
      );

    await expect(
      service.createPurchase(TERMINAL_CODE, DEVICE_SECRET, purchaseDto(), repUser()),
    ).rejects.toThrow('check with the office before recording it again');

    // The disputed document is the winner, not the duplicate this request just
    // dropped: po-2 no longer exists, and a row pointing at it would send the
    // office looking for nothing.
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_PURCHASE_NOT_RECEIVED',
        entityId: 'po-1',
        newValue: expect.objectContaining({ stoppedAt: 'resume' }),
      }),
    );
  });
});

function saleProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    name: 'Maize Flour',
    baseUnitId: 'unit-1',
    defaultSellingPrice: '5000',
    retailPrice: null,
    wholesalePrice: null,
    productFamily: null,
    ...overrides,
  };
}

function saleDto(overrides: Record<string, unknown> = {}) {
  return {
    paymentMethod: 'CASH',
    idempotencyKey: IDEMPOTENCY_KEY,
    lines: [{ productId: 'product-1', quantity: 2 }],
    ...overrides,
  } as any;
}

function cashTerminalRow(overrides: Record<string, unknown> = {}) {
  return {
    ...terminalRow(),
    generalCustomerId: 'customer-1',
    paymentMethods: [
      { paymentMethod: 'CASH', isEnabled: true, cashAccountId: 'cash-1', label: null },
    ],
    ...overrides,
  };
}

describe('MobilePosLiteService customers', () => {
  it('searches customers on a terminal WITHOUT credit enabled (no longer credit-gated)', async () => {
    const { service, prisma } = makeService();
    // terminalRow() has creditEnabled: false — the search must still run.
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'customer-9',
        name: 'Asha Juma',
        customerCode: 'CUST-9',
        phone: '0712000000',
        creditLimit: '0',
        currentBalance: '0',
      },
    ]);

    const result = await service.customers(TERMINAL_CODE, DEVICE_SECRET, 'ash', repUser());

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-1', status: 'ACTIVE' }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ id: 'customer-9', name: 'Asha Juma' }));
  });

  it('still requires at least two search characters', async () => {
    const { service, prisma } = makeService();

    await expect(service.customers(TERMINAL_CODE, DEVICE_SECRET, 'a', repUser())).resolves.toEqual(
      [],
    );
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });
});

describe('MobilePosLiteService createSale customer attach', () => {
  it('persists an attached customer on a CASH sale', async () => {
    const { service, prisma, salesOrders } = makeService();
    prisma.mobilePosTerminal.findFirst.mockResolvedValue(cashTerminalRow());
    prisma.customer.findFirst.mockResolvedValue({ id: 'customer-9' });
    prisma.product.findMany.mockResolvedValue([saleProduct()]);

    await service.createSale(
      TERMINAL_CODE,
      DEVICE_SECRET,
      saleDto({ customerId: 'customer-9' }),
      repUser(),
    );

    // The attached customer is validated against the terminal scope...
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'customer-9',
          companyId: 'company-1',
          status: 'ACTIVE',
        }),
      }),
    );
    // ...and stamped on the quick sale instead of the general customer.
    expect(salesOrders.mobilePosLiteQuickSale).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-9',
        salesType: 'CASH_SALE',
        paymentMethod: 'CASH',
        cashAccountId: 'cash-1',
      }),
      expect.objectContaining({ id: 'rep-1' }),
      'terminal-1',
      TERMINAL_CODE,
    );
  });

  it('falls back to the terminal general customer when no customer is attached', async () => {
    const { service, prisma, salesOrders } = makeService();
    prisma.mobilePosTerminal.findFirst.mockResolvedValue(cashTerminalRow());
    prisma.product.findMany.mockResolvedValue([saleProduct()]);

    await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    expect(salesOrders.mobilePosLiteQuickSale).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'customer-1' }),
      expect.anything(),
      'terminal-1',
      TERMINAL_CODE,
    );
  });

  it('rejects an attached customer outside the terminal scope', async () => {
    const { service, prisma, salesOrders } = makeService();
    prisma.mobilePosTerminal.findFirst.mockResolvedValue(cashTerminalRow());
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(
      service.createSale(
        TERMINAL_CODE,
        DEVICE_SECRET,
        saleDto({ customerId: 'customer-9' }),
        repUser(),
      ),
    ).rejects.toThrow('not available for this terminal branch');
    expect(salesOrders.mobilePosLiteQuickSale).not.toHaveBeenCalled();
  });
});

/** Row shape returned by the stock() product query (spec-inventory §1.1). */
function stockScreenProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    name: 'Maize Flour',
    productCode: 'MF-1',
    sku: null,
    barcode: null,
    baseUnitId: 'unit-1',
    imageUrl: null,
    defaultSellingPrice: '5000',
    retailPrice: null,
    wholesalePrice: null,
    reorderLevel: null,
    minimumStockLevel: null,
    baseUnit: { id: 'unit-1', name: 'Piece', symbol: 'pc' },
    productFamily: null,
    ...overrides,
  };
}

function balanceRow(productId: string, quantityOnHand: number, quantityReserved: number) {
  return {
    productId,
    quantityOnHand: String(quantityOnHand),
    quantityReserved: String(quantityReserved),
  };
}

describe('MobilePosLiteService stock', () => {
  it('scopes the query to stock items of the terminal division (including division-null)', async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([]);

    await service.stock(TERMINAL_CODE, DEVICE_SECRET, undefined, repUser());

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          status: 'ACTIVE',
          // isStockItem() semantics in where-clause form.
          trackInventory: true,
          productType: { notIn: ['SERVICE', 'NON_STOCK_ITEM'] },
          AND: [{ OR: [{ divisionId: 'division-1' }, { divisionId: null }] }],
        }),
        orderBy: { name: 'asc' },
        take: 1500,
      }),
    );
    // Balances are joined for the TERMINAL's branch — never a client choice.
    expect(prisma.inventoryBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ branchId: 'branch-1' }),
      }),
    );
  });

  it('computes status boundaries: negative → OVERSOLD, zero → OUT, at-threshold → LOW, above → IN', async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([
      stockScreenProduct({ id: 'p-neg', name: 'A Neg' }),
      stockScreenProduct({ id: 'p-zero', name: 'B Zero' }),
      stockScreenProduct({ id: 'p-at', name: 'C AtThreshold', reorderLevel: '5' }),
      stockScreenProduct({ id: 'p-above', name: 'D Above', minimumStockLevel: '4' }),
    ]);
    prisma.inventoryBalance.findMany.mockResolvedValue([
      balanceRow('p-neg', 2, 5), // available -3
      balanceRow('p-zero', 3, 3), // available 0
      balanceRow('p-at', 5, 0), // available 5 = reorderLevel 5 → LOW_STOCK
      balanceRow('p-above', 5, 0), // available 5 > minimumStockLevel 4 → IN_STOCK
    ]);

    const result = await service.stock(TERMINAL_CODE, DEVICE_SECRET, undefined, repUser());
    const byId = new Map(result.items.map((item: any) => [item.productId, item]));

    expect(byId.get('p-neg')).toMatchObject({ available: -3, status: 'OVERSOLD' });
    expect(byId.get('p-zero')).toMatchObject({ available: 0, status: 'OUT_OF_STOCK' });
    expect(byId.get('p-at')).toMatchObject({ available: 5, threshold: 5, status: 'LOW_STOCK' });
    expect(byId.get('p-above')).toMatchObject({ available: 5, threshold: 4, status: 'IN_STOCK' });
  });

  it('includes unpriced products with sellingPrice null', async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([
      stockScreenProduct({
        id: 'p-unpriced',
        defaultSellingPrice: null,
        retailPrice: null,
        wholesalePrice: null,
      }),
    ]);
    prisma.inventoryBalance.findMany.mockResolvedValue([balanceRow('p-unpriced', 7, 0)]);

    const result = await service.stock(TERMINAL_CODE, DEVICE_SECRET, undefined, repUser());

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ productId: 'p-unpriced', sellingPrice: null });
  });

  it('treats a missing balance row as zeros → OUT_OF_STOCK with the default threshold 10', async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([stockScreenProduct({ id: 'p-norow' })]);
    prisma.inventoryBalance.findMany.mockResolvedValue([]);

    const result = await service.stock(TERMINAL_CODE, DEVICE_SECRET, undefined, repUser());

    expect(result.items[0]).toMatchObject({
      quantityOnHand: 0,
      quantityReserved: 0,
      available: 0,
      threshold: 10,
      status: 'OUT_OF_STOCK',
    });
  });

  it('sorts problems-first (OVERSOLD → OUT → LOW → IN) preserving name order within a band', async () => {
    const { service, prisma } = makeService();
    // DB order is name-asc; statuses are deliberately shuffled across it.
    prisma.product.findMany.mockResolvedValue([
      stockScreenProduct({ id: 'p-a', name: 'Asali' }), // IN (20 available)
      stockScreenProduct({ id: 'p-b', name: 'Bia' }), // OVERSOLD
      stockScreenProduct({ id: 'p-c', name: 'Chai' }), // LOW (5 ≤ 10)
      stockScreenProduct({ id: 'p-d', name: 'Dagaa' }), // OUT (no row)
      stockScreenProduct({ id: 'p-e', name: 'Embe' }), // LOW (5 ≤ 10)
    ]);
    prisma.inventoryBalance.findMany.mockResolvedValue([
      balanceRow('p-a', 20, 0),
      balanceRow('p-b', 0, 2),
      balanceRow('p-c', 5, 0),
      balanceRow('p-e', 5, 0),
    ]);

    const result = await service.stock(TERMINAL_CODE, DEVICE_SECRET, undefined, repUser());

    expect(result.items.map((item: any) => item.productId)).toEqual([
      'p-b', // OVERSOLD first
      'p-d', // OUT_OF_STOCK
      'p-c', // LOW_STOCK — Chai before Embe (name order kept in the band)
      'p-e',
      'p-a', // IN_STOCK last
    ]);
  });

  it('returns branch identity + asOf and NEVER serializes cost/value fields (review-blocking)', async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([stockScreenProduct()]);
    prisma.inventoryBalance.findMany.mockResolvedValue([balanceRow('product-1', 7, 2)]);

    const result = await service.stock(TERMINAL_CODE, DEVICE_SECRET, undefined, repUser());

    expect(result.branch).toEqual({ id: 'branch-1', name: 'Branch' });
    expect(typeof result.asOf).toBe('string');
    expect(Number.isNaN(Date.parse(result.asOf))).toBe(false);

    const serialized = JSON.parse(JSON.stringify(result));
    for (const item of serialized.items) {
      for (const forbidden of ['averageCost', 'totalValue', 'unitCost', 'riskValue']) {
        expect(item).not.toHaveProperty(forbidden);
      }
      expect(Object.keys(item).sort()).toEqual(
        [
          'available',
          'barcode',
          'code',
          'imageUrl',
          'name',
          'productId',
          'quantityOnHand',
          'quantityReserved',
          'sellingPrice',
          'status',
          'threshold',
          'unitId',
          'unitSymbol',
        ].sort(),
      );
    }
  });
});

describe('MobilePosLiteService saleReceipt', () => {
  function saleRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'so-1',
      salesOrderNumber: 'SO-2026-000123',
      orderDate: new Date('2026-08-12T06:30:00Z'),
      createdAt: new Date('2026-08-12T06:30:00Z'),
      totalAmount: '12500',
      paymentMethod: 'CASH',
      paymentReference: null,
      customerName: null,
      customer: { name: 'Asha Juma' },
      lines: [
        {
          description: 'Maize Flour',
          quantity: '2',
          unitPrice: '5000',
          lineTotal: '10000',
          product: { name: 'Maize Flour' },
        },
        {
          description: 'Soda',
          quantity: '1',
          unitPrice: '2500',
          lineTotal: '2500',
          product: { name: 'Soda' },
        },
      ],
      ...overrides,
    };
  }

  it('rejects a sale recorded on another terminal', async () => {
    const { service, prisma, generatedDocuments } = makeService();
    // The terminal-bound where clause finds nothing for foreign sales.
    prisma.salesOrder.findFirst.mockResolvedValue(null);

    await expect(
      service.saleReceipt(TERMINAL_CODE, DEVICE_SECRET, 'so-other', repUser()),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.salesOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'so-other',
          companyId: 'company-1',
          mobilePosTerminalId: 'terminal-1',
        }),
      }),
    );
    expect(generatedDocuments.renderLetterheadPdf).not.toHaveBeenCalled();
  });

  it('renders the letterhead receipt with bilingual labels, lines, and JUMLA total', async () => {
    const { service, prisma, generatedDocuments } = makeService();
    prisma.salesOrder.findFirst.mockResolvedValue(saleRow());

    const result = await service.saleReceipt(TERMINAL_CODE, DEVICE_SECRET, 'so-1', repUser());

    expect(generatedDocuments.renderLetterheadPdf).toHaveBeenCalledWith(
      { companyId: 'company-1', branchId: 'branch-1' },
      expect.objectContaining({
        title: 'RISITI / RECEIPT',
        subtitle: 'Asha Juma',
        reference: 'SO-2026-000123',
        meta: expect.arrayContaining([
          { label: 'Namba ya Risiti / Receipt No', value: 'SO-2026-000123' },
          { label: 'Tawi / Branch', value: 'Branch' },
          { label: 'Muuzaji / Served By', value: 'Rep One' },
        ]),
      }),
      expect.objectContaining({ id: 'rep-1' }),
    );

    const model = generatedDocuments.renderLetterheadPdf.mock.calls[0][1];
    const [transaction, items, thanks] = model.sections;
    expect(transaction.items).toEqual([
      { label: 'Mteja / Customer', value: 'Asha Juma' },
      { label: 'Malipo / Payment Method', value: 'Taslimu / Cash' },
    ]);
    expect(items.table.headers).toEqual([
      'Bidhaa / Item',
      'Idadi / Qty',
      'Bei / Unit Price',
      'Jumla / Total',
    ]);
    expect(items.table.rows).toEqual([
      ['Maize Flour', '2', 'TZS 5,000', 'TZS 10,000'],
      ['Soda', '1', 'TZS 2,500', 'TZS 2,500'],
    ]);
    expect(items.totals).toEqual([{ label: 'JUMLA / TOTAL', value: 'TZS 12,500', emphasis: true }]);
    expect(thanks.paragraphs).toEqual(['Asante kwa biashara yako! / Thank you for your business!']);

    expect(result.fileName).toBe('RISITI-SO-2026-000123.pdf');
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
  });

  it('includes the payment reference when the sale carries one', async () => {
    const { service, prisma, generatedDocuments } = makeService();
    prisma.mobilePosTerminal.findFirst.mockResolvedValue(
      cashTerminalRow({
        paymentMethods: [
          {
            paymentMethod: 'MOBILE_MONEY',
            isEnabled: true,
            cashAccountId: 'momo-1',
            label: 'M-Pesa Till 12345',
          },
        ],
      }),
    );
    prisma.salesOrder.findFirst.mockResolvedValue(
      saleRow({ paymentMethod: 'MOBILE_MONEY', paymentReference: 'TX-778899' }),
    );

    await service.saleReceipt(TERMINAL_CODE, DEVICE_SECRET, 'so-1', repUser());

    const model = generatedDocuments.renderLetterheadPdf.mock.calls[0][1];
    expect(model.sections[0].items).toEqual(
      expect.arrayContaining([
        {
          label: 'Malipo / Payment Method',
          value: 'Pesa za Simu / Mobile Money (M-Pesa Till 12345)',
        },
        { label: 'Kumbukumbu ya Malipo / Payment Reference', value: 'TX-778899' },
      ]),
    );
  });
});

function managerUser(): AuthUser {
  return { ...repUser(), permissions: ['mobile_pos_lite.use', 'mobile_pos_lite.stock_count'] };
}

function countDto(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: COUNT_KEY,
    lines: [{ productId: 'product-1', countedQuantity: 5 }],
    ...overrides,
  } as any;
}

function onHandRow(productId: string, quantityOnHand: number) {
  return { productId, quantityOnHand: String(quantityOnHand) };
}

/**
 * The count chain writes exactly ONE thing to the adjustment row itself: the
 * idempotency stamp that claims the key at create — `{ idempotencyKey }` and
 * nothing else. Any other field, and above all a `deletedAt`, would be this
 * wrapper retiring a manager's count, which is the thing two earlier rounds
 * proved it must never do. Stronger than "update was never called", because it
 * names what the one permitted write is allowed to contain.
 */
function expectCountNeverRetired(prisma: any) {
  for (const [args] of prisma.stockAdjustment.update.mock.calls) {
    expect(Object.keys(args.data)).toEqual(['idempotencyKey']);
  }
  expect(prisma.stockAdjustment.updateMany).not.toHaveBeenCalled();
}

describe('MobilePosLiteService createStockCount', () => {
  it('runs the full create -> submit -> approve -> post chain with a server-read systemQuantity', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.inventoryBalance.findMany.mockResolvedValue([onHandRow('product-1', 7)]);

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(stockAdjustments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        reason: 'MOBILE_POS_STOCK_COUNT',
        notes: expect.stringContaining(`[MPL-COUNT:${COUNT_KEY}]`),
        lines: [
          {
            productId: 'product-1',
            // Read from inventoryBalance.quantityOnHand — never from the client.
            systemQuantity: 7,
            countedQuantity: 5,
            unitId: 'unit-1',
          },
        ],
      }),
      expect.objectContaining({ id: 'rep-1' }),
    );
    // post() resolves cost itself; a buying cost must never ride on this path.
    expect(stockAdjustments.create.mock.calls[0][0].lines[0]).not.toHaveProperty('unitCost');
    expect(stockAdjustments.submit).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(stockAdjustments.approve).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(stockAdjustments.post).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(prisma.mobilePosTerminal.update).toHaveBeenCalled();
    expect(result).toEqual({
      id: 'sa-1',
      adjustmentNumber: 'SA-2026-ABC123',
      status: 'POSTED',
      lines: [
        { productId: 'product-1', systemQuantity: 7, countedQuantity: 5, varianceQuantity: -2 },
      ],
    });
  });

  it('embeds the capture time in the notes when the client sends one', async () => {
    const { service, stockAdjustments } = makeService();
    // Relative, not a literal date: a fixed timestamp would sail past the
    // capture window and turn this into a test that fails on a calendar.
    const capturedAt = hoursAgo(1).toISOString();

    await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ countedAt: capturedAt }),
      managerUser(),
    );

    expect(stockAdjustments.create.mock.calls[0][0].notes).toBe(
      `[MPL-COUNT:${COUNT_KEY}] Stock count from terminal ${TERMINAL_CODE} captured ${capturedAt}`,
    );
  });

  it('scopes products to the terminal company/division and reads balances for the terminal branch', async () => {
    const { service, prisma } = makeService();

    await service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser());

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['product-1'] },
          companyId: 'company-1',
          status: 'ACTIVE',
          AND: [{ OR: [{ divisionId: 'division-1' }, { divisionId: null }] }],
        }),
      }),
    );
    // The branch is the terminal's — a client can never point a count elsewhere.
    expect(prisma.inventoryBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { branchId: 'branch-1', productId: { in: ['product-1'] } },
        select: { productId: true, quantityOnHand: true },
      }),
    );
  });

  it('treats a missing balance row as systemQuantity 0 (never counted at this branch)', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.inventoryBalance.findMany.mockResolvedValue([]);

    await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ lines: [{ productId: 'product-1', countedQuantity: 3 }] }),
      managerUser(),
    );

    expect(stockAdjustments.create.mock.calls[0][0].lines).toEqual([
      { productId: 'product-1', systemQuantity: 0, countedQuantity: 3, unitId: 'unit-1' },
    ]);
  });

  it('accepts countedQuantity 0 as a real count ("shelf is empty"), not an absent line', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.inventoryBalance.findMany.mockResolvedValue([onHandRow('product-1', 7)]);

    await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ lines: [{ productId: 'product-1', countedQuantity: 0 }] }),
      managerUser(),
    );

    expect(stockAdjustments.create.mock.calls[0][0].lines).toEqual([
      { productId: 'product-1', systemQuantity: 7, countedQuantity: 0, unitId: 'unit-1' },
    ]);
  });

  it('rejects a product counted twice, naming the productId', async () => {
    const { service, stockAdjustments } = makeService();

    await expect(
      service.createStockCount(
        TERMINAL_CODE,
        DEVICE_SECRET,
        countDto({
          lines: [
            { productId: 'product-1', countedQuantity: 5 },
            { productId: 'product-1', countedQuantity: 6 },
          ],
        }),
        managerUser(),
      ),
    ).rejects.toThrow('Product product-1 was counted more than once');
    expect(stockAdjustments.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown/out-of-scope product, naming the productId', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.product.findMany.mockResolvedValue([]);

    const promise = service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toThrow('Product product-1 is not available for this terminal');
    expect(stockAdjustments.create).not.toHaveBeenCalled();
  });

  it('rejects a non-stock item, naming the productId', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.product.findMany.mockResolvedValue([stockProduct({ productType: 'SERVICE' })]);

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toThrow('Maize Flour (product-1) is not a stock item');
    expect(stockAdjustments.create).not.toHaveBeenCalled();
  });

  it('replays a completed count without creating, validating, or posting anything again', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(countAdjustment({ status: 'POSTED' }));

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(stockAdjustments.create).not.toHaveBeenCalled();
    expect(stockAdjustments.submit).not.toHaveBeenCalled();
    expect(stockAdjustments.approve).not.toHaveBeenCalled();
    expect(stockAdjustments.post).not.toHaveBeenCalled();
    // A retry of a posted count never re-validates: a product deactivated in
    // the meantime must not turn a safe replay into a 400.
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: 'sa-1',
      adjustmentNumber: 'SA-2026-ABC123',
      status: 'POSTED',
      lines: [
        { productId: 'product-1', systemQuantity: 7, countedQuantity: 5, varianceQuantity: -2 },
      ],
    });
  });

  it('refuses to replay a marker whose recorded count differs from the numbers just sent', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    // THE BLOCKER this guard exists for. She keys 50 for a shelf of 5, taps
    // TUMA, and the response dies over the posting step. While waiting she
    // spots the typo and fixes it to 5. The key is frozen on purpose — an edit
    // must never mint a second key, or a lost response counts the branch twice
    // — so the corrected sheet arrives under the SAME key. Without this guard
    // the wrapper drove the RECORDED +45, returned POSTED, and the phone fired
    // the success haptic and deleted her draft: 45 phantom units on the books,
    // a count-up gain in P&L, and her correction existing nowhere.
    prisma.stockAdjustment.findFirst.mockResolvedValue(countAdjustment({ status: 'APPROVED' }));

    await expect(
      service.createStockCount(
        TERMINAL_CODE,
        DEVICE_SECRET,
        countDto({ lines: [{ productId: 'product-1', countedQuantity: 4 }] }),
        managerUser(),
      ),
    ).rejects.toThrow(
      'This count was already sent with different numbers — check with the office before sending it again.',
    );

    expect(stockAdjustments.post).not.toHaveBeenCalled();
    expect(stockAdjustments.submit).not.toHaveBeenCalled();
    expect(stockAdjustments.approve).not.toHaveBeenCalled();
    expect(stockAdjustments.create).not.toHaveBeenCalled();
    // The refusal sends her to the office, so the office is told: the numbers on
    // SA-1 are disputed by the manager who took them, which is exactly what a
    // desk needs before deciding to post that document by hand.
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
        entityId: 'sa-1',
        severity: 'HIGH',
        newValue: expect.objectContaining({
          stoppedAt: 'resume',
          failedBecause:
            'This count was already sent with different numbers — check with the office before sending it again.',
        }),
      }),
    );
  });

  it('refuses a replay that DROPPED a counted line, so an omitted count and a zero never look alike', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    // "Not counted" and "counted as zero" are different facts on this screen,
    // and the difference has to survive the replay guard: dropping the zero
    // line means the shelf was never counted, which is not the sheet on record.
    prisma.stockAdjustment.findFirst.mockResolvedValue(
      countAdjustment({
        status: 'APPROVED',
        lines: [
          {
            productId: 'product-1',
            systemQuantity: '7',
            countedQuantity: '5',
            varianceQuantity: '-2',
          },
          {
            productId: 'product-2',
            systemQuantity: '3',
            countedQuantity: '0',
            varianceQuantity: '-3',
          },
        ],
      }),
    );

    await expect(
      service.createStockCount(
        TERMINAL_CODE,
        DEVICE_SECRET,
        countDto({ lines: [{ productId: 'product-1', countedQuantity: 5 }] }),
        managerUser(),
      ),
    ).rejects.toThrow('This count was already sent with different numbers');
    expect(stockAdjustments.post).not.toHaveBeenCalled();
  });

  it('refuses a replay that ADDED a line the recorded count never carried', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(countAdjustment({ status: 'APPROVED' }));

    await expect(
      service.createStockCount(
        TERMINAL_CODE,
        DEVICE_SECRET,
        countDto({
          lines: [
            { productId: 'product-1', countedQuantity: 5 },
            { productId: 'product-2', countedQuantity: 9 },
          ],
        }),
        managerUser(),
      ),
    ).rejects.toThrow('This count was already sent with different numbers');
    expect(stockAdjustments.post).not.toHaveBeenCalled();
  });

  it('still replays a marker whose counted numbers are identical, whatever the system side did', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    // The guard compares what the MANAGER typed, never the server's own side of
    // the arithmetic: a balance that moved between the attempts must not turn a
    // safe replay into a refusal.
    prisma.stockAdjustment.findFirst.mockResolvedValue(
      countAdjustment({
        status: 'POSTED',
        lines: [
          {
            productId: 'product-1',
            systemQuantity: '99',
            countedQuantity: '5',
            varianceQuantity: '-94',
          },
        ],
      }),
    );

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(result.status).toBe('POSTED');
    expect(stockAdjustments.create).not.toHaveBeenCalled();
  });

  it('verifies the WINNER of a twin race against the body too, before driving it', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    stockAdjustments.create.mockResolvedValue(countAdjustment({ id: 'sa-2', status: 'DRAFT' }));
    prisma.stockAdjustment.update.mockRejectedValueOnce(uniqueViolation());
    prisma.stockAdjustment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(
      countAdjustment({
        id: 'sa-1',
        status: 'APPROVED',
        lines: [
          {
            productId: 'product-1',
            systemQuantity: '7',
            countedQuantity: '5',
            varianceQuantity: '-2',
          },
        ],
      }),
    );

    await expect(
      service.createStockCount(
        TERMINAL_CODE,
        DEVICE_SECRET,
        countDto({ lines: [{ productId: 'product-1', countedQuantity: 4 }] }),
        managerUser(),
      ),
    ).rejects.toThrow('This count was already sent with different numbers');
    expect(stockAdjustments.post).not.toHaveBeenCalled();
    // The refusal is ABOUT the winner, so the winner is the row the office is
    // shown — not the duplicate this request just retired.
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
        entityId: 'sa-1',
        newValue: expect.objectContaining({ stoppedAt: 'resume' }),
      }),
    );
  });

  it('resumes a chain interrupted at DRAFT (submit -> approve -> post)', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(countAdjustment({ status: 'DRAFT' }));

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(stockAdjustments.create).not.toHaveBeenCalled();
    expect(stockAdjustments.submit).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(stockAdjustments.approve).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(stockAdjustments.post).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(result.status).toBe('POSTED');
  });

  it('resumes a chain interrupted at PENDING_APPROVAL (approve -> post)', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(
      countAdjustment({ status: 'PENDING_APPROVAL' }),
    );

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(stockAdjustments.submit).not.toHaveBeenCalled();
    expect(stockAdjustments.approve).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(stockAdjustments.post).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(result.status).toBe('POSTED');
  });

  it('resumes a chain interrupted at APPROVED (post only)', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(countAdjustment({ status: 'APPROVED' }));

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(stockAdjustments.submit).not.toHaveBeenCalled();
    expect(stockAdjustments.approve).not.toHaveBeenCalled();
    expect(stockAdjustments.post).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(result.status).toBe('POSTED');
  });

  it('continues instead of failing when a concurrent retry won the submit race', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce(countAdjustment({ status: 'DRAFT' }))
      .mockResolvedValueOnce({ status: 'PENDING_APPROVAL' });
    stockAdjustments.submit.mockRejectedValue(
      new BadRequestException('Only DRAFT adjustments can be submitted'),
    );

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(stockAdjustments.approve).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(result.status).toBe('POSTED');
  });

  it('finds the marker after reject() appended to the notes, and never counts twice', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    // What the row looks like once a desktop approver rejected it: the marker
    // survives because reject() APPENDS.
    prisma.stockAdjustment.findFirst.mockResolvedValue(countAdjustment({ status: 'REJECTED' }));

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.stockAdjustment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          deletedAt: null,
          OR: [
            // The stamped column is the authority.
            { idempotencyKey: COUNT_KEY },
            // The notes marker still resolves rows recorded before that column
            // existed, and there it is `contains`, not equals — reject()
            // APPENDS its reason, and appended text must not hide the marker.
            // Scoped to rows carrying no key of their own, so planted text can
            // never displace a stamped row.
            {
              AND: [{ idempotencyKey: null }, { notes: { contains: `[MPL-COUNT:${COUNT_KEY}]` } }],
            },
          ],
        },
      }),
    );
    expect(stockAdjustments.create).not.toHaveBeenCalled();
  });

  it('retires its duplicate draft and resumes the winner when the unique index says it lost the create race', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    stockAdjustments.create.mockResolvedValue(countAdjustment({ id: 'sa-2', status: 'DRAFT' }));
    // Pre-check misses on both requests, both create, and the DATABASE picks
    // the winner: our stamp lands on a key another request already claimed. The
    // read-ordered twin check this replaced could not — createdAt is stamped at
    // transaction START, so each side of a race could read itself as the
    // earliest and drive its own row, applying one shelf's variance twice.
    prisma.stockAdjustment.update.mockRejectedValueOnce(uniqueViolation());
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(countAdjustment({ id: 'sa-1', status: 'POSTED' }));

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(prisma.stockAdjustment.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'sa-2' },
      data: { idempotencyKey: COUNT_KEY },
    });
    expect(prisma.stockAdjustment.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'sa-2' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(stockAdjustments.submit).not.toHaveBeenCalled();
    expect(result.id).toBe('sa-1');
  });

  it('keeps its own live count when the key is held by a row that is no longer there', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    stockAdjustments.create.mockResolvedValue(countAdjustment({ id: 'sa-2', status: 'DRAFT' }));
    // The index says the key is claimed but no live row carries it: the holder
    // was soft-deleted, and only a DRAFT or REJECTED adjustment can be, so it
    // applied nothing. Refusing here would strand a manager standing at the
    // shelf behind a key nothing can resolve.
    prisma.stockAdjustment.update.mockRejectedValueOnce(uniqueViolation());
    prisma.stockAdjustment.findFirst.mockResolvedValue(null);

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(prisma.stockAdjustment.update).toHaveBeenCalledTimes(1);
    expect(stockAdjustments.submit).toHaveBeenCalledWith('sa-2', expect.anything());
    expect(result.id).toBe('sa-2');
    expect(result.status).toBe('POSTED');
  });

  it('stamps the key on the count it created, so replay protection is the database’s job', async () => {
    const { service, prisma } = makeService();

    await service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser());

    expect(prisma.stockAdjustment.update).toHaveBeenCalledWith({
      where: { id: 'sa-1' },
      data: { idempotencyKey: COUNT_KEY },
    });
  });

  it('rests at PENDING_APPROVAL when the auto-post escape flag is off', async () => {
    const { service, stockAdjustments } = makeService();
    // The module-level flag ships true; this is the documented escape.
    (service as any).autoPostStockCounts = false;

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(stockAdjustments.submit).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(stockAdjustments.approve).not.toHaveBeenCalled();
    expect(stockAdjustments.post).not.toHaveBeenCalled();
    expect(result.status).toBe('PENDING_APPROVAL');
  });

  it('treats PENDING_APPROVAL as terminal on resume while the escape flag is off', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(
      countAdjustment({ status: 'PENDING_APPROVAL' }),
    );
    (service as any).autoPostStockCounts = false;

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(stockAdjustments.submit).not.toHaveBeenCalled();
    expect(stockAdjustments.approve).not.toHaveBeenCalled();
    expect(result.status).toBe('PENDING_APPROVAL');
  });

  it('returns server-truth variance and NEVER serializes cost/value fields (review-blocking)', async () => {
    const { service, prisma } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(
      countAdjustment({
        status: 'POSTED',
        lines: [
          {
            productId: 'product-1',
            systemQuantity: '7',
            countedQuantity: '5',
            varianceQuantity: '-2',
            // Whatever the core row carries, it must not reach the phone.
            unitCost: '1500',
          },
        ],
      }),
    );

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    const serialized = JSON.parse(JSON.stringify(result));
    expect(Object.keys(serialized).sort()).toEqual(
      ['id', 'adjustmentNumber', 'status', 'lines'].sort(),
    );
    for (const line of serialized.lines) {
      for (const forbidden of ['unitCost', 'averageCost', 'totalValue', 'unitPrice']) {
        expect(line).not.toHaveProperty(forbidden);
      }
      expect(Object.keys(line).sort()).toEqual(
        ['productId', 'systemQuantity', 'countedQuantity', 'varianceQuantity'].sort(),
      );
    }
  });
});

/**
 * The count reads balances TWICE and on purpose: quantityOnHand for the
 * server-authoritative system side (which travels into the payload), then
 * averageCost for the count-up cost precondition (which never leaves the
 * service). One mock, two answers, keyed on the select the service asked for.
 */
function balanceReads(prisma: any, rows: { onHand?: unknown[]; averageCost?: unknown[] } = {}) {
  prisma.inventoryBalance.findMany.mockImplementation(async (args: any) =>
    args?.select?.averageCost ? (rows.averageCost ?? []) : (rows.onHand ?? []),
  );
}

function averageCostRow(productId: string, averageCost: number) {
  return { productId, averageCost: String(averageCost) };
}

describe('MobilePosLiteService createStockCount count-up valuation', () => {
  it('rejects a count-up nothing can value, naming the product, BEFORE anything is created', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    // The blocker's shape: never received at this branch (no balance row, so no
    // averageCost) and priced nowhere.
    prisma.product.findMany.mockResolvedValue([
      stockProduct({ defaultPurchasePrice: null, productFamily: null }),
    ]);
    balanceReads(prisma, {});

    const promise = service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ lines: [{ productId: 'product-1', countedQuantity: 7 }] }),
      managerUser(),
    );

    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toThrow(
      'Maize Flour (product-1) has no buying price on record and cannot be counted up — the office must set one first',
    );
    // Nothing exists to strand: no adjustment, so no orphan a desktop user
    // could post, and no soft-delete to write either.
    expect(stockAdjustments.create).not.toHaveBeenCalled();
    expect(stockAdjustments.submit).not.toHaveBeenCalled();
    expect(stockAdjustments.approve).not.toHaveBeenCalled();
    expect(stockAdjustments.post).not.toHaveBeenCalled();
    expect(prisma.stockAdjustment.update).not.toHaveBeenCalled();
  });

  it('counts UP a product with no inventoryBalance row when its default purchase price values it (spec-inventory §7 case 2)', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    balanceReads(prisma, {});

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ lines: [{ productId: 'product-1', countedQuantity: 7 }] }),
      managerUser(),
    );

    expect(stockAdjustments.create.mock.calls[0][0].lines).toEqual([
      { productId: 'product-1', systemQuantity: 0, countedQuantity: 7, unitId: 'unit-1' },
    ]);
    expect(stockAdjustments.post).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(result.status).toBe('POSTED');
  });

  it('accepts a count-up priced only by the product family, exactly like post() resolves it', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.product.findMany.mockResolvedValue([
      stockProduct({
        defaultPurchasePrice: null,
        productFamily: { defaultPurchasePrice: '900' },
      }),
    ]);
    balanceReads(prisma, {});

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ lines: [{ productId: 'product-1', countedQuantity: 7 }] }),
      managerUser(),
    );

    expect(stockAdjustments.create).toHaveBeenCalled();
    expect(result.status).toBe('POSTED');
  });

  it('rejects a count-up whose product price is present but zero, family price notwithstanding', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    // post() reads the product's own price whenever it is non-null and only
    // then tests > 0 — the family is never consulted. Falling through to the
    // family here would put the rejection back inside post(), where it strands
    // the count at APPROVED.
    prisma.product.findMany.mockResolvedValue([
      stockProduct({
        defaultPurchasePrice: '0',
        productFamily: { defaultPurchasePrice: '900' },
      }),
    ]);
    balanceReads(prisma, {});

    await expect(
      service.createStockCount(
        TERMINAL_CODE,
        DEVICE_SECRET,
        countDto({ lines: [{ productId: 'product-1', countedQuantity: 7 }] }),
        managerUser(),
      ),
    ).rejects.toThrow('has no buying price on record and cannot be counted up');
    expect(stockAdjustments.create).not.toHaveBeenCalled();
  });

  it('values a count-up from the branch average cost when no default price exists anywhere', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.product.findMany.mockResolvedValue([
      stockProduct({ defaultPurchasePrice: null, productFamily: null }),
    ]);
    balanceReads(prisma, {
      onHand: [onHandRow('product-1', 4)],
      averageCost: [averageCostRow('product-1', 2500)],
    });

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ lines: [{ productId: 'product-1', countedQuantity: 7 }] }),
      managerUser(),
    );

    expect(stockAdjustments.create.mock.calls[0][0].lines).toEqual([
      { productId: 'product-1', systemQuantity: 4, countedQuantity: 7, unitId: 'unit-1' },
    ]);
    expect(result.status).toBe('POSTED');
    // The cost read is a precondition only — no cost may reach the payload.
    expect(stockAdjustments.create.mock.calls[0][0].lines[0]).not.toHaveProperty('unitCost');
  });

  it('never demands a cost for a count-DOWN on an unpriced product (post() relieves at the balance average)', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.product.findMany.mockResolvedValue([
      stockProduct({ defaultPurchasePrice: null, productFamily: null }),
    ]);
    balanceReads(prisma, { onHand: [onHandRow('product-1', 9)] });

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ lines: [{ productId: 'product-1', countedQuantity: 4 }] }),
      managerUser(),
    );

    expect(result.status).toBe('POSTED');
    expect(stockAdjustments.create.mock.calls[0][0].lines).toEqual([
      { productId: 'product-1', systemQuantity: 9, countedQuantity: 4, unitId: 'unit-1' },
    ]);
    // No count-up line, so the cost query never runs at all.
    expect(prisma.inventoryBalance.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('MobilePosLiteService createStockCount orphan safety', () => {
  it('leaves the count alive and resumable when post() refuses over a MISSING GL ACCOUNT — a curable company fault must never destroy a shop’s sheet', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    // The scenario that made the previous rule indefensible. A pilot company
    // whose chart has no inventory-adjustment-variance account is the EXPECTED
    // first-deployment state, and postAdjustmentLedger raises a plain 400 for
    // it — a sentence that ends in the word "retry". Read as a verdict about
    // the request, it soft-deleted the row, closed the key forever, and did the
    // same to every following sheet from the shop: hundreds of shelf counts
    // destroyed over a fault the office fixes in a minute, with nothing left to
    // post afterwards. The wrapper cannot tell a company fault from a body
    // fault after the fact, so it no longer tries: the row keeps its life.
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: 'APPROVED', notes: '[MPL-COUNT:k] Stock count' });
    stockAdjustments.post.mockRejectedValue(
      new BadRequestException(
        'Chart-of-accounts misconfiguration on company company-1: no "inventory adjustment variance" account is configured — create one and retry',
      ),
    );

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toThrow('create one and retry');

    // Nothing hidden, nothing deleted: the APPROVED row is still on the desktop
    // adjustments list for the office to post the moment the account exists.
    expectCountNeverRetired(prisma);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
        entityType: 'StockAdjustment',
        entityId: 'sa-1',
        severity: 'HIGH',
        newValue: expect.objectContaining({ stoppedAt: 'post', appliedMovements: 0 }),
      }),
    );
    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MOBILE_POS_LITE_STOCK_COUNT_COMPLETED' }),
    );
  });

  // The tripwire for the whole rule: whatever came out of the core chain, the
  // row survives it. Each of these was a real retirement trigger under the
  // 400/422 rule, and each is a property of the company or of the moment rather
  // than of the 350 numbers the manager counted.
  it.each([
    [
      'a missing variance account (company configuration)',
      new BadRequestException(
        'No "inventory adjustment variance" account is configured for company company-1 — create one and retry',
      ),
    ],
    [
      'a count-down that lost a race with a sale (the moment)',
      new BadRequestException(
        'Insufficient stock at branch/location branch-1: requested 5, available 0',
      ),
    ],
    [
      'an inactive branch (office state, cleared by reactivating it)',
      new BadRequestException('Branch is not active'),
    ],
  ])('never soft-deletes or closes a count over %s', async (_case, refusal) => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: 'APPROVED', notes: '[MPL-COUNT:k] Stock count' });
    stockAdjustments.post.mockRejectedValue(refusal);

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toBeInstanceOf(BadRequestException);

    expectCountNeverRetired(prisma);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED' }),
    );
  });

  it('lets the SAME frozen key post the count once the office fixed the configuration', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    // The other half of the rule, and the reason destroying the row was never
    // necessary: the phone keeps its key, so the retry drives the row that
    // already exists instead of minting a twin. Nothing probes for a "closed"
    // key any more, because nothing can close one.
    prisma.stockAdjustment.findFirst.mockResolvedValue(countAdjustment({ status: 'APPROVED' }));

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(result.status).toBe('POSTED');
    expect(stockAdjustments.create).not.toHaveBeenCalled();
    expect(prisma.stockAdjustment.count).not.toHaveBeenCalled();
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MOBILE_POS_LITE_STOCK_COUNT_COMPLETED' }),
    );
  });

  it('treats a missed marker as a first attempt and builds the count, with no closed-key probe in the way', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(null);

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(stockAdjustments.create).toHaveBeenCalled();
    expect(result.status).toBe('POSTED');
    // The retired-key probe is gone with the retirement it defended: a count
    // that is never soft-deleted is always found by its marker.
    expect(prisma.stockAdjustment.count).not.toHaveBeenCalled();
  });

  it('logs the chain when the key-claim window itself dies, so an unexplained DRAFT is never silent', async () => {
    const { service, prisma, auditLogs } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(null);
    // The row exists (create committed) and the very next write — same pool —
    // fails for a reason that is not the unique index. Before this the
    // exception left a marker-anchored DRAFT with no record that a terminal
    // count stopped there.
    prisma.stockAdjustment.update.mockRejectedValue(new Error('Connection reset by peer'));

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toThrow('Connection reset by peer');

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
        entityId: 'sa-1',
        newValue: expect.objectContaining({ stoppedAt: 'create', appliedMovements: null }),
      }),
    );
  });

  it('NEVER retires a count stranded by a Prisma transaction TIMEOUT — a hiccup must not cost a manager her count', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: 'APPROVED', notes: '[MPL-COUNT:k] Stock count' });
    // post() opens ONE interactive transaction doing ~10 round-trips per line,
    // so a 350-line closing count on a loaded droplet exhausts the transaction
    // timeout (P2028), or waits out the 2s connection-pool default, or deadlocks
    // against concurrent SALE_ISSUE movements. Every one of those rolls back
    // completely, which is exactly why movement evidence could never decide
    // anything on its own: round 2 read this the same way it read a refusal,
    // destroyed a perfectly valid count and then refused the identical resend
    // forever while the on-screen remedy told the manager to start the sheet
    // over. The row must stay exactly where it is so the frozen key resumes it.
    const timeout: any = new Error(
      'Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction.',
    );
    timeout.code = 'P2028';
    stockAdjustments.post.mockRejectedValue(timeout);

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toThrow('expired transaction');

    expectCountNeverRetired(prisma);
    // Left resumable, but never silent: the office has to be able to tell this
    // row from a routine pending count, and the log says where it stopped.
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
        entityId: 'sa-1',
        severity: 'HIGH',
        oldValue: { status: 'APPROVED' },
        newValue: expect.objectContaining({
          stoppedAt: 'post',
          appliedMovements: 0,
        }),
      }),
    );
  });

  it('settles and logs a chain abandoned at SUBMIT, destroying nothing', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce(countAdjustment({ status: 'DRAFT' }))
      .mockResolvedValueOnce({ status: 'DRAFT', notes: '[MPL-COUNT:k] Stock count' });
    // submit() is a plain findOne + update, so a pgbouncer restart or a pool
    // blip on that one write is enough. The row then sits at DRAFT reading like
    // an ordinary count someone started — with, before this, no audit row at
    // all, because only the post step was ever settled.
    stockAdjustments.submit.mockRejectedValue(new Error('Connection reset by peer'));

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toThrow('Connection reset by peer');

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
        entityId: 'sa-1',
        oldValue: { status: 'DRAFT' },
        newValue: expect.objectContaining({
          stoppedAt: 'submit',
          // Nothing was applied and nothing could have been: a DRAFT row moves
          // no stock. Unmeasured, not zero — the query is not worth running on
          // a connection that just failed.
          appliedMovements: null,
        }),
      }),
    );
    expect(prisma.stockAdjustment.updateMany).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.count).not.toHaveBeenCalled();
  });

  it('settles and logs a chain abandoned at APPROVE, destroying nothing', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce(countAdjustment({ status: 'PENDING_APPROVAL' }))
      .mockResolvedValueOnce({ status: 'PENDING_APPROVAL', notes: 'notes' });
    stockAdjustments.approve.mockRejectedValue(new Error('Connection reset by peer'));

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toThrow('Connection reset by peer');

    // Without this row the office reads SA-1 as a perfectly ordinary count
    // awaiting approval and posts it by hand the next morning.
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
        oldValue: { status: 'PENDING_APPROVAL' },
        newValue: expect.objectContaining({ stoppedAt: 'approve' }),
      }),
    );
    expectCountNeverRetired(prisma);
  });

  it('still writes the audit row when the settle path’s OWN queries fail', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: 'APPROVED', notes: 'notes' });
    stockAdjustments.post.mockRejectedValue(
      new BadRequestException(
        'Stock add for Maize Flour must include a unit cost greater than zero',
      ),
    );
    // The normal case: the connection that killed post() is still down, so the
    // evidence query dies too. Before this the exception propagated out of the
    // settle path and NOTHING was logged at all.
    prisma.inventoryMovement.count.mockRejectedValue(
      new Error('Connection terminated unexpectedly'),
    );

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toThrow('must include a unit cost greater than zero');

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
        newValue: expect.objectContaining({
          stoppedAt: 'post',
          // Unmeasured — and said so, so the office never reads it as proof
          // that nothing was applied.
          appliedMovements: null,
          settleFailed: 'Connection terminated unexpectedly',
        }),
      }),
    );
    expectCountNeverRetired(prisma);
  });

  it('never replaces the manager’s failure with the settle path’s own, even when the audit write dies too', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(countAdjustment({ status: 'APPROVED' }));
    stockAdjustments.post.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    prisma.inventoryMovement.count.mockRejectedValue(
      new Error('Timed out fetching a new connection from the connection pool'),
    );
    auditLogs.log.mockRejectedValue(new Error('Timed out fetching a new connection'));

    // The database is gone, so nothing can be recorded. What must still hold is
    // that the manager sees HER failure — the post one — and not the settle
    // path's own second-order noise, and that the row is untouched so the
    // frozen key resumes it.
    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toThrow('Connection terminated unexpectedly');
    expectCountNeverRetired(prisma);
  });

  it('re-reads the row with a deletedAt filter, so a soft-deleted row is observed as gone', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce(countAdjustment({ status: 'APPROVED' }))
      // Soft-deleted out from under the chain (the twin-detect loser is deleted
      // exactly this way, and a desk can delete one too). A soft delete does not
      // change `status`, so an unfiltered read returns the row still looking
      // APPROVED; the filter is what makes "no evidence" honest.
      .mockResolvedValueOnce(null);
    stockAdjustments.post.mockRejectedValue(
      new BadRequestException('Only APPROVED adjustments can be posted'),
    );

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toThrow('Only APPROVED adjustments can be posted');

    expect(prisma.stockAdjustment.findFirst).toHaveBeenCalledWith({
      where: { id: 'sa-1', deletedAt: null },
      select: { status: true, notes: true },
    });
    expect(prisma.stockAdjustment.updateMany).not.toHaveBeenCalled();
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
        oldValue: { status: 'UNKNOWN' },
      }),
    );
  });

  it('records the movements a failed post left behind, so the office can see the document disagrees with the ledger', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce(countAdjustment({ status: 'APPROVED' }))
      .mockResolvedValueOnce({ status: 'APPROVED', notes: 'notes' });
    stockAdjustments.post.mockRejectedValue(new Error('connection lost'));
    // The movement table says the work is out there while the document still
    // reads APPROVED. The count is measured for the LOG, never for a decision:
    // "resend it" and "look at this today" are different instructions and this
    // number is what tells them apart.
    prisma.inventoryMovement.count.mockResolvedValue(3);

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toThrow('connection lost');

    expectCountNeverRetired(prisma);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
        entityId: 'sa-1',
        newValue: expect.objectContaining({ appliedMovements: 3 }),
      }),
    );
  });

  it('reports the recorded POSTED truth when post() threw after the row was already posted', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce(countAdjustment({ status: 'APPROVED' }))
      .mockResolvedValueOnce({ status: 'POSTED' });
    stockAdjustments.post.mockRejectedValue(new Error('response lost'));

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(result.status).toBe('POSTED');
    expectCountNeverRetired(prisma);
  });

  it('leaves a count another desk moved out of APPROVED alone', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    // A desktop approver reverted the approval while the phone was retrying:
    // that row belongs to them now.
    prisma.stockAdjustment.findFirst
      .mockResolvedValueOnce(countAdjustment({ status: 'APPROVED' }))
      .mockResolvedValueOnce({ status: 'DRAFT' });
    stockAdjustments.post.mockRejectedValue(
      new BadRequestException('Only APPROVED adjustments can be posted'),
    );

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toThrow('Only APPROVED adjustments can be posted');

    expectCountNeverRetired(prisma);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
        oldValue: { status: 'DRAFT' },
      }),
    );
  });
});

/**
 * The capture's age. post() applies the variance frozen when the row was
 * created, which is the RIGHT number to apply while the shelf and the books
 * move together — every sale between the capture and the post moves both — and
 * becomes a second application of the same discrepancy once a desk, another
 * terminal or an unrecorded movement has been at the shelf in between. Nothing
 * available to the wrapper can tell those apart after the fact, so the capture
 * gets a life instead.
 */
describe('MobilePosLiteService createStockCount capture age', () => {
  it('refuses to post last night’s sheet this morning, leaving the row alive and logged', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();
    // 21:00 closing count, post() lost to a pool blip, the manager went home.
    // The phone's own copy invites exactly this ("hesabu yako ipo salama kwenye
    // simu hii — subiri kidogo, kisha ituma tena"), so the wrapper has to be
    // the thing that says no.
    prisma.stockAdjustment.findFirst.mockResolvedValue(
      countAdjustment({ status: 'APPROVED', createdAt: hoursAgo(11) }),
    );

    await expect(
      service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser()),
    ).rejects.toThrow(
      'This count was captured more than 6 hours ago and can no longer be sent from the phone — count the shelf again, or ask the office to post this one.',
    );

    expect(stockAdjustments.post).not.toHaveBeenCalled();
    // Refusing to post it automatically is not a verdict that it is worthless:
    // the row keeps its life and its place on the desktop list, and the office
    // gets the line saying what happened.
    expectCountNeverRetired(prisma);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
        entityId: 'sa-1',
        severity: 'HIGH',
        newValue: expect.objectContaining({ stoppedAt: 'resume' }),
      }),
    );
  });

  it('drives a capture still inside the window, so an ordinary retry is never punished', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(
      countAdjustment({ status: 'APPROVED', createdAt: hoursAgo(5) }),
    );

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(stockAdjustments.post).toHaveBeenCalledWith('sa-1', expect.anything());
    expect(result.status).toBe('POSTED');
  });

  it('replays an already POSTED count of ANY age — a replay applies nothing, and the phone needs the 2xx', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(
      countAdjustment({ status: 'POSTED', createdAt: hoursAgo(72) }),
    );

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    // Refusing this would strand a count that DID post behind a phone that can
    // never clear its draft — the failure mode the age bound exists to prevent,
    // inverted.
    expect(result.status).toBe('POSTED');
    expect(stockAdjustments.post).not.toHaveBeenCalled();
  });

  it('never refuses a row whose age it cannot prove', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(
      countAdjustment({ status: 'APPROVED', createdAt: null }),
    );

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    expect(stockAdjustments.post).toHaveBeenCalled();
    expect(result.status).toBe('POSTED');
  });

  it('leaves the age to the desk while the auto-post escape flag is off', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(
      countAdjustment({ status: 'PENDING_APPROVAL', createdAt: hoursAgo(30) }),
    );
    (service as any).autoPostStockCounts = false;

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto(),
      managerUser(),
    );

    // With the flag off this wrapper applies nothing at all, so an old capture
    // is a judgement for the approver holding the row, not a refusal here.
    expect(result.status).toBe('PENDING_APPROVAL');
    expect(stockAdjustments.approve).not.toHaveBeenCalled();
  });

  it('reads the ROW’s own timestamp, never the client’s countedAt', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(
      countAdjustment({ status: 'APPROVED', createdAt: hoursAgo(11) }),
    );

    // A phone whose clock says the sheet is minutes old must not be able to buy
    // itself more time: countedAt is informational, and phone clocks drift.
    await expect(
      service.createStockCount(
        TERMINAL_CODE,
        DEVICE_SECRET,
        countDto({ countedAt: new Date().toISOString() }),
        managerUser(),
      ),
    ).rejects.toThrow('can no longer be sent from the phone');
    expect(stockAdjustments.post).not.toHaveBeenCalled();
  });

  it('selects createdAt on the chain read, or the bound could never see an age', async () => {
    const { service, prisma } = makeService();

    await service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser());

    expect(prisma.stockAdjustment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ createdAt: true }),
      }),
    );
  });

  /**
   * The other side of the same life, and the side the harm actually lives on.
   * A row's createdAt bounds create -> post; it cannot see capture -> create,
   * and a sheet counted offline HAS no row until it is sent. 18:00 storeroom
   * count, no signal, phone put away; 08:00 she resumes the draft and taps
   * TUMA. This is a FIRST send: nothing is replayed, the variance is frozen
   * NOW against a balance that a night of trading has already moved, and every
   * unit sold overnight is booked back onto the shelf as stock found — with a
   * receipt showing exactly the numbers she expects.
   */
  it('refuses a FIRST send of a capture taken before the shop traded, creating nothing at all', async () => {
    const { service, prisma, stockAdjustments, auditLogs } = makeService();

    await expect(
      service.createStockCount(
        TERMINAL_CODE,
        DEVICE_SECRET,
        countDto({ countedAt: hoursAgo(14).toISOString() }),
        managerUser(),
      ),
    ).rejects.toThrow(
      'This count was captured more than 6 hours ago and can no longer be sent from the phone — count the shelf again.',
    );

    // A pre-create validation: nothing was built, so nothing is stranded and
    // there is no row for the office to be told about.
    expect(stockAdjustments.create).not.toHaveBeenCalled();
    expect(prisma.inventoryBalance.findMany).not.toHaveBeenCalled();
    expect(stockAdjustments.post).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED' }),
    );
  });

  it('drives a capture still inside the window on a first send, so the storeroom count sent when the signal returns is never punished', async () => {
    const { service, stockAdjustments } = makeService();

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ countedAt: hoursAgo(5).toISOString() }),
      managerUser(),
    );

    expect(stockAdjustments.create).toHaveBeenCalled();
    expect(result.status).toBe('POSTED');
  });

  it('never refuses a capture whose age it cannot establish', async () => {
    const { service, stockAdjustments } = makeService();

    // No stamp at all, and a stamp no clock can read: both are "age unknown",
    // and an unknown age never refuses — the same rule the resume side obeys.
    await service.createStockCount(TERMINAL_CODE, DEVICE_SECRET, countDto(), managerUser());
    await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ countedAt: 'not-a-timestamp' }),
      managerUser(),
    );

    expect(stockAdjustments.create).toHaveBeenCalledTimes(2);
  });

  it('measures the age on the phone’s own elapsed reading, so a device whose clock is hours behind still counts', async () => {
    const { service, stockAdjustments } = makeService();

    // The failing shape: an Android back from a flat battery with automatic
    // time off, sitting 8 hours behind. Its stamp reads 8h old against the
    // server clock, but the shelf was counted five minutes ago — and refusing
    // it would refuse the recount the message asks for, identically, forever.
    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ countedAt: hoursAgo(8).toISOString(), capturedAgoMs: 5 * 60 * 1000 }),
      managerUser(),
    );

    expect(stockAdjustments.create).toHaveBeenCalled();
    expect(result.status).toBe('POSTED');
  });

  it('still refuses a genuinely cold capture when the phone reports the elapsed time itself', async () => {
    const { service, stockAdjustments } = makeService();

    // Same single-clock reading, this time telling the truth about a sheet that
    // sat overnight: the bound has to survive the fix that made it skew-proof.
    await expect(
      service.createStockCount(
        TERMINAL_CODE,
        DEVICE_SECRET,
        countDto({ countedAt: new Date().toISOString(), capturedAgoMs: 13 * 60 * 60 * 1000 }),
        managerUser(),
      ),
    ).rejects.toThrow(/count the shelf again/i);

    expect(stockAdjustments.create).not.toHaveBeenCalled();
  });

  it('never refuses a capture stamped in the future, because a phone clock that runs fast is not a stale shelf', async () => {
    const { service, stockAdjustments } = makeService();

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ countedAt: hoursAgo(-9).toISOString() }),
      managerUser(),
    );

    expect(stockAdjustments.create).toHaveBeenCalled();
    expect(result.status).toBe('POSTED');
  });

  it('replays a POSTED count of any capture age — the create bound never touches a row that already exists', async () => {
    const { service, prisma, stockAdjustments } = makeService();
    prisma.stockAdjustment.findFirst.mockResolvedValue(
      countAdjustment({ status: 'POSTED', createdAt: hoursAgo(1) }),
    );

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ countedAt: hoursAgo(40).toISOString() }),
      managerUser(),
    );

    // The count posted; the phone only needs its 2xx to release the draft.
    // Refusing that would strand a sheet that DID post behind a phone that can
    // never clear it — the failure the bound exists to prevent, inverted.
    expect(result.status).toBe('POSTED');
    expect(stockAdjustments.post).not.toHaveBeenCalled();
  });

  it('leaves the create-side age to the desk while the auto-post escape flag is off', async () => {
    const { service, stockAdjustments } = makeService();
    (service as any).autoPostStockCounts = false;

    const result = await service.createStockCount(
      TERMINAL_CODE,
      DEVICE_SECRET,
      countDto({ countedAt: hoursAgo(20).toISOString() }),
      managerUser(),
    );

    // With the flag off this wrapper applies nothing at all: the count rests at
    // PENDING_APPROVAL and how old the capture is becomes a judgement for the
    // approver holding a document she can see.
    expect(stockAdjustments.create).toHaveBeenCalled();
    expect(result.status).toBe('PENDING_APPROVAL');
  });
});

describe('MobilePosLiteController stock-counts route', () => {
  it('gates POST /stock-counts on mobile_pos_lite.stock_count (the sole permission gate)', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MobilePosLiteController.prototype.createStockCount),
    ).toEqual(['mobile_pos_lite.stock_count']);
  });

  it('passes the terminal headers straight through to the service', () => {
    const service: any = { createStockCount: jest.fn().mockResolvedValue({ id: 'sa-1' }) };
    const controller = new MobilePosLiteController(service);
    const dto = countDto();
    const user = managerUser();

    controller.createStockCount(TERMINAL_CODE, DEVICE_SECRET, dto, user);

    expect(service.createStockCount).toHaveBeenCalledWith(TERMINAL_CODE, DEVICE_SECRET, dto, user);
  });
});
