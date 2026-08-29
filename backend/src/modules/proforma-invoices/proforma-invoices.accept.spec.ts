import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { ProformaInvoicesController } from './proforma-invoices.controller';
import { ProformaInvoicesService } from './proforma-invoices.service';

const USER = {
  id: 'user-a',
  companyId: 'company-a',
  companyAccess: [],
  roleScopes: ['COMPANY'],
} as any;

const SENT = {
  id: 'proforma-a',
  companyId: 'company-a',
  customerId: 'customer-a',
  proformaNumber: 'PRF-2031-00001',
  status: 'SENT',
  convertedSalesOrderId: null,
} as any;

function harness(row: any = SENT) {
  const tx = {
    proformaInvoice: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn(),
    },
  } as any;
  const prisma = {
    proformaInvoice: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(row)
        .mockResolvedValue({ ...row, status: 'ACCEPTED' }),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  } as any;
  const audit = { logStrictInTransaction: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new ProformaInvoicesService(prisma, audit);
  return { audit, prisma, service, tx };
}

describe('ProformaInvoicesService.accept', () => {
  it('claims SENT -> ACCEPTED with a guarded conditional write and strictly audits in-transaction', async () => {
    const { audit, prisma, service, tx } = harness();

    const result = await service.accept(SENT.id, USER);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.proformaInvoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: SENT.id,
        companyId: SENT.companyId,
        status: 'SENT',
        deletedAt: null,
      },
      data: { status: 'ACCEPTED' },
    });
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'PROFORMA_INVOICE_ACCEPTED',
        entityType: 'ProformaInvoice',
        entityId: SENT.id,
        userId: USER.id,
        companyId: SENT.companyId,
        newValue: { status: 'ACCEPTED' },
      }),
    );
    expect(tx.proformaInvoice.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      audit.logStrictInTransaction.mock.invocationCallOrder[0],
    );
    expect(result).toEqual(expect.objectContaining({ status: 'ACCEPTED' }));
  });

  it('rejects a proforma that is not SENT before any write (DRAFT must go through send first)', async () => {
    const { audit, prisma, service, tx } = harness({ ...SENT, status: 'DRAFT' });

    await expect(service.accept(SENT.id, USER)).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.proformaInvoice.updateMany).not.toHaveBeenCalled();
    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('treats a second accept of an already-ACCEPTED proforma as an idempotent replay', async () => {
    const { audit, prisma, service, tx } = harness({ ...SENT, status: 'ACCEPTED' });

    await expect(service.accept(SENT.id, USER)).resolves.toEqual(
      expect.objectContaining({ status: 'ACCEPTED' }),
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.proformaInvoice.updateMany).not.toHaveBeenCalled();
    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('does not duplicate the audit when a concurrent accept wins the conditional claim', async () => {
    const { audit, service, tx } = harness();
    tx.proformaInvoice.updateMany.mockResolvedValue({ count: 0 });
    tx.proformaInvoice.findUnique.mockResolvedValue({ status: 'ACCEPTED' });

    await expect(service.accept(SENT.id, USER)).resolves.toEqual(
      expect.objectContaining({ status: 'ACCEPTED' }),
    );

    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('fails closed on an unexpected lost-claim state', async () => {
    const { audit, service, tx } = harness();
    tx.proformaInvoice.updateMany.mockResolvedValue({ count: 0 });
    tx.proformaInvoice.findUnique.mockResolvedValue({ status: 'CANCELLED' });

    await expect(service.accept(SENT.id, USER)).rejects.toBeInstanceOf(BadRequestException);

    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a foreign-company record before any write', async () => {
    const { audit, prisma, service } = harness({ ...SENT, companyId: 'company-b' });

    await expect(service.accept(SENT.id, USER)).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('propagates strict audit failure so the claim rolls back with the transaction', async () => {
    const { audit, service } = harness();
    const persistenceFailure = new Error('audit append unavailable');
    audit.logStrictInTransaction.mockRejectedValueOnce(persistenceFailure);

    await expect(service.accept(SENT.id, USER)).rejects.toBe(persistenceFailure);
  });
});

describe('ProformaInvoicesController.accept', () => {
  it('requires proformas.update on the route, matching the sibling send transition', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, ProformaInvoicesController.prototype.accept),
    ).toEqual(['proformas.update']);
  });

  it('passes the complete authenticated principal from controller to service', async () => {
    const service = { accept: jest.fn().mockResolvedValue({ id: 'proforma-a' }) };
    const controller = new ProformaInvoicesController(service as any);

    await controller.accept('proforma-a', USER);

    expect(service.accept).toHaveBeenCalledWith('proforma-a', USER);
  });
});
