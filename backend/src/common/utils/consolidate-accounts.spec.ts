import { accountPage, consolidateAccounts, type AccountDocument } from './consolidate-accounts';

const row = (
  id: string,
  change: Partial<AccountDocument<{ id: string }>> = {},
): AccountDocument<{ id: string }> => ({
  id,
  record: { id },
  companyId: 'company-a',
  partyId: 'creditor-a',
  partyName: 'Creditor A',
  currency: 'USD',
  amount: '10.10',
  paidAmount: '0.10',
  outstandingAmount: '10.00',
  issueDate: '2026-09-01',
  dueDate: '2026-10-06',
  ...change,
});
const now = new Date('2026-10-07T10:00:00Z');

describe('Account consolidation', () => {
  it('keeps seven unique transactions underneath one exact creditor total', () => {
    const [account] = consolidateAccounts(
      Array.from({ length: 7 }, (_, i) => row(`ap-${i}`)),
      now,
    );
    expect(account).toMatchObject({
      documentCount: 7,
      amount: 70.7,
      paidAmount: 0.7,
      outstandingAmount: 70,
      overdueAmount: 70,
      status: 'OVERDUE',
    });
    expect(account.documents.map((r) => r.id)).toEqual(
      Array.from({ length: 7 }, (_, i) => `ap-${i}`),
    );
  });
  it('separates companies, currencies and distinct parties with the same display name', () => {
    expect(
      consolidateAccounts(
        [
          row('1'),
          row('2', { companyId: 'company-b' }),
          row('3', { currency: 'TZS' }),
          row('4', { partyId: 'creditor-b' }),
          row('5', { partyId: null }),
        ],
        now,
      ),
    ).toHaveLength(5);
  });
  it('normalizes unlinked names but keeps unnamed documents separate', () => {
    const accounts = consolidateAccounts(
      [
        row('1', { partyId: null, partyName: '  Creditor   A ' }),
        row('2', { partyId: null, partyName: 'creditor a' }),
        row('3', { partyId: null, partyName: null }),
        row('4', { partyId: null, partyName: null }),
      ],
      now,
    );
    expect(accounts).toHaveLength(3);
    expect(accounts[0].documentCount).toBe(2);
  });
  it('keeps personal owners and debtor/creditor registers separate', () => {
    expect(
      consolidateAccounts(
        [
          row('1', { companyId: null, ownerId: 'a', kind: 'DEBTOR' }),
          row('2', { companyId: null, ownerId: 'b', kind: 'DEBTOR' }),
          row('3', { companyId: null, ownerId: 'a', kind: 'CREDITOR' }),
        ],
        now,
      ),
    ).toHaveLength(3);
  });
  it('retains voided documents without adding to totals and treats due today as current', () => {
    const [account] = consolidateAccounts(
      [row('1', { inactive: true }), row('2', { dueDate: '2026-10-07' })],
      now,
    );
    expect(account).toMatchObject({
      documentCount: 2,
      openDocumentCount: 1,
      amount: 10.1,
      overdueAmount: 0,
      status: 'PARTIALLY_PAID',
    });
    expect(account.documents).toHaveLength(2);
  });
  it('paginates the accounts after combining their documents', () => {
    const groups = consolidateAccounts([row('1'), row('2'), row('3', { partyId: 'b' })], now);
    const page = accountPage(groups, { page: 1, limit: 1 });
    expect(page).toMatchObject({ total: 2, totalPages: 2 });
    expect(page.data[0].documents).toHaveLength(2);
  });
});
