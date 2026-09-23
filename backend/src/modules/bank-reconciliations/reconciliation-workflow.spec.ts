import { Prisma } from '@prisma/client';
import { BankReconciliationsService } from './bank-reconciliations.service';
const d = (value: number) => new Prisma.Decimal(value);
const user = { id: 'checker', companyId: 'c1', permissions: [] } as any;
function setup() {
  const line = {
    id: 'l1',
    transactionDate: new Date('2026-09-18'),
    description: 'Deposit',
    reference: 'DEP1',
    debitAmount: d(0),
    creditAmount: d(100),
    matched: true,
    matches: [{ amount: d(100) }],
  };
  const record: any = {
    id: 'r1',
    companyId: 'c1',
    cashAccountId: 'cash1',
    currency: 'TZS',
    status: 'DRAFT',
    preparedById: 'maker',
    statementStartDate: new Date('2026-09-01'),
    statementEndDate: new Date('2026-09-30'),
    statementOpeningBalance: d(0),
    statementClosingBalance: d(100),
    bookOpeningBalance: d(0),
    bookClosingBalance: d(100),
    differenceAmount: d(0),
    statementLines: [line],
    matches: [
      {
        bankStatementLineId: 'l1',
        matchedEntityType: 'JournalEntryLine',
        matchedEntityId: 'j1',
        amount: d(100),
      },
    ],
  };
  const journal = {
    id: 'j1',
    companyId: 'c1',
    accountId: 'a1',
    debit: d(100),
    credit: d(0),
    journalEntry: { companyId: 'c1', status: 'POSTED', deletedAt: null },
  };
  const db: any = {
    companyProfile: { findUnique: jest.fn(async () => ({ currency: 'TZS' })) },
    $queryRaw: jest.fn(),
    bankReconciliation: {
      findFirst: jest.fn(async () => record),
      findUniqueOrThrow: jest.fn(async () => record),
      update: jest.fn(async (args: any) => ({ ...record, ...args.data })),
    },
    cashAccount: {
      findFirst: jest.fn(async () => ({
        currency: 'TZS',
        accountType: 'BANK',
        isActive: true,
        ledgerAccount: { id: 'a1', companyId: 'c1', isActive: true, accountType: 'ASSET' },
      })),
    },
    journalEntryLine: { findMany: jest.fn(async () => [journal]) },
    bankReconciliationMatch: { count: jest.fn(async () => 0) },
    bankStatementLine: { createMany: jest.fn(async () => ({ count: 1 })) },
  };
  db.$transaction = jest.fn(async (callback: any) => callback(db));
  const audit: any = { log: jest.fn(), logStrictInTransaction: jest.fn() };
  const service = new BankReconciliationsService(
    db,
    audit,
    { resolve: jest.fn(async () => ({ id: 'a1' })) } as any,
    {} as any,
  );
  return { service, record, journal, db, audit };
}
describe('Reconciliation workflow evidence', () => {
  it('keeps the original journal in the books when a dated reversal exists', async () => {
    const { service, journal, db } = setup();
    journal.journalEntry.status = 'REVERSED';
    expect((await service.evidence('r1', user)).ready).toBe(true);
    expect(db.journalEntryLine.findMany.mock.calls[0][0].where.OR[1].journalEntry.status).toEqual({
      in: ['POSTED', 'REVERSED'],
    });
  });
  it('requires a dedicated mapping instead of silently using the company bank role', async () => {
    const { service, db } = setup();
    db.cashAccount.findFirst.mockResolvedValue({
      currency: 'TZS',
      accountType: 'BANK',
      ledgerAccount: null,
    });
    const evidence = await service.evidence('r1', user);
    expect(evidence.ready).toBe(false);
    expect(evidence.issues.join(' ')).toContain('own active');
    expect(db.journalEntryLine.findMany).not.toHaveBeenCalled();
  });
  it('blocks foreign-currency reconciliation against a base-currency ledger', async () => {
    const { service, db } = setup();
    db.companyProfile.findUnique.mockResolvedValue({ currency: 'USD' });
    expect((await service.evidence('r1', user)).issues.join(' ')).toContain('foreign-currency');
  });
  it('approves only when fresh evidence agrees and recalculates the stored balance', async () => {
    const { service, db } = setup();
    await expect(service.approve('r1', user)).resolves.toMatchObject({
      status: 'APPROVED',
      differenceAmount: 0,
      reconciledBalance: '100.0000',
    });
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it('rejects a stored zero difference with missing matches', async () => {
    const { service, record, db } = setup();
    record.matches = [];
    await expect(service.approve('r1', user)).rejects.toThrow('exactly one');
    expect(db.bankReconciliation.update).not.toHaveBeenCalled();
  });
  it('rejects a draft journal and a reused match', async () => {
    const { service, journal, db } = setup();
    journal.journalEntry.status = 'DRAFT';
    db.bankReconciliationMatch.count.mockResolvedValue(1);
    const result = await service.evidence('r1', user);
    expect(result.ready).toBe(false);
    expect(result.issues.join(' ')).toContain('another reconciliation');
    expect(result.issues.join(' ')).toContain('journal status');
  });
  it('preserves maker-checker and rechecks before close', async () => {
    const { service, record } = setup();
    await expect(service.approve('r1', { ...user, id: 'maker' })).rejects.toThrow('Maker-checker');
    record.status = 'APPROVED';
    record.statementClosingBalance = d(101);
    await expect(service.close('r1', user)).rejects.toThrow('closing balance');
  });
  it('imports valid lines once and skips duplicates within the file and existing statement', async () => {
    const { service, db, audit } = setup();
    const row = {
      transactionDate: '2026-09-18',
      description: 'Deposit',
      reference: 'DEP1',
      debitAmount: '0',
      creditAmount: '100.0000',
    };
    const fresh = { ...row, reference: 'DEP2' };
    await expect(
      service.importStatement('r1', { rows: [row, fresh, fresh] }, user),
    ).resolves.toEqual({ imported: 1, skipped: 2 });
    expect(db.bankStatementLine.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(audit.logStrictInTransaction).toHaveBeenCalled();
  });
  it('rejects an invalid batch before writing any lines and prevents approved imports', async () => {
    const { service, record, db } = setup();
    const row = {
      transactionDate: '2026-08-18',
      description: 'Deposit',
      debitAmount: '0',
      creditAmount: '100',
    };
    await expect(service.importStatement('r1', { rows: [row] }, user)).rejects.toThrow('inside');
    expect(db.bankStatementLine.createMany).not.toHaveBeenCalled();
    record.status = 'APPROVED';
    await expect(service.importStatement('r1', { rows: [row] }, user)).rejects.toThrow('draft');
  });
});
