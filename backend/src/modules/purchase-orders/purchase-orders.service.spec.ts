import { PurchaseOrdersService } from './purchase-orders.service';

function makeService() {
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    purchaseOrder: {
      create: jest.fn(async ({ data }: any) => ({ id: 'po-1', ...data, lines: [] })),
      update: jest.fn(async ({ data }: any) => ({ id: 'po-1', companyId: 'company-1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'po-1', companyId: 'company-1' })),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    cashAccount: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    inventoryMovement: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    goodsReceivedNote: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    payable: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: 'payable-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'payable-1', ...data })),
      aggregate: jest.fn().mockResolvedValue({ _sum: { outstandingAmount: 0 } }),
    },
    purchaseOrderLine: {
      deleteMany: jest.fn(),
    },
    division: {
      findFirst: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    },
    branch: {
      findFirst: jest.fn().mockResolvedValue({
        divisionId: 'division-1',
        division: { companyId: 'company-1' },
      }),
    },
    supplier: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    supplierInvoice: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([{ id: 'product-1', companyId: 'company-1' }]),
      findUnique: jest.fn().mockResolvedValue({ id: 'product-1', trackInventory: false }),
    },
    fuelTank: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(async ({ data }: any) => ({ id: 'tank-1', ...data })),
    },
    fuelDelivery: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: 'fuel-delivery-1', ...data })),
    },
    unitOfMeasure: {
      findMany: jest.fn().mockResolvedValue([{ id: 'unit-1', companyId: 'company-1' }]),
    },
  } as any;
  const auditLogs = {
    log: jest.fn().mockResolvedValue(undefined),
    logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
  } as any;
  const inventoryMovements = { createMovement: jest.fn().mockResolvedValue(undefined) } as any;
  const taxAutoApply = { applyForPurchaseOrder: jest.fn().mockResolvedValue({}) } as any;
  const codes = {
    next: jest.fn(async ({ entityType }: any) =>
      entityType === 'Payable' ? 'AP-2026-000001' : 'PO-2026-000001',
    ),
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
  } as any;
  const postingEngine = { postLines: jest.fn().mockResolvedValue({ id: 'je-1' }) } as any;
  const accountResolver = {
    resolveMany: jest.fn().mockResolvedValue({
      INVENTORY_ASSET: { id: 'inventory-account' },
      AP_CONTROL: { id: 'ap-account' },
      CASH_ON_HAND: { id: 'cash-account' },
    }),
  } as any;
  const profit = {
    assertPurchaseLinesHaveCost: jest.fn().mockResolvedValue(undefined),
  } as any;
  const service = new PurchaseOrdersService(
    prisma,
    auditLogs,
    inventoryMovements,
    taxAutoApply,
    codes,
    companyScope,
    postingEngine,
    accountResolver,
    profit,
  );

  return { service, prisma, postingEngine, accountResolver, inventoryMovements, codes, auditLogs };
}

const user = { id: 'user-1', permissions: ['purchases.create'] } as any;

function createDto(purchaseType: 'CASH_PURCHASE' | 'CREDIT_PURCHASE') {
  return {
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    supplierName: 'Supplier Ltd',
    purchaseType,
    orderDate: '2026-05-28',
    currency: 'TZS',
    lines: [
      {
        productId: 'product-1',
        description: 'Item',
        quantity: 2,
        unitId: 'unit-1',
        unitCost: 100,
        discountAmount: 0,
        taxAmount: 0,
      },
    ],
  } as any;
}

describe('PurchaseOrdersService payment state', () => {
  it('stores an optional supplier-issued invoice reference without changing purchase state', async () => {
    const { service, prisma } = makeService();
    const dto = createDto('CREDIT_PURCHASE');
    dto.supplierInvoiceNumber = 'INV-SUP-204';
    dto.supplierInvoiceDate = '2026-05-27';

    await service.create(dto, user);

    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierInvoiceNumber: 'INV-SUP-204',
          supplierInvoiceDate: new Date('2026-05-27'),
          paymentStatus: 'UNPAID',
        }),
      }),
    );
  });

  it('rejects a duplicate invoice number for the same manual supplier', async () => {
    const { service, prisma } = makeService();
    const dto = createDto('CREDIT_PURCHASE');
    dto.supplierInvoiceNumber = 'INV-DUPLICATE';
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-existing',
      purchaseOrderNumber: 'PO-2026-000009',
    });

    await expect(service.create(dto, user)).rejects.toThrow(
      'Supplier invoice number is already recorded on PO-2026-000009',
    );
    expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it('marks cash purchases paid immediately', async () => {
    const { service, prisma } = makeService();

    await service.create(createDto('CASH_PURCHASE'), user);

    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 200,
          paidAmount: 200,
          outstandingAmount: 0,
          paymentStatus: 'PAID',
        }),
      }),
    );
  });

  it('keeps credit purchases unpaid with the full outstanding balance', async () => {
    const { service, prisma } = makeService();

    await service.create(createDto('CREDIT_PURCHASE'), user);

    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 200,
          paidAmount: 0,
          outstandingAmount: 200,
          paymentStatus: 'UNPAID',
        }),
      }),
    );
  });

  it('rejects discounts greater than the purchase line amount', async () => {
    const { service } = makeService();
    const dto = createDto('CASH_PURCHASE');
    dto.lines[0].discountAmount = 250;

    await expect(service.create(dto, user)).rejects.toThrow(
      'Purchase order line discount cannot exceed the line amount',
    );
  });

  it('repairs cash payment state when a cash purchase is received', async () => {
    const { service, prisma, postingEngine, accountResolver } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      purchaseType: 'CASH_PURCHASE',
      totalAmount: 9400000,
      status: 'CONFIRMED',
      lines: [],
    });

    await service.receive('po-1', user);

    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'po-1' },
        data: expect.objectContaining({
          status: 'RECEIVED',
          paidAmount: 9400000,
          outstandingAmount: 0,
          paymentStatus: 'PAID',
          journalEntryId: 'je-1',
        }),
      }),
    );
    expect(accountResolver.resolveMany).toHaveBeenCalledWith(
      'company-1',
      ['INVENTORY_ASSET', 'CASH_ON_HAND'],
      prisma,
    );
    expect(postingEngine.postLines).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        referenceType: 'PurchaseOrder',
        referenceId: 'po-1',
      }),
      prisma,
    );
  });

  it('appends the attributable receive audit after the final PO write on the same tx', async () => {
    const { service, prisma, postingEngine, auditLogs } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      purchaseOrderNumber: 'PO-2026-000001',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      purchaseType: 'CASH_PURCHASE',
      totalAmount: 200,
      status: 'CONFIRMED',
      lines: [],
    });

    await service.receive('po-1', user);

    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'PURCHASE_ORDER_RECEIVE',
        entityType: 'PurchaseOrder',
        entityId: 'po-1',
        userId: 'user-1',
        companyId: 'company-1',
        oldValue: { status: 'CONFIRMED' },
        newValue: { status: 'RECEIVED' },
      }),
    );
    expect(postingEngine.postLines.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.purchaseOrder.update.mock.invocationCallOrder.at(-1),
    );
    expect(prisma.purchaseOrder.update.mock.invocationCallOrder.at(-1)).toBeLessThan(
      auditLogs.logStrictInTransaction.mock.invocationCallOrder[0],
    );
  });

  it('does not commit receipt state when the mandatory audit append fails', async () => {
    const { service, prisma, postingEngine, auditLogs } = makeService();
    let committedStatus = 'CONFIRMED';
    let stagedStatus = committedStatus;
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      purchaseOrderNumber: 'PO-2026-000001',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      purchaseType: 'CASH_PURCHASE',
      totalAmount: 200,
      status: 'CONFIRMED',
      lines: [],
    });
    prisma.purchaseOrder.updateMany.mockImplementation(async ({ data }: any) => {
      stagedStatus = data.status;
      return { count: 1 };
    });
    prisma.purchaseOrder.update.mockImplementation(async ({ data }: any) => {
      stagedStatus = data.status;
      return { id: 'po-1', companyId: 'company-1', ...data };
    });
    prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      stagedStatus = committedStatus;
      try {
        const result = await callback(prisma);
        committedStatus = stagedStatus;
        return result;
      } catch (error) {
        stagedStatus = committedStatus;
        throw error;
      }
    });
    auditLogs.logStrictInTransaction.mockRejectedValueOnce(new Error('audit store unavailable'));

    await expect(service.receive('po-1', user)).rejects.toThrow('audit store unavailable');

    expect(committedStatus).toBe('CONFIRMED');
    expect(postingEngine.postLines).toHaveBeenCalledWith(expect.any(Object), prisma);
    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PURCHASE_ORDER_RECEIVE' }),
    );
  });

  it('does not receive a purchase order when another receipt already claimed it', async () => {
    const { service, prisma, inventoryMovements } = makeService();
    prisma.purchaseOrder.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      purchaseType: 'CASH_PURCHASE',
      totalAmount: 200,
      status: 'CONFIRMED',
      lines: [
        {
          productId: 'product-1',
          quantity: 2,
          unitId: 'unit-1',
          unitCost: 100,
          lineTotal: 200,
        },
      ],
    });

    await expect(service.receive('po-1', user)).rejects.toThrow(
      'already been received or is no longer receivable',
    );
    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
  });

  it('does not receive a purchase order that was already posted by a GRN', async () => {
    const { service, prisma, inventoryMovements } = makeService();
    prisma.goodsReceivedNote.findFirst.mockResolvedValueOnce({ grnNumber: 'GRN-2026-000001' });
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      purchaseType: 'CASH_PURCHASE',
      totalAmount: 200,
      status: 'CONFIRMED',
      lines: [
        {
          productId: 'product-1',
          quantity: 2,
          unitId: 'unit-1',
          unitCost: 100,
          lineTotal: 200,
        },
      ],
    });

    await expect(service.receive('po-1', user)).rejects.toThrow(
      'already posted by GRN GRN-2026-000001',
    );
    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
  });

  it('posts received fuel purchase lines into the matching petroleum tank', async () => {
    const { service, prisma, inventoryMovements, codes } = makeService();
    prisma.product.findUnique.mockResolvedValue({ id: 'product-1', trackInventory: true });
    prisma.fuelTank.findMany.mockResolvedValue([
      { id: 'tank-1', tankCode: 'DIESEL-1', tankName: 'Diesel Tank 1' },
    ]);
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      purchaseOrderNumber: 'PO-2026-000001',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      supplierId: 'supplier-1',
      supplierName: 'Fuel Supplier Ltd',
      purchaseType: 'CASH_PURCHASE',
      totalAmount: 2000000,
      expectedDate: null,
      currency: 'TZS',
      status: 'CONFIRMED',
      payableId: null,
      lines: [
        {
          productId: 'product-1',
          quantity: 1000,
          unitId: 'unit-1',
          unitCost: 2000,
          lineTotal: 2000000,
          batchNumber: null,
          expiryDate: null,
        },
      ],
    });

    await service.receive('po-1', user);

    expect(inventoryMovements.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        movementType: 'PURCHASE_RECEIPT',
        quantity: 1000,
        referenceType: 'PurchaseOrder',
        referenceId: 'po-1',
        branchId: 'branch-1',
      }),
    );
    expect(prisma.fuelDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purchaseOrderId: 'po-1',
          tankId: 'tank-1',
          productId: 'product-1',
          acceptedLitres: 1000,
          status: 'POSTED',
          postedById: 'user-1',
        }),
      }),
    );
    expect(prisma.fuelTank.update).toHaveBeenCalledWith({
      where: { id: 'tank-1' },
      data: { currentBookBalance: { increment: 1000 } },
    });
    expect(codes.next).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'FuelDelivery', companyId: 'company-1' }),
    );
  });

  it('blocks fuel purchase receipt when no receiving-branch tank exists', async () => {
    const { service, prisma, inventoryMovements } = makeService();
    prisma.product.findUnique.mockResolvedValue({
      id: 'product-1',
      name: 'PETROL',
      trackInventory: true,
      category: { categoryType: 'FUEL' },
    });
    prisma.fuelTank.findMany.mockResolvedValue([]);
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      purchaseOrderNumber: 'PO-2026-000001',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      supplierId: 'supplier-1',
      supplierName: 'Fuel Supplier Ltd',
      purchaseType: 'CASH_PURCHASE',
      totalAmount: 2000000,
      expectedDate: null,
      currency: 'TZS',
      status: 'CONFIRMED',
      payableId: null,
      lines: [
        {
          id: 'line-1',
          productId: 'product-1',
          quantity: 1000,
          unitId: 'unit-1',
          unitCost: 2000,
          lineTotal: 2000000,
          batchNumber: null,
          expiryDate: null,
        },
      ],
    });

    await expect(service.receive('po-1', user)).rejects.toThrow(
      'has no active tank at the purchase order receiving branch',
    );
    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
  });
});

describe('PurchaseOrdersService invoice reference metadata', () => {
  it('updates a received purchase without reopening or reposting it', async () => {
    const { service, prisma, inventoryMovements, postingEngine, auditLogs } = makeService();
    prisma.purchaseOrder.findFirst
      .mockResolvedValueOnce({
        id: 'po-1',
        companyId: 'company-1',
        supplierId: null,
        supplierName: 'Supplier Ltd',
        status: 'RECEIVED',
        paymentStatus: 'UNPAID',
        totalAmount: 200,
        supplierInvoiceNumber: null,
        supplierInvoiceDate: null,
        supplierInvoices: [],
      })
      .mockResolvedValueOnce(null);
    prisma.purchaseOrder.update.mockResolvedValue({
      id: 'po-1',
      companyId: 'company-1',
      status: 'RECEIVED',
      paymentStatus: 'UNPAID',
      totalAmount: 200,
      supplierInvoiceNumber: 'INV-HIST-12',
      supplierInvoiceDate: new Date('2026-04-30'),
      supplierInvoices: [],
    });

    const result = await service.updateInvoiceReference(
      'po-1',
      { supplierInvoiceNumber: ' INV-HIST-12 ', supplierInvoiceDate: '2026-04-30' },
      user,
    );

    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      data: {
        supplierInvoiceNumber: 'INV-HIST-12',
        supplierInvoiceDate: new Date('2026-04-30'),
      },
      include: expect.any(Object),
    });
    expect(result).toEqual(
      expect.objectContaining({
        status: 'RECEIVED',
        displayInvoiceNumber: 'INV-HIST-12',
        invoiceSource: 'PURCHASE_ORDER_REFERENCE',
      }),
    );
    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PURCHASE_ORDER_INVOICE_REFERENCE_UPDATE' }),
    );
  });
});

describe('PurchaseOrdersService.receive credit purchase payable sync', () => {
  function creditOrder(extra: Record<string, unknown> = {}) {
    return {
      id: 'po-1',
      purchaseOrderNumber: 'PO-2026-000001',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      supplierId: 'supplier-1',
      supplierName: 'Supplier Ltd',
      purchaseType: 'CREDIT_PURCHASE',
      totalAmount: 1000000,
      expectedDate: null,
      currency: 'TZS',
      status: 'CONFIRMED',
      payableId: null,
      lines: [
        {
          productId: 'product-1',
          quantity: 10,
          unitId: 'unit-1',
          unitCost: 100000,
          lineTotal: 1000000,
          batchNumber: null,
          expiryDate: null,
        },
      ],
      ...extra,
    };
  }

  it('creates a linked payable and AP ledger when receiving a credit purchase', async () => {
    const { service, prisma, postingEngine, inventoryMovements, codes } = makeService();
    prisma.product.findUnique.mockResolvedValue({ id: 'product-1', trackInventory: true });
    prisma.purchaseOrder.findFirst.mockResolvedValue(creditOrder());

    await service.receive('po-1', user);

    // Inventory side is still posted via the movements service (WAC subledger).
    expect(inventoryMovements.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        movementType: 'PURCHASE_RECEIPT',
        quantity: 10,
        referenceType: 'PurchaseOrder',
        referenceId: 'po-1',
      }),
    );
    expect(codes.next).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'Payable', companyId: 'company-1' }),
    );
    expect(prisma.payable.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payableNumber: 'AP-2026-000001',
          companyId: 'company-1',
          divisionId: 'division-1',
          branchId: 'branch-1',
          supplierId: 'supplier-1',
          supplierName: 'Supplier Ltd',
          sourceType: 'PurchaseOrder',
          sourceId: 'po-1',
          amount: expect.anything(),
          outstandingAmount: expect.anything(),
          status: 'OPEN',
        }),
      }),
    );
    expect(postingEngine.postLines).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        referenceType: 'Payable',
        referenceId: 'payable-1',
        lines: expect.arrayContaining([
          expect.objectContaining({
            accountId: 'inventory-account',
            debit: expect.anything(),
            credit: 0,
          }),
          expect.objectContaining({ accountId: 'ap-account', debit: 0, credit: expect.anything() }),
        ]),
      }),
      prisma,
    );
    const updateArg = prisma.purchaseOrder.update.mock.calls.at(-1)?.[0];
    expect(updateArg.data.status).toBe('RECEIVED');
    expect(updateArg.data.journalEntryId).toBe('je-1');
    expect(updateArg.data.payableId).toBe('payable-1');
  });

  it('does not re-post AP or touch the linked payable when the PO already has one', async () => {
    const { service, prisma, postingEngine } = makeService();
    prisma.product.findUnique.mockResolvedValue({ id: 'product-1', trackInventory: true });
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      creditOrder({ payableId: 'payable-existing' }),
    );

    await service.receive('po-1', user);

    // The pre-existing payable (created by the supplier-invoice flow) is left alone:
    // no second AP_CONTROL credit, no journalEntryId overwrite.
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(prisma.payable.create).not.toHaveBeenCalled();
    expect(prisma.payable.update).not.toHaveBeenCalled();
  });

  it('still posts the cash/inventory ledger for a CASH purchase receipt', async () => {
    const { service, prisma, postingEngine, accountResolver } = makeService();
    prisma.product.findUnique.mockResolvedValue({ id: 'product-1', trackInventory: true });
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      creditOrder({ purchaseType: 'CASH_PURCHASE' }),
    );

    await service.receive('po-1', user);

    expect(accountResolver.resolveMany).toHaveBeenCalledWith(
      'company-1',
      ['INVENTORY_ASSET', 'CASH_ON_HAND'],
      prisma,
    );
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    // Never resolves AP_CONTROL on the cash path.
    expect(accountResolver.resolveMany).not.toHaveBeenCalledWith(
      'company-1',
      expect.arrayContaining(['AP_CONTROL']),
      prisma,
    );
    expect(prisma.payable.create).not.toHaveBeenCalled();
  });
});

describe('PurchaseOrdersService.receive full-receipt-only (finding #20)', () => {
  it('rejects a PARTIALLY_RECEIVED order on the direct receive path', async () => {
    const { service, prisma, inventoryMovements, postingEngine } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      purchaseType: 'CASH_PURCHASE',
      totalAmount: 200,
      status: 'PARTIALLY_RECEIVED',
      lines: [],
    });

    await expect(service.receive('po-1', user)).rejects.toThrow(
      'Only CONFIRMED purchase orders can be received here',
    );
    // No movement, no claim, no ledger for the rejected partial path.
    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(prisma.purchaseOrder.updateMany).not.toHaveBeenCalled();
  });

  it('claims only CONFIRMED orders inside the receive transaction', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      purchaseType: 'CASH_PURCHASE',
      totalAmount: 200,
      status: 'CONFIRMED',
      lines: [],
    });

    await service.receive('po-1', user);

    expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'po-1', deletedAt: null, status: 'CONFIRMED' },
      }),
    );
  });
});

describe('PurchaseOrdersService.cancel outstanding reset (finding #19)', () => {
  it('zeroes the PO row outstandingAmount so summary() stops counting it', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      companyId: 'company-1',
      status: 'CONFIRMED',
      outstandingAmount: 1000000,
      payableId: null,
    });

    await service.cancel('po-1', user);

    const updateArg = prisma.purchaseOrder.update.mock.calls.at(-1)?.[0];
    expect(updateArg).toEqual({
      where: { id: 'po-1' },
      data: { status: 'CANCELLED', outstandingAmount: 0 },
    });
  });

  it('also zeroes the linked payable outstanding when one exists', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      companyId: 'company-1',
      status: 'CONFIRMED',
      outstandingAmount: 1000000,
      payableId: 'payable-1',
    });
    prisma.payable.aggregate = jest.fn().mockResolvedValue({ _sum: { outstandingAmount: 0 } });
    prisma.supplier.updateMany = jest.fn().mockResolvedValue({ count: 1 });

    await service.cancel('po-1', user);

    expect(prisma.payable.update).toHaveBeenCalledWith({
      where: { id: 'payable-1' },
      data: { status: 'CANCELLED', outstandingAmount: 0 },
    });
    const poUpdate = prisma.purchaseOrder.update.mock.calls.at(-1)?.[0];
    expect(poUpdate.data).toEqual({ status: 'CANCELLED', outstandingAmount: 0 });
  });
});

describe('PurchaseOrdersService.summary', () => {
  it('rolls status group sums into register-wide totals', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.groupBy.mockResolvedValue([
      {
        status: 'DRAFT',
        _count: { _all: 2 },
        _sum: { totalAmount: 100, outstandingAmount: 100 },
      },
      {
        status: 'RECEIVED',
        _count: { _all: 1 },
        _sum: { totalAmount: 400, outstandingAmount: 0 },
      },
    ]);

    const result = await service.summary({ companyId: 'company-1' } as any, user);

    expect(prisma.purchaseOrder.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['status'],
        where: expect.objectContaining({ deletedAt: null, companyId: 'company-1' }),
        _sum: { totalAmount: true, outstandingAmount: true },
      }),
    );
    expect(result.totals).toEqual({ count: 3, totalAmount: 500, outstandingAmount: 100 });
    expect(result.byStatus).toEqual([
      { status: 'DRAFT', count: 2, totalAmount: 100, outstandingAmount: 100 },
      { status: 'RECEIVED', count: 1, totalAmount: 400, outstandingAmount: 0 },
    ]);
  });
});

describe('PurchaseOrdersService.confirm cash account currency', () => {
  function draftOrder(currency: string, purchaseType = 'CASH_PURCHASE') {
    return {
      id: 'po-1',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      purchaseType,
      currency,
      status: 'DRAFT',
      lines: [],
    };
  }

  it('blocks a cash purchase when no cash account holds the order currency', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(draftOrder('USD'));
    prisma.cashAccount.findMany.mockResolvedValue([{ currency: 'TZS' }]);

    await expect(service.confirm('po-1', user)).rejects.toThrow('No active cash account holds USD');
    expect(prisma.purchaseOrder.updateMany).not.toHaveBeenCalled();
  });

  it('confirms a cash purchase when a cash account currency matches', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(draftOrder('TZS'));
    prisma.cashAccount.findMany.mockResolvedValue([{ currency: 'TZS' }]);

    await service.confirm('po-1', user);

    expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'po-1', status: 'DRAFT' } }),
    );
  });

  it('does not currency-check a credit purchase', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(draftOrder('USD', 'CREDIT_PURCHASE'));

    await service.confirm('po-1', user);

    expect(prisma.cashAccount.findMany).not.toHaveBeenCalled();
    expect(prisma.purchaseOrder.updateMany).toHaveBeenCalled();
  });
});
