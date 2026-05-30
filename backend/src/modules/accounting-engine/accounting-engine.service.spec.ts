import { AccountingEngineService } from './accounting-engine.service';

const user = {
  id: 'user-1',
  email: 'admin@example.com',
  roles: ['GROUP_ADMINISTRATOR'],
  roleScopes: ['COMPANY'],
  permissions: ['accounting_engine.dashboard'],
  companyId: 'company-1',
};

const roleAccounts = [
  'cash_on_hand',
  'bank',
  'ar_control',
  'ap_control',
  'inventory_asset',
  'sales_revenue',
  'cost_of_goods_sold',
  'general_expense',
  'tax_vat_payable',
  'retained_earnings',
  'fixed_asset',
  'accumulated_depreciation',
  'depreciation_expense',
  'loan_principal_payable',
  'loan_interest_expense',
  'income_summary',
].map((role, index) => ({
  accountCode: `${1000 + index}`,
  accountName: role,
  accountSubType: role,
}));

function makeService(accounts = roleAccounts) {
  const prisma = {
    accountingPeriodClose: { count: jest.fn(async () => 1) },
    accountingLock: { count: jest.fn(async () => 0) },
    auditAdjustment: { count: jest.fn(async () => 0) },
    postingRun: {
      count: jest.fn(async ({ where }: any) => (where.status === 'DRAFT' ? 2 : 0)),
    },
    chartOfAccount: { findMany: jest.fn(async () => accounts) },
    fiscalYear: { count: jest.fn(async () => 1) },
    accountingPeriod: { count: jest.fn(async () => 1) },
    journalEntry: {
      count: jest.fn(async ({ where }: any) => (where.status === 'DRAFT' ? 3 : 0)),
    },
    cashAccount: {
      count: jest.fn(async ({ where }: any) => (where.accountType ? 1 : 2)),
    },
  } as any;

  return {
    service: new AccountingEngineService(prisma, {} as any),
    prisma,
  };
}

describe('AccountingEngineService', () => {
  it('returns dashboard aliases and readiness from summary', async () => {
    const { service } = makeService();

    const summary = await service.getSummary({}, user);

    expect(summary.pendingCloses).toBe(1);
    expect(summary.pendingPeriodCloses).toBe(1);
    expect(summary.openLocks).toBe(0);
    expect(summary.openAccountingLocks).toBe(0);
    expect(summary.pendingAdjustments).toBe(0);
    expect(summary.pendingAuditAdjustments).toBe(0);
    expect(summary.pendingPostingRuns).toBe(2);
    expect(summary.readiness.score).toBeGreaterThanOrEqual(90);
  });

  it('scores a complete finance setup as production ready', async () => {
    const { service } = makeService();

    const readiness = await service.getReadiness({}, user);

    expect(readiness.score).toBeGreaterThanOrEqual(90);
    expect(readiness.status).toBe('READY');
    expect(readiness.target).toBe(90);
    expect(readiness.indicators.coreRolesCovered).toBe(10);
    expect(readiness.missingCoreRoles).toEqual([]);
  });

  it('surfaces missing core account roles as critical finance setup blockers', async () => {
    const accounts = roleAccounts.filter((account) => account.accountSubType !== 'ap_control');
    const { service } = makeService(accounts);

    const readiness = await service.getReadiness({}, user);

    expect(readiness.status).toBe('CRITICAL');
    expect(readiness.missingCoreRoles).toContain('AP_CONTROL');
    expect(readiness.checks.find((check) => check.key === 'chart-of-accounts')?.status).toBe(
      'CRITICAL',
    );
    expect(
      readiness.checks.find((check) => check.key === 'operations-subledger-bridge')?.status,
    ).toBe('CRITICAL');
  });
});
