import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TaxTransactionsService } from './tax-transactions.service';

/** Party linkage, Phase 3 PR-7: tax amounts per party from the snapshot each row carries. */
const d = (v: string) => new Prisma.Decimal(v);
function setup(groups: any[]) {
  const prisma: any = {
    taxTransaction: { groupBy: jest.fn(async () => groups) },
    supplier: {
      findMany: jest.fn(async () => [{ id: 'sup-1', name: 'Fuel Co', supplierCode: 'SUP-1' }]),
    },
    customer: {
      findMany: jest.fn(async () => [{ id: 'cus-1', name: 'Westsides', customerCode: 'CUS-1' }]),
    },
    taxType: {
      findMany: jest.fn(async () => [{ id: 'vat', name: 'Value Added Tax', taxTypeCode: 'VAT' }]),
    },
  };
  const service = new TaxTransactionsService(prisma, { log: jest.fn() } as any);
  const user = {
    id: 'u1',
    companyId: 'c1',
    role: { scope: 'COMPANY' },
    companyAccess: [{ companyId: 'c1', accessLevel: 'READ' }],
  };
  return { prisma, service, user };
}
const group = (over: Record<string, any>) => ({
  partyType: 'NONE',
  supplierId: null,
  customerId: null,
  partyTin: null,
  partyVrn: null,
  direction: 'OUTPUT',
  taxTypeId: 'vat',
  currency: 'TZS',
  _sum: { taxableAmount: d('100'), taxAmount: d('18') },
  _count: { _all: 1 },
  ...over,
});

describe('TaxTransactionsService.byParty', () => {
  it('groups by the party snapshot, names parties and tax types, keeps "No party" visible and totals per direction and currency', async () => {
    const { service, user, prisma } = setup([
      group({
        partyType: 'CUSTOMER',
        customerId: 'cus-1',
        partyTin: '123',
        partyVrn: '40-1',
        _sum: { taxableAmount: d('1000'), taxAmount: d('180') },
        _count: { _all: 3 },
      }),
      group({
        partyType: 'SUPPLIER',
        supplierId: 'sup-1',
        direction: 'INPUT',
        _sum: { taxableAmount: d('500'), taxAmount: d('90') },
        _count: { _all: 2 },
      }),
      group({}),
    ]);
    const report = await service.byParty(user, {
      companyId: 'c1',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });
    const { where, by } = prisma.taxTransaction.groupBy.mock.calls[0][0];
    expect(by).toEqual([
      'partyType',
      'supplierId',
      'customerId',
      'partyTin',
      'partyVrn',
      'direction',
      'taxTypeId',
      'currency',
    ]);
    expect(where).toMatchObject({
      deletedAt: null,
      status: { not: 'REVERSED' },
      companyId: 'c1',
      transactionDate: { gte: new Date('2026-09-01'), lte: new Date('2026-09-30') },
    });
    expect(report.rows.map((r) => [r.name, r.kind, r.direction, r.tax, r.transactions])).toEqual([
      ['Westsides', 'customer', 'OUTPUT', '180.00', 3],
      ['Fuel Co', 'supplier', 'INPUT', '90.00', 2],
      ['No party', null, 'OUTPUT', '18.00', 1],
    ]);
    expect(report.rows[0]).toMatchObject({
      partyId: 'cus-1',
      code: 'CUS-1',
      tin: '123',
      vrn: '40-1',
      taxable: '1000.00',
      taxType: { code: 'VAT', name: 'Value Added Tax' },
    });
    expect(report.untagged).toBe(1);
    expect(report.totals).toEqual([
      { direction: 'OUTPUT', currency: 'TZS', taxable: '1100.00', tax: '198.00', transactions: 4 },
      { direction: 'INPUT', currency: 'TZS', taxable: '500.00', tax: '90.00', transactions: 2 },
    ]);
  });

  it('filters by direction and rejects an invalid date without reading', async () => {
    const { service, user, prisma } = setup([]);
    const report = await service.byParty(user, { companyId: 'c1', direction: 'INPUT' });
    expect(prisma.taxTransaction.groupBy.mock.calls[0][0].where).toMatchObject({
      direction: 'INPUT',
    });
    expect(report).toMatchObject({ rows: [], untagged: 0, totals: [], direction: 'INPUT' });
    expect(prisma.supplier.findMany).not.toHaveBeenCalled();
    await expect(
      service.byParty(user, { companyId: 'c1', dateFrom: 'not-a-date' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
