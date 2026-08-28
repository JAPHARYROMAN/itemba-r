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
