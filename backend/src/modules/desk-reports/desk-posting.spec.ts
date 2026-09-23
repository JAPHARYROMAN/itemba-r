import { Prisma } from '@prisma/client';
import { DeskPostingSource, postingStatus, sourceFingerprint } from './desk-posting.domain';
import { DeskPostingService } from './desk-posting.service';
const source: DeskPostingSource = {
  id: 's1',
  kind: 'sales',
  companyId: 'c1',
  divisionId: 'd1',
  branchId: 'b1',
  reference: 'INV-1',
  currency: 'TZS',
  date: '2026-09-18',
  amount: '250.00',
  partyId: 'customer1',
  voided: false,
};
const journal = () => ({
  companyId: 'c1',
  id: 'j1',
  status: 'POSTED',
  description: `Sales Desk INV-1 [desk-source:${sourceFingerprint(source)}]`,
  totalDebit: new Prisma.Decimal(250),
  totalCredit: new Prisma.Decimal(250),
  transactionDate: new Date(source.date),
  reversalOfId: null,
});
describe('Desk posting evidence', () => {
  it('distinguishes posted, unposted and duplicate documents', () => {
    expect(postingStatus(source, [])).toBe('Unposted');
    expect(postingStatus(source, [journal()])).toBe('Posted');
    expect(postingStatus(source, [journal(), { ...journal(), id: 'j2' }])).toBe('Duplicate');
  });
  it('flags changed, voided and reversed sources instead of silently reposting', () => {
    expect(postingStatus({ ...source, amount: '300.00' }, [journal()])).toBe('Changed');
    expect(postingStatus({ ...source, voided: true }, [journal()])).toBe('Changed');
    expect(postingStatus(source, [{ ...journal(), status: 'REVERSED' }])).toBe('Needs review');
    expect(postingStatus(source, [{ ...journal(), totalDebit: new Prisma.Decimal(200) }])).toBe(
      'Changed',
    );
  });
});
describe('Desk posting transaction', () => {
  const user = { id: 'u1', permissions: ['sales_desk.view'] } as any;
  function setup(existing: unknown[] = []) {
    const db: any = {
      $queryRaw: jest.fn(),
      salesDeskSale: {
        findMany: jest.fn(async () => [
          {
            ...source,
            saleNumber: source.reference,
            saleDate: new Date(source.date),
            totalAmount: new Prisma.Decimal(source.amount),
            customerId: source.partyId,
            voidedAt: null,
          },
        ]),
      },
      journalEntry: { findMany: jest.fn(async () => existing) },
      companyProfile: { findUnique: jest.fn(async () => ({ currency: 'TZS' })) },
      chartOfAccount: {
        findMany: jest.fn(async () => [
          { id: 'a1', accountType: 'ASSET' },
          { id: 'a2', accountType: 'INCOME' },
        ]),
      },
    };
    db.$transaction = jest.fn(async (callback: any) => callback(db));
    const companies = {
      companyWhereFor: jest.fn(async () => ({})),
      assertCanAccessCompany: jest.fn(),
    };
    const org = { recordWhereFor: jest.fn(async () => ({})), assertCanAccessScope: jest.fn() };
    const engine = { postLines: jest.fn(async () => ({ id: 'j1', journalNumber: 'JE-1' })) };
    const audit = { logStrictInTransaction: jest.fn() };
    return {
      db,
      engine,
      companies,
      org,
      audit,
      service: new DeskPostingService(
        db,
        companies as any,
        org as any,
        engine as any,
        audit as any,
      ),
    };
  }
  const input = {
    fingerprint: sourceFingerprint(source),
    debitAccountId: 'a1',
    creditAccountId: 'a2',
  };
  it('posts exact balanced values with source reference, write scope and transactional audit', async () => {
    const { service, db, engine, audit, companies, org } = setup();
    await expect(service.post(user, 'sales', source.id, input)).resolves.toEqual({
      id: 'j1',
      journalNumber: 'JE-1',
    });
    expect(companies.assertCanAccessCompany).toHaveBeenCalledWith(user, 'c1', 'WRITE');
    expect(org.assertCanAccessScope).toHaveBeenCalledWith(user, 'd1', 'b1', 'WRITE');
    expect(engine.postLines).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceType: 'DeskSale',
        referenceId: 's1',
        lines: [
          { accountId: 'a1', debit: new Prisma.Decimal(250) },
          { accountId: 'a2', credit: new Prisma.Decimal(250) },
        ],
      }),
      db,
    );
    expect(audit.logStrictInTransaction).toHaveBeenCalled();
  });
  it('blocks duplicate journals and stale previews', async () => {
    const existing = setup([journal()]);
    await expect(existing.service.post(user, 'sales', 's1', input)).rejects.toThrow(
      'already has a journal',
    );
    expect(existing.engine.postLines).not.toHaveBeenCalled();
    const fresh = setup();
    await expect(
      fresh.service.post(user, 'sales', 's1', { ...input, fingerprint: 'stale' }),
    ).rejects.toThrow('source changed');
  });
  it('blocks currency mismatch and unauthorized source access', async () => {
    const { service, db, engine } = setup();
    db.companyProfile.findUnique.mockResolvedValue({ currency: 'USD' });
    await expect(service.post(user, 'sales', 's1', input)).rejects.toThrow('currencies must match');
    await expect(service.post({ ...user, permissions: [] }, 'sales', 's1', input)).rejects.toThrow(
      'Source app access',
    );
    expect(engine.postLines).not.toHaveBeenCalled();
  });
});
