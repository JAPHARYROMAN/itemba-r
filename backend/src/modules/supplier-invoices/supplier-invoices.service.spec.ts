import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupplierInvoicesService } from './supplier-invoices.service';

function approvableInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'si-1',
    companyId: 'company-1',
    supplierId: 'supplier-1',
    supplierInvoiceNumber: 'SI-2026-000001',
    status: 'DRAFT',
    purchaseOrderId: null,
    payableId: null,
    totalAmount: 100,
    paidAmount: 0,
    currency: 'TZS',
    invoiceDate: new Date('2026-05-30T00:00:00.000Z'),
    dueDate: null,
    divisionId: 'division-1',
    branchId: 'branch-1',
    lines: [{ id: 'line-1', productId: 'product-1', lineTotal: 100 }],
    ...overrides,
  };
}

function makeService(txOverrides: Record<string, any> = {}) {
  const prisma: any = {
    supplierInvoice: {
      findFirst: jest.fn(async () => approvableInvoice()),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async ({ data }: any) => ({ id: 'si-1', ...data, lines: [] })),
    },
    supplier: {
      findFirst: jest.fn(async () => ({ id: 'supplier-1', name: 'Acme' })),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    ...txOverrides,
  };
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const accountResolver = {} as any;
  const postingEngine = {} as any;
  const codes = { next: jest.fn(async () => 'PAY-2026-000001') } as any;

  const service = new SupplierInvoicesService(
    prisma,
    auditLogs,
    companyScope,
    accountResolver,
    postingEngine,
    codes,
  );
  return { service, prisma };
}

const user = { id: 'user-1' } as any;

describe('SupplierInvoicesService approve atomic claim', () => {
  it('throws ConflictException and never posts when another action already claimed the invoice', async () => {
    const { service, prisma } = makeService();
    // findOne decorates results via extra queries; bypass it for a focused test.
    jest.spyOn(service, 'findOne').mockResolvedValue(approvableInvoice() as any);
    // Race loss: the guarded status claim matches no row.
    prisma.supplierInvoice.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.approve('si-1', undefined, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // The guarded claim was attempted with the correct pre-approval status set...
    expect(prisma.supplierInvoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'si-1',
          deletedAt: null,
          status: { in: ['DRAFT', 'RECEIVED', 'MATCHED', 'DISPUTED'] },
        }),
        data: expect.objectContaining({ status: 'APPROVED' }),
      }),
    );
    // ...and losing the claim short-circuits before any payable is created/posted.
    expect(prisma.supplierInvoice.update).not.toHaveBeenCalled();
  });

  it('leaves a PO-linked invoice APPROVED after a successful approval, not MATCHED/DISPUTED', async () => {
    const { service, prisma } = makeService({
      payable: {
        findUnique: jest.fn(),
        create: jest.fn(async () => ({
          id: 'pay-1',
          companyId: 'company-1',
          supplierId: 'supplier-1',
          journalEntryId: null,
        })),
        update: jest.fn(async () => ({ id: 'pay-1' })),
      },
      purchaseOrder: { updateMany: jest.fn(async () => ({ count: 1 })) },
    });
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(approvableInvoice({ purchaseOrderId: 'po-1', payableId: null }) as any);
    // createThreeWayMatch() writes status MATCHED/DISPUTED inside the same tx; the
    // final update must override it back to APPROVED. Stub the heavy collaborators.
    jest.spyOn(service as any, 'createThreeWayMatch').mockResolvedValue({ matchStatus: 'MATCHED' });
    jest.spyOn(service as any, 'postSupplierInvoicePayable').mockResolvedValue({ id: 'je-1' });
    jest.spyOn(service as any, 'syncSupplierBalance').mockResolvedValue(undefined);

    await service.approve('si-1', undefined, user);

    const finalUpdate = prisma.supplierInvoice.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate.data).toEqual(
      expect.objectContaining({ status: 'APPROVED', payableId: 'pay-1' }),
    );
  });
});

function makeUpdateService(prismaOverrides: Record<string, any> = {}) {
  const prisma: any = {
    supplierInvoice: {
      // assertInvoiceNumberAvailable lookups + the final update.
      findFirst: jest.fn(async () => null),
      update: jest.fn(async ({ data }: any) => ({ id: 'si-1', ...data, lines: [] })),
    },
    supplierInvoiceLine: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    threeWayMatch: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    supplier: {
      findFirst: jest.fn(async () => ({
        id: 'supplier-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
      })),
    },
    purchaseOrder: {
      findFirst: jest.fn(async () => ({
        id: 'po-1',
        supplierId: 'supplier-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        currency: 'TZS',
      })),
    },
    branch: {
      findFirst: jest.fn(async () => ({
        divisionId: 'division-1',
        division: { companyId: 'company-1' },
      })),
    },
    division: {
      findFirst: jest.fn(async () => ({ companyId: 'company-1' })),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    ...prismaOverrides,
  };
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new SupplierInvoicesService(
    prisma,
    auditLogs,
    companyScope,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, prisma };
}

const updateLines = [{ description: 'Widget', quantity: 1, unitPrice: 100 }] as any;

describe('SupplierInvoicesService update three-way match invalidation', () => {
  it('soft-deletes prior three-way matches when the lines are rewritten (reset to DRAFT)', async () => {
    const { service, prisma } = makeUpdateService();
    jest.spyOn(service, 'findOne').mockResolvedValue(
      approvableInvoice({
        status: 'DISPUTED',
        purchaseOrderId: 'po-1',
        currency: 'TZS',
      }) as any,
    );

    await service.update('si-1', { lines: updateLines, currency: 'TZS' } as any, user);

    expect(prisma.threeWayMatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { supplierInvoiceId: 'si-1', deletedAt: null },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('does not touch three-way matches when the lines are left unchanged', async () => {
    const { service, prisma } = makeUpdateService();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(
        approvableInvoice({ status: 'DRAFT', purchaseOrderId: 'po-1', currency: 'TZS' }) as any,
      );

    await service.update('si-1', { notes: 'memo' } as any, user);

    expect(prisma.threeWayMatch.updateMany).not.toHaveBeenCalled();
  });
});

describe('SupplierInvoicesService currency lock', () => {
  it('rejects an invoice whose currency differs from its linked purchase order', async () => {
    const { service } = makeUpdateService({
      purchaseOrder: {
        findFirst: jest.fn(async () => ({
          id: 'po-1',
          supplierId: 'supplier-1',
          divisionId: 'division-1',
          branchId: 'branch-1',
          currency: 'USD',
        })),
      },
    });
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(
        approvableInvoice({ status: 'DRAFT', purchaseOrderId: 'po-1', currency: 'TZS' }) as any,
      );

    await expect(service.update('si-1', { currency: 'TZS' } as any, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('allows an invoice whose currency matches its linked purchase order', async () => {
    const { service, prisma } = makeUpdateService();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(
        approvableInvoice({ status: 'DRAFT', purchaseOrderId: 'po-1', currency: 'TZS' }) as any,
      );

    await service.update('si-1', { currency: 'TZS' } as any, user);

    expect(prisma.supplierInvoice.update).toHaveBeenCalled();
  });
});

describe('SupplierInvoicesService runMatch guard', () => {
  it('rejects re-matching an already-approved invoice (would revert it out of APPROVED)', async () => {
    const { service } = makeService();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(approvableInvoice({ status: 'APPROVED' }) as any);

    await expect(service.runMatch('si-1', user)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SupplierInvoicesService cash-purchase PO guard', () => {
  it('rejects linking an invoice to a CASH_PURCHASE order (settles at receipt, no AP)', async () => {
    const { service } = makeUpdateService({
      purchaseOrder: {
        findFirst: jest.fn(async () => ({
          id: 'po-1',
          supplierId: 'supplier-1',
          divisionId: 'division-1',
          branchId: 'branch-1',
          currency: 'TZS',
          purchaseType: 'CASH_PURCHASE',
        })),
      },
    });
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(
        approvableInvoice({ status: 'DRAFT', purchaseOrderId: 'po-1', currency: 'TZS' }) as any,
      );

    await expect(service.update('si-1', { currency: 'TZS' } as any, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SupplierInvoicesService re-approval preserves payable payments (#6)', () => {
  it('derives outstanding from the payable paidAmount, not the invoice, on the update branch', async () => {
    const payableUpdate = jest.fn(async ({ data }: any) => ({
      id: 'pay-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      journalEntryId: 'je-1',
      ...data,
    }));
    const { service, prisma } = makeService({
      payable: {
        // The payable already received a 60 payment booked directly against it;
        // the invoice row still reports paidAmount 0 (stale).
        findUnique: jest.fn(async () => ({
          companyId: 'company-1',
          supplierId: 'supplier-1',
          paidAmount: 60,
        })),
        update: payableUpdate,
        create: jest.fn(),
      },
    });
    jest.spyOn(service, 'findOne').mockResolvedValue(
      approvableInvoice({
        status: 'DISPUTED',
        payableId: 'pay-1',
        totalAmount: 100,
        paidAmount: 0,
        purchaseOrderId: null,
      }) as any,
    );
    jest.spyOn(service as any, 'syncSupplierBalance').mockResolvedValue(undefined);

    await service.approve('si-1', undefined, user);

    expect(payableUpdate).toHaveBeenCalledTimes(1);
    const data = payableUpdate.mock.calls[0][0].data;
    // amount re-asserted to the invoice total (100), but outstanding keeps the
    // 60 already paid against the payable: 100 - 60 = 40 (NOT 100 - invoice.paidAmount).
    expect(Number(data.amount)).toBe(100);
    expect(Number(data.outstandingAmount)).toBe(40);
    // paidAmount is left untouched on the payable so applied payments survive.
    expect(data.paidAmount).toBeUndefined();
    // No second journal is posted when one already exists.
    expect(prisma.supplierInvoice.update).toHaveBeenCalled();
  });
});

describe('SupplierInvoicesService amountVarianceAgainstPurchaseOrder (#16)', () => {
  function poLine(overrides: Record<string, unknown> = {}) {
    return { productId: 'p-a', unitCost: 100, lineTotal: 1000, ...overrides };
  }
  function invLine(overrides: Record<string, unknown> = {}) {
    return {
      productId: 'p-a',
      quantity: 10,
      unitPrice: 100,
      lineTotal: 1000,
      taxAmount: 0,
      discountAmount: 0,
      ...overrides,
    };
  }

  it('does not flag a matched line just because the invoice carries an extra non-PO line', () => {
    const { service } = makeService();
    const invoice = {
      totalAmount: 2000,
      lines: [
        invLine(), // matches PO product p-a exactly: 1000
        invLine({ productId: null, lineTotal: 1000, quantity: 1, unitPrice: 1000 }), // freight 1000
      ],
    };
    const variance = (service as any).amountVarianceAgainstPurchaseOrder(invoice, [poLine()]);
    // Old (buggy) code compared expected 1000 against invoice.totalAmount 2000 => 1000.
    // Like-for-like over matched lines only => 0.
    expect(Number(variance)).toBe(0);
  });

  it('still detects a genuine overcharge on a matched line', () => {
    const { service } = makeService();
    const invoice = {
      totalAmount: 1200,
      lines: [invLine({ unitPrice: 120, lineTotal: 1200 })], // billed 1200 vs expected 1000
    };
    const variance = (service as any).amountVarianceAgainstPurchaseOrder(invoice, [poLine()]);
    expect(Number(variance)).toBe(200);
  });

  it('falls back to whole-invoice vs PO total when no line matches', () => {
    const { service } = makeService();
    const invoice = {
      totalAmount: 1500,
      lines: [invLine({ productId: 'p-other', lineTotal: 1500, unitPrice: 150 })],
    };
    const variance = (service as any).amountVarianceAgainstPurchaseOrder(invoice, [poLine()]);
    // No matched line => whole-invoice fallback: |1500 - 1000| = 500.
    expect(Number(variance)).toBe(500);
  });
});

describe('SupplierInvoicesService postSupplierInvoicePayable inventory-receipt guard', () => {
  function makePostService(prismaOverrides: Record<string, any> = {}) {
    const prisma: any = {
      product: {
        findMany: jest.fn(async () => [{ id: 'product-1', trackInventory: true }]),
      },
      goodsReceivedNote: { findFirst: jest.fn(async () => null) },
      purchaseOrder: { findFirst: jest.fn(async () => null) },
      ...prismaOverrides,
    };
    const accountResolver = {
      resolve: jest.fn(async (_companyId: string, role: string) => ({ id: `acc-${role}` })),
    } as any;
    const postingEngine = {
      postLines: jest.fn(async () => ({ id: 'je-1', journalNumber: 'JE-1' })),
    } as any;
    const service = new SupplierInvoicesService(
      prisma,
      { log: jest.fn() } as any,
      { assertCanAccessCompany: jest.fn() } as any,
      accountResolver,
      postingEngine,
      { next: jest.fn() } as any,
    );
    return { service, prisma, accountResolver, postingEngine };
  }

  function stockInvoice(overrides: Record<string, unknown> = {}) {
    return {
      id: 'si-1',
      companyId: 'company-1',
      supplierInvoiceNumber: 'SI-1',
      invoiceDate: new Date('2026-05-30T00:00:00.000Z'),
      divisionId: 'division-1',
      branchId: 'branch-1',
      purchaseOrderId: null,
      goodsReceivedNoteId: null,
      lines: [{ id: 'line-1', productId: 'product-1', lineTotal: 10000 }],
      ...overrides,
    };
  }

  const payable = { id: 'pay-1', amount: new Prisma.Decimal(10000) };

  it('rejects an inventory-line invoice with no posted goods receipt (GL would overstate subledger)', async () => {
    const { service, postingEngine } = makePostService();
    const tx: any = {
      product: { findMany: jest.fn(async () => [{ id: 'product-1', trackInventory: true }]) },
      goodsReceivedNote: { findFirst: jest.fn(async () => null) },
      purchaseOrder: { findFirst: jest.fn(async () => null) },
    };
    await expect(
      (service as any).postSupplierInvoicePayable(stockInvoice(), payable, 'user-1', tx),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('posts DR INVENTORY_ASSET / CR AP_CONTROL when a POSTED GRN backs the invoice', async () => {
    const { service, postingEngine } = makePostService();
    const tx: any = {
      product: { findMany: jest.fn(async () => [{ id: 'product-1', trackInventory: true }]) },
      goodsReceivedNote: { findFirst: jest.fn(async () => ({ id: 'grn-1' })) },
      purchaseOrder: { findFirst: jest.fn(async () => null) },
    };
    await (service as any).postSupplierInvoicePayable(
      stockInvoice({ goodsReceivedNoteId: 'grn-1' }),
      payable,
      'user-1',
      tx,
    );
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const lines = postingEngine.postLines.mock.calls[0][0].lines;
    const inventoryLine = lines.find((l: any) => l.accountId === 'acc-INVENTORY_ASSET');
    const apLine = lines.find((l: any) => l.accountId === 'acc-AP_CONTROL');
    expect(Number(inventoryLine.debit)).toBe(10000);
    expect(Number(apLine.credit)).toBe(10000);
    const debits = lines.reduce((s: number, l: any) => s + Number(l.debit ?? 0), 0);
    const credits = lines.reduce((s: number, l: any) => s + Number(l.credit ?? 0), 0);
    expect(debits).toBe(credits); // balanced JE
  });

  it('posts a received PO as a valid receipt (no GRN linked)', async () => {
    const { service, postingEngine } = makePostService();
    const tx: any = {
      product: { findMany: jest.fn(async () => [{ id: 'product-1', trackInventory: true }]) },
      goodsReceivedNote: { findFirst: jest.fn(async () => null) },
      purchaseOrder: { findFirst: jest.fn(async () => ({ id: 'po-1' })) },
    };
    await (service as any).postSupplierInvoicePayable(
      stockInvoice({ purchaseOrderId: 'po-1' }),
      payable,
      'user-1',
      tx,
    );
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
  });

  it('does not require a receipt for a non-stock (expense-only) invoice', async () => {
    const { service, postingEngine } = makePostService();
    const tx: any = {
      // product tracks no inventory -> line is routed to GENERAL_EXPENSE, no guard
      product: { findMany: jest.fn(async () => [{ id: 'product-1', trackInventory: false }]) },
      goodsReceivedNote: { findFirst: jest.fn(async () => null) },
      purchaseOrder: { findFirst: jest.fn(async () => null) },
    };
    await (service as any).postSupplierInvoicePayable(stockInvoice(), payable, 'user-1', tx);
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const lines = postingEngine.postLines.mock.calls[0][0].lines;
    expect(lines.some((l: any) => l.accountId === 'acc-GENERAL_EXPENSE')).toBe(true);
    expect(lines.some((l: any) => l.accountId === 'acc-INVENTORY_ASSET')).toBe(false);
  });
});
