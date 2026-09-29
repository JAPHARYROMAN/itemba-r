import { Prisma } from '@prisma/client';
import { BusinessReportsService } from './business-reports.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
const user = {
  id: 'reader',
  permissions: ['sales.view', 'payables.view', 'cash_accounts.view'],
} as AuthUser;
function fixture() {
  const rows = [
    {
      id: 'sale',
      salesOrderNumber: 'SO-1',
      customerName: 'Customer',
      orderDate: new Date('2026-09-01'),
      currency: 'TZS',
      totalAmount: new Prisma.Decimal('9007199254740991.99'),
      paidAmount: new Prisma.Decimal('0.30'),
      outstandingAmount: new Prisma.Decimal('9007199254740991.69'),
      status: 'CONFIRMED',
    },
  ];
  const tx = {
    salesOrder: { findMany: jest.fn().mockResolvedValue(rows) },
    payable: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const db = { $transaction: jest.fn().mockImplementation((work) => work(tx)) };
  const companies = { companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'permitted' }) };
  const org = { recordWhereFor: jest.fn().mockResolvedValue({ branchId: 'branch' }) };
  return {
    rows,
    tx,
    db,
    service: new BusinessReportsService(db as never, companies as never, org as never),
  };
}
describe('Shared business reports', () => {
  it('totals canonical records with exact decimal money and access constraints', async () => {
    const f = fixture();
    const result = await f.service.read(user, {
      kind: 'sales',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(result.totals[0].balance.toFixed(2)).toBe('9007199254740991.69');
    const where = f.tx.salesOrder.findMany.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ companyId: 'permitted' });
    expect(where.AND).toContainEqual({ branchId: 'branch' });
    expect(where.status.notIn).toEqual(['DRAFT', 'CANCELLED']);
    expect(result.basis).toContain('balances are current');
  });
  it('never combines currencies', async () => {
    const f = fixture();
    f.rows.push({ ...f.rows[0], id: 'other', currency: 'USD' });
    const result = await f.service.read(user, { kind: 'sales' });
    expect(result.totals.map((t) => t.currency)).toEqual(['TZS', 'USD']);
    expect(result.totals.every((t) => t.count === 1)).toBe(true);
  });
  it('denies a report whose underlying permission is absent', async () => {
    const f = fixture();
    await expect(f.service.read(user, { kind: 'customers' })).rejects.toThrow('cannot read');
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it.each([
    ['2026-10-01', '2026-09-01'],
    ['2026-02-30', undefined],
    ['invalid', undefined],
  ])('rejects invalid or reversed dates %s %s', async (from, to) => {
    const f = fixture();
    await expect(f.service.read(user, { kind: 'sales', from, to })).rejects.toThrow();
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('fails explicitly rather than exporting incomplete totals', async () => {
    const f = fixture();
    f.tx.salesOrder.findMany.mockResolvedValue(Array(20001).fill(f.rows[0]));
    await expect(f.service.read(user, { kind: 'sales' })).rejects.toThrow('20,000');
  });
  it('uses payables, excluding cancelled balances, without adding supplier invoices again', async () => {
    const f = fixture();
    await f.service.read(user, { kind: 'suppliers' });
    expect(f.tx.payable.findMany.mock.calls[0][0].where.status).toEqual({ not: 'CANCELLED' });
    expect(f.tx.salesOrder.findMany).not.toHaveBeenCalled();
  });
});
