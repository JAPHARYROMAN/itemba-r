import { AccessLevel, FinancialStatementType } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { FinancialStatementsService } from './financial-statements.service';

function writeUser(): AuthUser {
  return {
    id: 'user-1',
    email: 'clerk@itemba.local',
    fullName: 'Company Clerk',
    roles: ['COMPANY_ACCOUNTANT'],
    roleScopes: ['COMPANY'],
    permissions: ['financial_statements.generate'],
    companyId: 'company-a',
    companyAccess: [{ companyId: 'company-a', accessLevel: AccessLevel.MANAGE }],
  };
}

function makeHarness() {
  const created: any[] = [];
  const prisma = {
    financialStatementRun: {
      create: jest.fn(({ data }: any) => {
        const run = { id: `run-${created.length + 1}`, ...data };
        created.push(run);
        return Promise.resolve(run);
      }),
    },
  };
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
  const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) };
  const financialReports = {
    getTrialBalance: jest.fn().mockResolvedValue({ report: 'TRIAL_BALANCE', rows: [] }),
    getProfitAndLoss: jest.fn().mockResolvedValue({ report: 'PROFIT_AND_LOSS', netIncome: 100 }),
    getBalanceSheet: jest.fn().mockResolvedValue({ report: 'BALANCE_SHEET', assets: 500 }),
    getCashFlow: jest.fn().mockResolvedValue({ report: 'CASH_FLOW', netChangeInCash: 42 }),
  };

  const service = new FinancialStatementsService(
    prisma as any,
    auditLogs as any,
    companyScope as any,
    financialReports as any,
  );

  return { service, prisma, auditLogs, companyScope, financialReports, created };
}

const BASE_DTO = {
  companyId: 'company-a',
  periodStart: '2026-01-01',
  periodEnd: '2026-03-31',
};

describe('FinancialStatementsService.generate routing', () => {
  it('delegates PROFIT_AND_LOSS to getProfitAndLoss and persists it', async () => {
    const h = makeHarness();
    const out = await h.service.generate(
      { ...BASE_DTO, statementType: FinancialStatementType.PROFIT_AND_LOSS },
      writeUser(),
    );

    expect(h.financialReports.getProfitAndLoss).toHaveBeenCalledTimes(1);
    expect(h.financialReports.getTrialBalance).not.toHaveBeenCalled();
    expect(out.supported).toBe(true);
    expect(out.result).toEqual({ report: 'PROFIT_AND_LOSS', netIncome: 100 });
    expect(h.created[0].statementType).toBe(FinancialStatementType.PROFIT_AND_LOSS);
    expect(h.created[0].status).toBe('GENERATED');
    expect(h.created[0].resultSummary).toEqual({ report: 'PROFIT_AND_LOSS', netIncome: 100 });
  });

  it('delegates BALANCE_SHEET to getBalanceSheet using period end as the as-of date', async () => {
    const h = makeHarness();
    const out = await h.service.generate(
      { ...BASE_DTO, statementType: FinancialStatementType.BALANCE_SHEET },
      writeUser(),
    );

    expect(h.financialReports.getBalanceSheet).toHaveBeenCalledTimes(1);
    const asOfArg = h.financialReports.getBalanceSheet.mock.calls[0][1];
    expect(new Date(asOfArg).toISOString()).toBe(new Date('2026-03-31').toISOString());
    expect(out.result).toEqual({ report: 'BALANCE_SHEET', assets: 500 });
    expect(h.created[0].status).toBe('GENERATED');
  });

  it('delegates CASH_FLOW to getCashFlow', async () => {
    const h = makeHarness();
    const out = await h.service.generate(
      { ...BASE_DTO, statementType: FinancialStatementType.CASH_FLOW },
      writeUser(),
    );

    expect(h.financialReports.getCashFlow).toHaveBeenCalledTimes(1);
    expect(out.supported).toBe(true);
    expect(out.result).toEqual({ report: 'CASH_FLOW', netChangeInCash: 42 });
  });

  it('defaults to TRIAL_BALANCE when statementType is omitted', async () => {
    const h = makeHarness();
    const out = await h.service.generate({ ...BASE_DTO }, writeUser());

    expect(h.financialReports.getTrialBalance).toHaveBeenCalledTimes(1);
    expect(out.supported).toBe(true);
    expect(h.created[0].statementType).toBe(FinancialStatementType.TRIAL_BALANCE);
  });

  it('returns a clear notSupported result for EQUITY_STATEMENT without masquerading as a trial balance', async () => {
    const h = makeHarness();
    const out = await h.service.generate(
      { ...BASE_DTO, statementType: FinancialStatementType.EQUITY_STATEMENT },
      writeUser(),
    );

    expect(h.financialReports.getTrialBalance).not.toHaveBeenCalled();
    expect(out.supported).toBe(false);
    expect(out.result.notSupported).toBe(true);
    expect(h.created[0].status).toBe('FAILED');
    expect(h.created[0].errorMessage).toContain('EQUITY_STATEMENT');
  });

  it('enforces WRITE company scope before generating', async () => {
    const h = makeHarness();
    await h.service.generate({ ...BASE_DTO, statementType: FinancialStatementType.TRIAL_BALANCE }, writeUser());
    expect(h.companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      expect.anything(),
      'company-a',
      AccessLevel.WRITE,
    );
  });
});
