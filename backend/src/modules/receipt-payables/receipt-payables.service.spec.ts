import { Prisma, PurchaseType } from '@prisma/client';
import { ReceiptPayablesService } from './receipt-payables.service';

const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

function receipt(id: string, acceptedQuantity: Prisma.Decimal.Value) {
  return {
    id,
    companyId: 'company-1',
    purchaseOrderId: 'po-1',
    status: 'POSTED',
    deletedAt: null,
    lines: [
      {
        productId: 'product-1',
        unitId: 'unit-1',
        acceptedQuantity: dec(acceptedQuantity),
        unitCost: dec('33.3333'),
      },
    ],
  };
}

function existingPayable(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payable-existing',
    companyId: 'company-1',
    supplierId: 'supplier-1',
    currency: 'TZS',
    sourceType: 'PurchaseOrder',
    sourceId: 'po-1',
    amount: dec(100),
    paidAmount: dec(0),
    outstandingAmount: dec(100),
    status: 'OPEN',
    deletedAt: null,
    journalEntryId: 'journal-existing',
    ...overrides,
  };
}

function liabilityJournal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'journal-existing',
    companyId: 'company-1',
    status: 'POSTED',
    deletedAt: null,
    referenceType: 'Payable',
    referenceId: 'payable-existing',
    moduleName: 'purchase-orders',
    description: 'Supplier-credit receipt PO-001',
    lines: [
      { accountId: 'inventory-account', debit: dec(100), credit: dec(0) },
      { accountId: 'ap-account', debit: dec(0), credit: dec(100) },
    ],
    ...overrides,
  };
}

function makeService(advances?: { apply: jest.Mock }) {
  const order = {
    id: 'po-1',
    purchaseOrderNumber: 'PO-001',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    supplierId: 'supplier-1',
    supplier: { name: 'Supplier One' },
    supplierName: 'Supplier One',
    currency: 'TZS',
    purchaseType: PurchaseType.STOCK_PURCHASE,
    status: 'RECEIVED',
    totalAmount: dec(100),
    paidAmount: dec(0),
    payableId: null,
    journalEntryId: null,
    lines: [
      {
        productId: 'product-1',
        unitId: 'unit-1',
        quantity: dec(3),
        unitCost: dec(30),
        // Gross agreed price includes line tax/discount, unlike raw unit cost.
        lineTotal: dec(100),
      },
    ],
  } as any;
  const state = {
    grns: [] as any[],
    invoices: [] as any[],
    payables: [] as any[],
    journals: [] as any[],
    standaloneGrn: null as any,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked-row' }]),
    purchaseOrder: {
      findFirst: jest.fn(async () => order),
      update: jest.fn(async ({ data }: any) => Object.assign(order, data)),
    },
    goodsReceivedNote: {
      findMany: jest.fn(async () => state.grns),
      findFirst: jest.fn(async ({ select }: any) => {
        if (select) return { purchaseOrderId: state.standaloneGrn ? null : order.id };
        return state.standaloneGrn;
      }),
    },
    supplierInvoice: { findMany: jest.fn(async () => state.invoices) },
    product: {
      findMany: jest.fn(async ({ where }: any) =>
        where.id.in.map((id: string) => ({ id, productType: 'STOCK_ITEM', trackInventory: true })),
      ),
    },
    companyProfile: { findUnique: jest.fn().mockResolvedValue({ currency: 'TZS' }) },
    supplierPayment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { unappliedAmount: dec(0) } }),
    },
    payable: {
      findMany: jest.fn(async () => state.payables),
      findUnique: jest.fn(async ({ where }: any) => state.payables.find((p) => p.id === where.id)),
      create: jest.fn(async ({ data }: any) => {
        const payable = {
          id: `payable-${state.payables.length + 1}`,
          deletedAt: null,
          journalEntryId: null,
          ...data,
          amount: dec(data.amount),
          paidAmount: dec(data.paidAmount),
          outstandingAmount: dec(data.outstandingAmount),
        };
        state.payables.push(payable);
        return payable;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const payable = state.payables.find((p) => p.id === where.id);
        Object.assign(payable, data);
        return payable;
      }),
      aggregate: jest.fn(async () => ({
        _sum: {
          outstandingAmount: state.payables
            .filter((p) => !p.deletedAt && ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'].includes(p.status))
            .reduce((sum, p) => sum.plus(p.outstandingAmount), dec(0)),
        },
      })),
    },
    journalEntry: {
      findMany: jest.fn(async () =>
        state.journals.filter((journal) => journal.status === 'POSTED' && !journal.deletedAt),
      ),
    },
    supplier: {
      findFirst: jest.fn().mockResolvedValue({ name: 'Supplier One' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as any;
  const codes = { next: jest.fn().mockResolvedValue('AP-001') };
  const accountResolver = {
    resolveMany: jest.fn().mockResolvedValue({
      INVENTORY_ASSET: { id: 'inventory-account' },
      GENERAL_EXPENSE: { id: 'expense-account' },
      AP_CONTROL: { id: 'ap-account' },
    }),
  };
  const postingEngine = {
    postLines: jest.fn(async (data: any) => {
      const journal = {
        id: `journal-${state.journals.length + 1}`,
        status: 'POSTED',
        deletedAt: null,
        ...data,
      };
      state.journals.push(journal);
      return journal;
    }),
  };
  const auditLogs = { logStrictInTransaction: jest.fn().mockResolvedValue(undefined) };
  const service = new ReceiptPayablesService(
    codes as any,
    accountResolver as any,
    postingEngine as any,
    auditLogs as any,
    advances as any,
  );
  const input = {
    purchaseOrderId: order.id,
    companyId: order.companyId,
    transactionDate: new Date('2026-10-20T00:00:00.000Z'),
    userId: 'user-1',
    tx,
  };
  return { service, tx, order, state, input, postingEngine, auditLogs, accountResolver };
}

describe('ReceiptPayablesService', () => {
  it('applies a verified purchase advance to the new receipt payable with the full user and owning transaction', async () => {
    const advances = { apply: jest.fn().mockResolvedValue(undefined) };
    const { service, tx, order, state, input } = makeService(advances);
    order.paidAmount = dec(20);
    tx.supplierPayment.aggregate.mockResolvedValueOnce({ _sum: { unappliedAmount: dec(20) } });
    const user = { id: input.userId, roles: ['GROUP_SUPER_ADMIN'] } as any;

    const result = await service.ensureForPurchaseOrder({ ...input, user });

    expect(result?.postedAmount).toBe('100.00');
    expect(state.payables).toHaveLength(1);
    expect(tx.supplierPayment.aggregate).toHaveBeenCalledWith({
      where: {
        companyId: order.companyId,
        supplierId: order.supplierId,
        currency: order.currency,
        deletedAt: null,
        status: 'COMPLETED',
        purchaseAdvance: { purchaseOrderId: order.id },
      },
      _sum: { unappliedAmount: true },
    });
    expect(advances.apply).toHaveBeenCalledWith(
      tx,
      user,
      order.id,
      result?.payableId,
      input.transactionDate,
    );
  });

  it('rejects a recorded prepayment without enough matching advance evidence before creating AP', async () => {
    const advances = { apply: jest.fn().mockResolvedValue(undefined) };
    const { service, tx, order, state, input, postingEngine } = makeService(advances);
    order.paidAmount = dec(20);
    tx.supplierPayment.aggregate.mockResolvedValueOnce({ _sum: { unappliedAmount: dec(19) } });

    await expect(
      service.ensureForPurchaseOrder({ ...input, user: { id: input.userId } as any }),
    ).rejects.toThrow('recorded settlement without a payable');

    expect(tx.payable.create).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(advances.apply).not.toHaveBeenCalled();
    expect(state.payables).toHaveLength(0);
  });

  it('posts a stock purchase liability and journals it using the caller transaction', async () => {
    const { service, tx, order, state, input, postingEngine, auditLogs } = makeService();

    const result = await service.ensureForPurchaseOrder(input);

    expect(result?.postedAmount).toBe('100.00');
    expect(state.payables).toHaveLength(1);
    expect(state.payables[0].sourceType).toBe('PurchaseOrder');
    expect(state.payables[0].amount.toFixed(2)).toBe('100.00');
    expect(order.payableId).toBe(state.payables[0].id);
    expect(postingEngine.postLines).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceType: 'Payable',
        referenceId: state.payables[0].id,
        lines: [
          expect.objectContaining({ accountId: 'inventory-account', debit: dec(100), credit: 0 }),
          expect.objectContaining({ accountId: 'ap-account', debit: 0, credit: dec(100) }),
        ],
      }),
      tx,
    );
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'RECEIPT_PAYABLE_POST' }),
    );
  });

  it('aggregates accepted gross values before rounding, posts only each delta, and repeats without another liability', async () => {
    const { service, tx, order, state, input, postingEngine } = makeService();
    order.status = 'PARTIALLY_RECEIVED';
    state.grns.push(receipt('grn-1', 1));

    expect((await service.ensureForPurchaseOrder(input))?.postedAmount).toBe('33.33');
    state.grns.push(receipt('grn-2', 1));
    expect((await service.ensureForPurchaseOrder(input))?.postedAmount).toBe('33.34');
    state.grns.push(receipt('grn-3', 1));
    order.status = 'RECEIVED';
    expect((await service.ensureForPurchaseOrder(input))?.postedAmount).toBe('33.33');
    expect((await service.ensureForPurchaseOrder(input))?.postedAmount).toBe('0.00');

    expect(state.payables).toHaveLength(1);
    expect(state.payables[0].amount.toFixed(2)).toBe('100.00');
    expect(state.payables[0].outstandingAmount.toFixed(2)).toBe('100.00');
    expect(postingEngine.postLines).toHaveBeenCalledTimes(3);
    expect(tx.payable.create).toHaveBeenCalledTimes(1);
    expect(state.journals.reduce((sum, j) => sum.plus(j.lines[1].credit), dec(0)).toFixed(2)).toBe(
      '100.00',
    );
  });

  it('reuses a posted invoice liability even when it covers more than the partial receipt', async () => {
    const { service, tx, order, state, input, postingEngine } = makeService();
    order.status = 'PARTIALLY_RECEIVED';
    state.grns.push(receipt('grn-1', 1));
    state.invoices.push({ id: 'invoice-1', payableId: 'payable-existing' });
    state.payables.push(existingPayable({ sourceType: 'SupplierInvoice', sourceId: 'invoice-1' }));
    state.journals.push(
      liabilityJournal({
        referenceType: 'SupplierInvoice',
        referenceId: 'invoice-1',
        moduleName: 'supplier-invoices',
      }),
    );

    const result = await service.ensureForPurchaseOrder(input);

    expect(result).toEqual({
      payableId: 'payable-existing',
      journalEntryId: 'journal-existing',
      postedAmount: '0.00',
    });
    expect(order.payableId).toBe('payable-existing');
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.payable.create).not.toHaveBeenCalled();
  });

  it('allows explicitly free extra goods without adding a liability for them', async () => {
    const { service, state, input } = makeService();
    const grn = receipt('grn-1', 3);
    grn.lines.push({
      productId: 'free-product',
      unitId: 'unit-1',
      acceptedQuantity: dec(2),
      unitCost: dec(0),
    });
    state.grns.push(grn);

    expect((await service.ensureForPurchaseOrder(input))?.postedAmount).toBe('100.00');
    expect(state.payables[0].amount.toFixed(2)).toBe('100.00');
  });

  it('rejects a linked GRN cost variance pending review of the approved purchase value', async () => {
    const { service, state, input, postingEngine } = makeService();
    const grn = receipt('grn-1', 3);
    grn.lines[0].unitCost = dec(40);
    state.grns.push(grn);

    await expect(service.ensureForPurchaseOrder(input)).rejects.toThrow(
      'GRN cost differs from the approved purchase order',
    );
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(state.payables).toHaveLength(0);
  });

  it('rejects multiple active liabilities rather than choosing one and posting again', async () => {
    const { service, state, input, postingEngine } = makeService();
    state.payables.push(existingPayable(), existingPayable({ id: 'payable-duplicate' }));

    await expect(service.ensureForPurchaseOrder(input)).rejects.toThrow('Multiple liabilities');
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('rejects an unlinked manual payable that may already represent the receipt', async () => {
    const { service, state, input, postingEngine } = makeService();
    state.payables.push(existingPayable({ sourceType: null, sourceId: null }));

    await expect(service.ensureForPurchaseOrder(input)).rejects.toThrow(
      'An unlinked payable may already cover',
    );
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('adds accepted services as an expense delta without increasing the existing stock debit', async () => {
    const { service, tx, order, state, input, postingEngine } = makeService();
    order.lines.push({
      productId: 'service-1',
      unitId: 'unit-1',
      quantity: dec(2),
      unitCost: dec(6),
      lineTotal: dec(12),
    });
    order.totalAmount = dec(112);
    order.status = 'PARTIALLY_RECEIVED';
    state.grns.push(receipt('stock-grn', 3));
    tx.product.findMany.mockImplementation(async ({ where }: any) =>
      where.id.in.map((id: string) => ({
        id,
        productType: id === 'service-1' ? 'SERVICE' : 'STOCK_ITEM',
        trackInventory: id !== 'service-1',
      })),
    );
    await service.ensureForPurchaseOrder(input);
    state.grns.push({
      id: 'service-grn',
      lines: [
        { productId: 'service-1', unitId: 'unit-1', acceptedQuantity: dec(2), unitCost: dec(6) },
      ],
    });
    order.status = 'RECEIVED';

    expect((await service.ensureForPurchaseOrder(input))?.postedAmount).toBe('12.00');

    const deltaLines = postingEngine.postLines.mock.calls[1][0].lines;
    expect(deltaLines).toEqual([
      expect.objectContaining({ accountId: 'expense-account', debit: dec(12), credit: 0 }),
      expect.objectContaining({ accountId: 'ap-account', debit: 0, credit: dec(12) }),
    ]);
    expect(state.payables[0].amount.toFixed(2)).toBe('112.00');
  });

  it('rejects a same-total rounding shift between expense and inventory instead of leaving the old debit allocation', async () => {
    const { service, tx, order, state, input, postingEngine } = makeService();
    order.payableId = 'payable-existing';
    order.journalEntryId = 'journal-existing';
    order.totalAmount = dec('0.02');
    order.lines = ['product-1', 'service-1'].map((productId) => ({
      productId,
      unitId: 'unit-1',
      quantity: dec(2),
      unitCost: dec('0.005'),
      lineTotal: dec('0.01'),
    }));
    tx.product.findMany.mockImplementation(async ({ where }: any) =>
      where.id.in.map((id: string) => ({
        id,
        productType: id === 'service-1' ? 'SERVICE' : 'STOCK_ITEM',
        trackInventory: id !== 'service-1',
      })),
    );
    state.grns.push(
      {
        id: 'prior-service',
        lines: [
          {
            productId: 'service-1',
            unitId: 'unit-1',
            acceptedQuantity: dec(1),
            unitCost: dec('0.005'),
          },
        ],
      },
      {
        id: 'new-stock',
        lines: [
          {
            productId: 'product-1',
            unitId: 'unit-1',
            acceptedQuantity: dec(1),
            unitCost: dec('0.005'),
          },
        ],
      },
    );
    state.payables.push(existingPayable({ amount: dec('0.01'), outstandingAmount: dec('0.01') }));
    state.journals.push(
      liabilityJournal({
        lines: [
          { accountId: 'expense-account', debit: dec('0.01'), credit: dec(0) },
          { accountId: 'ap-account', debit: dec(0), credit: dec('0.01') },
        ],
      }),
    );

    await expect(service.ensureForPurchaseOrder(input)).rejects.toThrow(/rounding|allocation/i);

    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.payable.update).not.toHaveBeenCalled();
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
    expect(state.payables[0].amount.toFixed(2)).toBe('0.01');
    expect(state.journals).toHaveLength(1);
  });

  it.each([{ status: 'CANCELLED' }, { deletedAt: new Date('2026-10-19T00:00:00Z') }])(
    'rejects inactive payable coverage with a posted liability (%j)',
    async (inactive) => {
      const { service, state, input, postingEngine } = makeService();
      state.payables.push(existingPayable(inactive));
      state.journals.push(liabilityJournal());

      await expect(service.ensureForPurchaseOrder(input)).rejects.toThrow(
        'Inactive receipt payable still has posted accounting',
      );
      expect(postingEngine.postLines).not.toHaveBeenCalled();
    },
  );

  it('rejects an orphan posted purchase journal instead of duplicating its AP', async () => {
    const { service, tx, state, input, postingEngine } = makeService();
    state.journals.push(liabilityJournal({ referenceType: 'PurchaseOrder', referenceId: 'po-1' }));

    await expect(service.ensureForPurchaseOrder(input)).rejects.toThrow(
      'is not linked to its payable',
    );
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.payable.create).not.toHaveBeenCalled();
  });

  it('aborts before links and the success audit when journal posting fails', async () => {
    const { service, tx, input, postingEngine, auditLogs } = makeService();
    postingEngine.postLines.mockRejectedValueOnce(new Error('Accounting period closed'));

    await expect(service.ensureForPurchaseOrder(input)).rejects.toThrow('Accounting period closed');

    expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
    expect(tx.payable.update).not.toHaveBeenCalled();
    expect(auditLogs.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('creates no payable for an explicitly cash-settled purchase', async () => {
    const { service, tx, order, input, postingEngine, accountResolver } = makeService();
    order.purchaseType = PurchaseType.CASH_PURCHASE;

    expect(await service.ensureForPurchaseOrder(input)).toBeNull();

    expect(tx.payable.create).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(accountResolver.resolveMany).not.toHaveBeenCalled();
  });

  it('posts standalone supplier GRNs once using accepted cost and linked invoice currency', async () => {
    const { service, tx, state, input, postingEngine } = makeService();
    state.standaloneGrn = {
      ...receipt('standalone-grn', 4),
      purchaseOrderId: null,
      grnNumber: 'GRN-001',
      divisionId: 'division-1',
      branchId: 'branch-1',
      supplierId: 'supplier-1',
      lines: [{ acceptedQuantity: dec(4), unitCost: dec('12.50') }],
      supplierInvoices: [{ currency: 'USD', status: 'DRAFT', deletedAt: null }],
    };
    const grnInput = { ...input, goodsReceivedNoteId: 'standalone-grn' };

    expect((await service.ensureForGrn(grnInput))?.postedAmount).toBe('50.00');
    expect((await service.ensureForGrn(grnInput))?.postedAmount).toBe('0.00');

    expect(state.payables).toHaveLength(1);
    expect(state.payables[0]).toEqual(
      expect.objectContaining({
        sourceType: 'GoodsReceivedNote',
        sourceId: 'standalone-grn',
        currency: 'USD',
      }),
    );
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
  });

  it('shares the PO liability when a GRN is linked to a purchase order', async () => {
    const { service, state, input, postingEngine } = makeService();
    state.grns.push(receipt('grn-1', 3));

    expect(
      (await service.ensureForGrn({ ...input, goodsReceivedNoteId: 'grn-1' }))?.postedAmount,
    ).toBe('100.00');
    expect((await service.ensureForPurchaseOrder(input))?.postedAmount).toBe('0.00');

    expect(state.payables).toHaveLength(1);
    expect(state.payables[0].sourceType).toBe('PurchaseOrder');
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
  });

  it('preserves a prior payment while increasing a partial receipt liability', async () => {
    const { service, order, state, input, postingEngine } = makeService();
    order.status = 'PARTIALLY_RECEIVED';
    order.payableId = 'payable-existing';
    order.journalEntryId = 'journal-existing';
    state.grns.push(receipt('grn-1', 1), receipt('grn-2', 1));
    state.payables.push(
      existingPayable({
        amount: dec('33.33'),
        paidAmount: dec(10),
        outstandingAmount: dec('23.33'),
        status: 'PARTIALLY_PAID',
      }),
    );
    state.journals.push(
      liabilityJournal({
        lines: [
          { accountId: 'inventory-account', debit: dec('33.33'), credit: dec(0) },
          { accountId: 'ap-account', debit: dec(0), credit: dec('33.33') },
        ],
      }),
      liabilityJournal({
        id: 'payment-journal',
        moduleName: 'payables',
        description: 'Payable settlement AP-001',
        lines: [
          { accountId: 'ap-account', debit: dec(10), credit: dec(0) },
          { accountId: 'cash-account', debit: dec(0), credit: dec(10) },
        ],
      }),
    );

    expect((await service.ensureForPurchaseOrder(input))?.postedAmount).toBe('33.34');

    expect(state.payables[0].amount.toFixed(2)).toBe('66.67');
    expect(state.payables[0].paidAmount.toFixed(2)).toBe('10.00');
    expect(state.payables[0].outstandingAmount.toFixed(2)).toBe('56.67');
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
  });

  it('rejects a payable whose backing journal is not posted instead of retaining that link on a new journal', async () => {
    const { service, state, input, postingEngine } = makeService();
    state.payables.push(existingPayable());
    state.journals.push(liabilityJournal({ status: 'DRAFT' }));

    await expect(service.ensureForPurchaseOrder(input)).rejects.toThrow(/journal|backing/i);

    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });
});
