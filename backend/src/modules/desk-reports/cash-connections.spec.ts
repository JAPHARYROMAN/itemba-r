import { Prisma } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { CashConnectionsService } from './cash-connections.service';
import { cashLines } from './cash-posting.domain';
import { sourceFingerprint, DeskPostingSource } from './desk-posting.domain';
const d = (v: string | number) => new Prisma.Decimal(v);
const user: any = {
  id: 'u1',
  permissions: [
    'cash_desk.view',
    'cash_desk.manage',
    'cash_accounts.manage',
    'journal_entries.view',
    'journal_entries.create',
    'journal_entries.post',
    'journal_entries.reverse',
    'sales_desk.view',
    'invoice_desk.view',
  ],
};
const scope = { companyId: 'c1', divisionId: 'd1', branchId: 'b1' };
function setup(kind = 'EXPENSE') {
  const gl = {
    id: 'cash-gl',
    ...scope,
    accountType: 'ASSET',
    isActive: true,
    deletedAt: null,
    accountName: 'Till',
    accountCode: '1001',
  };
  const bank = {
    id: 'bank1',
    ...scope,
    accountType: 'CASH_ON_HAND',
    isActive: true,
    deletedAt: null,
    currency: 'TZS',
    ledgerAccountId: gl.id,
    ledgerAccount: gl,
  };
  const account = {
    id: 'a1',
    ...scope,
    name: 'Till',
    currency: 'TZS',
    erpCashAccountId: bank.id,
    erpCashAccount: bank,
  };
  const offset = {
    id: 'offset',
    ...scope,
    accountType: kind === 'EXPENSE' ? 'EXPENSE' : 'INCOME',
    isActive: true,
    deletedAt: null,
    accountName: 'Offset',
    accountCode: '5001',
  };
  const row: any = {
    id: 'm1',
    kind,
    amount: d(100),
    currency: 'TZS',
    businessDate: new Date('2026-09-19'),
    description: 'Movement',
    reference: 'REF1',
    reversedAt: null,
    reversalOfId: null,
    loanId: null,
    salesPaymentId: null,
    invoicePaymentId: null,
    entries: [
      {
        accountId: account.id,
        account,
        amount: d(['EXPENSE', 'SUPPLIER_PAYMENT'].includes(kind) ? -100 : 100),
      },
    ],
  };
  const db: any = {
    $queryRaw: jest.fn(async () => []),
    cashDeskMovement: {
      findFirst: jest.fn(async () => row),
    },
    cashDeskAccount: {
      count: jest.fn(async () => row.entries.length),
      findUnique: jest.fn(async ({ where }: any) => (where.id ? account : null)),
      update: jest.fn(),
    },
    cashAccount: { findUnique: jest.fn(async () => bank), update: jest.fn() },
    companyProfile: { findUnique: jest.fn(async () => ({ currency: 'TZS' })) },
    chartOfAccount: {
      findMany: jest.fn(async () => [gl, offset]),
      findUnique: jest.fn(async () => gl),
    },
    journalEntry: {
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(),
    },
    journalEntryLine: { updateMany: jest.fn() },
  };
  db.$transaction = jest.fn(async (work: any) => work(db));
  const companies: any = {
    companyWhereFor: jest.fn(async () => ({})),
    assertCanAccessCompany: jest.fn(),
  };
  const org: any = { recordWhereFor: jest.fn(async () => ({})), assertCanAccessScope: jest.fn() };
  const engine: any = { postLines: jest.fn(async () => ({ id: 'j1', journalNumber: 'JE-1' })) };
  const audit: any = { logStrictInTransaction: jest.fn() };
  return {
    row,
    account,
    bank,
    gl,
    offset,
    db,
    companies,
    org,
    engine,
    audit,
    service: new CashConnectionsService(db, companies, org, engine, audit),
  };
}
describe('Cash ledger rules', () => {
  it('allows balance review when company write access is denied and still blocks saving', async () => {
    const { service, db, bank, companies } = setup();
    db.cashDeskAccount.findMany = jest.fn(async () => []);
    db.cashAccount.findMany = jest.fn(async () => [{ ...bank, currentBalance: d('154000.01') }]);
    db.journalEntryLine.groupBy = jest.fn(async () => [
      { accountId: 'cash-gl', _sum: { debit: d(1000), credit: d('0.01') } },
    ]);
    companies.assertCanAccessCompany.mockRejectedValue(
      new ForbiddenException('Insufficient company write access'),
    );
    const result = await service.connections(user, {});
    expect(result.bank[0]).toMatchObject({
      canConnect: false,
      recordedBalance: '154000.01',
      ledgerBalance: '999.99',
      balanceDifference: '153000.02',
    });
    expect(result.ledger[0].ledgerBalance).toBe('999.99');
    expect(db.journalEntryLine.groupBy.mock.calls[0][0].where.journalEntry.status.in).toEqual([
      'POSTED',
      'REVERSED',
    ]);
    await expect(
      service.connect(user, { cashAccountId: 'bank1', ledgerAccountId: 'cash-gl' }),
    ).rejects.toThrow('write access');
    expect(db.cashAccount.update).not.toHaveBeenCalled();
  });
  it('returns candidate ledger balances before a mapping exists, without treating missing mappings as zero', async () => {
    const { service, db, bank } = setup();
    db.cashDeskAccount.findMany = jest.fn(async () => []);
    db.cashAccount.findMany = jest.fn(async () => [
      { ...bank, ledgerAccountId: null, ledgerAccount: null, currentBalance: d(0) },
    ]);
    db.journalEntryLine.groupBy = jest.fn(async () => [
      { accountId: 'cash-gl', _sum: { debit: d(1000), credit: null } },
    ]);
    const result = await service.connections(user, {});
    expect(result.bank[0]).toMatchObject({
      canConnect: true,
      ledgerBalance: null,
      balanceDifference: null,
    });
    expect(result.ledger[0].ledgerBalance).toBe('1000.00');
    expect(result.ledger[1].ledgerBalance).toBe('0.00');
  });
  it('does not hide service failures as read-only account access', async () => {
    const { service, db, bank, companies } = setup();
    db.cashDeskAccount.findMany = jest.fn(async () => []);
    db.cashAccount.findMany = jest.fn(async () => [{ ...bank, currentBalance: d(0) }]);
    db.journalEntryLine.groupBy = jest.fn(async () => []);
    companies.assertCanAccessCompany.mockRejectedValue(new Error('Database unavailable'));
    await expect(service.connections(user, {})).rejects.toThrow('Database unavailable');
  });
  it.each([
    ['DAILY_SALES', 1],
    ['OTHER_IN', 1],
    ['OPENING', 1],
    ['SALE_RECEIPT', 1],
    ['SUPPLIER_PAYMENT', -1],
    ['EXPENSE', -1],
  ])('posts %s in the correct direction', (kind, sign) => {
    const lines = cashLines(
      String(kind),
      d('100.05'),
      [{ accountId: 'cash', amount: d('100.05').mul(Number(sign)) }],
      'offset',
    );
    expect(lines[0].debit.minus(lines[0].credit).toFixed(2)).toBe(
      Number(sign) === 1 ? '100.05' : '-100.05',
    );
    expect(lines.reduce((sum, l) => sum.plus(l.debit).minus(l.credit), d(0)).isZero()).toBe(true);
  });
  it('moves cash between accounts without income or expense lines', () => {
    const lines = cashLines('TRANSFER', d(10), [
      { accountId: 'bank', amount: d(-10) },
      { accountId: 'till', amount: d(10) },
    ]);
    expect(lines.map((l) => l.accountId)).toEqual(['bank', 'till']);
    expect(() =>
      cashLines('TRANSFER', d(10), [
        { accountId: 'bank', amount: d(-10) },
        { accountId: 'till', amount: d(11) },
      ]),
    ).toThrow('equal and opposite');
    expect(() =>
      cashLines('EXPENSE', d(10), [{ accountId: 'bank', amount: d(10) }], 'expense'),
    ).toThrow('direction');
  });
  it('rejects amounts outside exact engine precision', () => {
    expect(() =>
      cashLines(
        'OTHER_IN',
        d('9999999999999999.99'),
        [{ accountId: 'cash', amount: d('9999999999999999.99') }],
        'income',
      ),
    ).toThrow('precision');
  });
});
describe('Cash connection workflow', () => {
  it('reviews and posts default-currency cash movements without a legal profile', async () => {
    const { service, db, engine } = setup();
    db.companyProfile.findUnique.mockResolvedValue(null);
    const review = await service.review(user, 'm1');
    expect(review.issues).toEqual([]);
    await service.post(user, 'm1', { fingerprint: review.fingerprint, offsetAccountId: 'offset' });
    expect(engine.postLines).toHaveBeenCalledTimes(1);
  });
  it('posts one expense journal with original date, source, organisation and audit in the transaction', async () => {
    const { service, engine, audit, db } = setup();
    const review = await service.review(user, 'm1');
    expect(review.issues).toEqual([]);
    await service.post(user, 'm1', { fingerprint: review.fingerprint, offsetAccountId: 'offset' });
    expect(engine.postLines).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceType: 'DeskCash',
        referenceId: 'm1',
        ...scope,
        transactionDate: new Date('2026-09-19'),
      }),
      db,
    );
    const lines = engine.postLines.mock.calls[0][0].lines;
    expect(lines[0].credit.eq(100)).toBe(true);
    expect(lines[1].debit.eq(100)).toBe(true);
    expect(audit.logStrictInTransaction).toHaveBeenCalled();
  });
  it('rejects stale reviews, duplicates and missing mappings', async () => {
    const { service, account, db, engine } = setup();
    const review = await service.review(user, 'm1');
    await expect(
      service.post(user, 'm1', { fingerprint: 'stale', offsetAccountId: 'offset' }),
    ).rejects.toThrow('changed');
    account.erpCashAccount.ledgerAccountId = 'different';
    await expect(
      service.post(user, 'm1', { fingerprint: review.fingerprint, offsetAccountId: 'offset' }),
    ).rejects.toThrow('changed');
    db.journalEntry.findMany.mockResolvedValue([
      { id: 'existing', status: 'POSTED', journalNumber: 'JE-X' },
    ]);
    await expect(
      service.post(user, 'm1', { fingerprint: review.fingerprint, offsetAccountId: 'offset' }),
    ).rejects.toThrow('already has');
    expect(engine.postLines).not.toHaveBeenCalled();
  });
  it('blocks foreign currency, missing mappings, loans and access to only one transfer side', async () => {
    const { service, row, account, db } = setup();
    row.currency = 'USD';
    account.erpCashAccount = null as any;
    expect((await service.review(user, 'm1')).issues.join(' ')).toContain('currency');
    expect((await service.review(user, 'm1')).issues.join(' ')).toContain('Connect Till');
    row.loanId = 'loan1';
    expect((await service.review(user, 'm1')).issues.join(' ')).toContain('loan');
    db.cashDeskAccount.count.mockResolvedValue(0);
    await expect(service.review(user, 'm1')).rejects.toThrow('every account');
  });
  it('requires source and posting permissions independently', async () => {
    const { service } = setup();
    await expect(
      service.post({ ...user, permissions: ['cash_desk.view'] }, 'm1', { fingerprint: 'x' }),
    ).rejects.toThrow('permission');
    await expect(
      service.review({ ...user, permissions: ['journal_entries.view'] }, 'm1'),
    ).rejects.toThrow('permission');
  });
  it.each(['SALE_RECEIPT', 'SUPPLIER_PAYMENT'])(
    'settles the original invoice control account for %s',
    async (kind) => {
      const { service, row, offset, db, engine } = setup(kind),
        sales = kind === 'SALE_RECEIPT';
      offset.accountType = sales ? 'ASSET' : 'LIABILITY';
      const invoice = {
        ...scope,
        id: 'inv1',
        saleDate: new Date('2026-09-18'),
        invoiceDate: new Date('2026-09-18'),
        saleNumber: 'INV1',
        invoiceNumber: 'INV1',
        currency: 'TZS',
        totalAmount: d(200),
        customerId: 'party1',
        supplierId: 'party1',
        voidedAt: null,
      };
      if (!sales) delete (invoice as any).saleDate;
      if (sales) {
        row.salesPaymentId = 'p1';
        row.salesPayment = { sale: invoice, amount: d(100), reversedAt: null };
      } else {
        row.invoicePaymentId = 'p1';
        row.invoicePayment = { invoice, amount: d(100), reversedAt: null };
      }
      const doc: DeskPostingSource = {
        id: 'inv1',
        kind: sales ? 'sales' : 'purchases',
        ...scope,
        reference: 'INV1',
        currency: 'TZS',
        date: '2026-09-18',
        amount: '200.00',
        partyId: 'party1',
        voided: false,
      };
      const parent = {
        id: 'parent',
        status: 'POSTED',
        totalDebit: d(200),
        totalCredit: d(200),
        transactionDate: new Date(doc.date),
        reversalOfId: null,
        description: `Invoice [desk-source:${sourceFingerprint(doc)}]`,
        lines: [
          {
            accountId: 'offset',
            account: offset,
            debit: d(sales ? 200 : 0),
            credit: d(sales ? 0 : 200),
          },
        ],
      };
      db.journalEntry.findMany.mockImplementation(async ({ where }: any) =>
        where.referenceType === 'DeskCash' || where.OR ? [] : [parent],
      );
      const review = await service.review(user, 'm1');
      expect(review.offsetId).toBe('offset');
      expect(review.issues).toEqual([]);
      await service.post(user, 'm1', {
        fingerprint: review.fingerprint,
        offsetAccountId: 'wrong-client-account',
      });
      expect(engine.postLines.mock.calls[0][0].lines[1].accountId).toBe('offset');
      parent.status = 'REVERSED';
      expect((await service.review(user, 'm1')).issues.join(' ')).toContain('invoice first');
    },
  );
  it('prevents reuse or reassignment of a cash ledger mapping', async () => {
    const { service, bank, db } = setup();
    bank.ledgerAccountId = 'old-ledger';
    await expect(
      service.connect(user, { cashAccountId: 'bank1', ledgerAccountId: 'cash-gl' }),
    ).rejects.toThrow('reassigned');
    bank.ledgerAccountId = 'cash-gl';
    db.cashAccount.findUnique.mockImplementation(async ({ where }: any) =>
      where.id ? bank : { ...bank, id: 'other' },
    );
    await expect(
      service.connect(user, { cashAccountId: 'bank1', ledgerAccountId: 'cash-gl' }),
    ).rejects.toThrow('own ledger');
    expect(db.cashAccount.update).not.toHaveBeenCalled();
  });
  it('reverses the original journal exactly in the caller transaction and requires reversal permission', async () => {
    const { service, db, engine } = setup();
    const original = {
      id: 'j0',
      journalNumber: 'JE-0',
      status: 'POSTED',
      ...scope,
      lines: [
        { accountId: 'cash-gl', debit: d(0), credit: d(100), ...scope },
        { accountId: 'offset', debit: d(100), credit: d(0), ...scope },
      ],
    };
    db.journalEntry.findMany.mockResolvedValue([original]);
    await expect(
      service.reverseInTransaction(
        db,
        { ...user, permissions: [] },
        'm1',
        'r1',
        new Date(),
        'Correction',
      ),
    ).rejects.toThrow('permission');
    await service.reverseInTransaction(db, user, 'm1', 'r1', new Date('2026-09-20'), 'Correction');
    const [input, client] = engine.postLines.mock.calls[0];
    expect(client).toBe(db);
    expect(input.referenceId).toBe('r1');
    expect(input.lines[0].debit.eq(100)).toBe(true);
    expect(input.lines[1].credit.eq(100)).toBe(true);
    expect(db.journalEntry.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: { reversalOfId: 'j0' },
    });
  });
});

describe('Verified Cash Desk balance setup', () => {
  function initial() {
    const result = setup();
    Object.assign(result.bank, {
      ledgerAccountId: null,
      divisionId: null,
      branchId: null,
      openingBalance: d(0),
      currentBalance: d(0),
      _count: {
        expenses: 0,
        fuelShiftCollections: 0,
        salesOrders: 0,
        refunds: 0,
        customerPayments: 0,
        supplierPayments: 0,
        mobilePosPayments: 0,
        bankReconciliations: 0,
      },
    });
    Object.assign(result.gl, { divisionId: null, branchId: null });
    Object.assign(result.account, {
      erpCashAccountId: null,
      kind: 'CASH',
      balance: d('167693000.01'),
    });
    result.db.cashAccount.findUnique.mockImplementation(async ({ where }: any) =>
      where.id ? result.bank : null,
    );
    result.db.cashDeskAccount.findUnique.mockImplementation(async ({ where }: any) =>
      where.id ? result.account : null,
    );
    result.db.cashDeskEntry = {
      aggregate: jest.fn(async () => ({ _sum: { amount: d('167693000.01') } })),
    };
    return result;
  }
  const input = {
    deskAccountId: 'a1',
    cashAccountId: 'bank1',
    ledgerAccountId: 'cash-gl',
    confirmedDeskBalance: '167693000.01',
  };
  it('connects and adopts verified TZS cash without creating a legal profile', async () => {
    const { service, db, audit } = initial();
    db.companyProfile.findUnique.mockResolvedValue(null);
    await expect(service.connect(user, input)).resolves.toEqual({ connected: true });
    expect(db.cashAccount.update).toHaveBeenCalledWith({
      where: { id: 'bank1' },
      data: expect.objectContaining({ currentBalance: d(input.confirmedDeskBalance) }),
    });
    expect(audit.logStrictInTransaction).toHaveBeenCalledTimes(1);
    expect(db.companyProfile.findUnique).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      select: { currency: true },
    });
  });
  it.each(['missing profile', 'configured currency', 'account mismatch'])(
    'rejects currency mismatch before writing the connection: %s',
    async (issue) => {
      const { service, db, bank, account } = initial();
      if (issue === 'missing profile') {
        db.companyProfile.findUnique.mockResolvedValue(null);
        bank.currency = 'USD';
        account.currency = 'USD';
      } else {
        db.companyProfile.findUnique.mockResolvedValue({ currency: 'USD' });
        if (issue === 'account mismatch') bank.currency = 'USD';
      }
      await expect(service.connect(user, input)).rejects.toThrow('accounting currency');
      expect(db.cashAccount.update).not.toHaveBeenCalled();
      expect(db.cashDeskAccount.update).not.toHaveBeenCalled();
    },
  );
  it('honors an explicitly configured non-default company currency', async () => {
    const { service, db, bank, account } = initial();
    db.companyProfile.findUnique.mockResolvedValue({ currency: 'USD' });
    bank.currency = 'USD';
    account.currency = 'USD';
    await expect(service.connect(user, input)).resolves.toEqual({ connected: true });
  });
  it('adopts the exact movement-backed balance and branch, with audit, without touching cash movements or journals', async () => {
    const { service, db, audit, engine } = initial();
    await expect(service.connect(user, input)).resolves.toEqual({ connected: true });
    expect(db.cashAccount.update).toHaveBeenCalledWith({
      where: { id: 'bank1' },
      data: {
        ledgerAccountId: 'cash-gl',
        currentBalance: d('167693000.01'),
        divisionId: 'd1',
        branchId: 'b1',
      },
    });
    expect(db.cashDeskAccount.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { erpCashAccountId: 'bank1' },
    });
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: 'u1',
        metadata: expect.objectContaining({
          balanceSetup: expect.objectContaining({
            previousBalance: '0.00',
            recordedBalance: '167693000.01',
            ledgerHistoryUnchanged: true,
          }),
        }),
      }),
    );
    expect(engine.postLines).not.toHaveBeenCalled();
    expect(db.$transaction.mock.calls[0][1].isolationLevel).toBe('Serializable');
  });
  it('keeps normal connection behavior when balance setup is not selected', async () => {
    const { service, db } = initial();
    const { confirmedDeskBalance, ...normal } = input;
    void confirmedDeskBalance;
    await service.connect(user, normal);
    expect(db.cashAccount.update).toHaveBeenCalledWith({
      where: { id: 'bank1' },
      data: { ledgerAccountId: 'cash-gl' },
    });
    expect(db.cashDeskEntry.aggregate).not.toHaveBeenCalled();
  });
  it.each([
    'cash history',
    'balance',
    'opening',
    'ledger',
    'desk',
    'bank kind',
    'desk kind',
    'stale',
    'movements',
    'scope',
    'permission',
    'precision',
  ])('rejects %s before any balance or mapping is written', async (issue) => {
    const { service, db, bank, account, gl } = initial();
    const b = bank as any,
      a = account as any;
    const payload = { ...input };
    let actor = user;
    if (issue === 'cash history') b._count.customerPayments = 1;
    if (issue === 'balance') b.currentBalance = d(1);
    if (issue === 'opening') b.openingBalance = d(1);
    if (issue === 'ledger') b.ledgerAccountId = gl.id;
    if (issue === 'desk') a.erpCashAccountId = 'other-bank';
    if (issue === 'bank kind') b.accountType = 'BANK';
    if (issue === 'desk kind') a.kind = 'BANK';
    if (issue === 'stale') a.balance = d(42);
    if (issue === 'movements')
      db.cashDeskEntry.aggregate.mockResolvedValue({ _sum: { amount: d(42) } });
    if (issue === 'scope') b.companyId = 'other-company';
    if (issue === 'permission') actor = { ...user, permissions: ['cash_desk.view'] };
    if (issue === 'precision') payload.confirmedDeskBalance = '167693000.001';
    await expect(service.connect(actor, payload)).rejects.toThrow();
    expect(db.cashAccount.update).not.toHaveBeenCalled();
    expect(db.cashDeskAccount.update).not.toHaveBeenCalled();
  });
  it('recognizes an exact retry without writing a second baseline and refuses to reset a spent balance', async () => {
    const { service, bank, account, db } = initial();
    Object.assign(bank, {
      ledgerAccountId: 'cash-gl',
      currentBalance: d(input.confirmedDeskBalance),
    });
    Object.assign(account, { erpCashAccountId: 'bank1' });
    db.cashAccount.findUnique.mockImplementation(async () => bank);
    await expect(service.connect(user, input)).resolves.toEqual({ connected: true });
    expect(db.cashAccount.update).not.toHaveBeenCalled();
    (bank as any).currentBalance = d(12);
    await expect(service.connect(user, input)).rejects.toThrow('first connecting');
    expect(db.cashAccount.update).not.toHaveBeenCalled();
  });
  it('propagates audit failure so the enclosing transaction rolls back the setup', async () => {
    const { service, audit } = initial();
    audit.logStrictInTransaction.mockRejectedValue(new Error('Audit unavailable'));
    await expect(service.connect(user, input)).rejects.toThrow('Audit unavailable');
  });
});
