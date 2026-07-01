import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { CustomerStatementsService } from './customer-statements.service';

const D = (v: number | string) => new Prisma.Decimal(v);
const USER: any = { id: 'user-1', email: 'u@x.io' };
const COMPANY = 'co-1';
const CUSTOMER = 'cust-1';

/** Fixture movements. Dates: two BEFORE the period (roll into opening), the
 * rest inside [2026-02-01, 2026-02-28]. */
const RECEIVABLES = [
  // pre-period invoice -> opening debit 1000
  {
    id: 'r0',
    receivableNumber: 'INV-0',
    amount: D(1000),
    issueDate: new Date('2026-01-10'),
    dueDate: new Date('2026-01-25'),
    outstandingAmount: D(0),
    status: 'PAID',
  },
  // in-period invoices
  {
    id: 'r1',
    receivableNumber: 'INV-1',
    amount: D(5000),
    issueDate: new Date('2026-02-05'),
    dueDate: new Date('2026-02-20'),
    outstandingAmount: D(5000),
    status: 'OPEN',
  },
  {
    id: 'r2',
    receivableNumber: 'INV-2',
    amount: D(2000),
    issueDate: new Date('2026-02-15'),
    dueDate: new Date('2025-11-01'), // long overdue vs dateTo -> over90
    outstandingAmount: D(2000),
    status: 'OVERDUE',
  },
];

const PAYMENTS = [
  // pre-period payment -> opening credit 1000 (pays off r0)
  {
    id: 'p0',
    paymentNumber: 'PMT-0',
    amount: D(1000),
    paymentDate: new Date('2026-01-20'),
    reference: null,
  },
  // in-period payment credit 3000
  {
    id: 'p1',
    paymentNumber: 'PMT-1',
    amount: D(3000),
    paymentDate: new Date('2026-02-10'),
    reference: 'MPESA-123',
  },
];

const CREDIT_NOTES = [
  // in-period credit note credit 500
  {
    id: 'c1',
    creditNoteNumber: 'CN-1',
    totalAmount: D(500),
    issueDate: new Date('2026-02-18'),
    reason: 'Return',
  },
];

const REFUNDS = [
  // in-period refund debit 250
  {
    id: 'f1',
    refundNumber: 'RF-1',
    amount: D(250),
    refundDate: new Date('2026-02-25'),
    reason: null,
  },
];

function makeService(overrides?: {
  customer?: any;
  companyScope?: any;
}) {
  const assertCanAccessCompany = jest.fn().mockResolvedValue(undefined);
  const prisma: any = {
    customer: {
      findFirst: jest.fn().mockResolvedValue(
        overrides?.customer === undefined
          ? { id: CUSTOMER, name: 'Acme Ltd', email: 'ap@acme.io' }
          : overrides.customer,
      ),
    },
    receivable: { findMany: jest.fn().mockResolvedValue(RECEIVABLES) },
    customerPayment: { findMany: jest.fn().mockResolvedValue(PAYMENTS) },
    creditNote: { findMany: jest.fn().mockResolvedValue(CREDIT_NOTES) },
    refund: { findMany: jest.fn().mockResolvedValue(REFUNDS) },
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  const companyScope: any = overrides?.companyScope ?? { assertCanAccessCompany };
  const printEngine: any = {
    renderPdf: jest.fn(),
    renderExcel: jest.fn(),
  };
  const email: any = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const service = new CustomerStatementsService(prisma, audit, companyScope, printEngine, email);
  return { service, prisma, audit, companyScope, printEngine, email, assertCanAccessCompany };
}

const SEL = {
  companyId: COMPANY,
  customerId: CUSTOMER,
  dateFrom: '2026-02-01',
  dateTo: '2026-02-28',
};

describe('CustomerStatementsService.buildStatement', () => {
  it('computes opening balance from pre-period movements only', async () => {
    const { service } = makeService();
    const s = await service.buildStatement(SEL, USER);
    // opening = INV-0 (1000 debit) - PMT-0 (1000 credit) = 0
    expect(s.openingBalance.toFixed(2)).toBe('0.00');
    // in-period lines exclude the two pre-period movements (INV-0, PMT-0)
    expect(s.lineCount).toBe(5);
    expect(s.lines.map((l) => l.reference)).toEqual([
      'INV-1',
      'PMT-1',
      'INV-2',
      'CN-1',
      'RF-1',
    ]);
  });

  it('reconciles opening + totalDebits - totalCredits === closingBalance', async () => {
    const { service } = makeService();
    const s = await service.buildStatement(SEL, USER);
    // debits: INV-1 5000 + INV-2 2000 + RF-1 250 = 7250
    // credits: PMT-1 3000 + CN-1 500 = 3500
    expect(s.totalDebits.toFixed(2)).toBe('7250.00');
    expect(s.totalCredits.toFixed(2)).toBe('3500.00');
    const recomputed = s.openingBalance.plus(s.totalDebits).minus(s.totalCredits);
    expect(recomputed.toFixed(2)).toBe(s.closingBalance.toFixed(2));
    // opening 0 + 7250 - 3500 = 3750
    expect(s.closingBalance.toFixed(2)).toBe('3750.00');
  });

  it('running balance on the last line equals closingBalance', async () => {
    const { service } = makeService();
    const s = await service.buildStatement(SEL, USER);
    const last = s.lines[s.lines.length - 1];
    expect(last.balance.toFixed(2)).toBe(s.closingBalance.toFixed(2));
    // running balance is monotonic in the chronological order applied
    let acc = s.openingBalance;
    for (const l of s.lines) {
      acc = acc.plus(l.debit).minus(l.credit);
      expect(l.balance.toFixed(2)).toBe(acc.toFixed(2));
    }
  });

  it('orders lines chronologically with deterministic same-date tie-break', async () => {
    const { service } = makeService();
    const s = await service.buildStatement(SEL, USER);
    const dates = s.lines.map((l) => l.date.getTime());
    const sorted = [...dates].sort((a, b) => a - b);
    expect(dates).toEqual(sorted);
  });

  it('buckets aging as a LIVE snapshot (as of today, not dateTo) using open receivables', async () => {
    const { service } = makeService();
    const s = await service.buildStatement(SEL, USER);

    // Aging is deliberately a current snapshot: it ages each receivable's
    // live outstandingAmount as of TODAY, NOT as of dateTo (2026-02-28).
    // r0 is PAID -> excluded regardless. r1/r2 are OPEN/OVERDUE with
    // outstanding 5000/2000. Compute the expected band from `now` so this
    // test does not hard-depend on the wall clock.
    const now = Date.now();
    const DAY = 1000 * 60 * 60 * 24;
    const bandOf = (due: string, amount: number) => {
      const days = Math.floor((now - new Date(due).getTime()) / DAY);
      if (days <= 0) return { current: amount } as Record<string, number>;
      if (days <= 30) return { days1_30: amount };
      if (days <= 60) return { days31_60: amount };
      if (days <= 90) return { days61_90: amount };
      return { over90: amount };
    };
    const expected: Record<string, number> = {
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      over90: 0,
    };
    for (const [k, v] of Object.entries(bandOf('2026-02-20', 5000))) expected[k] += v;
    for (const [k, v] of Object.entries(bandOf('2025-11-01', 2000))) expected[k] += v;

    expect(s.aging.current).toBe(expected.current);
    expect(s.aging.days1_30).toBe(expected.days1_30);
    expect(s.aging.days31_60).toBe(expected.days31_60);
    expect(s.aging.days61_90).toBe(expected.days61_90);
    expect(s.aging.over90).toBe(expected.over90);
    expect(s.aging.total).toBe(7000);
  });

  it('ages as of today, not dateTo, and returns agingAsOf ~= now', async () => {
    const { service } = makeService();
    const before = Date.now();
    const s = await service.buildStatement(SEL, USER);
    const after = Date.now();

    // agingAsOf is a live "today" timestamp, independent of the (past) dateTo.
    expect(s.agingAsOf).toBeInstanceOf(Date);
    expect(s.agingAsOf.getTime()).toBeGreaterThanOrEqual(before);
    expect(s.agingAsOf.getTime()).toBeLessThanOrEqual(after);
    // It must NOT be pinned to dateTo (2026-02-28) for a backdated statement.
    expect(s.agingAsOf.getTime()).toBeGreaterThan(s.dateTo.getTime());

    // oldestDaysOverdue is measured from today, so it grows well past the
    // dateTo-relative value (r2 due 2025-11-01 is many months overdue now).
    expect(s.aging.oldestDaysOverdue).toBeGreaterThan(90);
  });

  it('scopes every movement query to companyId + customerId', async () => {
    const { service, prisma } = makeService();
    await service.buildStatement(SEL, USER);
    for (const model of ['receivable', 'customerPayment', 'creditNote', 'refund'] as const) {
      const where = prisma[model].findMany.mock.calls[0][0].where;
      expect(where.companyId).toBe(COMPANY);
      expect(where.customerId).toBe(CUSTOMER);
    }
  });

  it('enforces company access before returning data', async () => {
    const assertCanAccessCompany = jest
      .fn()
      .mockRejectedValue(new Error('forbidden'));
    const { service } = makeService({ companyScope: { assertCanAccessCompany } });
    await expect(service.buildStatement(SEL, USER)).rejects.toThrow('forbidden');
    expect(assertCanAccessCompany).toHaveBeenCalledWith(USER, COMPANY, AccessLevel.READ);
  });

  it('throws NotFound when the customer is not in the company', async () => {
    const { service } = makeService({ customer: null });
    await expect(service.buildStatement(SEL, USER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects dateFrom after dateTo', async () => {
    const { service } = makeService();
    await expect(
      service.buildStatement({ ...SEL, dateFrom: '2026-03-01', dateTo: '2026-02-01' }, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CustomerStatementsService.getDetail serialization', () => {
  it('returns money fields as strings and includes aging', async () => {
    const { service } = makeService();
    const out = await service.getDetail(SEL as any, USER);
    expect(typeof out.openingBalance).toBe('string');
    expect(typeof out.closingBalance).toBe('string');
    expect(out.closingBalance).toBe('3750.00');
    expect(out.lines[0].debit).toBe('5000.00');
    expect(out.aging.total).toBe(7000);
    // Aging is labelled with its live as-of date so consumers know it is a
    // current snapshot, not an as-of-dateTo figure.
    expect(out.agingAsOf).toBeInstanceOf(Date);
  });
});

describe('CustomerStatementsService.exportPdf', () => {
  it('delegates to print-engine when templateId is supplied', async () => {
    const { service, printEngine, audit } = makeService();
    printEngine.renderPdf.mockResolvedValue({
      id: 'gen-1',
      filename: 'tmpl.pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
      mimeType: 'application/pdf',
    });
    const res = await service.exportPdf({ ...SEL, templateId: 'tmpl-1' } as any, USER);
    expect(printEngine.renderPdf).toHaveBeenCalledTimes(1);
    expect(res.documentId).toBe('gen-1');
    expect(res.mimeType).toBe('application/pdf');
    expect(audit.log).toHaveBeenCalled();
  });

  it('renders a local PDF buffer when no templateId is supplied', async () => {
    const { service, printEngine } = makeService();
    const res = await service.exportPdf(SEL as any, USER);
    expect(printEngine.renderPdf).not.toHaveBeenCalled();
    expect(Buffer.isBuffer(res.buffer)).toBe(true);
    expect(res.buffer.slice(0, 5).toString('utf8')).toBe('%PDF-');
    expect(res.filename).toMatch(/\.pdf$/);
  });
});

describe('CustomerStatementsService.exportExcel', () => {
  it('renders a local XLSX buffer when no templateId is supplied', async () => {
    const { service } = makeService();
    const res = await service.exportExcel(SEL as any, USER);
    expect(Buffer.isBuffer(res.buffer)).toBe(true);
    // XLSX (zip) magic bytes PK
    expect(res.buffer[0]).toBe(0x50);
    expect(res.buffer[1]).toBe(0x4b);
    expect(res.filename).toMatch(/\.xlsx$/);
  });
});

describe('CustomerStatementsService.emailToCustomer', () => {
  const OLD_ENV = process.env.SMTP_HOST;
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = OLD_ENV;
  });

  it('no-ops gracefully (emailed:false) when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST;
    const { service, email } = makeService();
    const res = await service.emailToCustomer(SEL as any, USER);
    expect(res.emailed).toBe(false);
    expect(res.smtpConfigured).toBe(false);
    // sendEmail is still called (it is the no-op boundary), targeting customer email
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0]).toBe('ap@acme.io');
  });

  it('reports emailed:true when SMTP host is set and recipient resolved', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    const { service } = makeService();
    const res = await service.emailToCustomer(SEL as any, USER);
    expect(res.smtpConfigured).toBe(true);
    expect(res.emailed).toBe(true);
    expect(res.to).toBe('ap@acme.io');
  });

  it('skips send when no recipient and no customer email', async () => {
    delete process.env.SMTP_HOST;
    const { service, email } = makeService({
      customer: { id: CUSTOMER, name: 'NoEmail Ltd', email: null },
    });
    const res = await service.emailToCustomer(SEL as any, USER);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(res.emailed).toBe(false);
    expect(res.to).toBeNull();
  });
});
