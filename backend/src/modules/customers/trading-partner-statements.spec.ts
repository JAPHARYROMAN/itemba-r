import { Prisma } from '@prisma/client';
import { CustomersService } from './customers.service';
import { SuppliersService } from '../suppliers/suppliers.service';

const user = { id: 'user' } as any;
const decimal = (value: number) => new Prisma.Decimal(value);
const zero = decimal(0);

describe.each(['customer', 'supplier'] as const)('%s 360 saved statements', (kind) => {
  function setup(incomplete = false, currencies = ['TZS', 'TZS']) {
    const runs = currencies.map((currency, index) => ({
      id: `run-${index}`,
      companyId: 'company',
      [`${kind}Id`]: 'party',
      statementRunNumber: `STAT-${index}`,
      currency,
      periodStart: new Date(index === 0 ? '2026-01-01' : '2026-02-01'),
      periodEnd: new Date(index === 0 ? '2026-01-31' : '2026-02-28'),
      openingBalance: decimal(999),
      totalDebits: decimal(999),
      totalCredits: zero,
      closingBalance: decimal(1998),
      generatedBy: { id: 'user', fullName: 'Reviewer' },
    }));
    const multiplier = (currency: string) => (currency === 'USD' ? 10 : 1);
    const documents = jest.fn().mockImplementation(({ where }) => {
      const scale = multiplier(where.currency);
      return Promise.resolve([
        {
          id: 'document',
          [kind === 'customer' ? 'receivableNumber' : 'payableNumber']: 'DOC-1',
          amount: decimal(100 * scale),
          paidAmount: decimal((incomplete ? 55 : 50) * scale),
          outstandingAmount: decimal((incomplete ? 45 : 50) * scale),
          issueDate: new Date('2026-01-10'),
          dueDate: null,
          status: 'PARTIALLY_PAID',
        },
      ]);
    });
    const payments = jest.fn().mockImplementation(({ where }) => {
      const scale = multiplier(where.currency);
      return Promise.resolve([
        {
          id: 'payment-1',
          paymentNumber: 'PMT-1',
          paymentDate: new Date('2026-02-10'),
          amount: decimal(20 * scale),
          status: 'COMPLETED',
          allocations: [
            {
              [kind === 'customer' ? 'receivableId' : 'payableId']: 'document',
              amount: decimal(20 * scale),
            },
          ],
        },
        {
          id: 'payment-2',
          paymentNumber: 'PMT-2',
          paymentDate: new Date('2026-03-10'),
          amount: decimal(30 * scale),
          status: 'COMPLETED',
          allocations: [
            {
              [kind === 'customer' ? 'receivableId' : 'payableId']: 'document',
              amount: decimal(30 * scale),
            },
          ],
        },
      ]);
    });
    const runQuery = jest.fn().mockResolvedValue(runs);
    const scope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) };
    const prisma: any = {
      [kind === 'customer' ? 'receivable' : 'payable']: { findMany: documents },
      [`${kind}Payment`]: { findMany: payments },
      [`${kind}StatementRun`]: { findMany: runQuery },
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
      creditNote: { findMany: jest.fn().mockResolvedValue([]) },
      refund: { findMany: jest.fn().mockResolvedValue([]) },
      customerPriceAgreement: { findMany: jest.fn().mockResolvedValue([]) },
      supplierPerformanceProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service =
      kind === 'customer'
        ? new CustomersService(prisma, { log: jest.fn() } as any, scope as any)
        : new SuppliersService(prisma, { log: jest.fn() } as any, scope as any);
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 'party', companyId: 'company', creditLimit: 0 } as any);
    jest.spyOn(service, 'ledger').mockResolvedValue({ events: [] } as any);
    if (kind === 'customer') {
      jest
        .spyOn(service as CustomersService, 'salesSummary')
        .mockResolvedValue({ totals: {}, recentSalesOrders: [] } as any);
      jest.spyOn(service as CustomersService, 'receivablesSummary').mockResolvedValue({
        totals: { openReceivableBalance: 50 },
        openReceivables: [],
        recentReceivables: [],
      } as any);
      jest.spyOn(service as CustomersService, 'productHistory').mockResolvedValue([] as any);
    } else {
      jest
        .spyOn(service as SuppliersService, 'purchaseSummary')
        .mockResolvedValue({ totals: {}, recentPurchaseOrders: [] } as any);
      jest
        .spyOn(service as SuppliersService, 'payablesSummary')
        .mockResolvedValue({ totals: {}, openPayables: [], recentPayables: [] } as any);
      jest.spyOn(service as any, 'productCoverage').mockResolvedValue([]);
    }
    return { service, documents, payments, runs, scope, runQuery };
  }

  it('projects dated period balances and preserves saved evidence on profile reads', async () => {
    const { service, documents, runQuery } = setup();
    const result = await service.controlCenter('party', user);
    const [january, february] = result.latestStatements;
    expect(january.openingBalance.toString()).toBe('0');
    expect(january.totalDebits.toString()).toBe('100');
    expect(january.totalCredits.toString()).toBe('0');
    expect(january.closingBalance.toString()).toBe('100');
    expect(february.openingBalance.toString()).toBe('100');
    expect(february.totalDebits.toString()).toBe('0');
    expect(february.totalCredits.toString()).toBe('20');
    expect(february.closingBalance.toString()).toBe('80');
    expect(february.storedBalances.closingBalance.toString()).toBe('1998');
    expect(february.datedBalances.closingBalance.toString()).toBe('80');
    expect(february.settlementHistory.status).toBe('COMPLETE');
    expect(february.generatedBy.fullName).toBe('Reviewer');
    // Two saved periods share one evidence set, avoiding repeated history reads.
    expect(documents).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company', [`${kind}Id`]: 'party' },
        take: 10,
      }),
    );
  });

  it('exposes provisional dated balances and explicit gaps in incomplete profile history', async () => {
    const { service } = setup(true);
    const result = await service.controlCenter('party', user);
    const february = result.latestStatements[1];
    expect(february.closingBalance.toString()).toBe('80');
    expect(february.storedBalances.closingBalance.toString()).toBe('1998');
    expect(february.settlementHistory).toMatchObject({
      status: 'INCOMPLETE',
      unresolvedAmount: '5.00',
      gaps: [{ documentId: 'document', amount: '5.00' }],
    });
  });

  it('keeps each saved run currency scoped during profile projection', async () => {
    const { service, documents, payments } = setup(false, ['USD', 'TZS']);
    const result = await service.controlCenter('party', user);
    expect(result.latestStatements[0].currency).toBe('USD');
    expect(result.latestStatements[0].closingBalance.toString()).toBe('1000');
    expect(result.latestStatements[1].currency).toBe('TZS');
    expect(result.latestStatements[1].closingBalance.toString()).toBe('80');
    for (const query of [documents, payments]) {
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'company',
            [`${kind}Id`]: 'party',
            currency: 'USD',
          }),
        }),
      );
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'company',
            [`${kind}Id`]: 'party',
            currency: 'TZS',
          }),
        }),
      );
    }
  });

  it('rejects a run from an inaccessible company before reading its financial evidence', async () => {
    const { service, scope, documents, runs } = setup();
    runs[0].companyId = 'foreign';
    scope.assertCanAccessCompany.mockImplementation((_: any, companyId: string) =>
      companyId === 'foreign'
        ? Promise.reject(new Error('Company inaccessible'))
        : Promise.resolve(undefined),
    );
    await expect(service.controlCenter('party', user)).rejects.toThrow('Company inaccessible');
    expect(documents).not.toHaveBeenCalled();
  });
});
