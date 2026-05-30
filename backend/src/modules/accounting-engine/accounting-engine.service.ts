import { Injectable } from '@nestjs/common';
import {
  AccountingLockStatus,
  AuditAdjustmentStatus,
  CashAccountType,
  FiscalPeriodStatus,
  JournalEntryStatus,
  PeriodCloseStatus,
  PostingRunStatus,
  Prisma,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { companyWhereForUser } from '../../common/services';
import { AccountRole, CONVENTIONAL_CODES } from '../../common/services/account-resolver.service';
import { AccountingEngineSummaryQueryDto } from './dto/accounting-engine-query.dto';

export type FinanceReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

export interface FinanceReadinessCheck {
  key: string;
  title: string;
  status: FinanceReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string | string[]>;
}

interface FinanceRoleAccount {
  accountCode: string;
  accountSubType: string | null;
}

const CORE_FINANCE_ROLES: AccountRole[] = [
  'CASH_ON_HAND',
  'BANK',
  'AR_CONTROL',
  'AP_CONTROL',
  'INVENTORY_ASSET',
  'SALES_REVENUE',
  'COST_OF_GOODS_SOLD',
  'GENERAL_EXPENSE',
  'TAX_VAT_PAYABLE',
  'RETAINED_EARNINGS',
];

const ADVANCED_FINANCE_ROLES: AccountRole[] = [
  'FIXED_ASSET',
  'ACCUMULATED_DEPRECIATION',
  'DEPRECIATION_EXPENSE',
  'LOAN_PRINCIPAL_PAYABLE',
  'LOAN_INTEREST_EXPENSE',
  'INCOME_SUMMARY',
];

@Injectable()
export class AccountingEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getSummary(query: AccountingEngineSummaryQueryDto, user?: AuthUser) {
    const { companyId } = query;
    const scope = companyWhereForUser(user, companyId);
    const closeWhere: Prisma.AccountingPeriodCloseWhereInput = { deletedAt: null, ...scope };
    const lockWhere: Prisma.AccountingLockWhereInput = { deletedAt: null, ...scope };
    const adjustmentWhere: Prisma.AuditAdjustmentWhereInput = { deletedAt: null, ...scope };
    const postingRunWhere: Prisma.PostingRunWhereInput = { deletedAt: null, ...scope };

    const [pendingCloses, openLocks, pendingAdjustments, pendingPostingRuns] = await Promise.all([
      this.prisma.accountingPeriodClose.count({
        where: {
          ...closeWhere,
          status: { in: [PeriodCloseStatus.DRAFT, PeriodCloseStatus.REVIEWING] },
        },
      }),
      this.prisma.accountingLock.count({
        where: { ...lockWhere, status: AccountingLockStatus.ACTIVE },
      }),
      this.prisma.auditAdjustment.count({
        where: {
          ...adjustmentWhere,
          status: { in: [AuditAdjustmentStatus.DRAFT, AuditAdjustmentStatus.SUBMITTED] },
        },
      }),
      this.prisma.postingRun.count({
        where: { ...postingRunWhere, status: PostingRunStatus.DRAFT },
      }),
    ]);

    return {
      pendingCloses,
      openLocks,
      pendingAdjustments,
      pendingPostingRuns,
      pendingPeriodCloses: pendingCloses,
      openAccountingLocks: openLocks,
      pendingAuditAdjustments: pendingAdjustments,
      readiness: await this.getReadiness(query, user),
    };
  }

  async getReadiness(query: AccountingEngineSummaryQueryDto, user?: AuthUser) {
    const { companyId } = query;
    const scope = companyWhereForUser(user, companyId);
    const now = new Date();

    const [
      financeAccounts,
      openFiscalYears,
      currentOpenPeriods,
      draftJournalEntries,
      postedJournalsMissingPeriod,
      failedPostingRuns,
      activeCashAccounts,
      activeBankLikeCashAccounts,
      pendingPeriodCloses,
      openAccountingLocks,
      pendingAuditAdjustments,
    ] = await Promise.all([
      this.prisma.chartOfAccount.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          ...scope,
        },
        select: {
          accountCode: true,
          accountSubType: true,
        },
      }),
      this.prisma.fiscalYear.count({
        where: {
          status: FiscalPeriodStatus.OPEN,
          ...scope,
        },
      }),
      this.prisma.accountingPeriod.count({
        where: {
          status: FiscalPeriodStatus.OPEN,
          startDate: { lte: now },
          endDate: { gte: now },
          ...scope,
        },
      }),
      this.prisma.journalEntry.count({
        where: {
          deletedAt: null,
          status: JournalEntryStatus.DRAFT,
          ...scope,
        },
      }),
      this.prisma.journalEntry.count({
        where: {
          deletedAt: null,
          status: JournalEntryStatus.POSTED,
          accountingPeriodId: null,
          ...scope,
        },
      }),
      this.prisma.postingRun.count({
        where: {
          deletedAt: null,
          status: PostingRunStatus.FAILED,
          ...scope,
        },
      }),
      this.prisma.cashAccount.count({
        where: {
          deletedAt: null,
          isActive: true,
          ...scope,
        },
      }),
      this.prisma.cashAccount.count({
        where: {
          deletedAt: null,
          isActive: true,
          accountType: { in: [CashAccountType.BANK, CashAccountType.MOBILE_MONEY] },
          ...scope,
        },
      }),
      this.prisma.accountingPeriodClose.count({
        where: {
          deletedAt: null,
          status: { in: [PeriodCloseStatus.DRAFT, PeriodCloseStatus.REVIEWING] },
          ...scope,
        },
      }),
      this.prisma.accountingLock.count({
        where: {
          deletedAt: null,
          status: AccountingLockStatus.ACTIVE,
          ...scope,
        },
      }),
      this.prisma.auditAdjustment.count({
        where: {
          deletedAt: null,
          status: { in: [AuditAdjustmentStatus.DRAFT, AuditAdjustmentStatus.SUBMITTED] },
          ...scope,
        },
      }),
    ]);

    const coveredCoreRoles = this.detectCoveredRoles(financeAccounts, CORE_FINANCE_ROLES);
    const coveredAdvancedRoles = this.detectCoveredRoles(financeAccounts, ADVANCED_FINANCE_ROLES);
    const missingCoreRoles = CORE_FINANCE_ROLES.filter((role) => !coveredCoreRoles.includes(role));
    const missingAdvancedRoles = ADVANCED_FINANCE_ROLES.filter(
      (role) => !coveredAdvancedRoles.includes(role),
    );
    const operationalPostingRoles: AccountRole[] = [
      'AR_CONTROL',
      'AP_CONTROL',
      'INVENTORY_ASSET',
      'SALES_REVENUE',
      'COST_OF_GOODS_SOLD',
    ];
    const missingOperationalRoles = operationalPostingRoles.filter(
      (role) => !coveredCoreRoles.includes(role),
    );

    const checks: FinanceReadinessCheck[] = [
      this.buildChartCheck(
        coveredCoreRoles,
        missingCoreRoles,
        coveredAdvancedRoles,
        missingAdvancedRoles,
      ),
      this.buildFiscalCalendarCheck(openFiscalYears, currentOpenPeriods),
      this.buildPostingHealthCheck(
        draftJournalEntries,
        postedJournalsMissingPeriod,
        failedPostingRuns,
      ),
      this.buildCashSetupCheck(activeCashAccounts, activeBankLikeCashAccounts, coveredCoreRoles),
      this.buildSubledgerCheck(missingOperationalRoles),
      this.buildCloseControlCheck(
        pendingPeriodCloses,
        openAccountingLocks,
        pendingAuditAdjustments,
      ),
    ];

    const score = Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
    const status: FinanceReadinessStatus = checks.some((check) => check.status === 'CRITICAL')
      ? 'CRITICAL'
      : score >= 90
        ? 'READY'
        : 'WARNING';

    return {
      score,
      target: 90,
      status,
      maturity:
        status === 'READY'
          ? 'Production-ready finance setup'
          : status === 'WARNING'
            ? 'Usable with setup warnings'
            : 'Setup blockers require action',
      updatedAt: now.toISOString(),
      indicators: {
        activeFinanceAccounts: financeAccounts.length,
        coreRolesCovered: coveredCoreRoles.length,
        coreRolesTotal: CORE_FINANCE_ROLES.length,
        advancedRolesCovered: coveredAdvancedRoles.length,
        advancedRolesTotal: ADVANCED_FINANCE_ROLES.length,
        openFiscalYears,
        currentOpenPeriods,
        draftJournalEntries,
        postedJournalsMissingPeriod,
        failedPostingRuns,
        activeCashAccounts,
        activeBankLikeCashAccounts,
        pendingPeriodCloses,
        openAccountingLocks,
        pendingAuditAdjustments,
      },
      missingCoreRoles,
      missingAdvancedRoles,
      checks,
    };
  }

  private detectCoveredRoles(accounts: FinanceRoleAccount[], roles: AccountRole[]) {
    return roles.filter((role) => {
      const subtype = role.toLowerCase();
      const codes = CONVENTIONAL_CODES[role] ?? [];
      return accounts.some((account) => {
        const accountSubType = account.accountSubType?.toLowerCase();
        return accountSubType === subtype || codes.includes(account.accountCode);
      });
    });
  }

  private buildChartCheck(
    coveredCoreRoles: AccountRole[],
    missingCoreRoles: AccountRole[],
    coveredAdvancedRoles: AccountRole[],
    missingAdvancedRoles: AccountRole[],
  ): FinanceReadinessCheck {
    const score =
      missingCoreRoles.length === 0
        ? 100
        : Math.round((coveredCoreRoles.length / CORE_FINANCE_ROLES.length) * 100);

    return {
      key: 'chart-of-accounts',
      title: 'Chart of accounts semantic roles',
      status: missingCoreRoles.length === 0 ? 'READY' : 'CRITICAL',
      score,
      message:
        missingCoreRoles.length === 0
          ? 'Core posting roles are mapped for sales, purchases, cash, tax, inventory, and retained earnings.'
          : `Missing core account roles: ${missingCoreRoles.join(', ')}.`,
      details: {
        coveredCoreRoles,
        missingCoreRoles,
        coveredAdvancedRoles,
        missingAdvancedRoles,
      },
    };
  }

  private buildFiscalCalendarCheck(
    openFiscalYears: number,
    currentOpenPeriods: number,
  ): FinanceReadinessCheck {
    const status: FinanceReadinessStatus =
      openFiscalYears > 0 && currentOpenPeriods > 0
        ? 'READY'
        : openFiscalYears > 0
          ? 'WARNING'
          : 'CRITICAL';

    return {
      key: 'fiscal-calendar',
      title: 'Fiscal calendar and open period',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 80 : 30,
      message:
        status === 'READY'
          ? 'A fiscal year and current accounting period are open for posting.'
          : status === 'WARNING'
            ? 'A fiscal year is open, but no current accounting period matches today.'
            : 'No open fiscal year is available for finance postings.',
      details: { openFiscalYears, currentOpenPeriods },
    };
  }

  private buildPostingHealthCheck(
    draftJournalEntries: number,
    postedJournalsMissingPeriod: number,
    failedPostingRuns: number,
  ): FinanceReadinessCheck {
    const status: FinanceReadinessStatus =
      postedJournalsMissingPeriod > 0 ? 'CRITICAL' : failedPostingRuns > 0 ? 'WARNING' : 'READY';

    return {
      key: 'posting-health',
      title: 'Posting engine health',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 85 : 45,
      message:
        status === 'READY'
          ? 'No failed posting runs or posted journals missing accounting periods were found.'
          : status === 'WARNING'
            ? 'Failed posting runs exist and need retry or cancellation review.'
            : 'Posted journal entries without accounting periods block reliable financial reporting.',
      details: { draftJournalEntries, postedJournalsMissingPeriod, failedPostingRuns },
    };
  }

  private buildCashSetupCheck(
    activeCashAccounts: number,
    activeBankLikeCashAccounts: number,
    coveredCoreRoles: AccountRole[],
  ): FinanceReadinessCheck {
    const cashRolesReady =
      coveredCoreRoles.includes('CASH_ON_HAND') && coveredCoreRoles.includes('BANK');
    const hasOperationalCashAccounts = activeCashAccounts > 0 && activeBankLikeCashAccounts > 0;
    const status: FinanceReadinessStatus = hasOperationalCashAccounts
      ? 'READY'
      : cashRolesReady
        ? 'WARNING'
        : 'CRITICAL';

    return {
      key: 'cash-bank-setup',
      title: 'Cash and bank setup',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 85 : 35,
      message:
        status === 'READY'
          ? 'Active cash and bank/mobile cash accounts are available for payment posting and reconciliation.'
          : status === 'WARNING'
            ? 'Ledger roles exist, but operational cash/bank accounts need to be completed.'
            : 'Cash and bank ledger roles are missing from the chart of accounts.',
      details: { activeCashAccounts, activeBankLikeCashAccounts },
    };
  }

  private buildSubledgerCheck(missingOperationalRoles: AccountRole[]): FinanceReadinessCheck {
    return {
      key: 'operations-subledger-bridge',
      title: 'Operations to finance posting bridge',
      status: missingOperationalRoles.length === 0 ? 'READY' : 'CRITICAL',
      score: missingOperationalRoles.length === 0 ? 100 : 50,
      message:
        missingOperationalRoles.length === 0
          ? 'Sales, purchases, inventory, receivables, and payables have the ledger roles needed for automatic posting.'
          : `Operations postings are blocked by missing roles: ${missingOperationalRoles.join(', ')}.`,
      details: { missingOperationalRoles },
    };
  }

  private buildCloseControlCheck(
    pendingPeriodCloses: number,
    openAccountingLocks: number,
    pendingAuditAdjustments: number,
  ): FinanceReadinessCheck {
    const status: FinanceReadinessStatus = pendingAuditAdjustments > 0 ? 'WARNING' : 'READY';

    return {
      key: 'close-controls',
      title: 'Close, lock, and audit controls',
      status,
      score: status === 'READY' ? 100 : 90,
      message:
        status === 'READY'
          ? 'Close controls, accounting locks, and audit adjustment queues are visible to finance users.'
          : 'Pending audit adjustments need review before period-close sign-off.',
      details: { pendingPeriodCloses, openAccountingLocks, pendingAuditAdjustments },
    };
  }
}
