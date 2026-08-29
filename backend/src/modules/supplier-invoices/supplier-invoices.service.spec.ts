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
    updatedAt: new Date('2026-05-30T12:00:00.000Z'),
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
  const auditLogs = {
    log: jest.fn().mockResolvedValue(undefined),
    logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
  } as any;
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
  return { auditLogs, service, prisma };
}

const user = { id: 'user-1' } as any;

describe('SupplierInvoicesService approve atomic claim', () => {
  it('rejects an update-to-approve stale snapshot before creating or posting a payable', async () => {
    const { service, prisma } = makeService();
    // findOne decorates results via extra queries; bypass it for a focused test.
    const snapshot = approvableInvoice();
    jest.spyOn(service, 'findOne').mockResolvedValue(snapshot as any);
    // An update committed after findOne(), so the exact updatedAt claim loses even
    // though the persisted status is still DRAFT and remains broadly approvable.
    prisma.supplierInvoice.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.approve('si-1', undefined, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // The claim is pinned to the exact status/version that was validated.
    expect(prisma.supplierInvoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'si-1',
          deletedAt: null,
          status: 'DRAFT',
          updatedAt: snapshot.updatedAt,
        },
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

  it('reuses the active match produced by runMatch when approving a matched invoice', async () => {
    const activeMatch = {
      id: 'match-1',
      supplierInvoiceId: 'si-1',
      companyId: 'company-1',
      purchaseOrderId: 'po-1',
      matchStatus: 'MATCHED',
    };
    const { auditLogs, service, prisma } = makeService({
      threeWayMatch: {
        findFirst: jest.fn(async () => activeMatch),
        create: jest.fn(),
      },
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
    const matchedSnapshot = approvableInvoice({
      status: 'MATCHED',
      purchaseOrderId: 'po-1',
    });
    jest.spyOn(service, 'findOne').mockResolvedValue(matchedSnapshot as any);
    const createMatch = jest.spyOn(service as any, 'createThreeWayMatch');
    jest.spyOn(service as any, 'postSupplierInvoicePayable').mockResolvedValue({ id: 'je-1' });
    jest.spyOn(service as any, 'syncSupplierBalance').mockResolvedValue(undefined);

    await service.approve('si-1', undefined, user);

    expect(prisma.supplierInvoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'si-1',
          deletedAt: null,
          status: 'MATCHED',
          updatedAt: matchedSnapshot.updatedAt,
        },
      }),
    );
    expect(prisma.threeWayMatch.findFirst).toHaveBeenCalledWith({
      where: {
        supplierInvoiceId: 'si-1',
        companyId: 'company-1',
        purchaseOrderId: 'po-1',
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(createMatch).not.toHaveBeenCalled();
    expect(prisma.threeWayMatch.create).not.toHaveBeenCalled();
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ newValue: expect.objectContaining({ match: activeMatch }) }),
    );
  });

  it('rolls back approval when a matched status has no active match to reuse', async () => {
    const { service, prisma } = makeService({
      threeWayMatch: { findFirst: jest.fn(async () => null) },
    });
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(approvableInvoice({ status: 'DISPUTED', purchaseOrderId: 'po-1' }) as any);

    await expect(service.approve('si-1', { allowVariance: true }, user)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(prisma.supplierInvoice.update).not.toHaveBeenCalled();
  });

  it('fails the approval transaction when its mandatory audit append fails', async () => {
    const failure = new Error('audit append unavailable');
    const { auditLogs, service } = makeService({
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
    });
    jest.spyOn(service, 'findOne').mockResolvedValue(approvableInvoice() as any);
    jest.spyOn(service as any, 'postSupplierInvoicePayable').mockResolvedValue({ id: 'je-1' });
    jest.spyOn(service as any, 'syncSupplierBalance').mockResolvedValue(undefined);
    auditLogs.logStrictInTransaction.mockRejectedValueOnce(failure);

    await expect(service.approve('si-1', undefined, user)).rejects.toBe(failure);
    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUPPLIER_INVOICE_APPROVE' }),
    );
  });
});

function makeUpdateService(prismaOverrides: Record<string, any> = {}) {
  const prisma: any = {
    supplierInvoice: {
      // assertInvoiceNumberAvailable lookups + the final update.
      findFirst: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
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

  const matchAffectingCases: Array<[Record<string, string>, string]> = [
    [{ supplierId: 'supplier-2' }, 'supplier'],
    [{ purchaseOrderId: 'po-2' }, 'purchase order'],
    [{ goodsReceivedNoteId: 'grn-2' }, 'goods receipt'],
    [{ currency: 'USD' }, 'currency'],
  ];

  it.each(matchAffectingCases)(
    'retires a stale active match when the %s input changes',
    async (patch) => {
      const { service, prisma } = makeUpdateService({
        supplier: {
          findFirst: jest.fn(async () => ({
            id: patch.supplierId ?? 'supplier-1',
            divisionId: 'division-1',
            branchId: 'branch-1',
          })),
        },
        purchaseOrder: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({
              id: patch.purchaseOrderId ?? 'po-1',
              supplierId: patch.supplierId ?? 'supplier-1',
              divisionId: 'division-1',
              branchId: 'branch-1',
              currency: patch.currency ?? 'TZS',
              purchaseType: 'CREDIT_PURCHASE',
            })
            .mockResolvedValue(null),
        },
        goodsReceivedNote: {
          findFirst: jest.fn(async () => ({
            id: patch.goodsReceivedNoteId ?? 'grn-1',
            companyId: 'company-1',
            supplierId: patch.supplierId ?? 'supplier-1',
            purchaseOrderId: patch.purchaseOrderId ?? 'po-1',
            divisionId: 'division-1',
            branchId: 'branch-1',
          })),
        },
      });
      jest.spyOn(service, 'findOne').mockResolvedValue(
        approvableInvoice({
          status: 'DISPUTED',
          purchaseOrderId: 'po-1',
          goodsReceivedNoteId: 'grn-1',
        }) as any,
      );

      await service.update('si-1', patch as any, user);

      expect(prisma.threeWayMatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { supplierInvoiceId: 'si-1', deletedAt: null } }),
      );
      expect(prisma.supplierInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT' }) }),
      );
    },
  );

  it('fails the version claim before rewriting lines or matches', async () => {
    const { service, prisma } = makeUpdateService();
    prisma.supplierInvoice.updateMany.mockResolvedValue({ count: 0 });
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(approvableInvoice({ status: 'DISPUTED' }) as any);

    await expect(
      service.update('si-1', { lines: updateLines } as any, user),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.supplierInvoiceLine.deleteMany).not.toHaveBeenCalled();
    expect(prisma.threeWayMatch.updateMany).not.toHaveBeenCalled();
    expect(prisma.supplierInvoice.update).not.toHaveBeenCalled();
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

  it('strictly audits a newly-created match inside the same transaction', async () => {
    const { auditLogs, prisma, service } = makeService();
    const match = { id: 'match-1', matchStatus: 'MATCHED' };
    jest.spyOn(service, 'findOne').mockResolvedValue(approvableInvoice() as any);
    jest.spyOn(service as any, 'createThreeWayMatch').mockResolvedValue({ match, created: true });

    await expect(service.runMatch('si-1', user)).resolves.toBe(match);

    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'SUPPLIER_INVOICE_MATCH',
        entityId: 'si-1',
        newValue: match,
      }),
    );
  });

  it('returns a replayed active match without another audit append', async () => {
    const { auditLogs, service } = makeService();
    const match = { id: 'match-existing', matchStatus: 'MATCHED' };
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(approvableInvoice({ status: 'MATCHED' }) as any);
    jest.spyOn(service as any, 'createThreeWayMatch').mockResolvedValue({ match, created: false });

    await expect(service.runMatch('si-1', user)).resolves.toBe(match);
    expect(auditLogs.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('propagates strict audit failure so the surrounding transaction cannot report success', async () => {
    const { auditLogs, service } = makeService();
    const failure = new Error('audit append unavailable');
    jest.spyOn(service, 'findOne').mockResolvedValue(approvableInvoice() as any);
    jest
      .spyOn(service as any, 'createThreeWayMatch')
      .mockResolvedValue({ match: { id: 'match-1' }, created: true });
    auditLogs.logStrictInTransaction.mockRejectedValueOnce(failure);

    await expect(service.runMatch('si-1', user)).rejects.toBe(failure);
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

describe('SupplierInvoicesService createThreeWayMatch shared-calculator variance (#16)', () => {
  // The SI approval matcher now routes both quantity- and amount-variance through
  // the shared three-way-match calculator so it can never drift from the
  // standalone three-way-matching register. These tests exercise the whole
  // createThreeWayMatch path (the previous suite poked a now-removed private
  // helper) to prove: (a) split PO lines for one product are aggregated instead
  // of only the last line being kept, and (b) the calculator's whole-invoice
  // actual basis is used, matching the register.
  function makeMatchService(po: any, grn: any = null) {
    const created: any[] = [];
    const statusWrites: any[] = [];
    const prisma: any = {
      purchaseOrder: { findFirst: jest.fn(async () => po) },
      goodsReceivedNote: { findFirst: jest.fn(async () => grn) },
      threeWayMatch: {
        create: jest.fn(async ({ data }: any) => {
          created.push(data);
          return { id: 'twm-1', ...data };
        }),
        updateMany: jest.fn(async () => ({ count: 0 })),
        findFirst: jest.fn(async () => null),
      },
      supplierInvoice: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(async () => ({ status: 'DRAFT' })),
        update: jest.fn(async ({ data }: any) => {
          statusWrites.push(data);
          return { id: 'si-1', ...data };
        }),
      },
    };
    const codes = { next: jest.fn(async () => 'TWM-2026-000001') } as any;
    const service = new SupplierInvoicesService(
      prisma,
      { log: jest.fn() } as any,
      { assertCanAccessCompany: jest.fn() } as any,
      {} as any,
      {} as any,
      codes,
    );
    return { service, created, prisma, statusWrites };
  }

  function invLine(overrides: Record<string, unknown> = {}) {
    return {
      productId: 'p-a',
      description: 'Widget',
      quantity: 10,
      unitPrice: 100,
      lineTotal: 1000,
      taxAmount: 0,
      discountAmount: 0,
      ...overrides,
    };
  }

  it('aggregates split PO lines for one product (weighted average), not just the last line', async () => {
    // PO orders product p-a across two lines: 5 @ 4 (=20) and 5 @ 6 (=30).
    // Weighted avg unit cost = (20+30)/(5+5) = 5. An invoice of 10 @ 5 = 50 matches.
    // The old logic kept only the LAST PO line (unitCost 6) => expected 60 => bogus
    // variance of 10 on a genuinely matched invoice.
    const po = {
      id: 'po-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      lines: [
        { productId: 'p-a', quantity: 5, unitCost: 4, lineTotal: 20 },
        { productId: 'p-a', quantity: 5, unitCost: 6, lineTotal: 30 },
      ],
    };
    const { service, created } = makeMatchService(po);
    const invoice = {
      id: 'si-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      goodsReceivedNoteId: null,
      totalAmount: 50,
      lines: [invLine({ quantity: 10, unitPrice: 5, lineTotal: 50 })],
    };
    await (service as any).createThreeWayMatch(invoice, 'user-1');
    expect(created).toHaveLength(1);
    expect(Number(created[0].amountVariance)).toBe(0);
    expect(created[0].matchStatus).toBe('MATCHED');
  });

  it('detects a genuine overcharge on a matched line', async () => {
    const po = {
      id: 'po-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      lines: [{ productId: 'p-a', quantity: 10, unitCost: 100, lineTotal: 1000 }],
    };
    const { service, created } = makeMatchService(po);
    const invoice = {
      id: 'si-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      goodsReceivedNoteId: null,
      totalAmount: 1200,
      lines: [invLine({ unitPrice: 120, lineTotal: 1200 })], // billed 1200 vs expected 1000
    };
    await (service as any).createThreeWayMatch(invoice, 'user-1');
    expect(Number(created[0].amountVariance)).toBe(200);
    expect(created[0].matchStatus).toBe('VARIANCE');
  });

  it('does NOT report a variance for an extra non-PO freight line on an otherwise matched invoice', async () => {
    // A perfectly-priced PO product line plus a non-PO freight/service line. The
    // amount variance must compare the matched expected (1000) against the matched
    // ACTUAL (1000) over the SAME matched-line set — NOT against the whole-invoice
    // total (2000). The freight line has no PO product to match, so it must not
    // manufacture a bogus 1000 variance on a genuinely matched invoice. (Quantity
    // variance is also nil: the single matched product line ties out to the PO.)
    const po = {
      id: 'po-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      lines: [{ productId: 'p-a', quantity: 10, unitCost: 100, lineTotal: 1000 }],
    };
    const { service, created } = makeMatchService(po);
    const invoice = {
      id: 'si-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      goodsReceivedNoteId: null,
      totalAmount: 2000,
      lines: [
        invLine(), // matches PO product p-a exactly: 1000
        // Flat non-PO freight charge (no product, no unit quantity) — it inflates
        // invoice.totalAmount to 2000 but has no PO counterpart. Modeled with
        // quantity 0 so it is a pure charge line and does not perturb the separate
        // quantity-variance path, isolating the amount-variance behaviour under test.
        invLine({
          productId: null,
          description: 'Freight',
          quantity: 0,
          unitPrice: 0,
          lineTotal: 1000,
        }),
      ],
    };
    await (service as any).createThreeWayMatch(invoice, 'user-1');
    // Amount variance is measured over the matched-line set only (1000 vs 1000),
    // so the freight line does not manufacture a variance.
    expect(Number(created[0].amountVariance)).toBe(0);
    expect(created[0].matchStatus).toBe('MATCHED');
  });

  it('falls back to whole-invoice vs PO total when no invoice line matches a PO product', async () => {
    const po = {
      id: 'po-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      lines: [{ productId: 'p-a', quantity: 10, unitCost: 100, lineTotal: 1000 }],
    };
    const { service, created } = makeMatchService(po);
    const invoice = {
      id: 'si-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      goodsReceivedNoteId: null,
      totalAmount: 1500,
      lines: [invLine({ productId: 'p-other', lineTotal: 1500, unitPrice: 150 })],
    };
    await (service as any).createThreeWayMatch(invoice, 'user-1');
    // No matched line => whole-invoice fallback: |1500 - 1000| = 500.
    expect(Number(created[0].amountVariance)).toBe(500);
  });

  it('conditionally claims a standalone match before allocating its number or row', async () => {
    const po = {
      id: 'po-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      lines: [{ productId: 'p-a', quantity: 1, unitCost: 100, lineTotal: 100 }],
    };
    const { service, prisma } = makeMatchService(po);
    const invoice = {
      ...approvableInvoice({ purchaseOrderId: 'po-1' }),
      totalAmount: 100,
      lines: [invLine({ quantity: 1, unitPrice: 100, lineTotal: 100 })],
    };

    const outcome = await (service as any).createThreeWayMatch(invoice, 'user-1', prisma, {
      claimStandalone: true,
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        created: true,
        match: expect.objectContaining({ id: 'twm-1' }),
      }),
    );
    expect(prisma.supplierInvoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'si-1',
        companyId: 'company-1',
        deletedAt: null,
        status: { in: ['DRAFT', 'RECEIVED'] },
        updatedAt: new Date('2026-05-30T12:00:00.000Z'),
      },
      data: { status: 'MATCHED' },
    });
    expect(prisma.supplierInvoice.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.threeWayMatch.create.mock.invocationCallOrder[0],
    );
  });

  it('returns the active match when a concurrent caller already won the claim', async () => {
    const po = {
      id: 'po-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      lines: [{ productId: 'p-a', quantity: 1, unitCost: 100, lineTotal: 100 }],
    };
    const { service, prisma } = makeMatchService(po);
    prisma.supplierInvoice.updateMany.mockResolvedValue({ count: 0 });
    prisma.supplierInvoice.findUnique.mockResolvedValue({ status: 'MATCHED' });
    prisma.threeWayMatch.findFirst.mockResolvedValue({
      id: 'match-winner',
      matchStatus: 'MATCHED',
    });

    const outcome = await (service as any).createThreeWayMatch(
      { ...approvableInvoice({ purchaseOrderId: 'po-1' }), lines: [invLine()] },
      'user-1',
      prisma,
      { claimStandalone: true },
    );

    expect(outcome).toEqual({
      created: false,
      match: { id: 'match-winner', matchStatus: 'MATCHED' },
    });
    expect(prisma.threeWayMatch.create).not.toHaveBeenCalled();
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

describe('SupplierInvoicesService void (payable-at-receipt aware)', () => {
  function voidableInvoice(overrides: Record<string, unknown> = {}) {
    return {
      id: 'si-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      supplierInvoiceNumber: 'SI-2026-000001',
      status: 'APPROVED',
      purchaseOrderId: null,
      payableId: 'pay-1',
      totalAmount: 10000,
      paidAmount: 0,
      outstandingAmount: 10000,
      currency: 'TZS',
      invoiceDate: new Date('2026-05-30T00:00:00.000Z'),
      dueDate: null,
      divisionId: 'division-1',
      branchId: 'branch-1',
      updatedAt: new Date('2026-05-30T12:00:00.000Z'),
      lines: [],
      ...overrides,
    };
  }

  // The JE main's approve() posts via postSupplierInvoicePayable for a mixed
  // stock+expense invoice: DR Inventory 8,000 / DR Expense 2,000 / CR AP 10,000.
  function approveJournal(overrides: Record<string, unknown> = {}) {
    return {
      id: 'je-approve-1',
      companyId: 'company-1',
      status: 'POSTED',
      referenceType: 'SupplierInvoice',
      referenceId: 'si-1',
      transactionDate: new Date('2026-05-30T00:00:00.000Z'),
      divisionId: 'division-1',
      branchId: 'branch-1',
      lines: [
        {
          accountId: 'acc-INVENTORY_ASSET',
          debit: new Prisma.Decimal(8000),
          credit: new Prisma.Decimal(0),
          description: 'Inventory from supplier invoice SI-2026-000001',
          divisionId: null,
          branchId: null,
        },
        {
          accountId: 'acc-GENERAL_EXPENSE',
          debit: new Prisma.Decimal(2000),
          credit: new Prisma.Decimal(0),
          description: 'Supplier invoice expense SI-2026-000001',
          divisionId: null,
          branchId: null,
        },
        {
          accountId: 'acc-AP_CONTROL',
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(10000),
          description: 'Accounts payable for supplier invoice SI-2026-000001',
          divisionId: null,
          branchId: null,
        },
      ],
      ...overrides,
    };
  }

  // The receipt accrual createCreditPurchasePayable posts when a credit-purchase
  // PO is received: DR Inventory / CR AP, stamped referenceType 'Payable'. This
  // referenceType is the origin evidence void() branches on.
  function receiptJournal(amount = 12000) {
    return {
      id: 'je-receipt-1',
      companyId: 'company-1',
      status: 'POSTED',
      referenceType: 'Payable',
      referenceId: 'pay-1',
      transactionDate: new Date('2026-05-20T00:00:00.000Z'),
      divisionId: 'division-1',
      branchId: 'branch-1',
      lines: [
        {
          accountId: 'acc-INVENTORY_ASSET',
          debit: new Prisma.Decimal(amount),
          credit: new Prisma.Decimal(0),
          description: 'Inventory received on supplier credit',
          divisionId: null,
          branchId: null,
        },
        {
          accountId: 'acc-AP_CONTROL',
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(amount),
          description: 'Accounts payable: Acme',
          divisionId: null,
          branchId: null,
        },
      ],
    };
  }

  function makeVoidService(
    opts: {
      invoice?: Record<string, unknown>;
      payable?: any;
      backingJournal?: any;
      invoiceJournal?: any;
      receiptPo?: any;
      receiptPayable?: any;
      overrides?: Record<string, any>;
    } = {},
  ) {
    const invoice = voidableInvoice(opts.invoice);
    const payable =
      opts.payable === undefined
        ? {
            id: 'pay-1',
            companyId: 'company-1',
            supplierId: 'supplier-1',
            status: 'OPEN',
            paidAmount: new Prisma.Decimal(0),
            journalEntryId: 'je-approve-1',
          }
        : opts.payable;
    const backingJournal =
      opts.backingJournal === undefined ? approveJournal() : opts.backingJournal;
    const invoiceJournal = opts.invoiceJournal === undefined ? null : opts.invoiceJournal;

    const captured: any = { payableUpdates: [] as any[] };
    const prisma: any = {
      supplierInvoice: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(async () => ({ status: 'CANCELLED' })),
        update: jest.fn(async ({ data }: any) => ({ ...invoice, ...data, lines: [] })),
      },
      payable: {
        // Live receipt payable candidate for the branch-(a) PO backlink reset;
        // default none.
        findFirst: jest.fn(async () => opts.receiptPayable ?? null),
        update: jest.fn(async ({ data }: any) => {
          captured.payableUpdates.push(data);
          return { id: 'pay-1', ...data };
        }),
      },
      // void() reads the payable via SELECT ... FOR UPDATE (row lock).
      $queryRaw: jest.fn(async () => (payable ? [payable] : [])),
      journalEntry: {
        // The by-id lookup fetches the payable's backing JE; the by-reference
        // lookup finds a JE this invoice's approve posted (if any).
        findFirst: jest.fn(async ({ where }: any) => (where?.id ? backingJournal : invoiceJournal)),
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({ id: 'je-rev-1' })),
      },
      purchaseOrder: {
        findFirst: jest.fn(
          async () =>
            opts.receiptPo ?? {
              id: 'po-1',
              purchaseOrderNumber: 'PO-2026-000009',
              divisionId: 'division-1',
              branchId: 'branch-1',
              expectedDate: new Date('2026-06-15T00:00:00.000Z'),
              totalAmount: new Prisma.Decimal(12000),
            },
        ),
        update: jest.fn(async ({ data }: any) => ({ id: 'po-1', ...data })),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      ...opts.overrides,
    };
    const auditLogs = {
      log: jest.fn().mockResolvedValue(undefined),
      logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
    } as any;
    const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) } as any;
    const accountResolver = {
      resolve: jest.fn(async (_companyId: string, role: string) => ({ id: `acc-${role}` })),
    } as any;
    const postingEngine = {
      postLines: jest.fn(async () => ({ id: 'je-rev-1', journalNumber: 'JE-REV-1' })),
    } as any;
    const service = new SupplierInvoicesService(
      prisma,
      auditLogs,
      companyScope,
      accountResolver,
      postingEngine,
      { next: jest.fn() } as any,
    );
    jest.spyOn(service as any, 'syncSupplierBalance').mockResolvedValue(undefined);
    jest.spyOn(service, 'findOne').mockResolvedValue(invoice as any);
    return { service, prisma, postingEngine, auditLogs, captured, invoice };
  }

  it('rejects voiding a non-APPROVED invoice', async () => {
    const { service, postingEngine } = makeVoidService({ invoice: { status: 'DRAFT' } });
    await expect(service.void('si-1', undefined, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('is an idempotent no-op when the invoice is already CANCELLED', async () => {
    const { service, prisma, postingEngine } = makeVoidService({
      invoice: { status: 'CANCELLED' },
    });
    const res = await service.void('si-1', undefined, user);
    expect(res).toEqual(expect.objectContaining({ status: 'CANCELLED' }));
    // No transaction, no claim, no reversal posted.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('blocks the void when the payable already has payments applied', async () => {
    const { service, prisma, postingEngine } = makeVoidService({
      payable: {
        id: 'pay-1',
        companyId: 'company-1',
        supplierId: 'supplier-1',
        status: 'PARTIALLY_PAID',
        paidAmount: new Prisma.Decimal(5000),
        journalEntryId: 'je-approve-1',
      },
    });
    await expect(service.void('si-1', undefined, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(prisma.payable.update).not.toHaveBeenCalled();
  });

  it('rejects voiding when the payable is WRITTEN_OFF (double AP relief otherwise) (#18)', async () => {
    // writeOff() posted DR AP / CR write-off income and left the approve JE
    // POSTED; paidAmount is 0, so only a status gate can stop the void from
    // mirror-reversing the approve JE (a SECOND DR AP) and clobbering the
    // WRITTEN_OFF audit state to CANCELLED.
    const { service, prisma, postingEngine } = makeVoidService({
      payable: {
        id: 'pay-1',
        companyId: 'company-1',
        supplierId: 'supplier-1',
        status: 'WRITTEN_OFF',
        paidAmount: new Prisma.Decimal(0),
        journalEntryId: 'je-approve-1',
      },
    });

    const err = await service.void('si-1', undefined, user).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/written off/i);
    // No second AP relief, no status clobber.
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(prisma.journalEntry.updateMany).not.toHaveBeenCalled();
    expect(prisma.payable.update).not.toHaveBeenCalled();
  });

  it('reads the payable with a row-locking SELECT ... FOR UPDATE inside the void transaction (#19)', async () => {
    // A plain findUnique lets a concurrent recordPayment (which locks the row
    // FOR UPDATE) settle the payable between void's guard and its cancel
    // write. The locked read serializes the two: the payment either commits
    // first (guard sees paidAmount/status and rejects) or blocks until the
    // void commits (its own gate then sees CANCELLED).
    const { service, prisma } = makeVoidService();
    await service.void('si-1', undefined, user);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0];
    const sql = Array.from(strings).join('?');
    expect(sql).toContain('FROM "payables"');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('FOR UPDATE');
    expect(values).toContain('pay-1');
  });

  it('clears the PO backlink to the cancelled invoice-created payable so a later receive() recreates the receipt payable (#17)', async () => {
    // approve() pointed the PO at the invoice-created payable; void cancels
    // that payable. The stale backlink would make receive() (gated on
    // !po.payableId) skip createCreditPurchasePayable — goods received on
    // supplier credit with no payable and no DR Inventory / CR AP accrual.
    const { service, prisma } = makeVoidService({ invoice: { purchaseOrderId: 'po-1' } });
    await service.void('si-1', undefined, user);

    // The PO is found BY the cancelled payable's id (authoritative even if the
    // invoice was linked to a different PO) and, with no live receipt payable
    // behind it, the backlink is cleared so receive() can create one.
    expect(prisma.purchaseOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payableId: 'pay-1',
          companyId: 'company-1',
          deletedAt: null,
        }),
      }),
    );
    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'po-1' }, data: { payableId: null } }),
    );
  });

  it('re-points the PO at its live receipt payable after cancelling the invoice payable (already-received variant) (#17)', async () => {
    // approve() overwrote PO.payableId from the receipt payable to the
    // invoice-created one; after the void cancels the latter, the PO must go
    // back to the still-live receipt obligation, not to null (receive()
    // already ran — recreating a payable would double the accrual).
    const { service, prisma } = makeVoidService({
      invoice: { purchaseOrderId: 'po-1' },
      receiptPayable: { id: 'pay-receipt-1' },
    });
    await service.void('si-1', undefined, user);

    expect(prisma.payable.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          sourceType: 'PurchaseOrder',
          sourceId: 'po-1',
          status: { not: 'CANCELLED' },
          deletedAt: null,
        }),
      }),
    );
    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'po-1' }, data: { payableId: 'pay-receipt-1' } }),
    );
  });

  it('leaves the PO backlink alone on the reuse path (the restored receipt payable still backs the PO) (#17)', async () => {
    const { service, prisma } = makeVoidService({
      invoice: { purchaseOrderId: 'po-1' },
      payable: {
        id: 'pay-1',
        companyId: 'company-1',
        supplierId: 'supplier-1',
        status: 'OPEN',
        paidAmount: new Prisma.Decimal(0),
        journalEntryId: 'je-receipt-1',
      },
      backingJournal: receiptJournal(12000),
    });
    await service.void('si-1', undefined, user);

    // Branch (b): the payable is restored, not cancelled, and the PO keeps
    // pointing at it — no backlink rewrite.
    expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
  });

  it('mirror-reverses the approve JE and cancels an invoice-created payable', async () => {
    const { service, prisma, postingEngine, captured } = makeVoidService();
    await service.void('si-1', { reason: 'entered in error' }, user);

    // Atomic APPROVED -> CANCELLED claim pinned to the version findOne() read.
    expect(prisma.supplierInvoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'si-1',
          deletedAt: null,
          status: 'APPROVED',
          updatedAt: new Date('2026-05-30T12:00:00.000Z'),
        },
        data: { status: 'CANCELLED' },
      }),
    );

    // Original JE flipped to REVERSED under a guarded claim, reason persisted.
    expect(prisma.journalEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'je-approve-1', status: 'POSTED', deletedAt: null }),
        data: expect.objectContaining({ status: 'REVERSED', reversalReason: 'entered in error' }),
      }),
    );

    // Reversal JE swaps every leg of the original approve posting.
    const revCall = postingEngine.postLines.mock.calls[0][0];
    expect(revCall).toEqual(
      expect.objectContaining({
        companyId: 'company-1',
        referenceType: 'SupplierInvoice',
        referenceId: 'si-1',
        moduleName: 'supplier_invoices',
      }),
    );
    const revLines = revCall.lines;
    const inventory = revLines.find((l: any) => l.accountId === 'acc-INVENTORY_ASSET');
    const expense = revLines.find((l: any) => l.accountId === 'acc-GENERAL_EXPENSE');
    const ap = revLines.find((l: any) => l.accountId === 'acc-AP_CONTROL');
    // Inventory 8,000 debit -> 8,000 credit; expense 2,000 debit -> 2,000 credit.
    expect(Number(inventory.credit)).toBe(8000);
    expect(Number(inventory.debit)).toBe(0);
    expect(Number(expense.credit)).toBe(2000);
    // AP 10,000 credit -> 10,000 debit (relieves the payable in the GL).
    expect(Number(ap.debit)).toBe(10000);
    // Still a balanced JE.
    const debits = revLines.reduce((s: number, l: any) => s + Number(l.debit ?? 0), 0);
    const credits = revLines.reduce((s: number, l: any) => s + Number(l.credit ?? 0), 0);
    expect(debits).toBe(credits);

    // Reversal linked back to the original.
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reversalOfId: 'je-approve-1' }) }),
    );

    // Payable cancelled + outstanding zeroed (it exists only because of this invoice).
    expect(captured.payableUpdates).toEqual([
      expect.objectContaining({ status: 'CANCELLED', outstandingAmount: 0 }),
    ]);

    // Invoice marked CANCELLED; the link to its (now cancelled) payable remains.
    const finalUpdate = prisma.supplierInvoice.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate.data).toEqual(
      expect.objectContaining({ status: 'CANCELLED', outstandingAmount: 0 }),
    );
    expect(finalUpdate.data.payableId).toBeUndefined();
  });

  it('finds the approve JE by invoice reference when the payable has no journalEntryId', async () => {
    const { service, prisma, postingEngine } = makeVoidService({
      payable: {
        id: 'pay-1',
        companyId: 'company-1',
        supplierId: 'supplier-1',
        status: 'OPEN',
        paidAmount: new Prisma.Decimal(0),
        journalEntryId: null,
      },
      invoiceJournal: approveJournal(),
    });
    await service.void('si-1', undefined, user);

    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ referenceType: 'SupplierInvoice', referenceId: 'si-1' }),
      }),
    );
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
  });

  it('restores a reused receipt-created payable instead of cancelling it (payable-at-receipt)', async () => {
    // approve() reused the payable createCreditPurchasePayable opened at goods
    // receipt (12,000) and re-stated its amount to the invoice total (11,500).
    // The origin evidence is the backing JE's referenceType 'Payable'; note the
    // payable's own sourceType was rewritten to 'SupplierInvoice' by approve()
    // and so proves nothing.
    const { service, prisma, postingEngine, captured } = makeVoidService({
      invoice: { purchaseOrderId: 'po-1', totalAmount: 11500, outstandingAmount: 11500 },
      payable: {
        id: 'pay-1',
        companyId: 'company-1',
        supplierId: 'supplier-1',
        status: 'OPEN',
        paidAmount: new Prisma.Decimal(0),
        journalEntryId: 'je-receipt-1',
      },
      backingJournal: receiptJournal(12000),
    });
    await service.void('si-1', undefined, user);

    // The receipt obligation stands: no reversal posted, the receipt accrual JE
    // stays POSTED (approve() posted no incremental JE for a reused payable —
    // postSupplierInvoicePayable is gated on !payable.journalEntryId).
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(prisma.journalEntry.updateMany).not.toHaveBeenCalled();

    // Payable restored to its pre-invoice state, NOT cancelled: amount and
    // outstanding back to the receipt JE's AP credit (12,000), source link back
    // to the purchase order that created it.
    expect(captured.payableUpdates).toHaveLength(1);
    const restore = captured.payableUpdates[0];
    expect(restore.status).toBeUndefined();
    expect(Number(restore.amount)).toBe(12000);
    expect(Number(restore.outstandingAmount)).toBe(12000);
    expect(restore.sourceType).toBe('PurchaseOrder');
    expect(restore.sourceId).toBe('po-1');

    // The cancelled invoice is detached from the live receipt obligation.
    const finalUpdate = prisma.supplierInvoice.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate.data).toEqual(
      expect.objectContaining({ status: 'CANCELLED', outstandingAmount: 0, payableId: null }),
    );
  });

  it('defensively reverses an invoice-referenced POSTED JE on the reuse path, leaving the receipt JE alone', async () => {
    const incremental = approveJournal({ id: 'je-incremental-1' });
    const { service, prisma, postingEngine } = makeVoidService({
      invoice: { purchaseOrderId: 'po-1' },
      payable: {
        id: 'pay-1',
        companyId: 'company-1',
        supplierId: 'supplier-1',
        status: 'OPEN',
        paidAmount: new Prisma.Decimal(0),
        journalEntryId: 'je-receipt-1',
      },
      backingJournal: receiptJournal(12000),
      invoiceJournal: incremental,
    });
    await service.void('si-1', undefined, user);

    // Only the incremental (invoice-referenced) entry is claimed and reversed.
    expect(prisma.journalEntry.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.journalEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'je-incremental-1' }) }),
    );
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
  });

  it('returns the already-cancelled invoice when a concurrent void wins the claim', async () => {
    const { service, prisma, postingEngine } = makeVoidService();
    prisma.supplierInvoice.updateMany.mockResolvedValue({ count: 0 });
    prisma.supplierInvoice.findUnique.mockResolvedValue({ status: 'CANCELLED' });

    const res = await service.void('si-1', undefined, user);

    expect(res).toBeDefined();
    // The loser posts nothing and touches no payable.
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(prisma.payable.update).not.toHaveBeenCalled();
  });

  it('conflicts when the invoice changed under the void to a non-cancelled state', async () => {
    const { service, prisma } = makeVoidService();
    prisma.supplierInvoice.updateMany.mockResolvedValue({ count: 0 });
    prisma.supplierInvoice.findUnique.mockResolvedValue({ status: 'PARTIALLY_PAID' });

    await expect(service.void('si-1', undefined, user)).rejects.toBeInstanceOf(ConflictException);
  });

  it('appends the audit row strictly inside the transaction and fails the void when it fails', async () => {
    const failure = new Error('audit append unavailable');
    const { service, prisma, auditLogs } = makeVoidService();
    auditLogs.logStrictInTransaction.mockRejectedValueOnce(failure);

    await expect(service.void('si-1', { reason: 'dup' }, user)).rejects.toBe(failure);
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'SUPPLIER_INVOICE_VOID',
        entityId: 'si-1',
        newValue: expect.objectContaining({ reason: 'dup' }),
      }),
    );
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
