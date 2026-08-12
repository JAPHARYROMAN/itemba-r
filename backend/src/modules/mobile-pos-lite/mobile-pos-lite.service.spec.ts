import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { MobilePosLiteService } from './mobile-pos-lite.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const DEVICE_SECRET = 'device-secret-device-secret-0001';
const TERMINAL_CODE = 'MPL-TEST0001';
const IDEMPOTENCY_KEY = 'offline-purchase-key-0001';

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
      delete: jest.fn().mockResolvedValue({}),
    },
    goodsReceivedNote: {
      findFirst: jest.fn().mockResolvedValue(null),
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

  const service = new MobilePosLiteService(
    prisma,
    companyScope,
    auditLogs,
    salesOrders,
    purchaseOrders,
    goodsReceivedNotes,
    codes,
    generatedDocuments,
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

  it('drops its duplicate DRAFT and resumes the winner when a concurrent retry created twins', async () => {
    const { service, prisma, purchaseOrders } = makeService();
    purchaseOrders.create.mockResolvedValue(chainOrder({ id: 'po-2', status: 'DRAFT' }));
    // Pre-check misses, twins query then shows the winner first.
    prisma.purchaseOrder.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(chainOrder({ id: 'po-1', status: 'CONFIRMED' }));
    prisma.purchaseOrder.findMany.mockResolvedValue([{ id: 'po-1' }, { id: 'po-2' }]);
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

    expect(prisma.purchaseOrder.delete).toHaveBeenCalledWith({ where: { id: 'po-2' } });
    expect(purchaseOrders.confirm).not.toHaveBeenCalled();
    expect(result.id).toBe('po-1');
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
