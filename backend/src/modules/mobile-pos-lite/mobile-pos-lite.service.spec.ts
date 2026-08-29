import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
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
      // See productBatch below: present only so "stock moved exactly once" can
      // be asserted as "these were never called from here".
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
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
      // The purchase history's receipt-number join (spec-history-reports §1.2).
      findMany: jest.fn().mockResolvedValue([]),
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
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
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
      // Sales history + the day report's server-side recomputation. The
      // aggregate is the UNBOUNDED one both of them take their headline
      // figures from, so it defaults to an empty day rather than to the list.
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { totalAmount: null } }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    // The day report's product breakdown AND its items-sold total, summed by
    // the database over the whole day. Unbounded on purpose: a figure the
    // letterhead prints in `Muhtasari / Summary` must not come from a page.
    salesOrderLine: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    // The counter-sale delivery note's fast path. Null means "no note for this
    // sale yet" — the ordinary first sale. The company-scoped unique index on
    // (companyId, counterSaleOrderId) is what actually decides a create race;
    // this read only saves burning a DN- number on the ordinary replay.
    deliveryNote: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    // Nothing in this module may write stock directly, and the counter-delivery
    // chain least of all. Mocked so the double-stock assertion can prove they
    // were never called — NOT because any path here is expected to reach them.
    productBatch: {
      update: jest.fn().mockResolvedValue({}),
    },
    mobilePosDayReport: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      // The row is echoed back from the data the chain wrote, so the response
      // assertions below are reading what would actually have been stored —
      // above all the idempotency key the INSERT itself carries.
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: 'report-1',
          submittedAt: new Date('2026-08-14T15:42:11.000Z'),
          createdAt: new Date('2026-08-14T15:42:11.000Z'),
          updatedAt: new Date('2026-08-14T15:42:11.000Z'),
          ...data,
        }),
      ),
    },
  };
  const companyScope: any = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    assertGroupScoped: jest.fn(),
    // The office list resolves its company scope from the AuthUser, never from
    // a client-supplied companyId (spec-history-reports §1.5).
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
  };
  const auditLogs: any = { log: jest.fn().mockResolvedValue(undefined) };
  const salesOrders: any = {
    mobilePosLiteQuickSale: jest.fn().mockResolvedValue(completedSale()),
  };
  const deliveryNotes: any = {
    create: jest.fn().mockResolvedValue({ id: 'dn-1', status: 'DRAFT' }),
    dispatch: jest.fn().mockResolvedValue({ id: 'dn-1', status: 'DISPATCHED' }),
    deliver: jest.fn().mockResolvedValue({ id: 'dn-1', status: 'DELIVERED' }),
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
    deliveryNotes,
  );

  return {
    service,
    prisma,
    companyScope,
    salesOrders,
    purchaseOrders,
    goodsReceivedNotes,
    codes,
    auditLogs,
    generatedDocuments,
    stockAdjustments,
    deliveryNotes,
  };
}

/**
 * What salesOrders.mobilePosLiteQuickSale actually resolves with — the
 * SalesOrdersService.findOne() record, carrying the company, branch, customer
 * snapshot, order instant and lines. The counter-delivery note is built entirely
 * from this plus the authenticated user and the resolved terminal, so the mock
 * has to be the real shape or the test proves nothing.
 */
function completedSale(overrides: Record<string, unknown> = {}) {
  return {
    id: 'so-1',
    salesOrderNumber: 'SO-2026-000001',
    companyId: 'company-1',
    branchId: 'branch-1',
    customerId: 'customer-1',
    customerName: 'Walk-in',
    orderDate: new Date('2026-08-15T09:14:00.000Z'),
    status: 'CONFIRMED',
    lines: [
      {
        id: 'sol-1',
        productId: 'product-1',
        description: 'Maize Flour',
        // A Prisma Decimal arrives as a string-ish value, never a JS number.
        quantity: '2',
        unitId: 'unit-1',
      },
    ],
    ...overrides,
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

/**
 * THE COUNTER-SALE DELIVERY NOTE.
 *
 * A counter sale is delivered at the instant it is paid — the customer carries
 * the goods out — but fulfillment in this system is tracked ONLY by DeliveryNote
 * rows, so without this every POS sale read "Delivered: PENDING" for the life of
 * the order. These tests pin the four things that make the fix safe on a shop
 * that is trading right now:
 *
 *   1. exactly ONE note per sale, decided by the database and not by a read;
 *   2. stock moves exactly ONCE — the note adds nothing;
 *   3. a note that cannot be written NEVER takes the sale down;
 *   4. nothing is invented on the document.
 */
describe('MobilePosLiteService createSale counter delivery note', () => {
  function arrangeSale(harness: ReturnType<typeof makeService>) {
    harness.prisma.mobilePosTerminal.findFirst.mockResolvedValue(cashTerminalRow());
    harness.prisma.product.findMany.mockResolvedValue([saleProduct()]);
    return harness;
  }

  /** The one audit row written when the note could not be recorded. */
  function counterDeliveryFailureRows(auditLogs: any) {
    return auditLogs.log.mock.calls
      .map(([entry]: any[]) => entry)
      .filter((entry: any) => entry?.action === 'MOBILE_POS_LITE_COUNTER_DELIVERY_NOT_RECORDED');
  }

  // CD-1
  it('drives exactly one create -> dispatch -> deliver chain, keyed on the sales order', async () => {
    const harness = arrangeSale(makeService());
    const { service, deliveryNotes } = harness;

    await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    expect(deliveryNotes.create).toHaveBeenCalledTimes(1);
    expect(deliveryNotes.dispatch).toHaveBeenCalledTimes(1);
    expect(deliveryNotes.deliver).toHaveBeenCalledTimes(1);

    // The order of the three calls is the lifecycle, not an accident: dispatch
    // refuses a non-DRAFT note and deliver refuses a non-DISPATCHED one.
    const createdAt = deliveryNotes.create.mock.invocationCallOrder[0];
    const dispatchedAt = deliveryNotes.dispatch.mock.invocationCallOrder[0];
    const deliveredAt = deliveryNotes.deliver.mock.invocationCallOrder[0];
    expect(createdAt).toBeLessThan(dispatchedAt);
    expect(dispatchedAt).toBeLessThan(deliveredAt);

    const [dto, userId, context] = deliveryNotes.create.mock.calls[0];
    expect(dto.salesOrderId).toBe('so-1');
    expect(dto.companyId).toBe('company-1');
    expect(dto.branchId).toBe('branch-1');
    expect(userId).toBe('rep-1');
    // The replay key AND the worklist discriminator, derived server-side from
    // the sale and never from a request body.
    expect(context).toEqual({ counterSaleOrderId: 'so-1' });
  });

  // CD-2
  it('moves NO stock: the note writes no movement, balance or batch', async () => {
    const harness = arrangeSale(makeService());
    const { service, prisma } = harness;

    await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    // The sale issues its SALE_ISSUE movements inside SalesOrdersService.confirm(),
    // which is mocked away here — so anything below firing would be the delivery
    // note inventing a second decrement.
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.createMany).not.toHaveBeenCalled();
    expect(prisma.inventoryBalance.update).not.toHaveBeenCalled();
    expect(prisma.inventoryBalance.upsert).not.toHaveBeenCalled();
    expect(prisma.productBatch.update).not.toHaveBeenCalled();
  });

  // CD-2, the durable half.
  it('SOURCE GUARD: delivery-notes.service.ts has no stock effects at all', () => {
    // This is the assertion that keeps the change safe over time. Creating a
    // delivery note for a POS sale cannot double-decrement stock only because
    // DeliveryNotesService is a pure document lifecycle — create (DRAFT) ->
    // dispatch (DISPATCHED) -> deliver (DELIVERED) — with no inventory writes of
    // any kind. The mock assertions above cannot notice the day somebody adds
    // one; this can, and it fails loudly when they do.
    const source = readFileSync(
      join(__dirname, '..', 'delivery-notes', 'delivery-notes.service.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/inventoryMovement/);
    expect(source).not.toMatch(/inventoryBalance/);
    expect(source).not.toMatch(/productBatch/);
    expect(source).not.toMatch(/stockLedger/);
  });

  // CD-3
  it('REPLAY: a sale whose note already exists creates no second note', async () => {
    const harness = arrangeSale(makeService());
    const { service, prisma, deliveryNotes } = harness;
    prisma.deliveryNote.findFirst.mockResolvedValue({ id: 'dn-1', status: 'DELIVERED' });

    const result = await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    expect(deliveryNotes.create).not.toHaveBeenCalled();
    expect(deliveryNotes.dispatch).not.toHaveBeenCalled();
    expect(deliveryNotes.deliver).not.toHaveBeenCalled();
    // The replay still returns the original sale result to the rep.
    expect(result).toEqual(expect.objectContaining({ id: 'so-1' }));
  });

  // CD-3, the offline case that makes replay ordinary traffic rather than an edge.
  it('REPLAY: an offline-queued sale replayed on sync produces no second note', async () => {
    const harness = arrangeSale(makeService());
    const { service, prisma, salesOrders, deliveryNotes } = harness;

    // First delivery of the queued sale: the note is written.
    await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());
    expect(deliveryNotes.create).toHaveBeenCalledTimes(1);

    // The phone re-sends the same queued sale. replayQuickSale() resolves it to
    // the SAME SalesOrder row, so the second request arrives holding the same
    // sales-order id — which is exactly what the note's key is derived from.
    prisma.deliveryNote.findFirst.mockResolvedValue({ id: 'dn-1', status: 'DELIVERED' });
    const replayed = await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    expect(deliveryNotes.create).toHaveBeenCalledTimes(1);
    expect(replayed).toEqual(expect.objectContaining({ id: 'so-1' }));
    expect(salesOrders.mobilePosLiteQuickSale).toHaveBeenCalledTimes(2);
  });

  // CD-4
  it('CREATE RACE: a P2002 drives the row that owns the key, and never retries create', async () => {
    const harness = arrangeSale(makeService());
    const { service, prisma, deliveryNotes } = harness;
    // Both racers read "no note yet" — a read cannot settle a create race, which
    // is the whole reason the unique index exists.
    prisma.deliveryNote.findFirst
      .mockResolvedValueOnce(null)
      // ...then the loser reads back the row that OWNS the key.
      .mockResolvedValueOnce({ id: 'dn-winner', status: 'DRAFT' });
    deliveryNotes.create.mockRejectedValueOnce(uniqueViolation());

    const result = await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    expect(deliveryNotes.create).toHaveBeenCalledTimes(1);
    expect(deliveryNotes.dispatch).toHaveBeenCalledWith('dn-winner', 'rep-1');
    expect(deliveryNotes.deliver).toHaveBeenCalledWith('dn-winner', expect.anything(), 'rep-1');
    expect(result).toEqual(expect.objectContaining({ id: 'so-1' }));
  });

  // CD-5
  it('FAILURE ISOLATION: a note that cannot be written never fails the sale', async () => {
    const harness = arrangeSale(makeService());
    const { service, deliveryNotes, auditLogs } = harness;
    deliveryNotes.create.mockRejectedValue(new Error('delivery note exploded'));

    // The money and the stock ARE the sale. The note is a document about it.
    const result = await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());
    expect(result).toEqual(expect.objectContaining({ id: 'so-1' }));

    const failures = counterDeliveryFailureRows(auditLogs);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual(
      expect.objectContaining({
        entityType: 'SalesOrder',
        entityId: 'so-1',
        companyId: 'company-1',
        userId: 'rep-1',
        newValue: expect.objectContaining({
          salesOrderNumber: 'SO-2026-000001',
          reason: 'delivery note exploded',
        }),
      }),
    );

    // The sale's own completion row is still written and unharmed.
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MOBILE_POS_LITE_SALE_COMPLETED' }),
    );
  });

  // CD-6
  it('FAILURE ISOLATION: the sale still stands when the audit row ALSO fails', async () => {
    const harness = arrangeSale(makeService());
    const { service, deliveryNotes, auditLogs } = harness;
    deliveryNotes.create.mockRejectedValue(new Error('delivery note exploded'));
    // The audit row lives in the database that just failed, which is exactly
    // when the fallback matters. Only the failure row rejects — the sale's own
    // completion row is written before the chain runs and must be unaffected.
    auditLogs.log.mockImplementation((entry: any) =>
      entry?.action === 'MOBILE_POS_LITE_COUNTER_DELIVERY_NOT_RECORDED'
        ? Promise.reject(new Error('audit down'))
        : Promise.resolve(undefined),
    );

    await expect(
      service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser()),
    ).resolves.toEqual(expect.objectContaining({ id: 'so-1' }));
  });

  // CD-7
  it('RESUME: a note stranded at DISPATCHED is driven to DELIVERED, not re-created', async () => {
    const harness = arrangeSale(makeService());
    const { service, prisma, deliveryNotes } = harness;
    prisma.deliveryNote.findFirst.mockResolvedValue({ id: 'dn-7', status: 'DISPATCHED' });

    await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    expect(deliveryNotes.create).not.toHaveBeenCalled();
    expect(deliveryNotes.dispatch).not.toHaveBeenCalled();
    expect(deliveryNotes.deliver).toHaveBeenCalledTimes(1);
    expect(deliveryNotes.deliver.mock.calls[0][0]).toBe('dn-7');
  });

  // CD-7, the other stranded state.
  it('RESUME: a note stranded at DRAFT is dispatched and then delivered', async () => {
    const harness = arrangeSale(makeService());
    const { service, prisma, deliveryNotes } = harness;
    prisma.deliveryNote.findFirst.mockResolvedValue({ id: 'dn-8', status: 'DRAFT' });

    await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    expect(deliveryNotes.create).not.toHaveBeenCalled();
    expect(deliveryNotes.dispatch).toHaveBeenCalledWith('dn-8', 'rep-1');
    expect(deliveryNotes.deliver).toHaveBeenCalledTimes(1);
  });

  // CD-8
  it('a CANCELLED note is never resurrected, and the sale still returns', async () => {
    const harness = arrangeSale(makeService());
    const { service, prisma, deliveryNotes, auditLogs } = harness;
    prisma.deliveryNote.findFirst.mockResolvedValue({ id: 'dn-x', status: 'CANCELLED' });

    const result = await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    expect(deliveryNotes.create).not.toHaveBeenCalled();
    expect(deliveryNotes.dispatch).not.toHaveBeenCalled();
    expect(deliveryNotes.deliver).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ id: 'so-1' }));
    // Somebody cancelled it deliberately; the office gets a line, not a new note.
    expect(counterDeliveryFailureRows(auditLogs)).toHaveLength(1);
  });

  // CD-9 / CD-10
  it('FIELD DISCIPLINE: nothing is invented on the document', async () => {
    const harness = arrangeSale(makeService());
    const { service, deliveryNotes } = harness;

    await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    const [dto] = deliveryNotes.create.mock.calls[0];

    // The moment of the sale, not new Date(): an offline-queued sale replays
    // later, and a note dated a day after the goods left is a lie.
    expect(dto.deliveryDate).toBe(new Date('2026-08-15T09:14:00.000Z').toISOString());

    // There was no driver, no vehicle and no destination. Writing any of them
    // would be forging delivery evidence.
    expect(dto.driverName).toBeUndefined();
    expect(dto.vehicleNumber).toBeUndefined();
    expect(dto.deliveryAddress).toBeUndefined();
    expect(dto.receivedByPhone).toBeUndefined();

    // CD-10: the authenticated rep, a User id. terminal.salespersonId is an
    // EMPLOYEE id and DeliveryNote.deliveredById is an FK to User — passing it
    // would fail the FK on every single sale in the fleet.
    expect(dto.deliveredById).toBe('rep-1');
    expect(dto.deliveredById).not.toBe('employee-1');

    expect(dto.notes).toBe(`Counter sale — goods collected at the counter (${TERMINAL_CODE})`);

    expect(dto.lines).toHaveLength(1);
    for (const line of dto.lines) {
      expect(line.productId).toBe('product-1');
      expect(line.unitId).toBe('unit-1');
      // The Prisma value is a Decimal; the DTO wants a JS number.
      expect(typeof line.quantity).toBe('number');
      expect(line.quantity).toBe(2);
      // delivery_note_lines HAS NO salesOrderLineId COLUMN. A defined value
      // raises PrismaClientValidationError at runtime; only an absent key is
      // safe. This path stays immune by never emitting it.
      expect(line).not.toHaveProperty('salesOrderLineId');
    }
  });

  // CD-9, multi-line.
  it('a multi-line sale carries every line onto the note, in order', async () => {
    const harness = arrangeSale(makeService());
    const { service, salesOrders, deliveryNotes } = harness;
    salesOrders.mobilePosLiteQuickSale.mockResolvedValue(
      completedSale({
        lines: [
          { productId: 'product-1', description: 'Maize Flour', quantity: '2', unitId: 'unit-1' },
          { productId: 'product-2', description: 'Sugar', quantity: '5.5', unitId: 'unit-2' },
          { productId: 'product-3', description: null, quantity: '1', unitId: 'unit-1' },
        ],
      }),
    );

    await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    const [dto] = deliveryNotes.create.mock.calls[0];
    expect(dto.lines).toEqual([
      { productId: 'product-1', description: 'Maize Flour', quantity: 2, unitId: 'unit-1' },
      { productId: 'product-2', description: 'Sugar', quantity: 5.5, unitId: 'unit-2' },
      { productId: 'product-3', description: undefined, quantity: 1, unitId: 'unit-1' },
    ]);
    expect(deliveryNotes.deliver).toHaveBeenCalledTimes(1);
  });

  // CD-11
  it('a CREDIT counter sale is delivered too — the goods still walked out', async () => {
    const harness = makeService();
    const { service, prisma, deliveryNotes } = harness;
    prisma.mobilePosTerminal.findFirst.mockResolvedValue(cashTerminalRow({ creditEnabled: true }));
    prisma.product.findMany.mockResolvedValue([saleProduct()]);
    prisma.customer.findFirst.mockResolvedValue({ id: 'customer-9' });

    await service.createSale(
      TERMINAL_CODE,
      DEVICE_SECRET,
      saleDto({ paymentMethod: 'CREDIT', customerId: 'customer-9' }),
      repUser(),
    );

    // Only the money is owed. Excluding credit would leave exactly the orders
    // where fulfillment tracking matters most reading "never delivered".
    expect(deliveryNotes.create).toHaveBeenCalledTimes(1);
    expect(deliveryNotes.deliver).toHaveBeenCalledTimes(1);
  });

  // CD-12
  it('receivedByName repeats the party the sale is recorded against, and invents no person', async () => {
    const harness = arrangeSale(makeService());
    const { service, deliveryNotes } = harness;

    await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    const [noteId, deliverDto, userId] = deliveryNotes.deliver.mock.calls[0];
    expect(noteId).toBe('dn-1');
    expect(userId).toBe('rep-1');
    // For a walk-in this is the terminal's general customer — the shop's own
    // record of "walk-in". Never the rep's name, never "Collected".
    expect(deliverDto).toEqual({ receivedByName: 'Walk-in' });
    expect(deliverDto).not.toHaveProperty('receivedByPhone');
  });

  it('a sale with no lines writes no note at all', async () => {
    const harness = arrangeSale(makeService());
    const { service, salesOrders, deliveryNotes } = harness;
    salesOrders.mobilePosLiteQuickSale.mockResolvedValue(completedSale({ lines: [] }));

    const result = await service.createSale(TERMINAL_CODE, DEVICE_SECRET, saleDto(), repUser());

    expect(deliveryNotes.create).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ id: 'so-1' }));
  });
});

// ─── The historical half: POST /mobile-pos-lite/counter-delivery-backfill ─────

/** The office manager who runs the repair. Never a rep, never a terminal. */
function officeManager(): AuthUser {
  return { ...repUser(), id: 'manager-1', permissions: ['mobile_pos_lite.manage'] };
}

/**
 * A historical POS sales order as the backfill's own SELECT returns it, plus two
 * fixture-only fields the real query never selects:
 *
 *  - `status` / `deletedAt`, so the where-clause evaluator below can decide
 *    whether the row would have been selected at all;
 *  - `counterNotes`, standing in for "a delivery note already owns this order's
 *    (companyId, counterSaleOrderId) key" — the NOT EXISTS guard, and what the
 *    unique index enforces in the database.
 *
 * They are stripped before the row is handed to the service, so a test can never
 * pass because the service read a field the real query does not return.
 */
function historicalOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'so-312',
    salesOrderNumber: 'SO-2026-000312',
    companyId: 'company-1',
    branchId: 'branch-1',
    customerId: 'customer-1',
    customerName: 'Walk-in',
    orderDate: new Date('2026-08-14T08:05:00.000Z'),
    createdById: 'rep-7',
    mobilePosTerminalId: 'terminal-1',
    mobilePosTerminal: { terminalCode: TERMINAL_CODE },
    lines: [
      { productId: 'product-1', description: 'Maize Flour', quantity: '3', unitId: 'unit-1' },
    ],
    status: 'CONFIRMED',
    deletedAt: null,
    counterNotes: 0,
    ...overrides,
  };
}

/**
 * Evaluate the service's OWN where clause against a fixture row.
 *
 * This is the point of the fixture tests: the qualifiers are not asserted as a
 * shape somebody could keep passing while it means nothing — they are executed.
 * Drop `status` from the query and the DRAFT order flows through and writes a
 * note; drop the NOT EXISTS guard and an order that already has one is repaired
 * twice. Both fail here.
 */
function matchesBackfillWhere(where: any, order: any) {
  if (where.companyId && where.companyId !== order.companyId) return false;
  if (where.mobilePosTerminalId?.not === null && order.mobilePosTerminalId === null) return false;
  if (where.status?.in && !where.status.in.includes(order.status)) return false;
  if (where.deletedAt === null && order.deletedAt !== null) return false;
  if (where.lines?.some && (order.lines ?? []).length === 0) return false;
  if (
    where.deliveryNotes?.none?.counterSaleOrderId?.not === null &&
    (order.counterNotes ?? 0) > 0
  ) {
    return false;
  }
  return true;
}

/** Everything the real SELECT returns, and nothing it does not. */
function asSelectedRow(order: any) {
  const { status, deletedAt, counterNotes, ...selected } = order;
  return selected;
}

/**
 * Wire the prisma and delivery-note mocks to behave like the database this runs
 * against: the population is filtered, ordered and capped by the service's own
 * arguments, and — the part that makes re-runs mean anything — writing a note
 * takes that order OUT of the population, exactly as the unique index does.
 */
function arrangeBackfill(harness: ReturnType<typeof makeService>, fixture: any[]) {
  harness.prisma.salesOrder.findMany.mockImplementation(({ where, orderBy, take }: any) => {
    const rows = fixture.filter((order) => matchesBackfillWhere(where, order));
    if (orderBy?.orderDate === 'asc') {
      rows.sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());
    }
    return Promise.resolve(rows.slice(0, take).map(asSelectedRow));
  });
  harness.deliveryNotes.create.mockImplementation((dto: any) => {
    const row = fixture.find((order) => order.id === dto.salesOrderId);
    if (row) row.counterNotes += 1;
    return Promise.resolve({ id: `dn-${dto.salesOrderId}`, status: 'DRAFT' });
  });
  return harness;
}

/** The sales-order ids the run actually wrote a note for, in order. */
function backfilledOrderIds(deliveryNotes: any) {
  return deliveryNotes.create.mock.calls.map(([dto]: any[]) => dto.salesOrderId);
}

describe('MobilePosLiteService counterDeliveryBackfill', () => {
  // CD-18
  it('selects exactly the population spec §4.2 claims, oldest first, capped at 500', async () => {
    const { service, prisma, companyScope } = makeService();

    await service.counterDeliveryBackfill({}, officeManager());

    // The manager gate, asserted in the service and not only on the route.
    expect(companyScope.assertGroupScoped).toHaveBeenCalled();
    // Company scope comes from the AuthUser, never from an unchecked parameter.
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith(officeManager(), undefined);

    const [args] = prisma.salesOrder.findMany.mock.calls[0];
    expect(args.where).toEqual({
      companyId: 'company-1',
      // The only server-derived proof of POS origin.
      mobilePosTerminalId: { not: null },
      // confirm() IS the counter event; DRAFT never charged anybody and
      // CANCELLED/VOIDED means the counter reversed it.
      status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
      deletedAt: null,
      lines: { some: {} },
      // The no-existing-note guard.
      deliveryNotes: { none: { counterSaleOrderId: { not: null } } },
    });
    // Oldest first, so an interrupted run leaves a contiguous tail, not holes.
    expect(args.orderBy).toEqual({ orderDate: 'asc' });
    // A large history is repaired across several runs, never in one request.
    expect(args.take).toBe(500);
  });

  // CD-18, executed rather than asserted as a shape.
  it('never touches a desktop, DRAFT, CANCELLED, VOIDED, deleted, empty or already-noted order', async () => {
    const harness = arrangeBackfill(makeService(), [
      historicalOrder({ id: 'so-good-1', orderDate: new Date('2026-08-14T08:05:00.000Z') }),
      historicalOrder({
        id: 'so-good-2',
        status: 'PAID',
        orderDate: new Date('2026-08-15T09:14:00.000Z'),
      }),
      historicalOrder({
        id: 'so-good-3',
        status: 'PARTIALLY_PAID',
        orderDate: new Date('2026-08-15T10:00:00.000Z'),
      }),
      // Rung on the desktop. No terminal stamp, so no proof the goods ever
      // crossed a counter — and a cash desktop sale looks identical otherwise.
      historicalOrder({ id: 'so-desktop', mobilePosTerminalId: null, mobilePosTerminal: null }),
      // Never charged anybody; the goods never moved.
      historicalOrder({ id: 'so-draft', status: 'DRAFT' }),
      // The counter reversed these two.
      historicalOrder({ id: 'so-cancelled', status: 'CANCELLED' }),
      historicalOrder({ id: 'so-voided', status: 'VOIDED' }),
      historicalOrder({ id: 'so-deleted', deletedAt: new Date('2026-08-14T12:00:00.000Z') }),
      historicalOrder({ id: 'so-empty', lines: [] }),
      // Already repaired: its key is owned, and a second note would be a
      // duplicate fulfillment record on a one-item sale.
      historicalOrder({ id: 'so-noted', counterNotes: 1 }),
    ]);
    const { service, deliveryNotes } = harness;

    const report = await service.counterDeliveryBackfill({}, officeManager());

    expect(backfilledOrderIds(deliveryNotes)).toEqual(['so-good-1', 'so-good-2', 'so-good-3']);
    expect(report).toEqual({
      scanned: 3,
      created: 3,
      resumed: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    });
  });

  // CD-18, the chain each qualifying order gets.
  it('drives the same create -> dispatch -> deliver chain the live sale drives', async () => {
    const harness = arrangeBackfill(makeService(), [historicalOrder()]);
    const { service, deliveryNotes } = harness;

    await service.counterDeliveryBackfill({}, officeManager());

    expect(deliveryNotes.create).toHaveBeenCalledTimes(1);
    expect(deliveryNotes.dispatch).toHaveBeenCalledTimes(1);
    expect(deliveryNotes.deliver).toHaveBeenCalledTimes(1);
    expect(deliveryNotes.create.mock.invocationCallOrder[0]).toBeLessThan(
      deliveryNotes.dispatch.mock.invocationCallOrder[0],
    );
    expect(deliveryNotes.dispatch.mock.invocationCallOrder[0]).toBeLessThan(
      deliveryNotes.deliver.mock.invocationCallOrder[0],
    );

    // The same server-derived key the live path uses — which is why one shared
    // unique index covers history and new sales alike.
    const [, , context] = deliveryNotes.create.mock.calls[0];
    expect(context).toEqual({ counterSaleOrderId: 'so-312' });
    // receivedByName repeats the party the sale is recorded against; no person
    // is invented for a collection nobody signed for.
    expect(deliveryNotes.deliver.mock.calls[0][1]).toEqual({ receivedByName: 'Walk-in' });
  });

  // CD-19
  it('RE-RUNNABLE: a second run over a repaired population writes nothing', async () => {
    const fixture = [historicalOrder({ id: 'so-a' }), historicalOrder({ id: 'so-b' })];
    const harness = arrangeBackfill(makeService(), fixture);
    const { service, deliveryNotes } = harness;

    const first = await service.counterDeliveryBackfill({}, officeManager());
    expect(first).toMatchObject({ scanned: 2, created: 2, failed: 0 });
    expect(deliveryNotes.create).toHaveBeenCalledTimes(2);

    const second = await service.counterDeliveryBackfill({}, officeManager());

    expect(second).toEqual({
      scanned: 0,
      created: 0,
      resumed: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    });
    expect(deliveryNotes.create).toHaveBeenCalledTimes(2);
  });

  // CD-19, the layer that decides it when a read cannot.
  it('RE-RUNNABLE: a create race is settled by the unique index, not by the scan', async () => {
    const harness = arrangeBackfill(makeService(), [historicalOrder()]);
    const { service, prisma, deliveryNotes } = harness;
    // The order was selected as outstanding, then a concurrent replay of the
    // same sale claimed the key before this run's INSERT landed. Postgres stamps
    // createdAt at transaction START, so no read could have decided this.
    deliveryNotes.create.mockRejectedValueOnce(uniqueViolation());
    prisma.deliveryNote.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'dn-winner', status: 'DRAFT' });

    const report = await service.counterDeliveryBackfill({}, officeManager());

    // Not a failure and not a duplicate: the row that OWNS the key is driven.
    expect(report).toMatchObject({ scanned: 1, created: 0, resumed: 1, failed: 0 });
    expect(deliveryNotes.create).toHaveBeenCalledTimes(1);
    expect(deliveryNotes.dispatch).toHaveBeenCalledWith('dn-winner', 'rep-7');
  });

  // CD-19, a note left stranded by a §3 failure is healed, never duplicated.
  it('resumes a stranded note instead of creating a second one', async () => {
    const harness = arrangeBackfill(makeService(), [historicalOrder()]);
    const { service, prisma, deliveryNotes } = harness;
    prisma.deliveryNote.findFirst.mockResolvedValue({ id: 'dn-stranded', status: 'DISPATCHED' });

    const report = await service.counterDeliveryBackfill({}, officeManager());

    expect(deliveryNotes.create).not.toHaveBeenCalled();
    expect(deliveryNotes.deliver).toHaveBeenCalledTimes(1);
    expect(deliveryNotes.deliver.mock.calls[0][0]).toBe('dn-stranded');
    expect(report).toMatchObject({ created: 0, resumed: 1, skipped: 0, failed: 0 });
  });

  it('counts an already-DELIVERED note as skipped, not as work done', async () => {
    const harness = arrangeBackfill(makeService(), [historicalOrder()]);
    const { service, prisma, deliveryNotes } = harness;
    prisma.deliveryNote.findFirst.mockResolvedValue({ id: 'dn-done', status: 'DELIVERED' });

    const report = await service.counterDeliveryBackfill({}, officeManager());

    expect(deliveryNotes.create).not.toHaveBeenCalled();
    expect(deliveryNotes.dispatch).not.toHaveBeenCalled();
    expect(deliveryNotes.deliver).not.toHaveBeenCalled();
    expect(report).toMatchObject({ created: 0, resumed: 0, skipped: 1, failed: 0 });
  });

  // CD-20
  it('NO INVENTED EVIDENCE: every field on a backfilled note is a recorded fact', async () => {
    const harness = arrangeBackfill(makeService(), [historicalOrder()]);
    const { service, deliveryNotes } = harness;

    await service.counterDeliveryBackfill({}, officeManager());

    const [dto, userId] = deliveryNotes.create.mock.calls[0];

    // THE ORDER'S OWN DATE. `new Date()` here would back-date nothing and
    // misdate everything — the whole point of a backfill is the old date.
    expect(dto.deliveryDate).toBe(new Date('2026-08-14T08:05:00.000Z').toISOString());

    // There was no driver, no vehicle, no destination and no phone. Writing one
    // would be forging delivery evidence months after the fact.
    expect(dto.driverName).toBeUndefined();
    expect(dto.vehicleNumber).toBeUndefined();
    expect(dto.deliveryAddress).toBeUndefined();
    expect(dto.receivedByPhone).toBeUndefined();

    // The rep who actually rang it — a recorded fact and a valid User FK — not
    // the manager who happens to be running the repair today.
    expect(dto.deliveredById).toBe('rep-7');
    expect(dto.deliveredById).not.toBe('manager-1');
    expect(userId).toBe('rep-7');

    // The document says it was repaired, so nobody ever mistakes it for a note
    // a person wrote at the counter that day.
    expect(dto.notes).toBe(
      `Counter sale — goods collected at the counter (${TERMINAL_CODE}). Recorded by backfill on ${new Date()
        .toISOString()
        .slice(0, 10)}.`,
    );

    expect(dto.customerName).toBe('Walk-in');
    expect(dto.lines).toEqual([
      { productId: 'product-1', description: 'Maize Flour', quantity: 3, unitId: 'unit-1' },
    ]);
    for (const line of dto.lines) {
      expect(typeof line.quantity).toBe('number');
      // delivery_note_lines HAS NO salesOrderLineId COLUMN — a defined value
      // raises PrismaClientValidationError. The backfill inherits this path's
      // immunity by driving the same builder.
      expect(line).not.toHaveProperty('salesOrderLineId');
    }
  });

  // CD-20, the run itself is attributed even though the documents are not.
  it('records who ran the repair on the run audit row', async () => {
    const harness = arrangeBackfill(makeService(), [historicalOrder()]);
    const { service, auditLogs } = harness;

    await service.counterDeliveryBackfill({}, officeManager());

    const [entry] = auditLogs.log.mock.calls
      .map(([row]: any[]) => row)
      .filter((row: any) => row?.action === 'MOBILE_POS_LITE_COUNTER_DELIVERY_BACKFILL');
    expect(entry).toEqual(
      expect.objectContaining({
        entityType: 'SalesOrder',
        // The manager, not the rep the documents are attributed to.
        userId: 'manager-1',
        newValue: expect.objectContaining({ scanned: 1, created: 1, failed: 0 }),
      }),
    );
  });

  it('returns the report even when its own audit row cannot be written', async () => {
    const harness = arrangeBackfill(makeService(), [historicalOrder()]);
    const { service, auditLogs, deliveryNotes } = harness;
    auditLogs.log.mockRejectedValue(new Error('audit down'));

    // The notes are already written and correct; a failed log line must not turn
    // a successful repair into a 500 that sends the operator round again.
    const report = await service.counterDeliveryBackfill({}, officeManager());

    expect(report).toMatchObject({ scanned: 1, created: 1 });
    expect(deliveryNotes.deliver).toHaveBeenCalledTimes(1);
  });

  // CD-21
  it('counts one order’s failure and still processes the rest of the batch', async () => {
    const harness = arrangeBackfill(makeService(), [
      historicalOrder({ id: 'so-a', orderDate: new Date('2026-08-14T08:00:00.000Z') }),
      historicalOrder({
        id: 'so-b',
        salesOrderNumber: 'SO-2026-000313',
        orderDate: new Date('2026-08-14T09:00:00.000Z'),
      }),
      historicalOrder({ id: 'so-c', orderDate: new Date('2026-08-14T10:00:00.000Z') }),
    ]);
    const { service, deliveryNotes } = harness;
    const good = deliveryNotes.create.getMockImplementation()!;
    deliveryNotes.create.mockImplementation((dto: any, ...rest: any[]) =>
      dto.salesOrderId === 'so-b'
        ? Promise.reject(new Error('delivery note exploded'))
        : good(dto, ...rest),
    );

    const report = await service.counterDeliveryBackfill({}, officeManager());

    // The run does not abort, and the failed order is left exactly as it was —
    // the next run will pick it up again.
    expect(report).toMatchObject({ scanned: 3, created: 2, failed: 1 });
    expect(report.failures).toEqual([
      {
        salesOrderId: 'so-b',
        salesOrderNumber: 'SO-2026-000313',
        reason: 'delivery note exploded',
      },
    ]);
    expect(backfilledOrderIds(deliveryNotes)).toEqual(['so-a', 'so-b', 'so-c']);
    expect(deliveryNotes.deliver).toHaveBeenCalledTimes(2);
  });

  it('BATCH BOUNDARY: one request repairs at most 500 orders and the next takes the rest', async () => {
    const fixture = Array.from({ length: 503 }, (_, index) =>
      historicalOrder({
        id: `so-${String(index).padStart(4, '0')}`,
        salesOrderNumber: `SO-2026-${String(index).padStart(6, '0')}`,
        // Oldest first, so the batch boundary is deterministic.
        orderDate: new Date(Date.UTC(2026, 0, 1) + index * 60_000),
      }),
    );
    const harness = arrangeBackfill(makeService(), fixture);
    const { service, deliveryNotes } = harness;

    const first = await service.counterDeliveryBackfill({}, officeManager());
    expect(first).toMatchObject({ scanned: 500, created: 500, failed: 0 });
    expect(backfilledOrderIds(deliveryNotes)[0]).toBe('so-0000');
    expect(backfilledOrderIds(deliveryNotes)[499]).toBe('so-0499');

    // The script keeps posting while a run makes progress; the second request
    // sees a population 500 rows smaller and finishes it.
    const second = await service.counterDeliveryBackfill({}, officeManager());
    expect(second).toMatchObject({ scanned: 3, created: 3, failed: 0 });
    expect(backfilledOrderIds(deliveryNotes).slice(500)).toEqual(['so-0500', 'so-0501', 'so-0502']);

    const third = await service.counterDeliveryBackfill({}, officeManager());
    expect(third).toMatchObject({ scanned: 0, created: 0 });
  });

  it('INTERRUPTED RUN: a re-run repairs the remainder and nothing else', async () => {
    const fixture = [
      historicalOrder({ id: 'so-a', orderDate: new Date('2026-08-14T08:00:00.000Z') }),
      historicalOrder({ id: 'so-b', orderDate: new Date('2026-08-14T09:00:00.000Z') }),
      historicalOrder({ id: 'so-c', orderDate: new Date('2026-08-14T10:00:00.000Z') }),
    ];
    const harness = arrangeBackfill(makeService(), fixture);
    const { service, deliveryNotes } = harness;

    // The connection dropped after so-b committed. Every order is its own
    // committed chain, so the two that landed stand and the third did not start.
    const good = deliveryNotes.create.getMockImplementation()!;
    deliveryNotes.create.mockImplementation((dto: any, ...rest: any[]) =>
      dto.salesOrderId === 'so-c'
        ? Promise.reject(new Error('socket hang up'))
        : good(dto, ...rest),
    );
    const interrupted = await service.counterDeliveryBackfill({}, officeManager());
    expect(interrupted).toMatchObject({ created: 2, failed: 1 });

    deliveryNotes.create.mockImplementation(good);
    const resumedRun = await service.counterDeliveryBackfill({}, officeManager());

    // Only what was still outstanding — the two that landed are not touched.
    expect(resumedRun).toMatchObject({ scanned: 1, created: 1, failed: 0 });
    expect(backfilledOrderIds(deliveryNotes).slice(3)).toEqual(['so-c']);
  });

  it('MOVES NO STOCK: repairing history writes no movement, balance or batch', async () => {
    const harness = arrangeBackfill(makeService(), [
      historicalOrder({ id: 'so-a' }),
      historicalOrder({ id: 'so-b', orderDate: new Date('2026-08-14T09:00:00.000Z') }),
    ]);
    const { service, prisma } = harness;

    await service.counterDeliveryBackfill({}, officeManager());

    // The SALE_ISSUE movements were written by SalesOrdersService.confirm() when
    // the customer paid. Anything below firing would be a SECOND decrement, on
    // stock counted and sold months ago — the one failure that would be
    // unrecoverable without a manual count.
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.createMany).not.toHaveBeenCalled();
    expect(prisma.inventoryBalance.update).not.toHaveBeenCalled();
    expect(prisma.inventoryBalance.upsert).not.toHaveBeenCalled();
    expect(prisma.productBatch.update).not.toHaveBeenCalled();
    // And nothing about the sales orders themselves is rewritten.
    expect(prisma.salesOrder.findFirst).not.toHaveBeenCalled();
  });

  it('a companyId narrows the run, and must carry WRITE on that company', async () => {
    const harness = arrangeBackfill(makeService(), [historicalOrder()]);
    const { service, prisma, companyScope } = harness;
    companyScope.companyWhereFor.mockResolvedValue({ companyId: 'company-2' });

    await service.counterDeliveryBackfill({ companyId: 'company-2' }, officeManager());

    // Repairing history writes business documents, so READ is not enough.
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      officeManager(),
      'company-2',
      'WRITE',
    );
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith(officeManager(), 'company-2');
    expect(prisma.salesOrder.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ companyId: 'company-2' }),
    );
  });

  it('refuses a caller the company scope rejects, before anything is written', async () => {
    const harness = arrangeBackfill(makeService(), [historicalOrder()]);
    const { service, prisma, companyScope, deliveryNotes } = harness;
    companyScope.assertCanAccessCompany.mockRejectedValue(new Error('no access to this company'));

    await expect(
      service.counterDeliveryBackfill({ companyId: 'company-9' }, officeManager()),
    ).rejects.toThrow('no access to this company');

    expect(prisma.salesOrder.findMany).not.toHaveBeenCalled();
    expect(deliveryNotes.create).not.toHaveBeenCalled();
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

  it('prints the VAT-inclusive unit price for derived net lines so qty x unit price == line total', async () => {
    const { service, prisma, generatedDocuments } = makeService();
    // Post inclusive-VAT derivation the persisted unitPrice is NET (ex-VAT)
    // while lineTotal is the gross amount the customer paid. The receipt must
    // print the gross per-unit price (sticker price), not the net figure —
    // otherwise the paper reads 1 x 847 = 1,000 with no explanation.
    prisma.salesOrder.findFirst.mockResolvedValue(
      saleRow({
        totalAmount: '11000',
        lines: [
          {
            description: 'Sukari',
            quantity: '1',
            unitPrice: '847.46', // net after 18% carved out of gross 1,000
            taxAmount: '152.54',
            lineTotal: '1000',
            product: { name: 'Sukari' },
          },
          {
            description: 'Mchele',
            quantity: '2',
            unitPrice: '4237.29', // net after 18% carved out of gross 5,000/unit
            taxAmount: '1525.42',
            lineTotal: '10000',
            product: { name: 'Mchele' },
          },
        ],
      }),
    );

    await service.saleReceipt(TERMINAL_CODE, DEVICE_SECRET, 'so-1', repUser());

    // The line query must fetch taxAmount so the renderer can reconstruct the
    // gross price even when quantity is unusable.
    expect(prisma.salesOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          lines: expect.objectContaining({
            select: expect.objectContaining({ taxAmount: true }),
          }),
        }),
      }),
    );

    const model = generatedDocuments.renderLetterheadPdf.mock.calls[0][1];
    const items = model.sections.find((s: any) => s.title === 'Bidhaa / Items');
    // Rows multiply out again: 1 x 1,000 = 1,000 and 2 x 5,000 = 10,000.
    expect(items.table.rows).toEqual([
      ['Sukari', '1', 'TZS 1,000', 'TZS 1,000'],
      ['Mchele', '2', 'TZS 5,000', 'TZS 10,000'],
    ]);
    // Receipt totals are untouched by the unit-price fix.
    expect(items.totals).toEqual([{ label: 'JUMLA / TOTAL', value: 'TZS 11,000', emphasis: true }]);
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

// ───────────────────────────────────────────────────────────────────────────────
// Historia (sales + purchase viewing) and Funga Siku (the end-of-day report)
// — spec-history-reports. Everything below is additive.
// ───────────────────────────────────────────────────────────────────────────────

const DAY_REPORT_KEY = 'offline-day-report-key-0001';

/**
 * THE BUSINESS TIMEZONE, restated here on purpose.
 *
 * These expectations are computed from the zone by NAME, never from the
 * machine's own and never from a hard-coded +3, so the suite asserts the same
 * boundary whether it runs on a UTC container, a developer's laptop in EAT, or
 * a CI box in California. That independence IS the regression: the shipped
 * container sets no TZ, and reading the day from the process's zone is what cut
 * every trading day at 03:00 EAT and refused every close made before it.
 */
const BUSINESS_TZ = 'Africa/Nairobi';

const businessClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function businessFields(value: Date) {
  const parts = businessClock.formatToParts(value);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** The `YYYY-MM-DD` business day `offsetDays` days back from now. */
function localDateKey(offsetDays = 0) {
  const at = businessFields(new Date());
  const day = new Date(Date.UTC(at.year, at.month - 1, at.day - offsetDays));
  return day.toISOString().slice(0, 10);
}

/** The instant midnight begins in the business zone on that calendar day. */
function businessMidnight(dayKey: string) {
  const wallClock = Date.parse(`${dayKey}T00:00:00.000Z`);
  const offsetAt = (instant: Date) => {
    const at = businessFields(instant);
    return (
      Date.UTC(at.year, at.month - 1, at.day, at.hour, at.minute, at.second) - instant.getTime()
    );
  };
  const guess = new Date(wallClock - offsetAt(new Date(wallClock)));
  return new Date(wallClock - offsetAt(guess));
}

/** Business-zone midnight today, and the two boundaries both history lists sit between. */
function historyBoundaries() {
  const today = localDateKey();
  return {
    dayStart: businessMidnight(today),
    // Today counts as day 1, so "siku 7" is today plus the six before it.
    from: businessMidnight(localDateKey(6)),
    dayEnd: businessMidnight(localDateKey(-1)),
  };
}

/**
 * A SalesOrder row as the sales-history select block reads it.
 */
function historySaleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'so-1',
    salesOrderNumber: 'SO-2026-0912',
    createdAt: new Date('2026-08-14T09:14:00.000Z'),
    paymentMethod: 'CASH',
    paymentReference: null,
    customerName: null,
    totalAmount: '18000',
    customer: { name: 'Mama Asha' },
    lines: [
      {
        productId: 'product-1',
        description: 'Embe Dodo',
        quantity: '3',
        unitPrice: '6000',
        lineTotal: '18000',
        product: { name: 'Embe Dodo' },
        unit: { symbol: 'pc' },
      },
    ],
    ...overrides,
  };
}

/**
 * A PurchaseOrder row carrying NON-ZERO buying costs at both levels. The point
 * of the fixture is that the leak is available to leak: unitCost, lineTotal and
 * totalAmount are all present on the object the service reads, so a payload
 * built by spreading a Prisma row would carry them and the key-set assertion
 * below would catch it.
 */
function historyPurchaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    purchaseOrderNumber: 'PO-2026-0141',
    createdAt: new Date('2026-08-13T09:14:00.000Z'),
    subtotal: '480000',
    totalAmount: '480000',
    paidAmount: '0',
    outstandingAmount: '480000',
    supplier: { name: 'Azam Distributors' },
    lines: [
      {
        productId: 'product-1',
        description: 'Embe Dodo',
        quantity: '24',
        unitCost: '20000',
        lineTotal: '480000',
        product: { name: 'Embe Dodo' },
        unit: { symbol: 'pc' },
      },
    ],
    ...overrides,
  };
}

function dayReportDto(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: DAY_REPORT_KEY,
    businessDate: localDateKey(),
    heldCount: 0,
    heldAmount: 0,
    ...overrides,
  } as any;
}

/** A stored MobilePosDayReport, as the replay and PDF paths read it back. */
function dayReportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-1',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    branchName: 'Branch',
    terminalId: 'terminal-1',
    terminalCode: TERMINAL_CODE,
    terminalName: 'Counter 1',
    repUserId: 'rep-1',
    repName: 'Rep One',
    businessDate: new Date(`${localDateKey()}T00:00:00.000Z`),
    salesCount: 23,
    grossTotal: '412000',
    itemsSoldQuantity: '87',
    byMethod: [{ paymentMethod: 'CASH', label: 'Fedha', count: 19, amount: 331000 }],
    items: [{ productId: 'product-1', name: 'Embe Dodo', quantity: 14, amount: 84000 }],
    itemsTruncated: false,
    declaredHeldCount: 0,
    declaredHeldAmount: '0',
    idempotencyKey: DAY_REPORT_KEY,
    submittedAt: new Date('2026-08-14T15:42:11.000Z'),
    createdAt: new Date('2026-08-14T15:42:11.000Z'),
    updatedAt: new Date('2026-08-14T15:42:11.000Z'),
    ...overrides,
  };
}

/**
 * One row of the day report's product breakdown as `salesOrderLine.groupBy`
 * returns it: the DATABASE's sum for a product over the whole window, not a
 * page of orders summed in JS.
 */
function dayReportLineGroup(
  productId: string,
  quantity: string | number,
  lineTotal: string | number,
) {
  return { productId, _sum: { quantity: String(quantity), lineTotal: String(lineTotal) } };
}

/**
 * Every key in a serialised payload, recursively.
 *
 * KEYS ONLY, never values: a product legitimately named "Total Motor Oil" must
 * not fail the build. This is what makes the cost assertions survive the change
 * they exist for — a column added to PurchaseOrderLine or SalesOrderLine next
 * year cannot slip through a suite that still passes, because the assertion is
 * over the whole set rather than over a list of today's field names.
 */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [
      key,
      ...allKeys(nested),
    ]);
  }
  return [];
}

describe('MobilePosLiteService salesHistory', () => {
  it('scopes to this terminal and this rep over the 7-day local-midnight window', async () => {
    const { service, prisma } = makeService();
    const { from, dayEnd } = historyBoundaries();

    const result = await service.salesHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());

    const expectedWhere = {
      companyId: 'company-1',
      mobilePosTerminalId: 'terminal-1',
      // Per-rep, exactly like mySalesToday: sales are personal accountability.
      createdById: 'rep-1',
      status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
      orderDate: { gte: from, lt: dayEnd },
    };
    expect(prisma.salesOrder.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
    expect(result.days).toBe(7);
    expect(result.from).toBe(from.toISOString());
  });

  it('takes the headline figures from the UNBOUNDED aggregate, never from the truncated list', async () => {
    const { service, prisma } = makeService();
    // 900 sales in the window; the list carries the newest 200. If the totals
    // came from the rows a rep would be told she sold a fraction of her week.
    prisma.salesOrder.aggregate.mockResolvedValue({
      _count: { _all: 900 },
      _sum: { totalAmount: '4120000' },
    });
    prisma.salesOrder.findMany.mockResolvedValue([historySaleRow()]);

    const result = await service.salesHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());

    expect(result.count).toBe(900);
    expect(result.totalAmount).toBe(4120000);
    expect(result.sales).toHaveLength(1);
  });

  it('serializes selling prices and NEVER cost or margin (review-blocking)', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.aggregate.mockResolvedValue({
      _count: { _all: 1 },
      _sum: { totalAmount: '18000' },
    });
    prisma.salesOrder.findMany.mockResolvedValue([historySaleRow()]);

    const result = await service.salesHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());
    const serialized = JSON.parse(JSON.stringify(result));

    expect(Object.keys(serialized).sort()).toEqual([
      'count',
      'days',
      'from',
      'sales',
      'totalAmount',
    ]);
    expect(Object.keys(serialized.sales[0]).sort()).toEqual([
      'createdAt',
      'customerName',
      'id',
      'lines',
      'paymentMethod',
      'paymentReference',
      'salesOrderNumber',
      'totalAmount',
    ]);
    expect(Object.keys(serialized.sales[0].lines[0]).sort()).toEqual([
      'lineTotal',
      'name',
      'productId',
      'quantity',
      'unitPrice',
      'unitSymbol',
    ]);
    // Selling-side numbers ride on purpose — they are already on the phone in
    // the catalog and on every printed receipt. The buying side never does.
    expect(serialized.sales[0].lines[0]).toMatchObject({ unitPrice: 6000, lineTotal: 18000 });
    expect(allKeys(serialized).filter((key) => /cost|margin|profit|cogs/i.test(key))).toEqual([]);
    for (const forbidden of [
      'unitCostAtSale',
      'cogsAmount',
      'grossProfitAmount',
      'grossMarginPct',
    ]) {
      expect(serialized.sales[0].lines[0]).not.toHaveProperty(forbidden);
    }
  });

  it('never uses include, at any level', async () => {
    const { service, prisma } = makeService();

    await service.salesHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());

    const [args] = prisma.salesOrder.findMany.mock.calls[0];
    expect(args.include).toBeUndefined();
    expect(args.select.lines.include).toBeUndefined();
    expect(Object.keys(args.select.lines.select).sort()).toEqual([
      'description',
      'lineTotal',
      'product',
      'productId',
      'quantity',
      'unit',
      'unitPrice',
    ]);
  });

  it('prefers the linked customer name, falls back to the snapshot, then to null', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findMany.mockResolvedValue([
      historySaleRow({ id: 'so-linked' }),
      historySaleRow({ id: 'so-snapshot', customer: null, customerName: 'Mzee Juma' }),
      historySaleRow({ id: 'so-none', customer: null, customerName: null }),
    ]);

    const result = await service.salesHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());

    expect(result.sales.map((sale: any) => sale.customerName)).toEqual([
      'Mama Asha',
      'Mzee Juma',
      null,
    ]);
  });

  it('names a line from the product, then the description, then empty', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findMany.mockResolvedValue([
      historySaleRow({
        lines: [
          { ...historySaleRow().lines[0], product: null, description: 'Free text line' },
          { ...historySaleRow().lines[0], product: null, description: null, unit: null },
        ],
      }),
    ]);

    const result = await service.salesHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());

    expect(result.sales[0].lines.map((line: any) => line.name)).toEqual(['Free text line', '']);
    expect(result.sales[0].lines[1].unitSymbol).toBe('');
  });
});

describe('MobilePosLiteService purchaseHistory', () => {
  it('scopes to the terminal BRANCH, POS-originated rows only, over the 7-day window', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findMany.mockResolvedValue([]);
    const { from, dayEnd } = historyBoundaries();

    const result = await service.purchaseHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());

    expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          // Branch, not rep: receiving is a branch activity and the manager
          // sees the branch's whole POS receiving book.
          branchId: 'branch-1',
          purchaseType: 'STOCK_PURCHASE',
          deletedAt: null,
          // Marker-filtered: desktop-ERP purchases at the same branch are not
          // this screen's book.
          notes: { contains: '[MPL-PURCHASE:' },
          createdAt: { gte: from, lt: dayEnd },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
    expect(result.days).toBe(7);
    expect(result.from).toBe(from.toISOString());
    expect(result.purchases).toEqual([]);
    // Nothing to join receipts for — the second query is skipped entirely.
    expect(prisma.goodsReceivedNote.findMany).not.toHaveBeenCalled();
  });

  it('never uses include, so no cost column can ride out on a relation', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findMany.mockResolvedValue([historyPurchaseRow()]);

    await service.purchaseHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());

    const [args] = prisma.purchaseOrder.findMany.mock.calls[0];
    expect(args.include).toBeUndefined();
    expect(Object.keys(args.select).sort()).toEqual([
      'createdAt',
      'id',
      'lines',
      'purchaseOrderNumber',
      'supplier',
    ]);
    expect(args.select.lines.include).toBeUndefined();
    expect(Object.keys(args.select.lines.select).sort()).toEqual([
      'description',
      'product',
      'productId',
      'quantity',
      'unit',
    ]);
    // The receipt-number join is cost-free too.
    const [grnArgs] = prisma.goodsReceivedNote.findMany.mock.calls[0];
    expect(grnArgs.include).toBeUndefined();
    expect(Object.keys(grnArgs.select).sort()).toEqual(['grnNumber', 'purchaseOrderId', 'status']);
  });

  it('returns the EXACT key set and no cost, total or value field anywhere (review-blocking)', async () => {
    const { service, prisma } = makeService();
    // The fixture carries real buying costs at both levels — the leak is
    // available to leak.
    prisma.purchaseOrder.findMany.mockResolvedValue([historyPurchaseRow()]);
    prisma.goodsReceivedNote.findMany.mockResolvedValue([
      { purchaseOrderId: 'po-1', grnNumber: 'GRN-2026-0139', status: 'POSTED' },
    ]);

    const result = await service.purchaseHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());
    const serialized = JSON.parse(JSON.stringify(result));

    // Top level: no window total, and there never will be one.
    expect(Object.keys(serialized).sort()).toEqual(['count', 'days', 'from', 'purchases']);
    expect(Object.keys(serialized.purchases[0]).sort()).toEqual([
      'grnNumber',
      'id',
      'lines',
      'purchaseOrderNumber',
      'recordedAt',
      'status',
      'supplierName',
    ]);
    expect(Object.keys(serialized.purchases[0].lines[0]).sort()).toEqual([
      'name',
      'productId',
      'quantity',
      'unitSymbol',
    ]);
    // And recursively, so a field added to PurchaseOrder or PurchaseOrderLine
    // next year cannot slip through a suite that still passes.
    expect(
      allKeys(serialized).filter((key) =>
        /cost|price|amount|total|value|margin|profit|cogs/i.test(key),
      ),
    ).toEqual([]);
    expect(serialized.purchases[0]).toEqual({
      id: 'po-1',
      purchaseOrderNumber: 'PO-2026-0141',
      grnNumber: 'GRN-2026-0139',
      supplierName: 'Azam Distributors',
      recordedAt: '2026-08-13T09:14:00.000Z',
      status: 'COMPLETE',
      lines: [{ productId: 'product-1', name: 'Embe Dodo', quantity: 24, unitSymbol: 'pc' }],
    });
  });

  it('surfaces an interrupted chain honestly as INCOMPLETE with a null GRN number', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findMany.mockResolvedValue([
      historyPurchaseRow({ id: 'po-done' }),
      historyPurchaseRow({ id: 'po-stuck' }),
      historyPurchaseRow({ id: 'po-none' }),
    ]);
    prisma.goodsReceivedNote.findMany.mockResolvedValue([
      { purchaseOrderId: 'po-done', grnNumber: 'GRN-1', status: 'POSTED' },
      // An APPROVED-but-unposted receipt moved no stock, so the delivery is not
      // complete and hiding it would make a stock movement unexplainable.
      { purchaseOrderId: 'po-stuck', grnNumber: 'GRN-2', status: 'APPROVED' },
    ]);

    const result = await service.purchaseHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());

    expect(
      result.purchases.map((purchase: any) => [purchase.id, purchase.status, purchase.grnNumber]),
    ).toEqual([
      ['po-done', 'COMPLETE', 'GRN-1'],
      ['po-stuck', 'INCOMPLETE', null],
      ['po-none', 'INCOMPLETE', null],
    ]);
  });

  it('empties a deleted supplier to a blank name rather than crashing the screen', async () => {
    const { service, prisma } = makeService();
    // The relation is onDelete: SetNull and there is no snapshot column.
    prisma.purchaseOrder.findMany.mockResolvedValue([historyPurchaseRow({ supplier: null })]);

    const result = await service.purchaseHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());

    expect(result.purchases[0].supplierName).toBe('');
  });
});

/**
 * REGRESSION — HISTORY_REVIEW_FINDINGS, `resolveClosableBusinessDate` /
 * `computeDayReport` (the day boundary), spec-history-reports §1.0 and §1.3.
 *
 * Every instant below is written in UTC and every expectation is an ABSOLUTE
 * instant, so the assertions describe one boundary rather than the boundary of
 * whichever machine runs them. The shipped container sets no TZ and runs UTC,
 * and CI runs UTC, so a revert to `new Date(v.getFullYear(), …)` fails here on
 * exactly the two clocks that matter. (On a laptop already set to EAT the two
 * implementations coincide — which is precisely how this shipped.)
 */
describe('MobilePosLiteService business-day boundary', () => {
  /**
   * 00:30 on 15 August in Dar es Salaam. The container's own clock still reads
   * 14 August 21:30 at this instant: the three-hour disagreement that refused a
   * rep her close for the first three hours of every day and cut the trading
   * day at 03:00 local.
   */
  const HALF_PAST_MIDNIGHT_EAT = new Date('2026-08-14T21:30:00.000Z');
  const MIDNIGHT_14_AUG_EAT = new Date('2026-08-13T21:00:00.000Z');
  const MIDNIGHT_15_AUG_EAT = new Date('2026-08-14T21:00:00.000Z');
  const MIDNIGHT_16_AUG_EAT = new Date('2026-08-15T21:00:00.000Z');

  afterEach(() => {
    jest.useRealTimers();
  });

  it('accepts a close at 00:30 EAT for the day the phone is actually in', async () => {
    jest.useFakeTimers({ now: HALF_PAST_MIDNIGHT_EAT });
    const { service, prisma } = makeService();

    const result = await service.createDayReport(
      TERMINAL_CODE,
      DEVICE_SECRET,
      dayReportDto({ businessDate: '2026-08-15' }),
      repUser(),
    );

    // Read from the container's own zone this was a hard 400 — "Only today or
    // yesterday can be closed from a Mobile POS terminal" — for an ordinary
    // act, with no recovery until 03:00.
    expect(result.businessDate).toBe('2026-08-15');
    const [{ data }] = prisma.mobilePosDayReport.create.mock.calls[0];
    expect(data.businessDate).toEqual(new Date('2026-08-15T00:00:00.000Z'));
  });

  it('computes the day over business-zone midnight, so nothing is cut at 03:00', async () => {
    jest.useFakeTimers({ now: HALF_PAST_MIDNIGHT_EAT });
    const { service, prisma } = makeService();

    await service.createDayReport(
      TERMINAL_CODE,
      DEVICE_SECRET,
      dayReportDto({ businessDate: '2026-08-15' }),
      repUser(),
    );

    // A sale rung at 01:00 EAT on the 15th falls inside the 15th's window, the
    // same day its own receipt prints. Under the process's zone this window ran
    // 03:00–03:00 and that sale was filed under the 14th.
    expect(prisma.salesOrder.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderDate: { gte: MIDNIGHT_15_AUG_EAT, lt: MIDNIGHT_16_AUG_EAT },
        }),
      }),
    );
  });

  it('reaches yesterday from after midnight, and no further', async () => {
    jest.useFakeTimers({ now: HALF_PAST_MIDNIGHT_EAT });
    const { service, prisma } = makeService();

    // The whole point of the yesterday window: she traded until 23:50, lost
    // signal, and is closing on the bus at 00:30 — or she is closing a day that
    // ended offline, the next morning. Both are this call.
    await service.createDayReport(
      TERMINAL_CODE,
      DEVICE_SECRET,
      dayReportDto({ businessDate: '2026-08-14' }),
      repUser(),
    );
    expect(prisma.salesOrder.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderDate: { gte: MIDNIGHT_14_AUG_EAT, lt: MIDNIGHT_15_AUG_EAT },
        }),
      }),
    );

    // Two days back is a device clock, not a work day.
    const older = makeService();
    await expect(
      older.service.createDayReport(
        TERMINAL_CODE,
        DEVICE_SECRET,
        dayReportDto({ businessDate: '2026-08-13' }),
        repUser(),
      ),
    ).rejects.toThrow('Only today or yesterday can be closed from a Mobile POS terminal');

    // And tomorrow is still tomorrow at 00:30, business zone or not.
    const ahead = makeService();
    await expect(
      ahead.service.createDayReport(
        TERMINAL_CODE,
        DEVICE_SECRET,
        dayReportDto({ businessDate: '2026-08-16' }),
        repUser(),
      ),
    ).rejects.toThrow('Only today or yesterday can be closed from a Mobile POS terminal');
  });

  it('cuts both history windows on the same business-zone midnights', async () => {
    jest.useFakeTimers({ now: HALF_PAST_MIDNIGHT_EAT });
    const { service, prisma } = makeService();

    prisma.purchaseOrder.findMany.mockResolvedValue([historyPurchaseRow()]);
    await service.salesHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());
    await service.purchaseHistory(TERMINAL_CODE, DEVICE_SECRET, repUser());

    // Today (the 15th in EAT) plus the six before it, ending at the 16th's
    // midnight — so the sale she rang ten minutes ago is in her own history.
    expect(prisma.salesOrder.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderDate: { gte: new Date('2026-08-08T21:00:00.000Z'), lt: MIDNIGHT_16_AUG_EAT },
        }),
      }),
    );
    expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: new Date('2026-08-08T21:00:00.000Z'), lt: MIDNIGHT_16_AUG_EAT },
        }),
      }),
    );
  });

  it('files the report under the calendar day the paper prints, not the instant the window opens', async () => {
    jest.useFakeTimers({ now: HALF_PAST_MIDNIGHT_EAT });
    const { service, prisma } = makeService();

    const result = await service.createDayReport(
      TERMINAL_CODE,
      DEVICE_SECRET,
      dayReportDto({ businessDate: '2026-08-15' }),
      repUser(),
    );

    // The @db.Date column keeps a calendar day (UTC midnight); the sales window
    // opens three hours earlier in absolute time. Both mean 15 August, which is
    // what the letterhead's `Tarehe / Date` row reads.
    const [{ data }] = prisma.mobilePosDayReport.create.mock.calls[0];
    expect(data.businessDate).toEqual(new Date('2026-08-15T00:00:00.000Z'));
    expect(result.reference).toBe(`${TERMINAL_CODE}-20260815`);
  });
});

describe('MobilePosLiteService createDayReport', () => {
  it('recomputes every figure server-side and stores the key on the INSERT itself', async () => {
    const { service, prisma, auditLogs } = makeService();
    prisma.mobilePosTerminal.findFirst.mockResolvedValue(
      cashTerminalRow({
        paymentMethods: [
          { paymentMethod: 'CASH', isEnabled: true, cashAccountId: 'cash-1', label: 'Fedha' },
        ],
      }),
    );
    prisma.salesOrder.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { totalAmount: '39000' },
    });
    prisma.salesOrder.groupBy.mockResolvedValue([
      { paymentMethod: 'CASH', _count: { _all: 2 }, _sum: { totalAmount: '30000' } },
      { paymentMethod: 'CREDIT', _count: { _all: 1 }, _sum: { totalAmount: '9000' } },
    ]);
    prisma.salesOrderLine.groupBy.mockResolvedValue([
      dayReportLineGroup('product-1', '5', '30000'),
      dayReportLineGroup('product-2', '1', '9000'),
    ]);
    prisma.product.findMany.mockResolvedValue([
      { id: 'product-1', name: 'Embe Dodo' },
      { id: 'product-2', name: 'Sukari' },
    ]);

    const result = await service.createDayReport(
      TERMINAL_CODE,
      DEVICE_SECRET,
      dayReportDto({ heldCount: 2, heldAmount: 26000 }),
      repUser(),
    );

    const [{ data }] = prisma.mobilePosDayReport.create.mock.calls[0];
    expect(data.idempotencyKey).toBe(DAY_REPORT_KEY);
    expect(data.terminalId).toBe('terminal-1');
    expect(data.repUserId).toBe('rep-1');
    // The window the figures were computed over is the terminal's own scope.
    expect(prisma.salesOrder.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          mobilePosTerminalId: 'terminal-1',
          createdById: 'rep-1',
          status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
        }),
      }),
    );

    // The headline figures ARE the underlying sales.
    expect(result.salesCount).toBe(3);
    expect(result.grossTotal).toBe(39000);
    expect(result.itemsSoldQuantity).toBe(6);
    // ...and the breakdown adds back up to the gross, so the paper is legible.
    expect(result.byMethod).toEqual([
      { paymentMethod: 'CASH', label: 'Fedha', count: 2, amount: 30000 },
      // CREDIT has no configured payment row and honestly gets a null label.
      { paymentMethod: 'CREDIT', label: null, count: 1, amount: 9000 },
    ]);
    expect(result.byMethod.reduce((sum: number, row: any) => sum + row.amount, 0)).toBe(
      result.grossTotal,
    );
    // Items aggregate per product, newest-value first.
    expect(result.items).toEqual([
      { productId: 'product-1', name: 'Embe Dodo', quantity: 5, amount: 30000 },
      { productId: 'product-2', name: 'Sukari', quantity: 1, amount: 9000 },
    ]);
    expect(result.itemsTruncated).toBe(false);
    // The ONLY client-declared numbers on the record, stored under names that
    // say so.
    expect(result.declaredHeldCount).toBe(2);
    expect(result.declaredHeldAmount).toBe(26000);
    expect(result.reference).toBe(`${TERMINAL_CODE}-${localDateKey().replace(/-/g, '')}`);

    expect(prisma.mobilePosTerminal.update).toHaveBeenCalled();
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_DAY_REPORT_SUBMITTED',
        entityType: 'MobilePosDayReport',
        entityId: 'report-1',
      }),
    );
  });

  it('closes a zero-sale day honestly rather than refusing it', async () => {
    const { service, prisma } = makeService();

    const result = await service.createDayReport(
      TERMINAL_CODE,
      DEVICE_SECRET,
      dayReportDto(),
      repUser(),
    );

    expect(result.salesCount).toBe(0);
    expect(result.grossTotal).toBe(0);
    expect(result.itemsSoldQuantity).toBe(0);
    expect(result.byMethod).toEqual([]);
    expect(result.items).toEqual([]);
    expect(prisma.mobilePosDayReport.create).toHaveBeenCalled();
  });

  it('accepts yesterday — a rep who lost signal at 20:00 closes on the bus', async () => {
    const { service, prisma } = makeService();

    const result = await service.createDayReport(
      TERMINAL_CODE,
      DEVICE_SECRET,
      dayReportDto({ businessDate: localDateKey(1) }),
      repUser(),
    );

    expect(result.businessDate).toBe(localDateKey(1));
    const [{ data }] = prisma.mobilePosDayReport.create.mock.calls[0];
    expect(data.businessDate).toEqual(new Date(`${localDateKey(1)}T00:00:00.000Z`));
  });

  it('refuses a day older than yesterday before anything exists, with the mapped sentence', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.createDayReport(
        TERMINAL_CODE,
        DEVICE_SECRET,
        dayReportDto({ businessDate: localDateKey(2) }),
        repUser(),
      ),
    ).rejects.toThrow('Only today or yesterday can be closed from a Mobile POS terminal');

    // Nothing was created, so nothing is stranded and no audit row is owed.
    expect(prisma.mobilePosDayReport.findFirst).not.toHaveBeenCalled();
    expect(prisma.mobilePosDayReport.create).not.toHaveBeenCalled();
  });

  it('refuses a future day and a calendar date that does not exist', async () => {
    const { service } = makeService();

    await expect(
      service.createDayReport(
        TERMINAL_CODE,
        DEVICE_SECRET,
        dayReportDto({ businessDate: localDateKey(-1) }),
        repUser(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    // 31 February matches the DTO regex and rolls forward to 3 March; the
    // round-trip check is what stops it filing under a day nobody worked.
    await expect(
      service.createDayReport(
        TERMINAL_CODE,
        DEVICE_SECRET,
        dayReportDto({ businessDate: `${localDateKey().slice(0, 4)}-02-31` }),
        repUser(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replays a matching key: the stored record back, and no second row', async () => {
    const { service, prisma } = makeService();
    prisma.mobilePosDayReport.findFirst.mockResolvedValue(
      dayReportRow({ declaredHeldCount: 2, declaredHeldAmount: '26000' }),
    );

    const result = await service.createDayReport(
      TERMINAL_CODE,
      DEVICE_SECRET,
      // The outbox drained between the failed attempt and this retry, so the
      // phone now declares nothing held...
      dayReportDto({ heldCount: 0, heldAmount: 0 }),
      repUser(),
    );

    // ...and the record does NOT move. Mutating a report the office may already
    // have read and printed is worse than a five-minute-stale disclosure; a rep
    // who wants the corrected picture closes again under a fresh key.
    expect(result.declaredHeldCount).toBe(2);
    expect(result.declaredHeldAmount).toBe(26000);
    expect(result.id).toBe('report-1');
    expect(result.salesCount).toBe(23);
    expect(prisma.mobilePosDayReport.create).not.toHaveBeenCalled();
    // A replay recomputes nothing: the office already has these numbers.
    expect(prisma.salesOrder.aggregate).not.toHaveBeenCalled();
  });

  it('refuses a key re-used for a DIFFERENT day, and writes the row the office needs', async () => {
    const { service, prisma, auditLogs } = makeService();
    prisma.mobilePosDayReport.findFirst.mockResolvedValue(
      dayReportRow({ businessDate: new Date(`${localDateKey(1)}T00:00:00.000Z`) }),
    );

    await expect(
      service.createDayReport(
        TERMINAL_CODE,
        DEVICE_SECRET,
        dayReportDto({ businessDate: localDateKey() }),
        repUser(),
      ),
    ).rejects.toThrow('This day report key was already used for a different day or terminal');

    // The refusal names the office as the recovery, so the office has to be
    // able to see it.
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOBILE_POS_LITE_DAY_REPORT_CONFLICT',
        entityType: 'MobilePosDayReport',
        entityId: 'report-1',
      }),
    );
    expect(prisma.mobilePosDayReport.create).not.toHaveBeenCalled();
  });

  it('refuses a key re-used from a different terminal or by a different rep', async () => {
    const { service, prisma } = makeService();
    prisma.mobilePosDayReport.findFirst.mockResolvedValue(
      dayReportRow({ terminalId: 'terminal-9' }),
    );
    await expect(
      service.createDayReport(TERMINAL_CODE, DEVICE_SECRET, dayReportDto(), repUser()),
    ).rejects.toBeInstanceOf(ConflictException);

    const second = makeService();
    second.prisma.mobilePosDayReport.findFirst.mockResolvedValue(
      dayReportRow({ repUserId: 'rep-9' }),
    );
    await expect(
      second.service.createDayReport(TERMINAL_CODE, DEVICE_SECRET, dayReportDto(), repUser()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets the DATABASE settle a create race: a unique violation resolves to the winner', async () => {
    const { service, prisma } = makeService();
    // Both racers read an empty table — Postgres stamps createdAt at
    // transaction START, so a read cannot decide this. The index can.
    prisma.mobilePosDayReport.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(dayReportRow());
    prisma.mobilePosDayReport.create.mockRejectedValue(uniqueViolation());

    const result = await service.createDayReport(
      TERMINAL_CODE,
      DEVICE_SECRET,
      dayReportDto(),
      repUser(),
    );

    expect(result.id).toBe('report-1');
    expect(result.salesCount).toBe(23);
    // The loser created nothing, so there is no row to retire — unlike the
    // purchase and count chains, this key is written by the INSERT itself.
    expect(prisma.mobilePosDayReport.create).toHaveBeenCalledTimes(1);
  });

  it('re-verifies the winner of a race before returning it', async () => {
    const { service, prisma } = makeService();
    prisma.mobilePosDayReport.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(dayReportRow({ terminalId: 'terminal-9' }));
    prisma.mobilePosDayReport.create.mockRejectedValue(uniqueViolation());

    await expect(
      service.createDayReport(TERMINAL_CODE, DEVICE_SECRET, dayReportDto(), repUser()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rethrows a non-unique insert failure untouched, leaving the frozen key safe to retry', async () => {
    const { service, prisma } = makeService();
    prisma.mobilePosDayReport.create.mockRejectedValue(new Error('connection terminated'));

    await expect(
      service.createDayReport(TERMINAL_CODE, DEVICE_SECRET, dayReportDto(), repUser()),
    ).rejects.toThrow('connection terminated');

    // No row exists, nothing was destroyed, and the identical retry is safe.
    expect(prisma.mobilePosDayReport.findFirst).toHaveBeenCalledTimes(1);
  });

  it('caps the item breakdown at 50 and says so, without touching the headline figures', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.aggregate.mockResolvedValue({
      _count: { _all: 60 },
      _sum: { totalAmount: '600000' },
    });
    prisma.salesOrderLine.groupBy.mockResolvedValue(
      Array.from({ length: 60 }, (_unused, index) =>
        dayReportLineGroup(`product-${index}`, '1', String(1000 * (index + 1))),
      ),
    );
    prisma.product.findMany.mockResolvedValue(
      Array.from({ length: 60 }, (_unused, index) => ({
        id: `product-${index}`,
        name: `Bidhaa ${index}`,
      })),
    );

    const result = await service.createDayReport(
      TERMINAL_CODE,
      DEVICE_SECRET,
      dayReportDto(),
      repUser(),
    );

    expect(result.items).toHaveLength(50);
    // Sorted by value, so the cap drops the smallest lines.
    expect(result.items[0].amount).toBe(60000);
    expect(result.itemsTruncated).toBe(true);
    // The DISPLAY cap never touched a total: the day was ranked whole first, so
    // items sold counts all 60 products even though 50 rows are printed.
    expect(result.salesCount).toBe(60);
    expect(result.grossTotal).toBe(600000);
    expect(result.itemsSoldQuantity).toBe(60);
    // Names are looked up only for the rows that will be printed.
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: expect.arrayContaining([expect.any(String)]) },
          companyId: 'company-1',
        }),
        select: { id: true, name: true },
      }),
    );
    expect(prisma.product.findMany.mock.calls[0][0].where.id.in).toHaveLength(50);
  });

  /**
   * REGRESSION — spec-history-reports §1.3, HISTORY_REVIEW_FINDINGS
   * `itemsSoldQuantity` (both rows).
   *
   * The figure used to be summed in JS over a findMany capped at 500 orders
   * while being printed in `Muhtasari / Summary` beside two exact aggregates,
   * under a paragraph promising the totals above were complete. It now comes
   * from a line-level groupBy with no take at all, over exactly the order
   * predicate the headline aggregate uses. Before the change this test fails on
   * the `take` assertion — the day's lines were read a page at a time.
   */
  it('sums items sold from an UNBOUNDED line aggregate, never from a page of orders', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.aggregate.mockResolvedValue({
      _count: { _all: 900 },
      _sum: { totalAmount: '9000000' },
    });
    prisma.salesOrderLine.groupBy.mockResolvedValue([
      dayReportLineGroup('product-1', '1801.5', '5400000'),
      dayReportLineGroup('product-2', '600', '3600000'),
    ]);
    prisma.product.findMany.mockResolvedValue([
      { id: 'product-1', name: 'Embe Dodo' },
      { id: 'product-2', name: 'Sukari' },
    ]);

    const result = await service.createDayReport(
      TERMINAL_CODE,
      DEVICE_SECRET,
      dayReportDto(),
      repUser(),
    );

    const [call] = prisma.salesOrderLine.groupBy.mock.calls[0];
    // No `take`, no `skip`, no cursor: nothing here can be a page.
    expect(call.take).toBeUndefined();
    expect(call.skip).toBeUndefined();
    expect(call).toEqual({
      by: ['productId'],
      where: {
        salesOrder: {
          companyId: 'company-1',
          mobilePosTerminalId: 'terminal-1',
          createdById: 'rep-1',
          status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
          orderDate: { gte: expect.any(Date), lt: expect.any(Date) },
        },
      },
      _sum: { quantity: true, lineTotal: true },
    });
    // A 900-order day: the old 500-order page would have undercounted this.
    expect(result.itemsSoldQuantity).toBe(2401.5);
    // ...and the day's whole book fits in the printed list, so the paper makes
    // no truncation claim at all.
    expect(result.itemsTruncated).toBe(false);
    // The line scope IS the headline scope — the two can never drift.
    const [aggregateCall] = prisma.salesOrder.aggregate.mock.calls[0];
    expect(call.where.salesOrder).toEqual(aggregateCall.where);
    // Nothing reads whole orders for this any more.
    expect(prisma.salesOrder.findMany).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION — the same finding, from the paper's side. The Items paragraph
   * used to read "Orodha hii imefupishwa; jumla hapo juu ni kamili", which was
   * false for the one Summary figure the 500-order bound could move. With every
   * Summary figure unbounded the sentence is true, and it now also says what
   * was dropped.
   */
  it('prints a truncation note that vouches only for figures no bound can move', async () => {
    const { service, prisma, generatedDocuments } = makeService();
    prisma.mobilePosDayReport.findFirst.mockResolvedValue(
      dayReportRow({ itemsTruncated: true, itemsSoldQuantity: '2401.5' }),
    );

    await service.dayReportPdf(TERMINAL_CODE, DEVICE_SECRET, 'report-1', repUser());

    const [, document] = generatedDocuments.renderLetterheadPdf.mock.calls[0];
    const summary = document.sections.find((s: any) => s.title === 'Muhtasari / Summary');
    expect(summary.items).toEqual([
      { label: 'Mauzo / Sales', value: '23' },
      { label: 'Jumla / Gross Total', value: 'TZS 412,000' },
      { label: 'Bidhaa zilizouzwa / Items Sold', value: '2,401.5' },
    ]);
    const items = document.sections.find((s: any) => s.title === 'Bidhaa / Items');
    expect(items.paragraphs).toEqual([
      'Orodha hii inaonyesha bidhaa 50 zenye thamani kubwa zaidi; jumla hapo juu ni kamili. / This list shows the 50 highest-value items; the totals above are complete.',
    ]);
  });
});

describe('MobilePosLiteService dayReports office list', () => {
  it('scopes to the companies the AuthUser can reach, never to a client-supplied one', async () => {
    const { service, prisma, companyScope } = makeService();
    prisma.mobilePosDayReport.findMany.mockResolvedValue([dayReportRow()]);

    const result = await service.dayReports({ terminalId: 'terminal-1' } as any, repUser());

    expect(companyScope.assertGroupScoped).toHaveBeenCalled();
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith(repUser());
    expect(prisma.mobilePosDayReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1', terminalId: 'terminal-1' },
        orderBy: { submittedAt: 'desc' },
        take: 100,
      }),
    );
    expect(result[0]).toMatchObject({ id: 'report-1', salesCount: 23, grossTotal: 412000 });
  });

  it('filters an inclusive business-date range', async () => {
    const { service, prisma } = makeService();

    await service.dayReports({ from: '2026-08-01', to: '2026-08-14' } as any, repUser());

    expect(prisma.mobilePosDayReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessDate: {
            gte: new Date('2026-08-01T00:00:00.000Z'),
            // The office asks for a day, not for the instant it begins.
            lt: new Date('2026-08-15T00:00:00.000Z'),
          },
        }),
      }),
    );
  });
});

describe('MobilePosLiteService dayReportPdf', () => {
  it('rejects a report submitted from another terminal', async () => {
    const { service, prisma, generatedDocuments } = makeService();
    prisma.mobilePosDayReport.findFirst.mockResolvedValue(null);

    await expect(
      service.dayReportPdf(TERMINAL_CODE, DEVICE_SECRET, 'report-other', repUser()),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.mobilePosDayReport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'report-other',
          companyId: 'company-1',
          terminalId: 'terminal-1',
        }),
      }),
    );
    expect(generatedDocuments.renderLetterheadPdf).not.toHaveBeenCalled();
  });

  it('renders the letterhead report from the STORED record, bilingually', async () => {
    const { service, prisma, generatedDocuments } = makeService();
    prisma.mobilePosDayReport.findFirst.mockResolvedValue(dayReportRow());

    const result = await service.dayReportPdf(TERMINAL_CODE, DEVICE_SECRET, 'report-1', repUser());

    expect(generatedDocuments.renderLetterheadPdf).toHaveBeenCalledWith(
      { companyId: 'company-1', branchId: 'branch-1' },
      expect.objectContaining({
        title: 'RIPOTI YA SIKU / DAY SALES REPORT',
        subtitle: 'Rep One',
        reference: `${TERMINAL_CODE}-${localDateKey().replace(/-/g, '')}`,
        meta: expect.arrayContaining([
          { label: 'Tawi / Branch', value: 'Branch' },
          { label: 'Muuzaji / Sales Rep', value: 'Rep One' },
        ]),
      }),
      expect.objectContaining({ id: 'rep-1' }),
    );

    const model = generatedDocuments.renderLetterheadPdf.mock.calls[0][1];
    const [summary, methods, items] = model.sections;
    expect(summary.items).toEqual([
      { label: 'Mauzo / Sales', value: '23' },
      { label: 'Jumla / Gross Total', value: 'TZS 412,000' },
      { label: 'Bidhaa zilizouzwa / Items Sold', value: '87' },
    ]);
    expect(methods.table.headers).toEqual(['Njia / Method', 'Idadi / Count', 'Jumla / Total']);
    expect(methods.table.rows).toEqual([['Fedha', '19', 'TZS 331,000']]);
    expect(methods.totals).toEqual([
      { label: 'JUMLA / TOTAL', value: 'TZS 412,000', emphasis: true },
    ]);
    expect(items.table.rows).toEqual([['Embe Dodo', '14', 'TZS 84,000']]);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    // The submit time disambiguates a second close of the same day.
    expect(result.fileName).toBe(
      `RIPOTI-${TERMINAL_CODE}-${localDateKey().replace(/-/g, '')}-1842.pdf`,
    );
  });

  it('prints the held section if and ONLY if the phone declared something held', async () => {
    const held = makeService();
    held.prisma.mobilePosDayReport.findFirst.mockResolvedValue(
      dayReportRow({ declaredHeldCount: 2, declaredHeldAmount: '26000' }),
    );
    await held.service.dayReportPdf(TERMINAL_CODE, DEVICE_SECRET, 'report-1', repUser());

    const heldModel = held.generatedDocuments.renderLetterheadPdf.mock.calls[0][1];
    const heldSection = heldModel.sections.find(
      (section: any) => section.title === 'Mauzo Yaliyo Mkononi / Sales Still On The Phone',
    );
    expect(heldSection.items).toEqual([
      { label: 'Mauzo / Sales', value: '2' },
      { label: 'Kiasi / Amount', value: 'TZS 26,000' },
    ]);
    // The sentence is what makes the report honest: not in the total, and
    // declared by the phone.
    expect(heldSection.paragraphs).toEqual([
      'Hazijajumuishwa kwenye jumla hapo juu. Idadi hii imetolewa na simu. / Not included in the total above. This figure is declared by the phone.',
    ]);

    const clean = makeService();
    clean.prisma.mobilePosDayReport.findFirst.mockResolvedValue(dayReportRow());
    await clean.service.dayReportPdf(TERMINAL_CODE, DEVICE_SECRET, 'report-1', repUser());

    const cleanModel = clean.generatedDocuments.renderLetterheadPdf.mock.calls[0][1];
    expect(cleanModel.sections.some((section: any) => /Mkononi/.test(section.title))).toBe(false);
  });

  it('says a zero-sale day was empty instead of printing headers over nothing', async () => {
    const { service, prisma, generatedDocuments } = makeService();
    prisma.mobilePosDayReport.findFirst.mockResolvedValue(
      dayReportRow({
        salesCount: 0,
        grossTotal: '0',
        itemsSoldQuantity: '0',
        byMethod: [],
        items: [],
      }),
    );

    await service.dayReportPdf(TERMINAL_CODE, DEVICE_SECRET, 'report-1', repUser());

    const model = generatedDocuments.renderLetterheadPdf.mock.calls[0][1];
    const [, methods, items] = model.sections;
    expect(methods.table).toBeUndefined();
    expect(methods.paragraphs).toEqual([
      'Hakuna mauzo yaliyorekodiwa siku hii. / No sales were recorded on this day.',
    ]);
    expect(items.paragraphs).toEqual([
      'Hakuna bidhaa zilizouzwa siku hii. / No items were sold on this day.',
    ]);
  });

  it('says so on the paper when the item list was capped', async () => {
    const { service, prisma, generatedDocuments } = makeService();
    prisma.mobilePosDayReport.findFirst.mockResolvedValue(dayReportRow({ itemsTruncated: true }));

    await service.dayReportPdf(TERMINAL_CODE, DEVICE_SECRET, 'report-1', repUser());

    const model = generatedDocuments.renderLetterheadPdf.mock.calls[0][1];
    // Names the rows that were dropped — the smallest — and vouches only for
    // the Summary figures, every one of which is now an unbounded aggregate.
    expect(model.sections[2].paragraphs).toEqual([
      'Orodha hii inaonyesha bidhaa 50 zenye thamani kubwa zaidi; jumla hapo juu ni kamili. / This list shows the 50 highest-value items; the totals above are complete.',
    ]);
  });
});

describe('MobilePosLiteController history and day-report routes', () => {
  it('gates GET /sales on mobile_pos_lite.use', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MobilePosLiteController.prototype.salesHistory),
    ).toEqual(['mobile_pos_lite.use']);
  });

  it('gates GET /purchases on mobile_pos_lite.purchase — the manager gate, never .use', () => {
    const gate = Reflect.getMetadata(
      PERMISSIONS_KEY,
      MobilePosLiteController.prototype.purchaseHistory,
    );
    // A .use-only rep is refused by the guard before the handler runs; this is
    // the same gate that already guards recording a delivery.
    expect(gate).toEqual(['mobile_pos_lite.purchase']);
    expect(gate).not.toContain('mobile_pos_lite.use');
  });

  it('gates the day report and its paper on mobile_pos_lite.use, and the office list on .manage', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MobilePosLiteController.prototype.createDayReport),
    ).toEqual(['mobile_pos_lite.use']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MobilePosLiteController.prototype.dayReportPdf),
    ).toEqual(['mobile_pos_lite.use']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MobilePosLiteController.prototype.dayReports),
    ).toEqual(['mobile_pos_lite.manage']);
  });

  it('passes the terminal headers straight through on every device-facing route', () => {
    const service: any = {
      salesHistory: jest.fn().mockResolvedValue({}),
      purchaseHistory: jest.fn().mockResolvedValue({}),
      createDayReport: jest.fn().mockResolvedValue({}),
    };
    const controller = new MobilePosLiteController(service);
    const user = repUser();
    const dto = dayReportDto();

    controller.salesHistory(TERMINAL_CODE, DEVICE_SECRET, user);
    controller.purchaseHistory(TERMINAL_CODE, DEVICE_SECRET, user);
    controller.createDayReport(TERMINAL_CODE, DEVICE_SECRET, dto, user);

    expect(service.salesHistory).toHaveBeenCalledWith(TERMINAL_CODE, DEVICE_SECRET, user);
    expect(service.purchaseHistory).toHaveBeenCalledWith(TERMINAL_CODE, DEVICE_SECRET, user);
    expect(service.createDayReport).toHaveBeenCalledWith(TERMINAL_CODE, DEVICE_SECRET, dto, user);
  });

  it('streams the day-report PDF with the same header set as the receipt route', async () => {
    const service: any = {
      dayReportPdf: jest
        .fn()
        .mockResolvedValue({ buffer: Buffer.from('%PDF-1.4'), fileName: 'RIPOTI-X-1842.pdf' }),
    };
    const controller = new MobilePosLiteController(service);
    const res: any = { setHeader: jest.fn(), send: jest.fn() };

    await controller.dayReportPdf(TERMINAL_CODE, DEVICE_SECRET, 'report-1', repUser(), res);

    // Non-passthrough @Res(), so the bytes bypass the TransformInterceptor
    // envelope — byte-for-byte the shape of sales/:id/receipt.
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'inline; filename="RIPOTI-X-1842.pdf"',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
  });

  // CD-22
  it('gates POST /counter-delivery-backfill on mobile_pos_lite.manage, never on .use', () => {
    const gate = Reflect.getMetadata(
      PERMISSIONS_KEY,
      MobilePosLiteController.prototype.counterDeliveryBackfill,
    );

    // This writes business documents across a company's whole sales history.
    // A rep's token holds .use and nothing else, and must never reach it.
    expect(gate).toEqual(['mobile_pos_lite.manage']);
    expect(gate).not.toContain('mobile_pos_lite.use');
  });

  // CD-22, the route is a desktop call and carries nothing a client chose.
  it('passes only the query and the caller to the backfill — no terminal headers, no body', () => {
    const service: any = { counterDeliveryBackfill: jest.fn().mockResolvedValue({}) };
    const controller = new MobilePosLiteController(service);
    const user = repUser();

    controller.counterDeliveryBackfill({}, 'company-1', user);

    expect(service.counterDeliveryBackfill).toHaveBeenCalledWith({ companyId: 'company-1' }, user);
    // Two arguments, so nothing a request body could carry can reach the run.
    expect(service.counterDeliveryBackfill.mock.calls[0]).toHaveLength(2);
  });
});
