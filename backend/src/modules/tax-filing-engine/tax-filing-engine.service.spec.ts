import { TaxFilingEngineService } from './tax-filing-engine.service';

const COMPANY_ID = 'company-1';
const PERIOD_ID = 'period-1';
const TAX_TYPE_ID = 'tax-type-1';
const USER = { id: 'user-1', companyId: COMPANY_ID, permissions: [] } as any;

const figures = {
  companyId: COMPANY_ID,
  taxTypeId: TAX_TYPE_ID,
  taxTypeCode: 'VAT',
  taxCategory: 'VAT',
  periodStart: new Date('2026-07-01T00:00:00.000Z'),
  periodEnd: new Date('2026-07-31T23:59:59.999Z'),
  grossAmount: 1_000,
  taxableAmount: 1_000,
  taxPayable: 180,
  taxRecoverable: 30,
  netTaxDue: 150,
  lines: [],
};

function makeService(existing: Record<string, unknown> | null) {
  const saved = {
    id: existing?.id ?? 'return-created-1',
    taxReturnNumber: existing?.taxReturnNumber ?? 'TR-00001',
    companyId: COMPANY_ID,
    taxFilingPeriodId: PERIOD_ID,
    taxTypeId: TAX_TYPE_ID,
    status: 'DRAFT',
    netTaxDue: 150,
  };
  const prisma = {
    taxReturn: {
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue(saved),
      update: jest.fn().mockResolvedValue(saved),
    },
  } as any;
  const codes = { next: jest.fn().mockResolvedValue('TR-00001') } as any;
  const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new TaxFilingEngineService(prisma, codes, companyScope, auditLogs);
  jest.spyOn(service as any, 'computeFigures').mockResolvedValue(figures);
  return { service, prisma, codes, auditLogs, saved };
}

describe('TaxFilingEngineService.computeReturn audit attribution', () => {
  it('audits a newly computed return as CREATE using the persisted id and company', async () => {
    const { service, auditLogs, saved } = makeService(null);

    await service.computeReturn(PERIOD_ID, USER);

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'TaxReturn',
        entityId: saved.id,
        userId: USER.id,
        companyId: COMPANY_ID,
        newValue: saved,
        metadata: {
          source: 'TaxFilingEngine',
          taxFilingPeriodId: PERIOD_ID,
          taxTypeId: TAX_TYPE_ID,
        },
      }),
    );
  });

  it('audits a recomputed draft as UPDATE using the same persisted id and company', async () => {
    const existing = {
      id: 'return-existing-1',
      taxReturnNumber: 'TR-00009',
      companyId: COMPANY_ID,
      status: 'DRAFT',
      netTaxDue: 99,
    };
    const { service, auditLogs, saved } = makeService(existing);

    await service.computeReturn(PERIOD_ID, USER);

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'TaxReturn',
        entityId: existing.id,
        userId: USER.id,
        companyId: COMPANY_ID,
        oldValue: existing,
        newValue: saved,
      }),
    );
  });
});
