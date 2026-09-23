import { Prisma } from '@prisma/client';
import { InvoiceDeskService } from './invoice-desk.service';
import { SalesDeskService } from '../sales-desk/sales-desk.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
const user = { id: 'u', email: 'u@test.local', permissions: [], roles: [] } as AuthUser;
describe('Desk report scope and dates', () => {
  it.each(['sales', 'invoices'])(
    '%s summary retains scope, dates and search without rounding money',
    async (kind) => {
      const findMany = jest.fn().mockResolvedValue([
        {
          customerId: 'c',
          supplierId: 's',
          customer: { name: 'Customer' },
          supplier: { name: 'Supplier' },
          currency: 'TZS',
          totalAmount: new Prisma.Decimal('9007199254740993.11'),
          paidAmount: new Prisma.Decimal('0.10'),
          dueDate: new Date('2020-01-01'),
        },
      ]);
      const table = { findMany, fields: { totalAmount: 'amount-field' } };
      const db = { salesDeskSale: table, invoiceDeskInvoice: table };
      const companies = { companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'allowed' }) };
      const org = {
        recordWhereFor: jest.fn().mockResolvedValue({ branchId: { in: ['allowed-branch'] } }),
      };
      // Narrow mocks deliberately cover only the read path under test.
      const service =
        kind === 'sales'
          ? new SalesDeskService(
              db as never,
              companies as never,
              org as never,
              {} as never,
              {} as never,
            )
          : new InvoiceDeskService(db as never, companies as never, org as never, {} as never);
      const result = await service.overview(user, {
        companyId: 'allowed',
        divisionId: 'division',
        branchId: 'allowed-branch',
        from: '2026-09-01',
        to: '2026-09-18',
        search: 'text',
        status: 'unpaid',
        page: 1,
      });
      expect(companies.companyWhereFor).toHaveBeenCalledWith(user, 'allowed');
      expect(org.recordWhereFor).toHaveBeenCalledWith(user);
      const where = findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('allowed-branch');
      expect(JSON.stringify(where)).toContain('2026-09-01T00:00:00.000Z');
      expect(JSON.stringify(where)).toContain('2026-09-18T00:00:00.000Z');
      expect(JSON.stringify(where)).toContain('text');
      expect(where.AND).toContainEqual({ voidedAt: null });
      expect(result.currencies[0].outstanding.toFixed(2)).toBe('9007199254740993.01');
    },
  );
  it('rejects inverted invoice date ranges before reading the database', async () => {
    const findMany = jest.fn();
    const service = new InvoiceDeskService(
      { invoiceDeskInvoice: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.overview(user, { from: '2026-09-20', to: '2026-09-01', page: 1 }),
    ).rejects.toThrow('Start date');
    expect(findMany).not.toHaveBeenCalled();
  });
});
