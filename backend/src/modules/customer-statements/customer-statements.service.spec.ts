import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomerStatementsService } from './customer-statements.service';
import {
  assembleCustomerAccounts,
  CustomerAccountProjectionService,
} from './customer-account-projection.service';
import { customerStatementPdf } from './customer-statement-pdf';
import { buildBusinessPdf } from '../generated-documents/pdf-builder';

const D = (n: number | string) => new Prisma.Decimal(n);
const DAY = (day: string) => new Date(`${day}T00:00:00Z`);
const USER: any = { id: 'user-1', roleScopes: ['COMPANY'], permissions: [] };
const customer = {
  id: 'customer-1',
  companyId: 'company-1',
  name: 'Acme Limited',
  customerCode: 'C-001',
  email: 'ap@acme.test',
  phone: null,
  address: 'Dar es Salaam',
  createdAt: DAY('2026-01-01'),
  company: { id: 'company-1', name: 'Itemba Limited', code: 'ITEMBA' },
};
const base = { companyId: customer.companyId, customerId: customer.id, currency: 'TZS' };
const invoice = {
  ...base,
  id: 'invoice-1',
  receivableNumber: 'INV-001',
  amount: D(1000),
  issueDate: DAY('2026-02-05'),
  dueDate: DAY('2026-02-20'),
  status: 'WRITTEN_OFF',
  outstandingAmount: D(0),
  sourceType: 'SalesOrder',
  sourceId: 'sale-1',
  journalEntryId: 'sale-journal',
  journalEntry: { companyId: 'company-1', status: 'POSTED', transactionDate: DAY('2026-02-05') },
};
const allocation = { receivableId: invoice.id, amount: D(400), receivable: invoice };
const payment = {
  ...base,
  id: 'payment-1',
  paymentNumber: 'PAY-001',
  amount: D(400),
  paymentDate: DAY('2026-02-10'),
  appliedAmount: D(400),
  unappliedAmount: D(0),
  method: 'BANK_TRANSFER',
  status: 'REVERSED',
  reversedAt: DAY('2026-03-05'),
  journalEntryId: 'payment-journal',
  journalEntry: { status: 'REVERSED' },
  reversalJournalEntry: { status: 'POSTED', transactionDate: DAY('2026-03-05') },
  allocations: [allocation],
};
const arLine = (amount: number) => ({
  credit: D(amount),
  debit: D(0),
  account: { accountCode: '1200', accountSubType: 'AR_CONTROL', accountType: 'ASSET' },
});
const cashLine = (amount: number) => ({
  credit: D(0),
  debit: D(amount),
  account: { accountCode: '1000', accountSubType: 'CASH_ON_HAND', accountType: 'ASSET' },
});
function sources() {
  return {
    customers: [customer],
    sales: [
      {
        ...base,
        id: 'sale-1',
        salesOrderNumber: 'SO-001',
        totalAmount: D(1000),
        taxAmount: D(0),
        orderDate: invoice.issueDate,
        paymentMethod: 'CREDIT',
        status: 'CONFIRMED',
        receivableId: invoice.id,
        journalEntryId: 'sale-journal',
        journalEntry: {
          id: 'sale-journal',
          status: 'POSTED',
          transactionDate: invoice.issueDate,
          reversedBy_: [],
        },
      },
      {
        ...base,
        id: 'cash-sale',
        salesOrderNumber: 'CS-001',
        totalAmount: D(100),
        orderDate: DAY('2026-02-11'),
        paymentMethod: 'CASH',
        status: 'CONFIRMED',
        journalEntry: { status: 'POSTED', transactionDate: DAY('2026-02-11'), reversedBy_: [] },
      },
    ],
    receivables: [invoice],
    payments: [payment],
    creditNotes: [
      {
        ...base,
        id: 'credit-1',
        creditNoteNumber: 'CN-001',
        receivableId: invoice.id,
        totalAmount: D(50),
        issueDate: DAY('2026-02-15'),
        status: 'VOID',
        journalEntry: {
          status: 'REVERSED',
          reversedBy_: [{ status: 'POSTED', transactionDate: DAY('2026-03-07') }],
        },
      },
    ],
    refunds: [],
    journals: [
      {
        id: 'legacy',
        companyId: base.companyId,
        referenceId: invoice.id,
        description: 'Receivable settlement INV-001',
        journalNumber: 'JE-001',
        transactionDate: DAY('2026-02-12'),
        totalDebit: D(200),
        totalCredit: D(200),
        status: 'POSTED',
        lines: [arLine(200), cashLine(200)],
        reversedBy_: [],
      },
      {
        id: 'writeoff',
        companyId: base.companyId,
        referenceId: invoice.id,
        description: 'Receivable write-off INV-001',
        journalNumber: 'JE-002',
        transactionDate: DAY('2026-04-01'),
        totalCredit: D(800),
        status: 'POSTED',
        lines: [arLine(800)],
        reversedBy_: [],
      },
    ],
  };
}
function account(asOf = '2026-02-28') {
  return assembleCustomerAccounts(sources(), new Date(`${asOf}T23:59:59.999Z`))[0];
}
function service() {
  const db: any = {
    customer: { findFirst: jest.fn().mockResolvedValue({ email: 'current-accounts@acme.test' }) },
    customerStatementRun: {
      create: jest.fn().mockImplementation(async ({ data }) => data),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const audit: any = {
    log: jest.fn().mockResolvedValue(undefined),
    logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  db.$transaction = jest.fn().mockImplementation((callback) => callback(db));
  const companies: any = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: base.companyId }),
  };
  const org: any = {
    accessibleIds: jest
      .fn()
      .mockResolvedValue({ unrestricted: true, divisionIds: [], branchIds: [] }),
  };
  const projection: any = {
    read: jest.fn().mockImplementation(async (_user, query) => ({
      asOf: new Date(`${query.dateTo}T23:59:59.999Z`),
      currency: 'TZS',
      scope: { companyId: base.companyId, branchIds: [], divisionIds: [], unrestricted: true },
      accounts: [account(query.dateTo)],
      warnings: ['ERP customer account only. Standalone Direct Sales are separate.'],
    })),
  };
  const email: any = { sendEmailWithAttachments: jest.fn().mockResolvedValue(true) };
  return {
    db,
    audit,
    companies,
    org,
    projection,
    email,
    service: new CustomerStatementsService(db, audit, companies, undefined, email, projection, org),
  };
}
const selection = {
  companyId: base.companyId,
  customerId: base.customerId,
  currency: 'TZS',
  dateFrom: '2026-02-01',
  dateTo: '2026-02-28',
};

describe('Customer account reconstruction', () => {
  it('recovers a mixed-tender creation receipt without duplicating its gross invoice', () => {
    const fixture: any = sources();
    fixture.sales = [fixture.sales[0]];
    fixture.payments = [];
    fixture.creditNotes = [];
    fixture.receivables[0] = {
      ...invoice,
      amount: D(100),
      paidAmount: D(60),
      status: 'PARTIALLY_PAID',
    };
    const creation = {
      id: 'sale-journal',
      companyId: base.companyId,
      journalNumber: 'JE-MIXED',
      transactionDate: invoice.issueDate,
      status: 'POSTED',
      description: 'Mixed tender sale',
      referenceType: 'SalesOrder',
      referenceId: 'sale-1',
      reversalOfId: null,
      lines: [cashLine(60), { ...arLine(0), debit: D(40) }],
      reversedBy_: [],
    };
    fixture.journals = [creation];
    fixture.sales[0] = {
      ...fixture.sales[0],
      totalAmount: D(100),
      paymentMethod: 'CASH',
      journalEntry: creation,
    };
    fixture.receivables[0].journalEntry = creation;
    const result = assembleCustomerAccounts(fixture, new Date('2026-02-28T23:59:59Z'))[0];
    expect(result.netBalance.toFixed(2)).toBe('40.00');
    expect(result.openInvoiceBalance.toFixed(2)).toBe('40.00');
    expect(result.movements.filter((line) => line.type === 'INVOICE')).toHaveLength(1);
    expect(result.payments.map((p) => p.amount.toFixed(2))).toEqual(['60.00']);
    expect(result.settlementHistory?.status).toBe('COMPLETE');
    const reversal = {
      ...creation,
      id: 'mixed-reversal',
      journalNumber: 'JE-MIXED-REV',
      transactionDate: DAY('2026-03-05'),
      reversalOfId: creation.id,
      lines: [{ ...cashLine(0), credit: D(60) }, arLine(40)],
    };
    creation.status = 'REVERSED';
    (creation.reversedBy_ as any[]) = [reversal];
    fixture.receivables[0].status = 'CANCELLED';
    fixture.sales[0].status = 'CANCELLED';
    const cancelled = assembleCustomerAccounts(fixture, new Date('2026-03-31T23:59:59Z'))[0];
    expect(cancelled.netBalance.toFixed(2)).toBe('0.00');
    expect(cancelled.openInvoiceBalance.toFixed(2)).toBe('0.00');
    expect(cancelled.customerCredit.toFixed(2)).toBe('0.00');
  });
  it('flags an unreconciled paid amount without inventing a historical receipt', () => {
    const fixture: any = sources();
    fixture.receivables[0] = { ...invoice, paidAmount: D(350) };
    const result = assembleCustomerAccounts(fixture, new Date('2026-02-28T23:59:59Z'))[0];
    expect(result.netBalance.toFixed(2)).toBe('350.00');
    expect(result.settlementHistory).toMatchObject({
      status: 'INCOMPLETE',
      unresolvedAmount: '150.00',
    });
    expect(result.integrityIssues).toContain('incomplete-settlement-history');
  });
  it('uses future receipts for evidence reconciliation while preserving historical balances and history', () => {
    const fixture: any = sources();
    fixture.receivables[0] = { ...invoice, paidAmount: D(400), status: 'PARTIALLY_PAID' };
    fixture.payments = [
      {
        ...payment,
        status: 'COMPLETED',
        amount: D(200),
        paymentDate: DAY('2026-03-10'),
        reversedAt: null,
        reversalJournalEntry: null,
        allocations: [{ ...allocation, amount: D(200) }],
      },
    ];
    fixture.creditNotes = [];
    const result = assembleCustomerAccounts(fixture, new Date('2026-02-28T23:59:59Z'))[0];
    expect(result.netBalance.toFixed(2)).toBe('800.00');
    expect(result.settlementHistory?.status).toBe('COMPLETE');
    expect(result.payments.some((p) => p.id === payment.id)).toBe(false);
  });
  it('preserves exact cents in large invoice aging buckets', () => {
    const amount = '9999999999999999.99';
    const rows: any = {
      customers: [customer],
      sales: [],
      payments: [],
      creditNotes: [],
      refunds: [],
      journals: [],
      receivables: [{ ...invoice, status: 'OPEN', journalEntryId: null, amount: D(amount) }],
    };
    const reconstructed = assembleCustomerAccounts(rows, new Date('2026-02-28T23:59:59.999Z'))[0];
    expect(reconstructed.aging.days1_30).toBe(amount);
    expect(reconstructed.aging.total).toBe(amount);
    expect(reconstructed.openInvoiceBalance.toFixed(2)).toBe(amount);
  });
  it('reconstructs historical balances before later reversal, void and write-off', () => {
    expect(account().netBalance.toFixed(2)).toBe('350.00');
    expect(account().openInvoiceBalance.toFixed(2)).toBe('350.00');
    expect(account().aging.days1_30).toBe('350.00');
    expect(account('2026-03-31').netBalance.toFixed(2)).toBe('800.00');
    expect(account('2026-03-31').openInvoiceBalance.toFixed(2)).toBe('800.00');
    expect(account('2026-04-30').netBalance.toFixed(2)).toBe('0.00');
    expect(account('2026-04-30').openInvoiceBalance.toFixed(2)).toBe('0.00');
  });
  it('includes an immediate cash sale and receipt exactly once as zero-net activity', () => {
    const rows = account().movements.filter((m) => m.sourceId === 'cash-sale');
    expect(rows.map((m) => m.type)).toEqual(['INVOICE', 'PAYMENT']);
    expect(rows.reduce((net, row) => net.plus(row.debit).minus(row.credit), D(0)).toFixed(2)).toBe(
      '0.00',
    );
  });
  it('shows reversed receipts in history with historical effective status and allocations', () => {
    expect(account().payments.find((p) => p.id === payment.id)?.status).toBe('COMPLETED');
    expect(account('2026-03-31').payments.find((p) => p.id === payment.id)?.status).toBe(
      'REVERSED',
    );
    expect(account().payments.find((p) => p.id === 'legacy')?.allocations[0].dueDate).toEqual(
      invoice.dueDate,
    );
  });
  it('does not count a customer-payment journal again as a legacy receipt', () => {
    const fixture = sources();
    fixture.journals.push({ ...fixture.journals[0], id: payment.journalEntryId });
    expect(
      assembleCustomerAccounts(fixture, new Date('2026-02-28T23:59:59Z'))[0].netBalance.toFixed(2),
    ).toBe('350.00');
  });
  it('rejects settlement-shaped inventory/tax journals without verified cash/AR legs', () => {
    const fixture = sources();
    fixture.journals[0].lines = [
      {
        ...arLine(200),
        account: { accountCode: '1200', accountSubType: 'INVENTORY_ASSET', accountType: 'ASSET' },
      },
      cashLine(200),
    ];
    const result = assembleCustomerAccounts(fixture, new Date('2026-02-28T23:59:59Z'))[0];
    expect(result.netBalance.toFixed(2)).toBe('550.00');
    expect(result.warnings).toContain(
      'Journal JE-001 does not contain a verified receivable cash settlement leg.',
    );
  });
  it('keeps deposits separate from open invoice balances and late allocations', () => {
    const fixture = sources();
    fixture.payments[0] = { ...payment, amount: D(500), unappliedAmount: D(100), allocations: [] };
    const result = assembleCustomerAccounts(fixture, new Date('2026-02-28T23:59:59Z'))[0];
    expect(result.openInvoiceBalance.toFixed(2)).toBe('750.00');
    expect(result.customerCredit.toFixed(2)).toBe('500.00');
    expect(result.netBalance.toFixed(2)).toBe('250.00');
  });
  it('does not include a never-posted cancelled draft or warn about it', () => {
    const fixture = sources();
    fixture.sales.push({
      ...fixture.sales[1],
      id: 'draft',
      status: 'CANCELLED',
      journalEntry: undefined,
    } as any);
    expect(assembleCustomerAccounts(fixture, new Date('2026-02-28T23:59:59Z'))[0].warnings).toEqual(
      [],
    );
  });
  it('uses stable source ordering for equal-dated invoices independent of database order', () => {
    const fixture = sources();
    fixture.receivables.push({
      ...invoice,
      id: 'invoice-2',
      receivableNumber: 'INV-002',
      status: 'OPEN',
      journalEntryId: 'sale-journal-2',
    });
    const first = assembleCustomerAccounts(
      fixture,
      new Date('2026-02-28T23:59:59Z'),
    )[0].movements.map((m) => `${m.reference}:${m.debit}:${m.credit}`);
    fixture.receivables.reverse();
    expect(
      assembleCustomerAccounts(fixture, new Date('2026-02-28T23:59:59Z'))[0].movements.map(
        (m) => `${m.reference}:${m.debit}:${m.credit}`,
      ),
    ).toEqual(first);
  });
  it('records scoped allocations on their effective dates and never reveals inaccessible receipt metadata', () => {
    const fixture: any = sources();
    fixture.receivables[0].status = 'OPEN';
    fixture.payments[0] = {
      ...payment,
      paymentDate: DAY('2026-01-10'),
      createdAt: DAY('2026-01-10'),
      headerVisible: false,
      reference: 'HIDDEN-BANK-REFERENCE',
      paymentNumber: 'HIDDEN-RECEIPT',
      allocations: [{ ...allocation, createdAt: DAY('2026-02-10') }],
    };
    const result = assembleCustomerAccounts(fixture, new Date('2026-02-28T23:59:59Z'))[0];
    const scoped = result.payments.find((p) => p.sourceType === 'PaymentAllocation')!;
    expect(scoped.date).toEqual(DAY('2026-02-10'));
    expect(scoped.method).toBe('OTHER');
    expect(scoped.id).not.toContain(payment.id);
    const printed = JSON.stringify(result.movements);
    expect(printed).not.toContain('HIDDEN-RECEIPT');
    expect(printed).not.toContain('HIDDEN-BANK-REFERENCE');
    expect(
      result.movements.find((m) => m.sourceType === 'PaymentAllocation' && m.type === 'PAYMENT')!
        .date,
    ).toEqual(DAY('2026-02-10'));
  });
  it('preserves original accrual dates after a source issue-date edit and flags changed ownership or terms', () => {
    const fixture: any = sources();
    fixture.receivables[0] = { ...invoice, issueDate: DAY('2026-12-01'), status: 'OPEN' };
    fixture.sourceEdits = [
      {
        companyId: customer.companyId,
        oldValue: { customerId: customer.id, dueDate: '2026-02-20' },
        newValue: { customerId: 'other-customer', dueDate: '2026-03-20' },
      },
    ];
    const result = assembleCustomerAccounts(fixture, new Date('2026-02-28T23:59:59Z'))[0];
    expect(result.movements.find((m) => m.sourceId === invoice.id)!.date).toEqual(
      DAY('2026-02-05'),
    );
    expect(result.integrityIssues).toEqual(
      expect.arrayContaining(['changed-source-ownership', 'changed-payment-terms']),
    );
  });
  it('does not treat a draft mirror journal as a completed financial reversal', () => {
    const fixture: any = sources();
    fixture.payments[0] = {
      ...payment,
      reversalJournalEntry: { status: 'DRAFT', transactionDate: DAY('2026-03-05') },
    };
    const result = assembleCustomerAccounts(fixture, new Date('2026-03-31T23:59:59Z'))[0];
    expect(result.payments.find((p) => p.id === payment.id)!.status).toBe('COMPLETED');
    expect(result.integrityIssues).toContain('missing-reversal');
  });
  it('matches the resolved semantic role account instead of generic conventional-code alternatives', () => {
    const fixture: any = sources();
    fixture.roleAccounts = {
      [customer.companyId]: { AR_CONTROL: 'ar-custom', CASH_ON_HAND: 'cash-custom' },
    };
    fixture.journals[0].lines = [
      { ...arLine(200), accountId: 'ar-custom' },
      { ...cashLine(200), accountId: 'cash-custom' },
      {
        ...arLine(5000),
        accountId: 'unrelated-1100',
        account: { accountCode: '1100', accountSubType: 'GENERIC_ASSET' },
      },
    ];
    fixture.journals[1].lines = [{ ...arLine(800), accountId: 'ar-custom' }];
    expect(
      assembleCustomerAccounts(fixture, new Date('2026-02-28T23:59:59Z'))[0].netBalance.toFixed(2),
    ).toBe('350.00');
  });
  it('does not expose deposits or hidden allocation amounts on partially visible receipts', () => {
    const fixture = sources();
    (fixture.payments[0] as any)._count = { allocations: 2 };
    fixture.payments[0].amount = D(9000);
    fixture.payments[0].unappliedAmount = D(1000);
    const visible = assembleCustomerAccounts(
      fixture,
      new Date('2026-02-28T23:59:59Z'),
    )[0].payments.find(
      (p) =>
        p.allocations.some((a) => a.receivableId === invoice.id) &&
        p.sourceType === 'CustomerPayment',
    )!;
    expect(visible.amount.toFixed(2)).toBe('400.00');
    expect(visible.unappliedAmount.toFixed(2)).toBe('0.00');
  });
});

describe('Customer statements and preserved exports', () => {
  it('projects legacy customer profile summaries without overwriting their saved balances', async () => {
    const { service: statements } = service();
    const run: any = {
      id: 'old',
      companyId: base.companyId,
      customerId: base.customerId,
      currency: 'TZS',
      snapshot: null,
      periodStart: DAY(selection.dateFrom),
      periodEnd: DAY(selection.dateTo),
      openingBalance: D(0),
      totalDebits: D(1000),
      totalCredits: D(0),
      closingBalance: D(1000),
    };
    const [projected] = await statements.projectSavedRuns([run], USER);
    expect(projected.closingBalance.toFixed(2)).toBe('350.00');
    expect(projected.storedBalances.closingBalance.toFixed(2)).toBe('1000.00');
    expect(projected.settlementHistory.status).toBe('COMPLETE');
    expect(projected.hasSnapshot).toBe(false);
    expect(run.closingBalance.toFixed(2)).toBe('1000.00');
  });
  it('preserves explicit intraday closing times on legacy summaries', async () => {
    const ctx = service();
    const projected = await ctx.projection.read(USER, { dateTo: selection.dateTo });
    projected.accounts[0].movements.push({
      date: new Date('2026-02-28T17:00:00Z'),
      type: 'PAYMENT',
      sourceId: 'after-cutoff',
      sourceType: 'CustomerPayment',
      sourceUrl: '/finance/receivables',
      reference: 'AFTER-CUTOFF',
      description: 'Receipt after the original cutoff',
      debit: D(0),
      credit: D(50),
    });
    ctx.projection.read.mockResolvedValue(projected);
    const run: any = {
      id: 'intraday',
      companyId: base.companyId,
      customerId: base.customerId,
      currency: 'TZS',
      snapshot: null,
      periodStart: DAY(selection.dateFrom),
      periodEnd: new Date('2026-02-28T14:00:00Z'),
      openingBalance: D(0),
      totalDebits: D(1000),
      totalCredits: D(0),
      closingBalance: D(1000),
    };
    const [summary] = await ctx.service.projectSavedRuns([run], USER);
    expect(summary.closingBalance.toFixed(2)).toBe('350.00');
    expect(summary.totalCredits.toFixed(2)).toBe('750.00');
  });
  it('preserves very large Excel amounts as exact text with a precision note', async () => {
    const amount = '9999999999999999.99';
    const fixture: any = {
      customers: [customer],
      sales: [],
      payments: [],
      creditNotes: [],
      refunds: [],
      journals: [],
      receivables: [{ ...invoice, status: 'OPEN', journalEntryId: null, amount: D(amount) }],
    };
    const projected = assembleCustomerAccounts(fixture, new Date('2026-02-28T23:59:59.999Z'))[0];
    const ctx = service();
    ctx.projection.read.mockResolvedValue({
      accounts: [projected],
      warnings: [],
      currency: 'TZS',
      scope: { companyId: base.companyId, divisionIds: [], branchIds: [], unrestricted: true },
    });
    const result = await ctx.service.exportExcel(selection, USER);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const workbook = new (require('exceljs').Workbook)();
    await workbook.xlsx.load(result.buffer);
    const sheet = workbook.getWorksheet('Statement');
    expect(sheet.getCell('D9').value).toBe(amount);
    expect(sheet.getCell('F10').value).toBe(amount);
    expect(sheet.getCell('F10').note).toContain('preserve cents');
    expect(sheet.getCell('F8').value).toBe(0);
  });
  it('calculates an opening balance and exact running balances with historical aging', async () => {
    const { service: statements } = service();
    const detail = await statements.getDetail({ ...selection, dateFrom: '2026-02-11' }, USER);
    expect(detail.openingBalance).toBe('600.00');
    expect(detail.closingBalance).toBe('350.00');
    expect(
      D(detail.openingBalance).plus(detail.totalDebits).minus(detail.totalCredits).toFixed(2),
    ).toBe(detail.closingBalance);
    expect(detail.lines.at(-1).balance).toBe('350.00');
    expect(detail.agingAsOf).toBe('2026-02-28T23:59:59.999Z');
  });
  it('freezes issued lines and PDF, and reopens them after source data changes', async () => {
    const { service: statements, db, projection } = service();
    const run = await statements.generate(
      {
        companyId: selection.companyId,
        customerId: selection.customerId,
        periodStart: selection.dateFrom,
        periodEnd: selection.dateTo,
      },
      USER,
    );
    db.customerStatementRun.findFirst.mockResolvedValue(
      db.customerStatementRun.create.mock.calls[0][0].data,
    );
    projection.read.mockRejectedValue(new Error('Live source changed'));
    expect(((await statements.savedDetail(run.id, USER)) as any).closingBalance).toBe('350.00');
    const pdf = await statements.exportPdf({ runId: run.id } as any, USER);
    expect(pdf.buffer).toEqual(db.customerStatementRun.create.mock.calls[0][0].data.pdfContent);
    expect(pdf.buffer.toString('ascii', 0, 5)).toBe('%PDF-');
  });
  it('hashes JSONB snapshots independent of key order and detects altered content', async () => {
    const { service: statements, db } = service();
    const run = await statements.generate(
      {
        companyId: selection.companyId,
        customerId: selection.customerId,
        periodStart: selection.dateFrom,
        periodEnd: selection.dateTo,
      },
      USER,
    );
    const stored = db.customerStatementRun.create.mock.calls[0][0].data;
    stored.snapshot = Object.fromEntries(Object.entries(stored.snapshot).reverse());
    db.customerStatementRun.findFirst.mockResolvedValue(stored);
    expect(((await statements.savedDetail(run.id, USER)) as any).closingBalance).toBe('350.00');
    stored.snapshot.closingBalance = '999.00';
    await expect(statements.savedDetail(run.id, USER)).rejects.toThrow('integrity check');
  });
  it('rejects a changed preview before export or issue', async () => {
    const { service: statements } = service();
    await expect(
      statements.exportPdf({ ...selection, expectedHash: 'stale' }, USER),
    ).rejects.toThrow('Refresh the statement');
    await expect(
      statements.generate(
        {
          companyId: selection.companyId,
          customerId: selection.customerId,
          periodStart: selection.dateFrom,
          periodEnd: selection.dateTo,
          expectedHash: 'stale',
        },
        USER,
      ),
    ).rejects.toThrow('Refresh the statement');
  });
  it('fails closed on unknown historical dates and legacy summary-only runs', async () => {
    const { service: statements, db, projection } = service();
    const projected = await projection.read(USER, { dateTo: selection.dateTo });
    projected.accounts[0].warnings.push('Invoice has no dated cancellation evidence.');
    projected.accounts[0].integrityIssues = ['missing-cancellation'];
    projection.read.mockResolvedValue(projected);
    await expect(
      statements.generate(
        {
          companyId: selection.companyId,
          customerId: selection.customerId,
          periodStart: selection.dateFrom,
          periodEnd: selection.dateTo,
        },
        USER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    db.customerStatementRun.findFirst.mockResolvedValue({
      id: 'old',
      companyId: selection.companyId,
      snapshot: null,
    });
    await expect(statements.savedDetail('old', USER)).rejects.toThrow('totals only');
  });
  it('revalidates every saved organizational scope and allows explicit authorized branch snapshots', async () => {
    const { service: statements, db, org } = service();
    const run = await statements.generate(
      {
        companyId: selection.companyId,
        customerId: selection.customerId,
        periodStart: selection.dateFrom,
        periodEnd: selection.dateTo,
      },
      USER,
    );
    db.customerStatementRun.findFirst.mockResolvedValue(
      db.customerStatementRun.create.mock.calls[0][0].data,
    );
    org.accessibleIds.mockResolvedValue({
      unrestricted: false,
      divisionIds: [],
      branchIds: ['branch-1'],
    });
    await expect(statements.savedDetail(run.id, USER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (statements as any).scopeAllowed(
        { unrestricted: true, branchId: 'branch-1' },
        { unrestricted: false, divisionIds: [], branchIds: ['branch-1'] },
      ),
    ).toBe(true);
  });
  it('keeps existing company-wide summaries but rejects unsupported template overrides explicitly', async () => {
    const { service: statements } = service();
    const summary = await statements.generate(
      {
        companyId: selection.companyId,
        periodStart: selection.dateFrom,
        periodEnd: selection.dateTo,
      },
      USER,
    );
    expect(summary.customerId).toBeNull();
    expect(summary.closingBalance.toFixed(2)).toBe('350.00');
    expect(summary.hasSnapshot).toBe(false);
    await expect(
      statements.exportPdf({ ...selection, templateId: 'custom' }, USER),
    ).rejects.toThrow('Template overrides');
  });
  it('returns no customer detail outside the projection scope and rejects invalid currency', async () => {
    const { service: statements, projection } = service();
    projection.read.mockResolvedValue({ accounts: [] });
    await expect(statements.getDetail(selection, USER)).rejects.toBeInstanceOf(NotFoundException);
    await expect(statements.getDetail({ ...selection, currency: 'INVALID' }, USER)).rejects.toThrow(
      'Invalid statement currency',
    );
  });
  it('exports numeric formatted spreadsheet money and a proper PDF table', async () => {
    const { service: statements } = service();
    const statement = await statements.buildStatement(selection, USER),
      model = customerStatementPdf(statement);
    expect(model.sections[0].table?.numericColumns).toEqual([2, 3, 4]);
    expect(buildBusinessPdf(model).toString('ascii', 0, 5)).toBe('%PDF-');
    const excel = await statements.exportExcel(selection, USER);
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excel.buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(8).getCell(6).value).toBe(0);
    expect(typeof sheet.getRow(9).getCell(4).value).toBe('number');
    expect(sheet.pageSetup.printTitlesRow).toBe('7:7');
  });
  it('sends a real PDF attachment through the existing email boundary and audits actual delivery result', async () => {
    const { service: statements, email, audit } = service();
    const result = await statements.emailToCustomer(selection, USER);
    expect(result.emailed).toBe(true);
    expect(email.sendEmailWithAttachments.mock.calls[0][4][0].content.toString('ascii', 0, 5)).toBe(
      '%PDF-',
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EMAIL',
        metadata: expect.objectContaining({ emailed: true }),
      }),
    );
  });
  it('emails the exact retained PDF to the current customer address after live activity changes', async () => {
    const { service: statements, db, projection, email } = service();
    const run = await statements.generate(
      {
        companyId: selection.companyId,
        customerId: selection.customerId,
        periodStart: selection.dateFrom,
        periodEnd: selection.dateTo,
      },
      USER,
    );
    const stored = db.customerStatementRun.create.mock.calls[0][0].data;
    db.customerStatementRun.findFirst.mockResolvedValue(stored);
    projection.read.mockRejectedValue(new Error('Changed live activity must not be read'));
    await statements.emailToCustomer({ runId: run.id } as any, USER);
    expect(email.sendEmailWithAttachments.mock.calls[0][0]).toBe('current-accounts@acme.test');
    expect(email.sendEmailWithAttachments.mock.calls[0][4][0].content).toEqual(stored.pdfContent);
  });
  it('rejects an outdated live email preview before sending', async () => {
    const { service: statements, email } = service();
    await expect(
      statements.emailToCustomer({ ...selection, expectedHash: 'stale' }, USER),
    ).rejects.toThrow('Refresh the statement');
    expect(email.sendEmailWithAttachments).not.toHaveBeenCalled();
  });
  it('rejects a modified retained PDF even when the saved JSON has not changed', async () => {
    const { service: statements, db } = service();
    const run = await statements.generate(
      {
        companyId: selection.companyId,
        customerId: selection.customerId,
        periodStart: selection.dateFrom,
        periodEnd: selection.dateTo,
      },
      USER,
    );
    const stored = db.customerStatementRun.create.mock.calls[0][0].data;
    stored.pdfContent = Buffer.from('%PDF-modified');
    db.customerStatementRun.findFirst.mockResolvedValue(stored);
    await expect(statements.exportPdf({ runId: run.id } as any, USER)).rejects.toThrow(
      'PDF integrity check',
    );
  });
  it('requires the strict audit to succeed inside the issue transaction', async () => {
    const { service: statements, audit, db } = service();
    audit.logStrictInTransaction.mockRejectedValue(new Error('Audit storage unavailable'));
    await expect(
      statements.generate(
        {
          companyId: selection.companyId,
          customerId: selection.customerId,
          periodStart: selection.dateFrom,
          periodEnd: selection.dateTo,
        },
        USER,
      ),
    ).rejects.toThrow('Audit storage unavailable');
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function));
  });
});

describe('Projection query isolation', () => {
  it('always intersects company, organization and currency inside a repeatable-read snapshot', async () => {
    const fixture = sources();
    const tx: any = {
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    for (const [model, rows] of [
      ['customer', fixture.customers],
      ['salesOrder', []],
      ['receivable', fixture.receivables],
      ['customerPayment', []],
      ['creditNote', []],
      ['refund', []],
      ['journalEntry', fixture.journals],
    ] as const)
      tx[model] = { findMany: jest.fn().mockResolvedValue(rows) };
    const db: any = { $transaction: jest.fn().mockImplementation((callback) => callback(tx)) },
      company: any = { companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }) },
      org: any = {
        accessibleIds: jest
          .fn()
          .mockResolvedValue({ unrestricted: false, divisionIds: [], branchIds: ['branch-1'] }),
        recordWhereFor: jest.fn().mockResolvedValue({ OR: [{ branchId: { in: ['branch-1'] } }] }),
      };
    await new CustomerAccountProjectionService(db, company, org).read(USER, {
      companyId: 'company-1',
      currency: 'TZS',
      dateTo: '2026-02-28',
    });
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }),
    );
    for (const model of ['salesOrder', 'receivable', 'creditNote', 'refund'])
      expect(tx[model].findMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({
          currency: 'TZS',
          AND: expect.arrayContaining([
            { companyId: 'company-1' },
            { OR: [{ branchId: { in: ['branch-1'] } }] },
          ]),
        }),
      );
  });
});
