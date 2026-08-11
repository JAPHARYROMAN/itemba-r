import { BadRequestException } from '@nestjs/common';
import { AccessLevel, CurrencyCode, PayableStatus, Prisma } from '@prisma/client';
import { SupplierStatementsService } from './supplier-statements.service';

const D = (v: number | string) => new Prisma.Decimal(v);
const USER: any = { id: 'user-1', email: 'u@x.io' };
const COMPANY = 'co-1';
const SUPPLIER = 'sup-1';

const START = '2026-02-01';
const END = '2026-02-28';

/**
 * Payable fixtures. One pre-period payable rolls into the opening balance; the
 * in-period rows drive debits/credits. WRITTEN_OFF and CANCELLED rows are
 * present but must be filtered out by the query (asserted via the where clause),
 * and a foreign-currency row must be excluded by the currency scope.
 */
const PRE_PERIOD = {
  amount: D(1000),
  paidAmount: D(400),
  issueDate: new Date('2026-01-10'),
  status: PayableStatus.PARTIALLY_PAID,
  currency: CurrencyCode.TZS,
};
const IN_PERIOD_1 = {
  amount: D(5000),
  paidAmount: D(2000),
  issueDate: new Date('2026-02-05'),
  status: PayableStatus.PARTIALLY_PAID,
  currency: CurrencyCode.TZS,
};
const IN_PERIOD_2 = {
  amount: D(3000),
  paidAmount: D(3000),
  issueDate: new Date('2026-02-20'),
  status: PayableStatus.PAID,
  currency: CurrencyCode.TZS,
};

function makeService(payables: any[] = [PRE_PERIOD, IN_PERIOD_1, IN_PERIOD_2]) {
  const assertCanAccessCompany = jest.fn().mockResolvedValue(undefined);
  const created: any[] = [];
  const prisma: any = {
    supplier: {
      findFirst: jest.fn().mockResolvedValue({ id: SUPPLIER }),
    },
    payable: {
      findMany: jest.fn().mockResolvedValue(payables),
    },
    supplierStatementRun: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        created.push(data);
        return Promise.resolve({ id: 'run-1', ...data });
      }),
    },
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  const companyScope: any = { assertCanAccessCompany };
  const service = new SupplierStatementsService(prisma, audit, companyScope);
  return { service, prisma, audit, companyScope, assertCanAccessCompany };
}

const DTO = {
  companyId: COMPANY,
  supplierId: SUPPLIER,
  periodStart: START,
  periodEnd: END,
};

describe('SupplierStatementsService.generate reconciliation', () => {
  it('computes opening balance from pre-period payables only (amount − paidAmount)', async () => {
    const { service } = makeService();
    const run = await service.generate(DTO as any, USER);
    // pre-period: 1000 − 400 = 600
    expect(run.openingBalance.toFixed(2)).toBe('600.00');
  });

  it('reconciles: closingBalance === openingBalance + totalDebits − totalCredits', async () => {
    const { service } = makeService();
    const run = await service.generate(DTO as any, USER);
    // in-period debits: 5000 + 3000 = 8000
    // in-period credits: 2000 + 3000 = 5000
    expect(run.totalDebits.toFixed(2)).toBe('8000.00');
    expect(run.totalCredits.toFixed(2)).toBe('5000.00');
    const recomputed = run.openingBalance.plus(run.totalDebits).minus(run.totalCredits);
    expect(recomputed.toFixed(2)).toBe(run.closingBalance.toFixed(2));
    // closing = 600 + 8000 − 5000 = 3600
    expect(run.closingBalance.toFixed(2)).toBe('3600.00');
  });

  it('closingBalance equals total outstanding through periodEnd (subledger tie-out)', async () => {
    const { service } = makeService();
    const run = await service.generate(DTO as any, USER);
    // Σ (amount − paidAmount) over all included payables:
    // (1000−400) + (5000−2000) + (3000−3000) = 600 + 3000 + 0 = 3600
    expect(run.closingBalance.toFixed(2)).toBe('3600.00');
  });

  it('excludes WRITTEN_OFF / CANCELLED payables via the query filter', async () => {
    const { service, prisma } = makeService();
    await service.generate(DTO as any, USER);
    const where = prisma.payable.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({
      notIn: [PayableStatus.WRITTEN_OFF, PayableStatus.CANCELLED],
    });
  });

  it('scopes the run to a single currency (default TZS) and persists it', async () => {
    const { service, prisma } = makeService();
    const run = await service.generate(DTO as any, USER);
    const where = prisma.payable.findMany.mock.calls[0][0].where;
    expect(where.currency).toBe(CurrencyCode.TZS);
    expect(run.currency).toBe(CurrencyCode.TZS);
  });

  it('honours an explicit currency in the DTO', async () => {
    const { service, prisma } = makeService([]);
    const run = await service.generate({ ...DTO, currency: CurrencyCode.USD } as any, USER);
    const where = prisma.payable.findMany.mock.calls[0][0].where;
    expect(where.currency).toBe(CurrencyCode.USD);
    expect(run.currency).toBe(CurrencyCode.USD);
  });

  it('caps the payable window at periodEnd (opening + in-period only)', async () => {
    const { service, prisma } = makeService();
    await service.generate(DTO as any, USER);
    const where = prisma.payable.findMany.mock.calls[0][0].where;
    expect(where.issueDate).toEqual({ lte: new Date(END) });
    expect(where.companyId).toBe(COMPANY);
    expect(where.deletedAt).toBeNull();
    expect(where.supplierId).toBe(SUPPLIER);
  });

  it('reconciles with an empty ledger (all zero, no NaN)', async () => {
    const { service } = makeService([]);
    const run = await service.generate(DTO as any, USER);
    expect(run.openingBalance.toFixed(2)).toBe('0.00');
    expect(run.totalDebits.toFixed(2)).toBe('0.00');
    expect(run.totalCredits.toFixed(2)).toBe('0.00');
    expect(run.closingBalance.toFixed(2)).toBe('0.00');
  });

  it('enforces WRITE company access before generating', async () => {
    const assertCanAccessCompany = jest.fn().mockRejectedValue(new Error('forbidden'));
    const service = new SupplierStatementsService(
      {
        supplier: { findFirst: jest.fn() },
        payable: { findMany: jest.fn() },
        supplierStatementRun: { create: jest.fn() },
      } as any,
      { log: jest.fn() } as any,
      { assertCanAccessCompany } as any,
    );
    await expect(service.generate(DTO as any, USER)).rejects.toThrow('forbidden');
    expect(assertCanAccessCompany).toHaveBeenCalledWith(USER, COMPANY, AccessLevel.WRITE);
  });

  it('rejects a supplier outside the selected company', async () => {
    const { service, prisma } = makeService();
    prisma.supplier.findFirst.mockResolvedValue(null);
    await expect(service.generate(DTO as any, USER)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.supplierStatementRun.create).not.toHaveBeenCalled();
  });

  it('rejects periodStart after periodEnd', async () => {
    const { service } = makeService();
    await expect(
      service.generate({ ...DTO, periodStart: '2026-03-01', periodEnd: '2026-02-01' } as any, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
