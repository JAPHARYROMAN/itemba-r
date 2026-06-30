import { BadRequestException, ConflictException } from '@nestjs/common';
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
