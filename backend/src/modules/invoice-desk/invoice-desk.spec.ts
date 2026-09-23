import { AccessLevel, Prisma } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { deskBalance, deskKey, positiveAmount } from './invoice-desk.domain';
import { InvoiceDeskService } from './invoice-desk.service';
import { InvoiceDeskController } from './invoice-desk.controller';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const d = (value: string) => new Prisma.Decimal(value);
const user = { id: 'user', email: 'user@example.test', permissions: [], roles: [] } as AuthUser;
const invoice = () => ({
  id: 'invoice',
  companyId: 'company',
  divisionId: 'division',
  branchId: 'branch',
  invoiceNumber: 'INV-01',
  invoiceDate: new Date('2026-01-01'),
  dueDate: new Date('2026-01-31'),
  totalAmount: d('100.30'),
  paidAmount: d('0'),
  voidedAt: null,
  version: 1,
  currency: 'TZS',
});
function fixture() {
  const tx = {
    cashDeskMovement: { findUnique: jest.fn().mockResolvedValue(null) },
    invoiceDeskInvoice: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(invoice()),
      update: jest.fn(),
    },
    invoiceDeskPayment: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: 'payment', ...data })),
      update: jest.fn(),
    },
    invoiceDeskAttachment: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
    invoiceDeskEvent: { create: jest.fn() },
  };
  const db = {
    $transaction: jest
      .fn()
      .mockImplementation((work) => (typeof work === 'function' ? work(tx) : Promise.all(work))),
    invoiceDeskInvoice: {
      fields: { totalAmount: 'totalAmount' },
      findFirst: jest.fn().mockResolvedValue(invoice()),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    invoiceDeskAttachment: { findFirst: jest.fn() },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch' }) },
    invoiceDeskSupplier: { findFirst: jest.fn().mockResolvedValue({ id: 'supplier' }) },
  };
  const companies = {
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: { in: ['company'] } }),
    assertCanAccessCompany: jest.fn(),
  };
  const org = {
    recordWhereFor: jest.fn().mockResolvedValue({ OR: [{ branchId: { in: ['branch'] } }] }),
    assertCanAccessScope: jest.fn(),
  };
  const audit = { logStrictInTransaction: jest.fn() };
  return {
    tx,
    db,
    companies,
    org,
    audit,
    service: new InvoiceDeskService(db as never, companies as never, org as never, audit as never),
  };
}
const payment = {
  version: 1,
  requestId: 'request',
  amount: '0.30',
  paymentDate: '2026-01-02',
  method: 'Cash',
  reference: 'receipt',
};

describe('Invoice Desk balances and validation', () => {
  it('keeps decimal cents and large balances exact', () => {
    expect(
      deskBalance({ ...invoice(), totalAmount: d('9999999999999999.99'), paidAmount: d('0.10') })
        .outstanding,
    ).toBe('9999999999999999.89');
    expect(d('0.10').plus(d('0.20')).toFixed(2)).toBe('0.30');
  });
  it.each(['0', '-1', '1.001', '1e3', 'NaN', '10000000000000000', ''])(
    'rejects invalid amount %s',
    (value) => expect(() => positiveAmount(value)).toThrow(),
  );
  it('does not mark invoices due today overdue; voids owe zero', () => {
    expect(deskBalance(invoice(), new Date('2026-01-31')).status).toBe('Unpaid');
    expect(deskBalance(invoice(), new Date('2026-02-01')).status).toBe('Overdue');
    expect(deskBalance({ ...invoice(), paidAmount: d('100.30') }).status).toBe('Paid');
    expect(deskBalance({ ...invoice(), paidAmount: d('10') }, new Date('2026-01-20')).status).toBe(
      'Part paid',
    );
    expect(deskBalance({ ...invoice(), voidedAt: new Date() }).outstanding).toBe('0.00');
  });
  it('normalizes supplier invoice duplicates without dropping punctuation', () => {
    expect(deskKey('  inv-  01 ')).toBe('INV- 01');
    expect(deskKey('INV_01')).not.toBe(deskKey('INV-01'));
  });
});
describe('Invoice Desk protected workflow', () => {
  it('combines company, branch, search and status with AND', async () => {
    const f = fixture();
    await f.service.list(user, { page: 1, search: 'paper', status: 'overdue' });
    const where = f.db.invoiceDeskInvoice.findMany.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ companyId: { in: ['company'] } });
    expect(where.AND).toContainEqual({ OR: [{ branchId: { in: ['branch'] } }] });
    expect(where.AND[3]).toMatchObject({ voidedAt: null, paidAmount: { lt: 'totalAmount' } });
    expect(where.AND[4].OR).toHaveLength(3);
  });
  it('hides out-of-scope invoices and attachments', async () => {
    const f = fixture();
    f.db.invoiceDeskInvoice.findFirst.mockResolvedValue(null);
    await expect(f.service.attachment(user, 'other', 'attachment')).rejects.toThrow(
      'Invoice not found',
    );
    expect(f.db.invoiceDeskAttachment.findFirst).not.toHaveBeenCalled();
  });
  it('requires write-level company and organisation access', async () => {
    const f = fixture();
    f.org.assertCanAccessScope.mockRejectedValue(new ForbiddenException());
    await expect(f.service.payment(user, 'invoice', payment)).rejects.toThrow();
    expect(f.companies.assertCanAccessCompany).toHaveBeenCalledWith(
      user,
      'company',
      AccessLevel.WRITE,
    );
    expect(f.org.assertCanAccessScope).toHaveBeenCalledWith(
      user,
      'division',
      'branch',
      AccessLevel.WRITE,
    );
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('records exact payments and audit events in the same transaction', async () => {
    const f = fixture();
    await f.service.payment(user, 'invoice', payment);
    expect(f.tx.invoiceDeskInvoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'invoice', version: 1, voidedAt: null },
      data: { version: { increment: 1 } },
    });
    expect(
      f.tx.invoiceDeskInvoice.update.mock.calls[0][0].data.paidAmount.increment.toString(),
    ).toBe('0.3');
    expect(f.tx.invoiceDeskEvent.create).toHaveBeenCalled();
    expect(f.audit.logStrictInTransaction.mock.calls[0][0]).toBe(f.tx);
  });
  it('rejects stale concurrent writes before a payment is created', async () => {
    const f = fixture();
    f.tx.invoiceDeskInvoice.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.payment(user, 'invoice', payment)).rejects.toThrow('changed');
    expect(f.tx.invoiceDeskPayment.create).not.toHaveBeenCalled();
  });
  it('rejects overpayments against the locked current balance', async () => {
    const f = fixture();
    f.tx.invoiceDeskInvoice.findUniqueOrThrow.mockResolvedValue({
      ...invoice(),
      paidAmount: d('100.20'),
    });
    await expect(f.service.payment(user, 'invoice', payment)).rejects.toThrow('exceeds');
    expect(f.tx.invoiceDeskPayment.create).not.toHaveBeenCalled();
  });
  it('returns a matching retry without a second payment', async () => {
    const f = fixture();
    f.tx.invoiceDeskPayment.findUnique.mockResolvedValue({
      invoiceId: 'invoice',
      amount: d('0.30'),
      paymentDate: new Date('2026-01-02'),
      method: 'Cash',
      reference: 'receipt',
    });
    await f.service.payment(user, 'invoice', payment);
    expect(f.tx.invoiceDeskInvoice.updateMany).not.toHaveBeenCalled();
    expect(f.tx.invoiceDeskPayment.create).not.toHaveBeenCalled();
    await expect(f.service.payment(user, 'invoice', { ...payment, amount: '10' })).rejects.toThrow(
      'different request',
    );
  });
  it('rejects future and pre-invoice payment dates', async () => {
    const f = fixture();
    await expect(
      f.service.payment(user, 'invoice', { ...payment, paymentDate: '2999-01-01' }),
    ).rejects.toThrow('already made');
    await expect(
      f.service.payment(user, 'invoice', { ...payment, paymentDate: '2025-01-01' }),
    ).rejects.toThrow('precede');
  });
  it('reverses only an active payment and preserves its reason', async () => {
    const f = fixture();
    f.tx.invoiceDeskPayment.findFirst.mockResolvedValue({ id: 'payment', amount: d('0.30') });
    await f.service.reverse(user, 'invoice', 'payment', { version: 1, reason: 'Wrong receipt' });
    expect(f.tx.invoiceDeskPayment.update.mock.calls[0][0].data.reversalReason).toBe(
      'Wrong receipt',
    );
    expect(
      f.tx.invoiceDeskInvoice.update.mock.calls[0][0].data.paidAmount.decrement.toString(),
    ).toBe('0.3');
    f.tx.invoiceDeskPayment.findFirst.mockResolvedValue(null);
    await expect(
      f.service.reverse(user, 'invoice', 'payment', { version: 1, reason: 'Again' }),
    ).rejects.toThrow('already reversed');
  });
  it('does not void paid invoices', async () => {
    const f = fixture();
    f.tx.invoiceDeskInvoice.findUniqueOrThrow.mockResolvedValue({
      ...invoice(),
      paidAmount: d('0.30'),
    });
    await expect(
      f.service.void(user, 'invoice', { version: 1, reason: 'Wrong invoice' }),
    ).rejects.toThrow('Reverse');
  });
  it('rejects mismatched company/branch before creating an invoice', async () => {
    const f = fixture();
    f.db.branch.findFirst.mockResolvedValue(null);
    await expect(
      f.service.create(user, {
        companyId: 'company',
        divisionId: 'division',
        branchId: 'other',
        supplierId: 'supplier',
      } as never),
    ).rejects.toThrow('belonging');
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects disguised attachments, oversized files and excess attachments', async () => {
    const f = fixture();
    await expect(
      f.service.attach(user, 'invoice', {
        buffer: Buffer.from('<script>'),
        size: 8,
        originalname: 'fake.pdf',
      } as never),
    ).rejects.toThrow('Only PDF');
    await expect(
      f.service.attach(user, 'invoice', {
        buffer: Buffer.from('%PDF-'),
        size: 10485761,
        originalname: 'large.pdf',
      } as never),
    ).rejects.toThrow('10 MB');
    f.tx.invoiceDeskAttachment.count.mockResolvedValue(10);
    await expect(
      f.service.attach(user, 'invoice', {
        buffer: Buffer.from('%PDF-1.7'),
        size: 8,
        originalname: 'file.pdf',
      } as never),
    ).rejects.toThrow('10 attachments');
  });
  it('separates currencies and applies organisation scope to the overview', async () => {
    const f = fixture();
    f.db.invoiceDeskInvoice.findMany.mockResolvedValue([
      { ...invoice(), supplierId: 'supplier', supplier: { name: 'Vendor' }, currency: 'TZS' },
      {
        ...invoice(),
        supplierId: 'supplier',
        supplier: { name: 'Vendor' },
        currency: 'USD',
        totalAmount: d('0.30'),
      },
    ]);
    const result = await f.service.overview(user, { page: 1 });
    expect(result.currencies.map((c) => [c.currency, c.outstanding.toFixed(2)])).toEqual([
      ['TZS', '100.30'],
      ['USD', '0.30'],
    ]);
    expect(result.suppliers).toHaveLength(2);
  });
  it('requires app view plus the specific write permission', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, InvoiceDeskController)).toEqual([
      'invoice_desk.view',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, InvoiceDeskController.prototype.payment)).toEqual([
      'invoice_desk.view',
      'invoice_desk.payments',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, InvoiceDeskController.prototype.create)).toEqual([
      'invoice_desk.view',
      'invoice_desk.manage',
    ]);
  });
});

describe('Invoice attachment Quick Look', () => {
  it('checks the invoice scope before previewing an attachment', async () => {
    const f = fixture();
    f.db.invoiceDeskInvoice.findFirst.mockResolvedValue(null);
    await expect(f.service.previewAttachment(user, 'foreign', 'file')).rejects.toThrow(
      'Invoice not found',
    );
    expect(f.db.invoiceDeskAttachment.findFirst).not.toHaveBeenCalled();
  });
  it('binds the attachment to its invoice and identifies safe preview formats', async () => {
    const f = fixture();
    f.db.invoiceDeskAttachment.findFirst.mockResolvedValue({
      id: 'file',
      content: Buffer.from('%PDF-1.7'),
      mimeType: 'application/pdf',
    });
    expect(await f.service.previewAttachment(user, 'invoice', 'file')).toEqual({ kind: 'pdf' });
    expect(f.db.invoiceDeskAttachment.findFirst).toHaveBeenCalledWith({
      where: { id: 'file', invoiceId: 'invoice' },
    });
    const scope = f.db.invoiceDeskInvoice.findFirst.mock.calls[0][0].where.AND;
    expect(scope).toContainEqual({ id: 'invoice' });
    expect(JSON.stringify(scope)).toContain('branch');
    f.db.invoiceDeskAttachment.findFirst.mockResolvedValue(null);
    await expect(f.service.previewAttachment(user, 'invoice', 'other-file')).rejects.toThrow(
      'Attachment not found',
    );
  });
  it('does not offer inline preview for disguised content', async () => {
    const f = fixture();
    f.db.invoiceDeskAttachment.findFirst.mockResolvedValue({
      content: Buffer.from('<html>invalid</html>'),
      mimeType: 'application/pdf',
    });
    expect(await f.service.previewAttachment(user, 'invoice', 'file')).toMatchObject({
      kind: 'download',
    });
  });
  it('keeps downloads private and only uses inline disposition for supported files', async () => {
    const f = fixture();
    const controller = new InvoiceDeskController(f.service);
    const response = { setHeader: jest.fn(), send: jest.fn() };
    f.db.invoiceDeskAttachment.findFirst.mockResolvedValue({
      content: Buffer.from('%PDF-'),
      mimeType: 'application/pdf',
      name: 'Receipt one.pdf',
    });
    await controller.download(user, 'invoice', 'file', response as never, '1');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      "inline; filename*=UTF-8''Receipt%20one.pdf",
    );
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    response.setHeader.mockClear();
    await controller.download(user, 'invoice', 'file', response as never);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      "attachment; filename*=UTF-8''Receipt%20one.pdf",
    );
    f.db.invoiceDeskAttachment.findFirst.mockResolvedValue({
      content: Buffer.from('<html>'),
      mimeType: 'text/html',
      name: 'file.html',
    });
    await controller.download(user, 'invoice', 'file', response as never, '1');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      "attachment; filename*=UTF-8''file.html",
    );
  });
});
