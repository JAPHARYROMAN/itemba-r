import { BadRequestException } from '@nestjs/common';
import { CurrencyCode, SupplierOrderDraftStatus } from '@prisma/client';
import { SupplierOrderDraftsService } from './supplier-order-drafts.service';

const user: any = {
  id: 'user-1',
  permissions: [],
  roleScopes: ['GROUP'],
  companyAccess: [{ companyId: 'company-1', accessLevel: 'MANAGE' }],
};

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    draftNumber: 'SOD-2026-000001',
    companyId: 'company-1',
    divisionId: null,
    branchId: null,
    supplierId: null,
    supplierName: 'One-off Supplier',
    supplierAddress: null,
    supplierContact: null,
    supplierTin: null,
    supplierVrn: null,
    supplierPhone: null,
    supplierEmail: null,
    draftDate: new Date('2026-07-22'),
    neededBy: null,
    currency: CurrencyCode.TZS,
    title: null,
    deliveryInstructions: null,
    terms: null,
    notes: null,
    subtotal: 0,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 0,
    hasUnpricedLines: true,
    status: SupplierOrderDraftStatus.DRAFT,
    createdById: user.id,
    sentAt: null,
    acceptedAt: null,
    declinedAt: null,
    cancelledAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    company: { id: 'company-1', name: 'Company', code: 'COMP' },
    division: null,
    branch: null,
    supplier: null,
    createdBy: { id: user.id, fullName: 'User', email: 'user@example.com' },
    lines: [],
    ...overrides,
  };
}

function makeService() {
  const create = jest.fn().mockResolvedValue(draft());
  const update = jest.fn();
  const findFirst = jest.fn().mockResolvedValue(null);
  const sideEffects = {
    inventoryMovement: { create: jest.fn() },
    payable: { create: jest.fn() },
    journalEntry: { create: jest.fn() },
    purchaseOrder: { create: jest.fn() },
  };
  const prisma: any = {
    supplier: { findFirst: jest.fn() },
    division: { findFirst: jest.fn().mockResolvedValue({ id: 'division-1' }) },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
    supplierOrderDraft: { findFirst, create, update, count: jest.fn(), groupBy: jest.fn() },
    supplierOrderDraftLine: { deleteMany: jest.fn() },
    ...sideEffects,
    $transaction: jest.fn(async (callback) =>
      callback({
        supplierOrderDraft: { create, update },
        supplierOrderDraftLine: { deleteMany: jest.fn() },
      }),
    ),
  };
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
  };
  const codes = { next: jest.fn().mockResolvedValue('SOD-2026-000001') };
  const audit = {
    log: jest.fn().mockResolvedValue(undefined),
    logStrict: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new SupplierOrderDraftsService(
      prisma,
      companyScope as any,
      codes as any,
      audit as any,
    ),
    prisma,
    create,
    update,
    findFirst,
    codes,
    audit,
    companyScope,
    sideEffects,
  };
}

describe('SupplierOrderDraftsService', () => {
  it('creates an entirely manual unpriced request without transactional side effects', async () => {
    const { service, create, sideEffects } = makeService();
    await service.create(
      {
        companyId: 'company-1',
        supplierName: 'One-off Supplier',
        draftDate: '2026-07-22',
        currency: CurrencyCode.TZS,
        lines: [
          {
            description: 'Custom fabricated shelf',
            quantity: 4,
            unitLabel: 'sets',
            unitPrice: null,
          },
        ],
      },
      user,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierId: null,
          supplierName: 'One-off Supplier',
          hasUnpricedLines: true,
          totalAmount: 0,
          lines: { create: [expect.objectContaining({ unitPrice: null, lineTotal: null })] },
        }),
      }),
    );
    expect(sideEffects.inventoryMovement.create).not.toHaveBeenCalled();
    expect(sideEffects.payable.create).not.toHaveBeenCalled();
    expect(sideEffects.journalEntry.create).not.toHaveBeenCalled();
    expect(sideEffects.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it('freezes saved supplier details into the document', async () => {
    const { service, prisma, create } = makeService();
    prisma.supplier.findFirst.mockResolvedValue({
      id: 'supplier-1',
      name: 'Vendor Ltd',
      address: 'Tunduma',
      contactPerson: 'Buyer Desk',
      tin: 'TIN-1',
      vrn: 'VRN-1',
      phone: '255700000000',
      email: 'vendor@example.com',
    });
    await service.create(
      {
        companyId: 'company-1',
        supplierId: 'supplier-1',
        draftDate: '2026-07-22',
        currency: CurrencyCode.TZS,
        lines: [{ description: 'Paint', quantity: 2, unitLabel: 'tin', unitPrice: 20_000 }],
      },
      user,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierId: 'supplier-1',
          supplierName: 'Vendor Ltd',
          supplierAddress: 'Tunduma',
          supplierTin: 'TIN-1',
          supplierVrn: 'VRN-1',
        }),
      }),
    );
  });

  it('calculates priced lines and labels the document partial when another line is unpriced', async () => {
    const { service, create } = makeService();
    await service.create(
      {
        companyId: 'company-1',
        supplierName: 'Vendor',
        draftDate: '2026-07-22',
        currency: CurrencyCode.TZS,
        lines: [
          {
            description: 'Priced',
            quantity: 2,
            unitLabel: 'pcs',
            unitPrice: 1000,
            discountAmount: 100,
            taxAmount: 50,
          },
          { description: 'Pending quote', quantity: 1, unitLabel: 'lot', unitPrice: null },
        ],
      },
      user,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 2000,
          discountAmount: 100,
          taxAmount: 50,
          totalAmount: 1950,
          hasUnpricedLines: true,
        }),
      }),
    );
  });

  it('rejects discount or tax on an unpriced line', async () => {
    const { service } = makeService();
    await expect(
      service.create(
        {
          companyId: 'company-1',
          supplierName: 'Vendor',
          draftDate: '2026-07-22',
          currency: CurrencyCode.TZS,
          lines: [
            {
              description: 'Pending quote',
              quantity: 1,
              unitLabel: 'lot',
              unitPrice: null,
              taxAmount: 100,
            },
          ],
        },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('makes sent drafts read-only until reopened', async () => {
    const { service, findFirst } = makeService();
    findFirst.mockResolvedValue(draft({ status: SupplierOrderDraftStatus.SENT }));
    await expect(
      service.update(
        'draft-1',
        {
          companyId: 'company-1',
          supplierName: 'Vendor',
          draftDate: '2026-07-22',
          currency: CurrencyCode.TZS,
          lines: [{ description: 'Item', quantity: 1, unitLabel: 'pcs', unitPrice: 100 }],
        },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moves a draft to SENT without creating an actual purchase transaction', async () => {
    const { service, findFirst, update, sideEffects } = makeService();
    findFirst.mockResolvedValue(draft());
    update.mockResolvedValue(draft({ status: SupplierOrderDraftStatus.SENT, sentAt: new Date() }));
    const result = await service.send('draft-1', user);
    expect(result.status).toBe(SupplierOrderDraftStatus.SENT);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SupplierOrderDraftStatus.SENT,
          sentAt: expect.any(Date),
        }),
      }),
    );
    expect(sideEffects.inventoryMovement.create).not.toHaveBeenCalled();
    expect(sideEffects.payable.create).not.toHaveBeenCalled();
    expect(sideEffects.journalEntry.create).not.toHaveBeenCalled();
    expect(sideEffects.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it('rejects lifecycle acceptance before the draft has been sent', async () => {
    const { service, findFirst } = makeService();
    findFirst.mockResolvedValue(draft());
    await expect(service.accept('draft-1', user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reopens a completed lifecycle state as an editable draft and clears transition dates', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValue(
      draft({
        status: SupplierOrderDraftStatus.ACCEPTED,
        sentAt: new Date(),
        acceptedAt: new Date(),
      }),
    );
    update.mockResolvedValue(draft({ status: SupplierOrderDraftStatus.DRAFT }));

    const result = await service.reopen('draft-1', user);

    expect(result.status).toBe(SupplierOrderDraftStatus.DRAFT);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SupplierOrderDraftStatus.DRAFT,
          sentAt: null,
          acceptedAt: null,
          declinedAt: null,
          cancelledAt: null,
        }),
      }),
    );
  });

  it('allows soft deletion only while the document is a draft', async () => {
    const { service, findFirst, update } = makeService();
    findFirst.mockResolvedValueOnce(draft({ status: SupplierOrderDraftStatus.SENT }));
    await expect(service.remove('draft-1', user)).rejects.toBeInstanceOf(BadRequestException);

    findFirst.mockResolvedValueOnce(draft());
    await expect(service.remove('draft-1', user)).resolves.toEqual({ success: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-1' },
        data: { deletedAt: expect.any(Date) },
      }),
    );
  });

  it('enforces company access when reading a draft', async () => {
    const { service, findFirst, companyScope } = makeService();
    findFirst.mockResolvedValue(draft());
    await service.findOne('draft-1', user);
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company-1', 'READ');
  });

  it('strictly persists the export observation before returning success', async () => {
    const { audit, service } = makeService();
    jest.spyOn(service, 'findOne').mockResolvedValue(draft() as any);

    await expect(service.auditExport('draft-1', { format: 'pdf' } as any, user)).resolves.toEqual({
      success: true,
    });

    expect(audit.logStrict).toHaveBeenCalledWith({
      action: 'SUPPLIER_ORDER_DRAFT_EXPORT',
      entityType: 'SupplierOrderDraft',
      entityId: 'draft-1',
      companyId: 'company-1',
      userId: user.id,
      newValue: { format: 'pdf', draftNumber: 'SOD-2026-000001' },
    });
  });

  it('fails the audit-only export command when its ledger append fails', async () => {
    const { audit, service } = makeService();
    const failure = new Error('audit ledger unavailable');
    jest.spyOn(service, 'findOne').mockResolvedValue(draft() as any);
    audit.logStrict.mockRejectedValueOnce(failure);

    await expect(service.auditExport('draft-1', { format: 'pdf' } as any, user)).rejects.toBe(
      failure,
    );
  });
});
