import { PurchaseOrdersService } from './purchase-orders.service';
import { Prisma } from '@prisma/client';

function makeService() {
  const prisma = {
    mobilePosEnrollment: { findFirst: jest.fn().mockResolvedValue(null) },
    mobilePosBranchSetup: { findFirst: jest.fn().mockResolvedValue(null) },
    mobilePosTerminal: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    companyProfile: { findUnique: jest.fn(async () => ({ currency: 'TZS' })) },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    $queryRaw: jest.fn().mockResolvedValue([]),
    supplierOrderDraft: { findFirst: jest.fn() },
    purchaseOrder: {
      create: jest.fn(async ({ data }: any) => ({ id: 'po-1', ...data, lines: [] })),
      update: jest.fn(async ({ data }: any) => ({ id: 'po-1', companyId: 'company-1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
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
      findUniqueOrThrow: jest.fn(async () => ({ outstandingAmount: new Prisma.Decimal(200) })),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: 'payable-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'payable-1', ...data })),
      aggregate: jest.fn().mockResolvedValue({ _sum: { outstandingAmount: 0 } }),
    },
    journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
    supplierPayment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { unappliedAmount: 0 } }),
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
      entityType === 'Payable'
        ? 'AP-2026-000001'
        : entityType === 'PurchaseInvoice'
          ? 'PINV-2026-000001'
          : 'PO-2026-000001',
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
  const payments = {
    createInTransaction: jest.fn(async () => ({ payment: { id: 'payment-1' } })),
    syncPurchaseOrders: jest.fn(),
  } as any;
  const cashPurchases = { fundingAccount: jest.fn(async () => ({ id: 'connected-cash' })) } as any;
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
    undefined,
    payments,
    cashPurchases,
  );

  return {
    service,
    prisma,
    postingEngine,
    accountResolver,
    inventoryMovements,
    codes,
    auditLogs,
    payments,
    cashPurchases,
  };
}

const user = { id: 'user-1', permissions: ['purchases.create'] } as any;

describe('Supplier draft conversion', () => {
  function setup() {
    const context = makeService();
    const source = {
      id: 'draft-1',
      draftNumber: 'SOD-2026-000001',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      supplierId: null,
      supplierName: 'Supplier Ltd',
      status: 'ACCEPTED',
      currency: 'TZS',
      neededBy: new Date('2026-10-10'),
      deliveryInstructions: 'Main store',
      terms: 'Net 30',
      notes: 'Original notes',
      lines: [
        {
          id: 'draft-line-1',
          description: 'Original item',
          quantity: 2,
          unitPrice: 100,
          discountAmount: 0,
          taxAmount: 0,
        },
      ],
    };
    context.prisma.supplierOrderDraft.findFirst.mockResolvedValue(source);
    const dto = createDto('CREDIT_PURCHASE');
    dto.lines[0].sourceDraftLineId = 'draft-line-1';
    return { ...context, source, dto };
  }
  it('copies the source snapshot, supplier and delivery details without financial posting', async () => {
    const { service, prisma, dto, postingEngine, inventoryMovements, auditLogs } = setup();
    const result = await service.convertDraft('draft-1', dto, user);
    expect(result.sourceDraftId).toBe('draft-1');
    expect(result.internalInvoiceNumber).toBe('PINV-2026-000001');
    expect(prisma.purchaseOrder.create.mock.calls[0][0].data).toMatchObject({
      status: 'DRAFT',
      supplierName: 'Supplier Ltd',
      expectedDate: new Date('2026-10-10'),
      lines: {
        create: [
          expect.objectContaining({ description: 'Original item', quantity: 2, unitCost: 100 }),
        ],
      },
    });
    expect(result.notes).toContain('SOD-2026-000001');
    expect(result.notes).toContain('Delivery: Main store');
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledTimes(2);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
    expect(prisma.payable.create).not.toHaveBeenCalled();
  });
  it('returns the same order on a retry without consuming new numbers', async () => {
    const { service, prisma, dto, codes } = setup();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'existing-po',
      sourceDraftId: 'draft-1',
      deletedAt: null,
    });
    expect((await service.convertDraft('draft-1', dto, user)).id).toBe('existing-po');
    expect(codes.next).not.toHaveBeenCalled();
    expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
  it.each(['CANCELLED', 'DECLINED'])('rejects %s source drafts', async (status) => {
    const { service, source, dto, prisma } = setup();
    source.status = status;
    await expect(service.convertDraft('draft-1', dto, user)).rejects.toThrow('cannot be converted');
    expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });
  it.each(['companyId', 'divisionId', 'branchId', 'currency'])(
    'rejects changed %s',
    async (field) => {
      const { service, dto, prisma } = setup();
      dto[field] = 'different';
      await expect(service.convertDraft('draft-1', dto, user)).rejects.toThrow();
      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    },
  );
  it('requires every source line exactly once', async () => {
    const { service, dto } = setup();
    dto.lines.push({ ...dto.lines[0] });
    await expect(service.convertDraft('draft-1', dto, user)).rejects.toThrow('exactly once');
  });
  it.each(['quantity', 'unitCost', 'discountAmount', 'taxAmount'])(
    'rejects tampered %s',
    async (field) => {
      const { service, dto } = setup();
      dto.lines[0][field] = 999;
      await expect(service.convertDraft('draft-1', dto, user)).rejects.toThrow(
        'Keep draft quantities',
      );
    },
  );
  it('allows entering a cost for an unpriced line', async () => {
    const { service, dto, source, prisma } = setup();
    (source.lines[0] as any).unitPrice = null;
    dto.lines[0].unitCost = 75;
    await service.convertDraft('draft-1', dto, user);
    expect(prisma.purchaseOrder.create.mock.calls[0][0].data.totalAmount).toBe(150);
  });
  it('retains the saved supplier and rejects another supplier', async () => {
    const { service, dto, source } = setup();
    (source as any).supplierId = 'source-supplier';
    dto.supplierId = 'another-supplier';
    await expect(service.convertDraft('draft-1', dto, user)).rejects.toThrow('Keep the draft');
  });
  it('checks company write scope even when returning an existing conversion', async () => {
    const { service, dto, prisma } = setup();
    const scope = (service as any).companyScope;
    scope.assertCanAccessCompany.mockRejectedValue(new Error('Forbidden'));
    await expect(service.convertDraft('draft-1', dto, user)).rejects.toThrow('Forbidden');
    expect(prisma.purchaseOrder.findFirst).not.toHaveBeenCalled();
  });
});

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
  it('generates an internal invoice number without inventing a supplier invoice or posting', async () => {
    const { service, prisma, postingEngine, inventoryMovements } = makeService();
    const result = await service.create(createDto('CREDIT_PURCHASE'), user);
    expect(result.internalInvoiceNumber).toBe('PINV-2026-000001');
    expect(result.supplierInvoiceNumber).toBeNull();
    expect(result.status).toBe('DRAFT');
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
    expect(prisma.payable.create).not.toHaveBeenCalled();
  });
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

  it('keeps cash purchases unpaid until an actual payment is recorded', async () => {
    const { service, prisma } = makeService();

    await service.create(createDto('CASH_PURCHASE'), user);

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
    const { service, prisma, postingEngine, accountResolver, payments } = makeService();
    prisma.payable.findUniqueOrThrow.mockResolvedValue({
      outstandingAmount: new Prisma.Decimal(9400000),
    });
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      purchaseType: 'CASH_PURCHASE',
      supplierId: 'supplier-1',
      currency: 'TZS',
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
          paidAmount: 0,
          outstandingAmount: 9400000,
          paymentStatus: 'UNPAID',
          journalEntryId: 'je-1',
        }),
      }),
    );
    expect(accountResolver.resolveMany).toHaveBeenCalledWith(
      'company-1',
      ['INVENTORY_ASSET', 'AP_CONTROL'],
      prisma,
    );
    expect(postingEngine.postLines).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        referenceType: 'Payable',
        referenceId: 'payable-1',
      }),
      prisma,
    );
    expect(payments.createInTransaction).toHaveBeenCalledWith(
      prisma,
      user,
      expect.objectContaining({
        source: { type: 'PurchaseOrder', id: 'po-1' },
        cashAccountId: 'connected-cash',
        amount: new Prisma.Decimal(9400000),
        allocations: [{ payableId: 'payable-1', amount: new Prisma.Decimal(9400000) }],
      }),
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
      supplierId: 'supplier-1',
      currency: 'TZS',
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
      supplierId: 'supplier-1',
      currency: 'TZS',
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
      supplierId: 'supplier-1',
      currency: 'TZS',
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
      supplierId: 'supplier-1',
      currency: 'TZS',
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
    prisma.fuelTank.findFirst.mockResolvedValue({
      id: 'tank-1',
      tankCode: 'DIESEL-1',
      tankName: 'Diesel Tank 1',
    });
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
    prisma.payable.findFirst.mockResolvedValue({
      id: 'payable-existing',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      currency: 'TZS',
      amount: 1000000,
      journalEntryId: 'covered-je',
    });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 'covered-je', totalDebit: 1000000 });

    await service.receive('po-1', user);

    // The pre-existing payable (created by the supplier-invoice flow) is left alone:
    // no second AP_CONTROL credit, no journalEntryId overwrite.
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(prisma.payable.create).not.toHaveBeenCalled();
    expect(prisma.payable.update).not.toHaveBeenCalled();
  });

  it('uses an AP receipt and a canonical cash payment for a CASH purchase', async () => {
    const { service, prisma, postingEngine, accountResolver, payments } = makeService();
    prisma.product.findUnique.mockResolvedValue({ id: 'product-1', trackInventory: true });
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      creditOrder({ purchaseType: 'CASH_PURCHASE' }),
    );

    await service.receive('po-1', user);

    expect(accountResolver.resolveMany).toHaveBeenCalledWith(
      'company-1',
      ['INVENTORY_ASSET', 'AP_CONTROL'],
      prisma,
    );
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    expect(prisma.payable.create).toHaveBeenCalledTimes(1);
    expect(payments.createInTransaction).toHaveBeenCalledTimes(1);
  });
  it('refreshes invoice coverage after locking the PO and preserves the stockist recorder in a caller-owned transaction', async () => {
    const { service, prisma, postingEngine, inventoryMovements } = makeService();
    let payableId: string | null = null;
    prisma.$queryRaw.mockImplementation(async () => {
      payableId = 'covered-payable';
      return [];
    });
    prisma.purchaseOrder.findFirst.mockImplementation(async () => creditOrder({ payableId }));
    prisma.product.findUnique.mockResolvedValue({ id: 'product-1', trackInventory: true });
    prisma.payable.findFirst.mockResolvedValue({
      companyId: 'company-1',
      supplierId: 'supplier-1',
      currency: 'TZS',
      amount: 1000000,
      journalEntryId: 'covered-je',
    });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 'covered-je', totalDebit: 1000000 });
    await service.receive('po-1', user, {}, prisma, { originUserId: 'stockist' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.purchaseOrder.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.purchaseOrder.findFirst.mock.invocationCallOrder[0],
    );
    expect(prisma.payable.create).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(inventoryMovements.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        createdById: 'stockist',
        auditActorUserId: 'user-1',
        tx: prisma,
      }),
    );
  });
  it.each([
    ['companyId', 'other-company'],
    ['supplierId', 'other-supplier'],
    ['currency', 'USD'],
    ['amount', 500000],
    ['journalEntryId', null],
  ])('rejects incompatible existing payable coverage for %s', async (field, value) => {
    const { service, prisma, postingEngine } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(creditOrder({ payableId: 'covered-payable' }));
    prisma.payable.findFirst.mockResolvedValue({
      companyId: 'company-1',
      supplierId: 'supplier-1',
      currency: 'TZS',
      amount: 1000000,
      journalEntryId: 'covered-je',
      [field]: value,
    });
    await expect(service.receive('po-1', user)).rejects.toThrow('coverage does not match');
    expect(prisma.payable.create).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
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
      supplierId: 'supplier-1',
      currency: 'TZS',
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
      supplierId: 'supplier-1',
      currency: 'TZS',
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
    prisma.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'CONFIRMED' });

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
    prisma.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'CONFIRMED' });
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

  it('rejects cancellation if the order was received before its transaction lock', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      companyId: 'company-1',
      status: 'CONFIRMED',
      payableId: 'payable-1',
    });
    prisma.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'RECEIVED' });

    await expect(service.cancel('po-1', user)).rejects.toThrow('Purchase order changed');
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.purchaseOrder.findUnique.mock.invocationCallOrder[0],
    );
    expect(prisma.payable.update).not.toHaveBeenCalled();
    expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
  });
});

describe('PurchaseOrdersService.summary', () => {
  it('keeps invoice coverage facets consistent with canonical payment filtering', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findMany.mockResolvedValue([
      order({
        payable: {
          id: 'ap-1',
          companyId: 'company-1',
          supplierId: 'supplier-1',
          currency: 'TZS',
          amount: 100,
          paidAmount: 100,
          outstandingAmount: 0,
          status: 'PAID',
        },
        supplierInvoices: [{ id: 'si-1' }],
      }),
      order({ id: 'open' }),
    ]);
    const result = await service.summary({ paymentStatus: 'PAID' } as any, user);
    expect(result.invoices).toEqual({
      linkedInvoiceCount: 1,
      missingInvoiceCount: 0,
      recordedInvoiceCount: 0,
    });
    expect(result.totals.count).toBe(1);
  });
  const order = (overrides: Record<string, unknown> = {}) => ({
    id: 'po-1',
    companyId: 'company-1',
    currency: 'TZS',
    supplierId: 'supplier-1',
    totalAmount: new Prisma.Decimal(100),
    paidAmount: new Prisma.Decimal(0),
    outstandingAmount: new Prisma.Decimal(100),
    paymentStatus: 'UNPAID',
    status: 'RECEIVED',
    ...overrides,
  });

  it('uses canonical settlement instead of stale historic order balances', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findMany.mockResolvedValue([
      order({
        payable: {
          id: 'ap-1',
          companyId: 'company-1',
          supplierId: 'supplier-1',
          currency: 'TZS',
          amount: 100,
          paidAmount: 100,
          outstandingAmount: 0,
          status: 'PAID',
          deletedAt: null,
          journalEntryId: 'je-1',
        },
      }),
    ]);

    const result = await service.summary({ companyId: 'company-1' } as any, user);
    expect(result.totals).toEqual({ count: 1, totalAmount: 100, outstandingAmount: 0 });
    expect(result.perCurrency).toEqual([
      expect.objectContaining({ currency: 'TZS', paidAmount: 100, outstandingAmount: 0 }),
    ]);
  });

  it('separates currency units and excludes canceled monetary values', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findMany.mockResolvedValue([
      order(),
      order({
        id: 'usd',
        currency: 'USD',
        totalAmount: new Prisma.Decimal(5),
        outstandingAmount: new Prisma.Decimal(5),
      }),
      order({ id: 'canceled', status: 'CANCELLED', totalAmount: new Prisma.Decimal(1000) }),
    ]);
    const result = await service.summary({} as any, user);
    expect(result.totals).toEqual({ count: 3, totalAmount: null, outstandingAmount: null });
    expect(result.mixedCurrencies).toBe(true);
    expect(result.perCurrency).toEqual([
      expect.objectContaining({ currency: 'TZS', totalAmount: 100, outstandingAmount: 100 }),
      expect.objectContaining({ currency: 'USD', totalAmount: 5, outstandingAmount: 5 }),
    ]);
  });

  it('flags a deleted canonical liability instead of projecting it as a paid source', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      order({
        payable: {
          companyId: 'company-1',
          supplierId: 'supplier-1',
          currency: 'TZS',
          amount: 100,
          paidAmount: 100,
          outstandingAmount: 0,
          deletedAt: new Date(),
        },
      }),
    );
    const result = await service.findOne('po-1', user);
    expect(result.accountingCoverage).toBe('CONFLICT');
    expect(Number(result.outstandingAmount)).toBe(100);
  });

  it('counts received unbilled coverage separately from draft commitments', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findMany.mockResolvedValue([
      order(),
      order({ id: 'draft', status: 'DRAFT' }),
    ]);
    const result = await service.summary({} as any, user);
    expect(result.perCurrency).toEqual([
      expect.objectContaining({ totalAmount: 200, unbilledAmount: 100 }),
    ]);
  });
});

describe('PurchaseOrdersService explicit payment deadline', () => {
  it.each([undefined, '2026-11-30'])(
    'creates receipt AP using explicit paymentDueDate %s instead of expected delivery',
    async (paymentDueDate) => {
      const { service, prisma } = makeService();
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        purchaseOrderNumber: 'PO-1',
        companyId: 'company-1',
        divisionId: null,
        branchId: 'branch-1',
        supplierId: 'supplier-1',
        supplierName: 'Supplier',
        purchaseType: 'CREDIT_PURCHASE',
        currency: 'TZS',
        totalAmount: new Prisma.Decimal(200),
        paidAmount: new Prisma.Decimal(0),
        outstandingAmount: new Prisma.Decimal(200),
        paymentStatus: 'UNPAID',
        status: 'CONFIRMED',
        expectedDate: new Date('2026-10-01'),
        lines: [],
      });
      await service.receive('po-1', user, { paymentDueDate });
      expect(prisma.payable.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dueDate: paymentDueDate ? new Date(paymentDueDate) : undefined,
          }),
        }),
      );
    },
  );
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
