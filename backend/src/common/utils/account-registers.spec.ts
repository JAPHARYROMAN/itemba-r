import { Prisma } from '@prisma/client';
import { PayablesService } from '../../modules/payables/payables.service';
import { ReceivablesService } from '../../modules/receivables/receivables.service';
import { SalesOrdersService } from '../../modules/sales-orders/sales-orders.service';
import { PurchaseOrdersService } from '../../modules/purchase-orders/purchase-orders.service';
import { RecordsService } from '../../modules/records/records.service';

const user = { id: 'user-a' } as any;
const scope = {
  companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-a' }),
  accessibleCompanyIds: jest.fn().mockResolvedValue(['company-a']),
};
const records = Array.from({ length: 7 }, (_, i) => ({
  id: `doc-${i}`,
  companyId: 'company-a',
  supplierId: 'supplier-a',
  customerId: 'customer-a',
  supplierName: 'Creditor A',
  customerName: 'Customer A',
  supplier: { name: 'Creditor A' },
  customer: { name: 'Customer A' },
  amount: new Prisma.Decimal('10.10'),
  totalAmount: new Prisma.Decimal('10.10'),
  paidAmount: new Prisma.Decimal('0.10'),
  outstandingAmount: new Prisma.Decimal('10.00'),
  company: { name: 'Company A' },
  currency: 'USD',
  issueDate: new Date('2026-10-01'),
  orderDate: new Date('2026-10-01'),
  expectedDate: new Date('2020-01-01'),
  status: 'OPEN',
  receivableId: null,
}));

describe('Consolidated register access and pagination', () => {
  it.each(['payables', 'receivables', 'sales', 'purchases'] as const)(
    '%s combines all authorized records before the account page limit',
    async (kind) => {
      const model = {
        findMany: jest.fn(async (_query: any) => records),
        count: jest.fn().mockResolvedValue(7),
      };
      const db = {
        payable: model,
        receivable: { ...model },
        salesOrder: model,
        purchaseOrder: model,
      } as any;
      let result: any;
      if (kind === 'payables')
        result = await new PayablesService(
          db,
          {} as any,
          scope as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        ).findAccounts({ limit: 1 }, user);
      else if (kind === 'receivables')
        result = await new ReceivablesService(
          db,
          {} as any,
          scope as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        ).findAccounts({ limit: 1 }, user);
      else if (kind === 'sales') {
        db.receivable.findMany = jest.fn().mockResolvedValue([]);
        result = await new SalesOrdersService(
          db,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
          scope as any,
          {} as any,
          {} as any,
          {} as any,
        ).findAll({ view: 'accounts', limit: 1 }, user);
      } else
        result = await new PurchaseOrdersService(
          db,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
          scope as any,
          {} as any,
          {} as any,
          {} as any,
        ).findAll({ view: 'accounts', limit: 1 }, user);
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: ['payables', 'receivables'].includes(kind)
              ? { in: ['company-a'] }
              : 'company-a',
            deletedAt: null,
          }),
        }),
      );
      expect(model.findMany.mock.calls[0][0]).not.toHaveProperty('take');
      expect(result).toMatchObject({ total: 1, totalPages: 1 });
      expect(result.data[0]).toMatchObject({
        documentCount: 7,
        amount: 70.7,
        outstandingAmount: 70,
      });
      expect(result.data[0].documents).toHaveLength(7);
      if (kind === 'purchases') {
        expect(result.data[0]).toMatchObject({ overdueAmount: 0, nextDueDate: null });
      }
    },
  );
  it('keeps personal/organization access checks in the consolidated notebook query', async () => {
    const rows = records.map((record) => ({
      ...record,
      ownerId: user.id,
      kind: 'CREDITOR',
      counterparty: 'Creditor A',
      settledAmount: record.paidAmount,
      recordDate: record.issueDate,
      dueDate: null,
      voidedAt: null,
    }));
    const model = {
      findMany: jest.fn(async (_query: any) => rows),
      count: jest.fn().mockResolvedValue(7),
      fields: { amount: 'amount' },
    };
    const db = { recordEntry: model, $transaction: jest.fn(async (calls) => Promise.all(calls)) };
    const companies = { ...scope, assertCanAccessCompany: jest.fn() };
    const org = { recordWhereFor: jest.fn().mockResolvedValue({ branchId: 'branch-a' }) };
    const result = await new RecordsService(
      db as any,
      companies as any,
      org as any,
      {} as any,
      {} as any,
    ).list(user, { view: 'accounts', kind: 'CREDITOR', page: 1 });
    const where = model.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('branch-a');
    expect(JSON.stringify(where)).toContain('user-a');
    expect(result).toMatchObject({ total: 1, pageSize: 25 });
    expect(result.rows[0]).toMatchObject({ documentCount: 7, outstandingAmount: 70 });
  });
});
