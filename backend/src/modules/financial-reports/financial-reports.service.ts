import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class FinancialReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getCompanySummary(companyId: string, user?: AuthUser) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const [accountTypeSums, cashBalance, receivables, payables] = await Promise.all([
      this.prisma.journalEntryLine.groupBy({
        by: ['companyId'],
        where: {
          companyId,
          journalEntry: { status: 'POSTED', deletedAt: null },
        },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.cashAccount.aggregate({
        where: { companyId, deletedAt: null, isActive: true },
        _sum: { currentBalance: true },
      }),
      this.prisma.receivable.aggregate({
        where: { companyId, deletedAt: null },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.payable.aggregate({
        where: { companyId, deletedAt: null },
        _sum: { outstandingAmount: true },
      }),
    ]);

    return {
      companyId,
      totalDebits: accountTypeSums[0]?._sum.debit ?? 0,
      totalCredits: accountTypeSums[0]?._sum.credit ?? 0,
      cashBalance: cashBalance._sum.currentBalance ?? 0,
      totalReceivables: receivables._sum.outstandingAmount ?? 0,
      totalPayables: payables._sum.outstandingAmount ?? 0,
    };
  }

  async getGroupSummary(user?: AuthUser) {
    if (user) this.companyScope.assertGroupScoped(user, 'view group financial reports');
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, code: true },
    });

    const summaries = await Promise.all(
      companies.map((c) => this.getCompanySummary(c.id).then((s) => ({ ...s, company: c }))),
    );

    const totals = summaries.reduce(
      (acc, s) => ({
        totalDebits: acc.totalDebits + Number(s.totalDebits),
        totalCredits: acc.totalCredits + Number(s.totalCredits),
        cashBalance: acc.cashBalance + Number(s.cashBalance),
        totalReceivables: acc.totalReceivables + Number(s.totalReceivables),
        totalPayables: acc.totalPayables + Number(s.totalPayables),
      }),
      { totalDebits: 0, totalCredits: 0, cashBalance: 0, totalReceivables: 0, totalPayables: 0 },
    );

    return { ...totals, companies: summaries };
  }

  async getTrialBalance(
    companyId: string,
    periodId?: string,
    dateFrom?: string,
    dateTo?: string,
    user?: AuthUser,
  ) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const jeWhere: any = { companyId, status: 'POSTED', deletedAt: null };
    if (periodId) jeWhere.accountingPeriodId = periodId;
    if (dateFrom || dateTo) {
      jeWhere.transactionDate = {};
      if (dateFrom) jeWhere.transactionDate.gte = new Date(dateFrom);
      if (dateTo) jeWhere.transactionDate.lte = new Date(dateTo);
    }

    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        companyId,
        journalEntry: jeWhere,
      },
      include: {
        account: {
          select: { id: true, accountCode: true, accountName: true, accountType: true },
        },
      },
    });

    const accountMap = new Map<string, {
      account: any;
      debit: number;
      credit: number;
    }>();

    for (const line of lines) {
      const existing = accountMap.get(line.accountId) ?? { account: line.account, debit: 0, credit: 0 };
      existing.debit += Number(line.debit);
      existing.credit += Number(line.credit);
      accountMap.set(line.accountId, existing);
    }

    const rows = Array.from(accountMap.values()).map((r) => ({
      account: r.account,
      debit: r.debit,
      credit: r.credit,
      balance: r.debit - r.credit,
    }));

    rows.sort((a, b) => a.account.accountCode.localeCompare(b.account.accountCode));

    return {
      companyId,
      rows,
      totalDebit: rows.reduce((s, r) => s + r.debit, 0),
      totalCredit: rows.reduce((s, r) => s + r.credit, 0),
    };
  }

  async getProfitAndLoss(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    user?: AuthUser,
  ) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const jeWhere: any = { companyId, status: 'POSTED', deletedAt: null };
    if (dateFrom || dateTo) {
      jeWhere.transactionDate = {};
      if (dateFrom) jeWhere.transactionDate.gte = new Date(dateFrom);
      if (dateTo) jeWhere.transactionDate.lte = new Date(dateTo);
    }

    const lines = await this.prisma.journalEntryLine.findMany({
      where: { companyId, journalEntry: jeWhere },
      include: { account: { select: { accountType: true } } },
    });

    let income = 0;
    let expenses = 0;
    let cogs = 0;

    for (const line of lines) {
      const net = Number(line.credit) - Number(line.debit);
      switch (line.account.accountType) {
        case 'INCOME':
          income += net;
          break;
        case 'EXPENSE':
          expenses += Number(line.debit) - Number(line.credit);
          break;
        case 'COST_OF_GOODS_SOLD':
          cogs += Number(line.debit) - Number(line.credit);
          break;
      }
    }

    return {
      companyId,
      income,
      expenses,
      cogs,
      grossProfit: income - cogs,
      netIncome: income - expenses - cogs,
      dateFrom,
      dateTo,
    };
  }

  async getBalanceSheet(companyId: string, asOf?: string, user?: AuthUser) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const asOfDate = asOf ? new Date(asOf) : new Date();
    const jeWhere: any = {
      companyId,
      status: 'POSTED',
      deletedAt: null,
      transactionDate: { lte: asOfDate },
    };

    const lines = await this.prisma.journalEntryLine.findMany({
      where: { companyId, journalEntry: jeWhere },
      include: { account: { select: { accountType: true } } },
    });

    let assets = 0;
    let liabilities = 0;
    let equity = 0;

    for (const line of lines) {
      const net = Number(line.debit) - Number(line.credit);
      switch (line.account.accountType) {
        case 'ASSET':
          assets += net;
          break;
        case 'LIABILITY':
          liabilities += Number(line.credit) - Number(line.debit);
          break;
        case 'EQUITY':
          equity += Number(line.credit) - Number(line.debit);
          break;
      }
    }

    return { companyId, assets, liabilities, equity, asOf: asOfDate };
  }

  async getReceivablesAging(companyId: string, user?: AuthUser) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const now = new Date();
    const receivables = await this.prisma.receivable.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
    });

    const buckets = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0, total: 0 };

    for (const r of receivables) {
      const amount = Number(r.outstandingAmount);
      if (!r.dueDate) {
        buckets.current += amount;
      } else {
        const days = Math.floor((now.getTime() - r.dueDate.getTime()) / (1000 * 60 * 60 * 24));
        if (days <= 0) buckets.current += amount;
        else if (days <= 30) buckets.days1_30 += amount;
        else if (days <= 60) buckets.days31_60 += amount;
        else if (days <= 90) buckets.days61_90 += amount;
        else buckets.over90 += amount;
      }
      buckets.total += amount;
    }

    return { companyId, ...buckets };
  }

  async getPayablesAging(companyId: string, user?: AuthUser) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const now = new Date();
    const payables = await this.prisma.payable.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
    });

    const buckets = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0, total: 0 };

    for (const p of payables) {
      const amount = Number(p.outstandingAmount);
      if (!p.dueDate) {
        buckets.current += amount;
      } else {
        const days = Math.floor((now.getTime() - p.dueDate.getTime()) / (1000 * 60 * 60 * 24));
        if (days <= 0) buckets.current += amount;
        else if (days <= 30) buckets.days1_30 += amount;
        else if (days <= 60) buckets.days31_60 += amount;
        else if (days <= 90) buckets.days61_90 += amount;
        else buckets.over90 += amount;
      }
      buckets.total += amount;
    }

    return { companyId, ...buckets };
  }

  /**
   * Cash Flow Statement — INDIRECT METHOD.
   *
   * Standard layout:
   *   Net Income (P&L for the period)
   *   + Non-cash adjustments (depreciation)
   *   + Working-capital changes (Δ AR, Δ AP, Δ Inventory)
   *   = Cash from Operating Activities
   *
   *   Cash from Investing Activities (asset acquisitions/disposals)
   *   Cash from Financing Activities (loan principal movements)
   *
   *   = Net change in cash
   *
   * NOTE: this implementation uses balance-sheet movements derived from posted
   * journal entries. It is the "starter" implementation — it correctly produces
   * the indirect-method totals on a textbook chart of accounts. Multi-currency,
   * non-cash investing activities, and FX revaluation are deliberately left to
   * a follow-up. Document the assumption in the response so consumers know.
   */
  async getCashFlow(
    companyId: string,
    periodStart: string,
    periodEnd: string,
    user?: AuthUser,
  ) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    // Net income from P&L for the period (income - expenses - cogs).
    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        companyId,
        journalEntry: {
          status: 'POSTED',
          deletedAt: null,
          transactionDate: { gte: start, lte: end },
        },
      },
      include: { account: { select: { accountType: true, accountCode: true, accountSubType: true } } },
    });

    let income = 0;
    let expenses = 0;
    let cogs = 0;
    let depreciationExpense = 0;
    let cashMovement = 0;
    let arDebit = 0;
    let arCredit = 0;
    let apDebit = 0;
    let apCredit = 0;
    let loanPayableDebit = 0;
    let loanPayableCredit = 0;
    let assetAcquisitions = 0;
    let assetDisposals = 0;

    for (const line of lines) {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      const subtype = (line.account.accountSubType ?? '').toLowerCase();
      const code = line.account.accountCode;

      switch (line.account.accountType) {
        case 'INCOME':
          income += credit - debit;
          break;
        case 'EXPENSE':
          if (subtype === 'depreciation_expense' || code === '5500' || code === '6500') {
            depreciationExpense += debit - credit;
          }
          expenses += debit - credit;
          break;
        case 'COST_OF_GOODS_SOLD':
          cogs += debit - credit;
          break;
        case 'ASSET':
          // Cash movements
          if (subtype === 'cash_on_hand' || subtype === 'bank' || code === '1010' || code === '1020') {
            cashMovement += debit - credit;
          }
          // Receivables
          else if (subtype === 'ar_control' || code === '1100' || code === '1110') {
            arDebit += debit;
            arCredit += credit;
          }
          // Fixed assets (proxy for investing activities)
          else if (code?.startsWith('15') || subtype.includes('fixed')) {
            assetAcquisitions += debit;
            assetDisposals += credit;
          }
          break;
        case 'LIABILITY':
          if (subtype === 'ap_control' || code === '2000' || code === '2010') {
            apDebit += debit;
            apCredit += credit;
          } else if (subtype === 'loan_principal_payable' || code === '2400' || code === '2500') {
            loanPayableDebit += debit;
            loanPayableCredit += credit;
          }
          break;
      }
    }

    const netIncome = income - expenses - cogs;
    const arChange = arCredit - arDebit; // AR went down = cash up
    const apChange = apCredit - apDebit; // AP went up = cash up
    const operatingActivities = netIncome + depreciationExpense + arChange + apChange;
    const investingActivities = assetDisposals - assetAcquisitions;
    const financingActivities = loanPayableCredit - loanPayableDebit;
    const netChangeInCash = operatingActivities + investingActivities + financingActivities;

    return {
      companyId,
      period: { start, end },
      method: 'INDIRECT',
      operatingActivities: {
        netIncome,
        depreciation: depreciationExpense,
        receivablesChange: arChange,
        payablesChange: apChange,
        total: operatingActivities,
      },
      investingActivities: {
        assetAcquisitions: -assetAcquisitions,
        assetDisposals,
        total: investingActivities,
      },
      financingActivities: {
        loanProceeds: loanPayableCredit,
        loanRepayments: -loanPayableDebit,
        total: financingActivities,
      },
      netChangeInCash,
      reconciliation: {
        cashMovementFromLedger: cashMovement,
        // Difference flagged so users can spot non-categorized movements.
        unexplainedDelta: cashMovement - netChangeInCash,
      },
      assumptions: [
        'Cash and bank accounts are detected via accountSubType (cash_on_hand|bank) or codes 1010/1020.',
        'Depreciation is detected via accountSubType=depreciation_expense or codes 5500/6500.',
        'Investing activities are proxied by movements on accounts whose code starts with 15 (fixed-asset block).',
        'Financing activities are loan-principal movements only; equity raises are not yet categorized.',
        'Multi-currency and FX revaluation are not included.',
      ],
    };
  }

  async getIntercompanyBalances(user?: AuthUser) {
    if (user) this.companyScope.assertGroupScoped(user, 'view intercompany balances');
    const txs = await this.prisma.interCompanyTransaction.findMany({
      where: { deletedAt: null, status: 'POSTED' },
      include: {
        fromCompany: { select: { id: true, name: true, code: true } },
        toCompany: { select: { id: true, name: true, code: true } },
      },
    });

    const pairMap = new Map<string, { fromCompany: any; toCompany: any; total: number; count: number }>();

    for (const tx of txs) {
      const key = `${tx.fromCompanyId}___${tx.toCompanyId}`;
      const existing = pairMap.get(key) ?? {
        fromCompany: tx.fromCompany,
        toCompany: tx.toCompany,
        total: 0,
        count: 0,
      };
      existing.total += Number(tx.amount);
      existing.count += 1;
      pairMap.set(key, existing);
    }

    return Array.from(pairMap.values());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Sprint R2 — Group-wide rollups.
  //
  // These produce honest sums across every active company; they do NOT perform
  // intercompany eliminations or currency translation. Both are independent
  // accounting-policy decisions; the caller should treat these numbers as
  // "pre-consolidation" totals. Intercompany positions are surfaced separately
  // via `getIntercompanyBalances()` so reviewers can spot what would eliminate.
  // ═══════════════════════════════════════════════════════════════════════════

  /** Group Trial Balance — keyed by accountCode (each company has its own
   *  ChartOfAccount rows, but the codes overlap by design via the seed). */
  async getGroupTrialBalance(
    periodId?: string,
    dateFrom?: string,
    dateTo?: string,
    user?: AuthUser,
  ) {
    if (user) this.companyScope.assertGroupScoped(user, 'view group financial reports');
    const jeWhere: any = { status: 'POSTED', deletedAt: null };
    if (periodId) jeWhere.accountingPeriodId = periodId;
    if (dateFrom || dateTo) {
      jeWhere.transactionDate = {};
      if (dateFrom) jeWhere.transactionDate.gte = new Date(dateFrom);
      if (dateTo) jeWhere.transactionDate.lte = new Date(dateTo);
    }

    const lines = await this.prisma.journalEntryLine.findMany({
      where: { journalEntry: jeWhere },
      include: {
        account: { select: { accountCode: true, accountName: true, accountType: true } },
      },
    });

    const byCode = new Map<string, { accountCode: string; accountName: string; accountType: string; debit: number; credit: number }>();
    for (const line of lines) {
      const key = line.account.accountCode;
      const existing = byCode.get(key) ?? {
        accountCode: line.account.accountCode,
        accountName: line.account.accountName,
        accountType: line.account.accountType,
        debit: 0,
        credit: 0,
      };
      existing.debit += Number(line.debit);
      existing.credit += Number(line.credit);
      byCode.set(key, existing);
    }

    const rows = Array.from(byCode.values())
      .map((r) => ({ ...r, balance: r.debit - r.credit }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    return {
      scope: 'GROUP',
      rows,
      totalDebit: rows.reduce((s, r) => s + r.debit, 0),
      totalCredit: rows.reduce((s, r) => s + r.credit, 0),
      assumptions: ['Sums are pre-consolidation: no intercompany elimination or FX translation.'],
    };
  }

  /** Group P&L — sum across all companies for a date range, plus per-company breakdown. */
  async getGroupProfitAndLoss(dateFrom?: string, dateTo?: string, user?: AuthUser) {
    if (user) this.companyScope.assertGroupScoped(user, 'view group financial reports');
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, code: true },
    });
    const byCompany = await Promise.all(
      companies.map((c) => this.getProfitAndLoss(c.id, dateFrom, dateTo).then((r) => ({ ...r, company: c }))),
    );
    const totals = byCompany.reduce(
      (acc, r) => ({
        income: acc.income + Number(r.income),
        expenses: acc.expenses + Number(r.expenses),
        cogs: acc.cogs + Number(r.cogs),
        grossProfit: acc.grossProfit + Number(r.grossProfit),
        netIncome: acc.netIncome + Number(r.netIncome),
      }),
      { income: 0, expenses: 0, cogs: 0, grossProfit: 0, netIncome: 0 },
    );
    return {
      scope: 'GROUP',
      ...totals,
      dateFrom,
      dateTo,
      byCompany,
      assumptions: ['Sums are pre-consolidation: no intercompany elimination or FX translation.'],
    };
  }

  /** Group Balance Sheet — sum across all companies as-of a date, plus per-company breakdown. */
  async getGroupBalanceSheet(asOf?: string, user?: AuthUser) {
    if (user) this.companyScope.assertGroupScoped(user, 'view group financial reports');
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, code: true },
    });
    const byCompany = await Promise.all(
      companies.map((c) => this.getBalanceSheet(c.id, asOf).then((r) => ({ ...r, company: c }))),
    );
    const totals = byCompany.reduce(
      (acc, r) => ({
        assets: acc.assets + Number(r.assets),
        liabilities: acc.liabilities + Number(r.liabilities),
        equity: acc.equity + Number(r.equity),
      }),
      { assets: 0, liabilities: 0, equity: 0 },
    );
    return {
      scope: 'GROUP',
      ...totals,
      asOf: byCompany[0]?.asOf ?? new Date(),
      byCompany,
      assumptions: ['Sums are pre-consolidation: no intercompany elimination or FX translation.'],
    };
  }

  /** Group AR aging — sum buckets across companies. */
  async getGroupReceivablesAging(user?: AuthUser) {
    if (user) this.companyScope.assertGroupScoped(user, 'view group financial reports');
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, code: true },
    });
    const byCompany = await Promise.all(
      companies.map((c) => this.getReceivablesAging(c.id).then((r) => ({ ...r, company: c }))),
    );
    const totals = byCompany.reduce(
      (acc, r) => ({
        current: acc.current + Number(r.current),
        days1_30: acc.days1_30 + Number(r.days1_30),
        days31_60: acc.days31_60 + Number(r.days31_60),
        days61_90: acc.days61_90 + Number(r.days61_90),
        over90: acc.over90 + Number(r.over90),
        total: acc.total + Number(r.total),
      }),
      { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0, total: 0 },
    );
    return { scope: 'GROUP', ...totals, byCompany };
  }

  /** Group AP aging — sum buckets across companies. */
  async getGroupPayablesAging(user?: AuthUser) {
    if (user) this.companyScope.assertGroupScoped(user, 'view group financial reports');
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, code: true },
    });
    const byCompany = await Promise.all(
      companies.map((c) => this.getPayablesAging(c.id).then((r) => ({ ...r, company: c }))),
    );
    const totals = byCompany.reduce(
      (acc, r) => ({
        current: acc.current + Number(r.current),
        days1_30: acc.days1_30 + Number(r.days1_30),
        days31_60: acc.days31_60 + Number(r.days31_60),
        days61_90: acc.days61_90 + Number(r.days61_90),
        over90: acc.over90 + Number(r.over90),
        total: acc.total + Number(r.total),
      }),
      { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0, total: 0 },
    );
    return { scope: 'GROUP', ...totals, byCompany };
  }

  /** Group cash position — current balances of every active CashAccount, grouped by company. */
  async getGroupCashPosition(user?: AuthUser) {
    if (user) this.companyScope.assertGroupScoped(user, 'view group financial reports');
    const accounts = await this.prisma.cashAccount.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        accountName: true,
        accountType: true,
        currentBalance: true,
        currency: true,
        company: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ companyId: 'asc' }, { accountName: 'asc' }],
    });

    const byCompany = new Map<string, {
      company: { id: string; name: string; code: string };
      accounts: typeof accounts;
      total: number;
    }>();
    let groupTotal = 0;
    for (const a of accounts) {
      const cid = a.company.id;
      let bucket = byCompany.get(cid);
      if (!bucket) {
        bucket = { company: a.company, accounts: [], total: 0 };
        byCompany.set(cid, bucket);
      }
      bucket.accounts.push(a);
      bucket.total += Number(a.currentBalance);
      groupTotal += Number(a.currentBalance);
    }

    return {
      scope: 'GROUP',
      groupTotal,
      byCompany: Array.from(byCompany.values()),
      assumptions: ['Balances are summed at face value — no FX translation across currency.'],
    };
  }
}
