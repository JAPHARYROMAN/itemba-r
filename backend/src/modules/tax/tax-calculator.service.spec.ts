import { TaxCalculatorService } from './tax-calculator.service';

describe('TaxCalculatorService', () => {
  function makeService(rows: any[]) {
    const prisma = {
      taxRate: {
        findUniqueOrThrow: async ({ where }: any) => {
          const r = rows.find((x) => x.id === where.id);
          if (!r) throw new Error('not found');
          return r;
        },
        findMany: async ({ where }: any) => {
          return rows
            .filter((r) => r.taxTypeId === where.taxTypeId)
            .filter((r) => !where.deletedAt || r.deletedAt === null)
            .filter((r) => {
              const date = where.effectiveFrom?.lte ?? new Date();
              if (r.effectiveFrom > date) return false;
              if (r.effectiveTo && r.effectiveTo < date) return false;
              return true;
            })
            .sort((a, b) => {
              if (a.companyId && !b.companyId) return -1;
              if (!a.companyId && b.companyId) return 1;
              return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
            });
        },
      },
    } as any;
    return new TaxCalculatorService(prisma);
  }

  describe('computeExclusive', () => {
    it('applies an 18% TZ VAT rate to a 1000 base correctly', async () => {
      const svc = makeService([
        {
          id: 'r1',
          taxTypeId: 'VAT',
          companyId: 'co-1',
          rate: 18,
          calculationMethod: 'PERCENTAGE',
          effectiveFrom: new Date('2020-01-01'),
          effectiveTo: null,
          deletedAt: null,
          status: 'ACTIVE',
        },
      ]);
      const got = await svc.computeExclusive({
        taxTypeId: 'VAT',
        companyId: 'co-1',
        baseAmount: 1000,
      });
      expect(got).toMatchObject({ base: 1000, tax: 180, gross: 1180, rate: 18, method: 'EXCLUSIVE' });
    });

    it('falls back to a group-level rate when no company-specific rate exists', async () => {
      const svc = makeService([
        {
          id: 'group',
          taxTypeId: 'VAT',
          companyId: null,
          rate: 18,
          calculationMethod: 'PERCENTAGE',
          effectiveFrom: new Date('2020-01-01'),
          effectiveTo: null,
          deletedAt: null,
          status: 'ACTIVE',
        },
      ]);
      const got = await svc.computeExclusive({
        taxTypeId: 'VAT',
        companyId: 'co-1',
        baseAmount: 500,
      });
      expect(got.tax).toBe(90);
    });

    it('prefers the company-specific rate when both exist', async () => {
      const svc = makeService([
        {
          id: 'group',
          taxTypeId: 'VAT',
          companyId: null,
          rate: 18,
          calculationMethod: 'PERCENTAGE',
          effectiveFrom: new Date('2020-01-01'),
          effectiveTo: null,
          deletedAt: null,
          status: 'ACTIVE',
        },
        {
          id: 'co',
          taxTypeId: 'VAT',
          companyId: 'co-1',
          rate: 0, // exempt for this company
          calculationMethod: 'PERCENTAGE',
          effectiveFrom: new Date('2020-01-01'),
          effectiveTo: null,
          deletedAt: null,
          status: 'ACTIVE',
        },
      ]);
      const got = await svc.computeExclusive({
        taxTypeId: 'VAT',
        companyId: 'co-1',
        baseAmount: 500,
      });
      expect(got.tax).toBe(0);
      expect(got.rate).toBe(0);
    });

    it('handles a fixed-amount rate (e.g. stamp duty)', async () => {
      const svc = makeService([
        {
          id: 'stamp',
          taxTypeId: 'STAMP_DUTY',
          companyId: 'co-1',
          rate: 25,
          calculationMethod: 'FIXED_AMOUNT',
          effectiveFrom: new Date('2020-01-01'),
          effectiveTo: null,
          deletedAt: null,
          status: 'ACTIVE',
        },
      ]);
      const got = await svc.computeExclusive({
        taxTypeId: 'STAMP_DUTY',
        companyId: 'co-1',
        baseAmount: 99999,
      });
      expect(got.tax).toBe(25);
      expect(got.calculation).toBe('FIXED');
    });
  });

  describe('computeInclusive', () => {
    it('back-calculates tax from a gross amount at 18% VAT', async () => {
      const svc = makeService([
        {
          id: 'r1',
          taxTypeId: 'VAT',
          companyId: 'co-1',
          rate: 18,
          calculationMethod: 'PERCENTAGE',
          effectiveFrom: new Date('2020-01-01'),
          effectiveTo: null,
          deletedAt: null,
          status: 'ACTIVE',
        },
      ]);
      const got = await svc.computeInclusive({
        taxTypeId: 'VAT',
        companyId: 'co-1',
        baseAmount: 1180,
      });
      expect(got.tax).toBe(180);
      expect(got.base).toBe(1000);
      expect(got.gross).toBe(1180);
    });
  });

  describe('errors', () => {
    it('throws when no rate is found for the type/date', async () => {
      const svc = makeService([]);
      await expect(
        svc.computeExclusive({ taxTypeId: 'VAT', companyId: 'co-1', baseAmount: 100 }),
      ).rejects.toThrow(/No active tax rate/);
    });

    it('throws when neither taxRateId nor taxTypeId is provided', async () => {
      const svc = makeService([]);
      await expect(
        svc.computeExclusive({ companyId: 'co-1', baseAmount: 100 } as any),
      ).rejects.toThrow(/taxRateId or taxTypeId/);
    });
  });
});
