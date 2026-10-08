import { describe, expect, it } from 'vitest';
import {
  businessTransactionSnapshot,
  consolidateTransactions,
  formatAccountMoney,
} from './account-consolidation';

const row = (id: string, changes = {}) => ({
  id,
  companyId: 'company-a',
  supplierId: 'supplier-a',
  supplierName: 'Creditor A',
  currency: 'USD',
  totalAmount: '10.10',
  paidAmount: '0.10',
  outstandingAmount: '10.00',
  status: 'APPROVED',
  ...changes,
});
describe('Supplemental register consolidation', () => {
  it('combines seven records with exact cents', () => {
    const [account] = consolidateTransactions(
      Array.from({ length: 7 }, (_, i) => row(String(i))),
      businessTransactionSnapshot,
    );
    expect(account).toMatchObject({
      amount: '70.70',
      paidAmount: '0.70',
      outstandingAmount: '70.00',
      documentCount: 7,
    });
    expect(account.documents).toHaveLength(7);
  });
  it('keeps money exact beyond the safe integer range', () => {
    const [account] = consolidateTransactions(
      [row('1', { totalAmount: '9999999999999999.99' }), row('2', { totalAmount: '0.01' })],
      businessTransactionSnapshot,
    );
    expect(account.amount).toBe('10000000000000000.00');
    expect(formatAccountMoney(account.amount, 'USD')).toBe('USD 10,000,000,000,000,000.00');
  });
  it('separates company, currency, party ID and unlinked names', () => {
    const accounts = consolidateTransactions(
      [
        row('1'),
        row('2', { companyId: 'company-b' }),
        row('3', { currency: 'TZS' }),
        row('4', { supplierId: 'supplier-b' }),
        row('5', { supplierId: null }),
      ],
      businessTransactionSnapshot,
    );
    expect(accounts).toHaveLength(5);
  });
  it('keeps voided documents inspectable with no contribution to money', () => {
    const [account] = consolidateTransactions(
      [row('1'), row('2', { status: 'VOIDED' })],
      businessTransactionSnapshot,
    );
    expect(account).toMatchObject({
      amount: '10.10',
      outstandingAmount: '10.00',
      documentCount: 2,
      openDocumentCount: 1,
    });
  });
  it('rejects invalid amounts instead of displaying an understated total', () => {
    expect(() =>
      consolidateTransactions([row('1', { totalAmount: 'invalid' })], businessTransactionSnapshot),
    ).toThrow('invalid monetary value');
  });
  it('uses the shared party ID for older desk aliases', () => {
    const records = [
      row('1', {
        supplierId: 'desk-a',
        supplier: { canonicalSupplierId: 'master-a', name: 'Creditor A' },
      }),
      row('2', {
        supplierId: 'desk-b',
        supplier: { canonicalSupplierId: 'master-a', name: 'Creditor A' },
      }),
    ];
    expect(consolidateTransactions(records, businessTransactionSnapshot)).toHaveLength(1);
  });
});
