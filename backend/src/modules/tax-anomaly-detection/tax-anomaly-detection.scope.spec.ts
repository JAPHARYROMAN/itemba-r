import { ForbiddenException } from '@nestjs/common';
import { TaxAnomalyDetectionService } from './tax-anomaly-detection.service';

const USER = {
  id: 'user-a',
  companyId: 'company-a',
  companyAccess: [],
  roleScopes: ['COMPANY'],
} as any;

describe('TaxAnomalyDetectionService scope', () => {
  it('rejects a foreign requested company before any anomaly query executes', async () => {
    const service = new TaxAnomalyDetectionService({} as any);

    await expect(service.scan({ companyId: 'company-b' }, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('applies the authenticated company predicate to every cheap-tier source', async () => {
    const customerFindMany = jest.fn().mockResolvedValue([]);
    const supplierFindMany = jest.fn().mockResolvedValue([]);
    const filingFindMany = jest.fn().mockResolvedValue([]);
    const payrollFindMany = jest.fn().mockResolvedValue([]);
    const salesFindMany = jest.fn().mockResolvedValue([]);
    const transactionFindMany = jest.fn().mockResolvedValue([]);
    const returnFindMany = jest.fn().mockResolvedValue([]);
    const service = new TaxAnomalyDetectionService({
      customer: { findMany: customerFindMany },
      supplier: { findMany: supplierFindMany },
      taxFilingPeriod: { findMany: filingFindMany },
      payrollRun: { findMany: payrollFindMany },
      salesOrder: { findMany: salesFindMany },
      taxTransaction: { findMany: transactionFindMany },
      taxReturn: { findMany: returnFindMany },
    } as any);

    await expect(service.scan({ companyId: 'company-a' }, USER)).resolves.toEqual(
      expect.objectContaining({ total: 0, anomalies: [] }),
    );

    for (const query of [
      customerFindMany,
      supplierFindMany,
      filingFindMany,
      payrollFindMany,
      salesFindMany,
      returnFindMany,
    ]) {
      for (const [args] of query.mock.calls) {
        expect(args.where).toEqual(expect.objectContaining({ companyId: 'company-a' }));
      }
    }
    expect(transactionFindMany).not.toHaveBeenCalled();
  });
});
