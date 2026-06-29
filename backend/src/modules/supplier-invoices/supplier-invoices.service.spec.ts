import { ConflictException } from '@nestjs/common';
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
});
