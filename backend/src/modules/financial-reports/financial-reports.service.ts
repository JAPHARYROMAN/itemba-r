import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

type ReportScope = {
  divisionId?: string | null;
  branchId?: string | null;
  excludeIntercompany?: boolean;
};

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
    scope: ReportScope = {},
  ) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const jeWhere: any = { companyId, status: 'POSTED', deletedAt: null };
    if (periodId) jeWhere.accountingPeriodId = periodId;
    if (dateFrom || dateTo) {
      jeWhere.transactionDate = {};
      if (dateFrom) jeWhere.transactionDate.gte = new Date(dateFrom);
      if (dateTo) jeWhere.transactionDate.lte = new Date(dateTo);
    }
    this.applyConsolidationFilter(jeWhere, scope);

    const lines = await this.prisma.journalEntryLine.findMany({
      where: this.buildLineWhere(companyId, jeWhere, scope),
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
      journalEntryIds: Set<string>;
    }>();

    for (const line of lines) {
      const existing = accountMap.get(line.accountId) ?? {
        account: line.account,
        debit: 0,
        credit: 0,
        journalEntryIds: new Set<string>(),
      };
      existing.debit += Number(line.debit);
      existing.credit += Number(line.credit);
      existing.journalEntryIds.add(line.journalEntryId);
      accountMap.set(line.accountId, existing);
    }

    const rows = Array.from(accountMap.values()).map((r) => ({
      account: r.account,
      debit: r.debit,
      credit: r.credit,
      balance: r.debit - r.credit,
      journalEntryIds: Array.from(r.journalEntryIds),
    }));

    rows.sort((a, b) => a.account.accountCode.localeCompare(b.account.accountCode));

    return {
      companyId,
      divisionId: scope.divisionId ?? null,
      branchId: scope.branchId ?? null,
      rows,
      totalDebit: rows.reduce((s, r) => s + r.debit, 0),
      totalCredit: rows.reduce((s, r) => s + r.credit, 0),
    };
  }

  async getScopeRollup(companyId: string, dateFrom?: string, dateTo?: string, user?: AuthUser) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const jeWhere: any = { companyId, status: 'POSTED', deletedAt: null };
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
          select: { accountType: true },
        },
      },
    });

    const divisionIds = Array.from(new Set(lines.map((line) => line.divisionId).filter(Boolean))) as string[];
    const branchIds = Array.from(new Set(lines.map((line) => line.branchId).filter(Boolean))) as string[];
    const [divisions, branches] = await Promise.all([
      divisionIds.length
        ? this.prisma.division.findMany({
            where: { id: { in: divisionIds } },
            select: { id: true, name: true, code: true },
          })
        : [],
      branchIds.length
        ? this.prisma.branch.findMany({
            where: { id: { in: branchIds } },
            select: { id: true, name: true, code: true, divisionId: true },
          })
        : [],
    ]);
    const divisionById = new Map(divisions.map((division) => [division.id, division]));
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));

    const byDivision = new Map<string, any>();
    const byBranch = new Map<string, any>();
    for (const line of lines) {
      const division = line.divisionId ? divisionById.get(line.divisionId) : null;
      const branch = line.branchId ? branchById.get(line.branchId) : null;
      this.addRollupAmount(byDivision, line.divisionId ?? 'unassigned', {
        id: line.divisionId,
        name: division?.name ?? 'Unassigned',
        code: division?.code ?? null,
      }, line);
      this.addRollupAmount(byBranch, line.branchId ?? 'unassigned', {
        id: line.branchId,
        name: branch?.name ?? 'Unassigned',
        code: branch?.code ?? null,
        divisionId: branch?.divisionId ?? line.divisionId ?? null,
      }, line);
    }

    return {
      companyId,
      dateFrom,
      dateTo,
      byDivision: Array.from(byDivision.values()).map((row) => this.serializeRollup(row)),
      byBranch: Array.from(byBranch.values()).map((row) => this.serializeRollup(row)),
    };
  }

  async getProfitAndLoss(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    user?: AuthUser,
    scope: ReportScope = {},
  ) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const jeWhere: any = { companyId, status: 'POSTED', deletedAt: null };
    if (dateFrom || dateTo) {
      jeWhere.transactionDate = {};
      if (dateFrom) jeWhere.transactionDate.gte = new Date(dateFrom);
      if (dateTo) jeWhere.transactionDate.lte = new Date(dateTo);
    }
    this.applyConsolidationFilter(jeWhere, scope);

    const lines = await this.prisma.journalEntryLine.findMany({
      where: this.buildLineWhere(companyId, jeWhere, scope),
      include: { account: { select: { accountType: true } } },
    });

    let income = 0;
    let expenses = 0;
    let cogs = 0;
    const incomeJournalEntryIds = new Set<string>();
    const expenseJournalEntryIds = new Set<string>();
    const cogsJournalEntryIds = new Set<string>();

    for (const line of lines) {
      const net = Number(line.credit) - Number(line.debit);
      switch (line.account.accountType) {
        case 'INCOME':
          income += net;
          incomeJournalEntryIds.add(line.journalEntryId);
          break;
        case 'EXPENSE':
          expenses += Number(line.debit) - Number(line.credit);
          expenseJournalEntryIds.add(line.journalEntryId);
          break;
        case 'COST_OF_GOODS_SOLD':
          cogs += Number(line.debit) - Number(line.credit);
          cogsJournalEntryIds.add(line.journalEntryId);
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
      divisionId: scope.divisionId ?? null,
      branchId: scope.branchId ?? null,
      drillDown: {
        income: Array.from(incomeJournalEntryIds),
        expenses: Array.from(expenseJournalEntryIds),
        cogs: Array.from(cogsJournalEntryIds),
      },
      statementLines: [
        { key: 'income', label: 'Income', amount: income, journalEntryIds: Array.from(incomeJournalEntryIds) },
        { key: 'cogs', label: 'Cost of Goods Sold', amount: cogs, journalEntryIds: Array.from(cogsJournalEntryIds) },
        { key: 'expenses', label: 'Expenses', amount: expenses, journalEntryIds: Array.from(expenseJournalEntryIds) },
      ],
    };
  }

  async getBalanceSheet(companyId: string, asOf?: string, user?: AuthUser, scope: ReportScope = {}) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const asOfDate = asOf ? new Date(asOf) : new Date();
    const jeWhere: any = {
      companyId,
      status: 'POSTED',
      deletedAt: null,
      transactionDate: { lte: asOfDate },
    };
    this.applyConsolidationFilter(jeWhere, scope);

    const lines = await this.prisma.journalEntryLine.findMany({
      where: this.buildLineWhere(companyId, jeWhere, scope),
      include: { account: { select: { accountType: true } } },
    });

    let assets = 0;
    let liabilities = 0;
    let equity = 0;
    const assetJournalEntryIds = new Set<string>();
    const liabilityJournalEntryIds = new Set<string>();
    const equityJournalEntryIds = new Set<string>();

    for (const line of lines) {
      const net = Number(line.debit) - Number(line.credit);
      switch (line.account.accountType) {
        case 'ASSET':
          assets += net;
          assetJournalEntryIds.add(line.journalEntryId);
          break;
        case 'LIABILITY':
          liabilities += Number(line.credit) - Number(line.debit);
          liabilityJournalEntryIds.add(line.journalEntryId);
          break;
        case 'EQUITY':
          equity += Number(line.credit) - Number(line.debit);
          equityJournalEntryIds.add(line.journalEntryId);
          break;
      }
    }

    return {
      companyId,
      assets,
      liabilities,
      equity,
      asOf: asOfDate,
      divisionId: scope.divisionId ?? null,
      branchId: scope.branchId ?? null,
      drillDown: {
        assets: Array.from(assetJournalEntryIds),
        liabilities: Array.from(liabilityJournalEntryIds),
        equity: Array.from(equityJournalEntryIds),
      },
      statementLines: [
        { key: 'assets', label: 'Assets', amount: assets, journalEntryIds: Array.from(assetJournalEntryIds) },
        { key: 'liabilities', label: 'Liabilities', amount: liabilities, journalEntryIds: Array.from(liabilityJournalEntryIds) },
        { key: 'equity', label: 'Equity', amount: equity, journalEntryIds: Array.from(equityJournalEntryIds) },
      ],
    };
  }

  async getReceivablesAging(companyId: string, user?: AuthUser) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const buckets = await this.agingBuckets((extra) =>
      this.prisma.receivable
        .aggregate({
          where: {
            companyId,
            deletedAt: null,
            status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
            ...extra,
          } as Prisma.ReceivableWhereInput,
          _sum: { outstandingAmount: true },
        })
        .then((agg) => Number(agg._sum.outstandingAmount ?? 0)),
    );
    return { companyId, ...buckets };
  }

  async getPayablesAging(companyId: string, user?: AuthUser) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const buckets = await this.agingBuckets((extra) =>
      this.prisma.payable
        .aggregate({
          where: {
            companyId,
            deletedAt: null,
            status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
            ...extra,
          } as Prisma.PayableWhereInput,
          _sum: { outstandingAmount: true },
        })
        .then((agg) => Number(agg._sum.outstandingAmount ?? 0)),
    );
    return { companyId, ...buckets };
  }

  /**
   * Bucket open AR/AP into days-overdue bands using DB-side SUMs (5 parallel
   * aggregates) instead of fetching every open row and summing in JS. The date
   * cutoffs reproduce the old floor((now - dueDate) / day) boundaries exactly:
   *   current  = no due date OR < 1 day overdue (old days <= 0)
   *   days1_30 = 1..30 days overdue, days31_60 = 31..60, etc.
   * The bands are disjoint and exhaustive, so total is their sum. `runSum`
   * returns the summed outstanding for one band's extra where-clause.
   */
  private async agingBuckets(runSum: (extraWhere: Record<string, unknown>) => Promise<number>) {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const c0 = new Date(now - day);
    const c30 = new Date(now - 31 * day);
    const c60 = new Date(now - 61 * day);
    const c90 = new Date(now - 91 * day);
    const [current, days1_30, days31_60, days61_90, over90] = await Promise.all([
      runSum({ OR: [{ dueDate: null }, { dueDate: { gt: c0 } }] }),
      runSum({ dueDate: { gt: c30, lte: c0 } }),
      runSum({ dueDate: { gt: c60, lte: c30 } }),
      runSum({ dueDate: { gt: c90, lte: c60 } }),
      runSum({ dueDate: { lte: c90 } }),
    ]);
    const total = current + days1_30 + days31_60 + days61_90 + over90;
    return { current, days1_30, days31_60, days61_90, over90, total };
  }

  /**
   * Customer credit aging — open AR per customer bucketed by days past due,
   * plus each customer's oldest overdue age. Answers "who owes us and how late".
   * Returns { rows, totals } so the report runner renders a per-customer table
   * with a totals summary.
   */
  async getCustomerAging(companyId: string, user?: AuthUser) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const now = new Date();
    const receivables = await this.prisma.receivable.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
      select: { customerId: true, customerName: true, outstandingAmount: true, dueDate: true },
    });

    type Row = {
      customer: string;
      current: number;
      days1_30: number;
      days31_60: number;
      days61_90: number;
      over90: number;
      total: number;
      oldestDaysOverdue: number;
    };
    const map = new Map<string, Row>();
    for (const r of receivables) {
      const key = r.customerId ?? `name:${r.customerName}`;
      const row: Row = map.get(key) ?? {
        customer: r.customerName,
        current: 0,
        days1_30: 0,
        days31_60: 0,
        days61_90: 0,
        over90: 0,
        total: 0,
        oldestDaysOverdue: 0,
      };
      const amount = Number(r.outstandingAmount);
      const days = r.dueDate
        ? Math.floor((now.getTime() - r.dueDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      if (days <= 0) row.current += amount;
      else if (days <= 30) row.days1_30 += amount;
      else if (days <= 60) row.days31_60 += amount;
      else if (days <= 90) row.days61_90 += amount;
      else row.over90 += amount;
      row.total += amount;
      row.oldestDaysOverdue = Math.max(row.oldestDaysOverdue, Math.max(0, days));
      map.set(key, row);
    }
    const rows = [...map.values()].sort((a, b) => b.total - a.total);
    return { companyId, rows, totals: this.sumAgingRows(rows) };
  }

  /**
   * Supplier aging — open AP per supplier bucketed by days past due.
   */
  async getSupplierAging(companyId: string, user?: AuthUser) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const now = new Date();
    const payables = await this.prisma.payable.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
      select: { supplierId: true, supplierName: true, outstandingAmount: true, dueDate: true },
    });

    type Row = {
      supplier: string;
      current: number;
      days1_30: number;
      days31_60: number;
      days61_90: number;
      over90: number;
      total: number;
      oldestDaysOverdue: number;
    };
    const map = new Map<string, Row>();
    for (const p of payables) {
      const key = p.supplierId ?? `name:${p.supplierName}`;
      const row: Row = map.get(key) ?? {
        supplier: p.supplierName,
        current: 0,
        days1_30: 0,
        days31_60: 0,
        days61_90: 0,
        over90: 0,
        total: 0,
        oldestDaysOverdue: 0,
      };
      const amount = Number(p.outstandingAmount);
      const days = p.dueDate
        ? Math.floor((now.getTime() - p.dueDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      if (days <= 0) row.current += amount;
      else if (days <= 30) row.days1_30 += amount;
      else if (days <= 60) row.days31_60 += amount;
      else if (days <= 90) row.days61_90 += amount;
      else row.over90 += amount;
      row.total += amount;
      row.oldestDaysOverdue = Math.max(row.oldestDaysOverdue, Math.max(0, days));
      map.set(key, row);
    }
    const rows = [...map.values()].sort((a, b) => b.total - a.total);
    return { companyId, rows, totals: this.sumAgingRows(rows) };
  }

  private sumAgingRows(
    rows: Array<{
      current: number;
      days1_30: number;
      days31_60: number;
      days61_90: number;
      over90: number;
      total: number;
    }>,
  ) {
    return rows.reduce(
      (acc, r) => ({
        current: acc.current + r.current,
        days1_30: acc.days1_30 + r.days1_30,
        days31_60: acc.days31_60 + r.days31_60,
        days61_90: acc.days61_90 + r.days61_90,
        over90: acc.over90 + r.over90,
        total: acc.total + r.total,
      }),
      { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0, total: 0 },
    );
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
    scope: ReportScope = {},
  ) {
    if (user) await this.companyScope.assertCanAccessCompany(user, companyId);
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const jeWhere: any = {
      status: 'POSTED',
      deletedAt: null,
      transactionDate: { gte: start, lte: end },
    };
    this.applyConsolidationFilter(jeWhere, scope);

    // Net income from P&L for the period (income - expenses - cogs).
    const lines = await this.prisma.journalEntryLine.findMany({
      where: this.buildLineWhere(companyId, jeWhere, scope),
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
    const operatingJournalEntryIds = new Set<string>();
    const investingJournalEntryIds = new Set<string>();
    const financingJournalEntryIds = new Set<string>();

    for (const line of lines) {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      const subtype = (line.account.accountSubType ?? '').toLowerCase();
      const code = line.account.accountCode;

      switch (line.account.accountType) {
        case 'INCOME':
          income += credit - debit;
          operatingJournalEntryIds.add(line.journalEntryId);
          break;
        case 'EXPENSE':
          if (subtype === 'depreciation_expense' || code === '5500' || code === '6500') {
            depreciationExpense += debit - credit;
          }
          expenses += debit - credit;
          operatingJournalEntryIds.add(line.journalEntryId);
          break;
        case 'COST_OF_GOODS_SOLD':
          cogs += debit - credit;
          operatingJournalEntryIds.add(line.journalEntryId);
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
            operatingJournalEntryIds.add(line.journalEntryId);
          }
          // Fixed assets (proxy for investing activities)
          else if (code?.startsWith('15') || subtype.includes('fixed')) {
            assetAcquisitions += debit;
            assetDisposals += credit;
            investingJournalEntryIds.add(line.journalEntryId);
          }
          break;
        case 'LIABILITY':
          if (subtype === 'ap_control' || code === '2000' || code === '2010') {
            apDebit += debit;
            apCredit += credit;
            operatingJournalEntryIds.add(line.journalEntryId);
          } else if (subtype === 'loan_principal_payable' || code === '2400' || code === '2500') {
            loanPayableDebit += debit;
            loanPayableCredit += credit;
            financingJournalEntryIds.add(line.journalEntryId);
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
      divisionId: scope.divisionId ?? null,
      branchId: scope.branchId ?? null,
      operatingActivities: {
        netIncome,
        depreciation: depreciationExpense,
        receivablesChange: arChange,
        payablesChange: apChange,
        total: operatingActivities,
        journalEntryIds: Array.from(operatingJournalEntryIds),
      },
      investingActivities: {
        assetAcquisitions: -assetAcquisitions,
        assetDisposals,
        total: investingActivities,
        journalEntryIds: Array.from(investingJournalEntryIds),
      },
      financingActivities: {
        loanProceeds: loanPayableCredit,
        loanRepayments: -loanPayableDebit,
        total: financingActivities,
        journalEntryIds: Array.from(financingJournalEntryIds),
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

    const byCode = new Map<string, {
      accountCode: string;
      accountName: string;
      accountType: string;
      debit: number;
      credit: number;
      journalEntryIds: Set<string>;
    }>();
    for (const line of lines) {
      const key = line.account.accountCode;
      const existing = byCode.get(key) ?? {
        accountCode: line.account.accountCode,
        accountName: line.account.accountName,
        accountType: line.account.accountType,
        debit: 0,
        credit: 0,
        journalEntryIds: new Set<string>(),
      };
      existing.debit += Number(line.debit);
      existing.credit += Number(line.credit);
      existing.journalEntryIds.add(line.journalEntryId);
      byCode.set(key, existing);
    }

    const rows = Array.from(byCode.values())
      .map((r) => ({ ...r, balance: r.debit - r.credit, journalEntryIds: Array.from(r.journalEntryIds) }))
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

  async getConsolidatedProfitAndLoss(dateFrom?: string, dateTo?: string, user?: AuthUser) {
    if (user) this.companyScope.assertGroupScoped(user, 'view consolidated group P&L');
    const [raw, consolidated, eliminatedJournalEntryIds] = await Promise.all([
      this.getGroupProfitAndLoss(dateFrom, dateTo),
      this.getGroupProfitAndLossWithScope(dateFrom, dateTo, { excludeIntercompany: true }),
      this.getIntercompanyJournalEntryIds({ dateFrom, dateTo }),
    ]);

    return {
      ...consolidated,
      scope: 'GROUP',
      consolidation: 'CONSOLIDATED',
      rawPreConsolidation: this.pickProfitAndLossTotals(raw),
      eliminations: {
        method: 'Posted InterCompanyTransaction journal entries are excluded from consolidated totals.',
        journalEntryIds: eliminatedJournalEntryIds,
        income: raw.income - consolidated.income,
        expenses: raw.expenses - consolidated.expenses,
        cogs: raw.cogs - consolidated.cogs,
        grossProfit: raw.grossProfit - consolidated.grossProfit,
        netIncome: raw.netIncome - consolidated.netIncome,
      },
      assumptions: [
        'Intercompany elimination is based on JournalEntry.referenceType=InterCompanyTransaction.',
        'Multi-currency and FX translation are not included.',
      ],
    };
  }

  async getConsolidatedBalanceSheet(asOf?: string, user?: AuthUser) {
    if (user) this.companyScope.assertGroupScoped(user, 'view consolidated group balance sheet');
    const [raw, consolidated, eliminatedJournalEntryIds] = await Promise.all([
      this.getGroupBalanceSheet(asOf),
      this.getGroupBalanceSheetWithScope(asOf, { excludeIntercompany: true }),
      this.getIntercompanyJournalEntryIds({ asOf }),
    ]);

    return {
      ...consolidated,
      scope: 'GROUP',
      consolidation: 'CONSOLIDATED',
      rawPreConsolidation: this.pickBalanceSheetTotals(raw),
      eliminations: {
        method: 'Posted InterCompanyTransaction journal entries are excluded from consolidated totals.',
        journalEntryIds: eliminatedJournalEntryIds,
        assets: raw.assets - consolidated.assets,
        liabilities: raw.liabilities - consolidated.liabilities,
        equity: raw.equity - consolidated.equity,
      },
      assumptions: [
        'Intercompany receivables/payables are eliminated through InterCompanyTransaction journal entries.',
        'Multi-currency and FX translation are not included.',
      ],
    };
  }

  async getConsolidatedCashFlow(periodStart: string, periodEnd: string, user?: AuthUser) {
    if (user) this.companyScope.assertGroupScoped(user, 'view consolidated group cash flow');
    const [raw, consolidated, eliminatedJournalEntryIds] = await Promise.all([
      this.getGroupCashFlow(periodStart, periodEnd),
      this.getGroupCashFlowWithScope(periodStart, periodEnd, { excludeIntercompany: true }),
      this.getIntercompanyJournalEntryIds({ dateFrom: periodStart, dateTo: periodEnd }),
    ]);

    return {
      ...consolidated,
      scope: 'GROUP',
      consolidation: 'CONSOLIDATED',
      rawPreConsolidation: this.pickCashFlowTotals(raw),
      eliminations: {
        method: 'Posted InterCompanyTransaction journal entries are excluded from consolidated totals.',
        journalEntryIds: eliminatedJournalEntryIds,
        operatingActivities: raw.operatingActivities.total - consolidated.operatingActivities.total,
        investingActivities: raw.investingActivities.total - consolidated.investingActivities.total,
        financingActivities: raw.financingActivities.total - consolidated.financingActivities.total,
        netChangeInCash: raw.netChangeInCash - consolidated.netChangeInCash,
      },
      assumptions: [
        'Cash flow uses the existing indirect-method classification rules.',
        'Intercompany cash movement is removed by excluding InterCompanyTransaction journal entries.',
        'Multi-currency and FX translation are not included.',
      ],
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

  private async getGroupProfitAndLossWithScope(
    dateFrom?: string,
    dateTo?: string,
    scope: ReportScope = {},
  ) {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, code: true },
    });
    const byCompany = await Promise.all(
      companies.map((company) =>
        this.getProfitAndLoss(company.id, dateFrom, dateTo, undefined, scope).then((report) => ({
          ...report,
          company,
        })),
      ),
    );
    const totals = byCompany.reduce(
      (acc, report) => ({
        income: acc.income + Number(report.income),
        expenses: acc.expenses + Number(report.expenses),
        cogs: acc.cogs + Number(report.cogs),
        grossProfit: acc.grossProfit + Number(report.grossProfit),
        netIncome: acc.netIncome + Number(report.netIncome),
      }),
      { income: 0, expenses: 0, cogs: 0, grossProfit: 0, netIncome: 0 },
    );
    return {
      scope: 'GROUP',
      ...totals,
      dateFrom,
      dateTo,
      byCompany,
    };
  }

  private async getGroupBalanceSheetWithScope(asOf?: string, scope: ReportScope = {}) {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, code: true },
    });
    const byCompany = await Promise.all(
      companies.map((company) =>
        this.getBalanceSheet(company.id, asOf, undefined, scope).then((report) => ({
          ...report,
          company,
        })),
      ),
    );
    const totals = byCompany.reduce(
      (acc, report) => ({
        assets: acc.assets + Number(report.assets),
        liabilities: acc.liabilities + Number(report.liabilities),
        equity: acc.equity + Number(report.equity),
      }),
      { assets: 0, liabilities: 0, equity: 0 },
    );
    return {
      scope: 'GROUP',
      ...totals,
      asOf: byCompany[0]?.asOf ?? (asOf ? new Date(asOf) : new Date()),
      byCompany,
    };
  }

  private async getGroupCashFlow(periodStart: string, periodEnd: string) {
    return this.getGroupCashFlowWithScope(periodStart, periodEnd, {});
  }

  private async getGroupCashFlowWithScope(
    periodStart: string,
    periodEnd: string,
    scope: ReportScope = {},
  ) {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, code: true },
    });
    const byCompany = await Promise.all(
      companies.map((company) =>
        this.getCashFlow(company.id, periodStart, periodEnd, undefined, scope).then((report) => ({
          ...report,
          company,
        })),
      ),
    );
    const totals = byCompany.reduce(
      (acc, report) => ({
        operatingActivities: acc.operatingActivities + Number(report.operatingActivities.total),
        investingActivities: acc.investingActivities + Number(report.investingActivities.total),
        financingActivities: acc.financingActivities + Number(report.financingActivities.total),
        netChangeInCash: acc.netChangeInCash + Number(report.netChangeInCash),
        cashMovementFromLedger:
          acc.cashMovementFromLedger + Number(report.reconciliation.cashMovementFromLedger),
        unexplainedDelta: acc.unexplainedDelta + Number(report.reconciliation.unexplainedDelta),
      }),
      {
        operatingActivities: 0,
        investingActivities: 0,
        financingActivities: 0,
        netChangeInCash: 0,
        cashMovementFromLedger: 0,
        unexplainedDelta: 0,
      },
    );

    return {
      scope: 'GROUP',
      period: { start: new Date(periodStart), end: new Date(periodEnd) },
      method: 'INDIRECT',
      operatingActivities: { total: totals.operatingActivities },
      investingActivities: { total: totals.investingActivities },
      financingActivities: { total: totals.financingActivities },
      netChangeInCash: totals.netChangeInCash,
      reconciliation: {
        cashMovementFromLedger: totals.cashMovementFromLedger,
        unexplainedDelta: totals.unexplainedDelta,
      },
      byCompany,
    };
  }

  private buildLineWhere(companyId: string, journalEntryWhere: any, scope: ReportScope) {
    return {
      companyId,
      ...(scope.divisionId ? { divisionId: scope.divisionId } : {}),
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      journalEntry: journalEntryWhere,
    };
  }

  private applyConsolidationFilter(journalEntryWhere: any, scope: ReportScope) {
    if (!scope.excludeIntercompany) return;
    journalEntryWhere.OR = [
      { referenceType: null },
      { referenceType: { not: 'InterCompanyTransaction' } },
    ];
  }

  private addRollupAmount(
    target: Map<string, any>,
    key: string,
    scopeInfo: any,
    line: { debit: any; credit: any; journalEntryId: string; account: { accountType: string } },
  ) {
    const existing = target.get(key) ?? {
      ...scopeInfo,
      income: 0,
      expenses: 0,
      cogs: 0,
      assets: 0,
      liabilities: 0,
      equity: 0,
      debit: 0,
      credit: 0,
      journalEntryIds: new Set<string>(),
    };
    const debit = Number(line.debit);
    const credit = Number(line.credit);
    existing.debit += debit;
    existing.credit += credit;
    existing.journalEntryIds.add(line.journalEntryId);

    switch (line.account.accountType) {
      case 'INCOME':
        existing.income += credit - debit;
        break;
      case 'EXPENSE':
        existing.expenses += debit - credit;
        break;
      case 'COST_OF_GOODS_SOLD':
        existing.cogs += debit - credit;
        break;
      case 'ASSET':
        existing.assets += debit - credit;
        break;
      case 'LIABILITY':
        existing.liabilities += credit - debit;
        break;
      case 'EQUITY':
        existing.equity += credit - debit;
        break;
    }
    existing.grossProfit = existing.income - existing.cogs;
    existing.netIncome = existing.income - existing.expenses - existing.cogs;
    target.set(key, existing);
  }

  private serializeRollup(row: any) {
    return {
      ...row,
      journalEntryIds: Array.from(row.journalEntryIds ?? []),
    };
  }

  private async getIntercompanyJournalEntryIds(input: {
    dateFrom?: string;
    dateTo?: string;
    asOf?: string;
  }) {
    const where: any = {
      status: 'POSTED',
      deletedAt: null,
      referenceType: 'InterCompanyTransaction',
    };
    if (input.dateFrom || input.dateTo || input.asOf) {
      where.transactionDate = {};
      if (input.dateFrom) where.transactionDate.gte = new Date(input.dateFrom);
      if (input.dateTo) where.transactionDate.lte = new Date(input.dateTo);
      if (input.asOf) where.transactionDate.lte = new Date(input.asOf);
    }
    const entries = await this.prisma.journalEntry.findMany({
      where,
      select: { id: true },
      orderBy: { transactionDate: 'asc' },
    });
    return entries.map((entry) => entry.id);
  }

  private pickProfitAndLossTotals(report: any) {
    return {
      income: report.income,
      expenses: report.expenses,
      cogs: report.cogs,
      grossProfit: report.grossProfit,
      netIncome: report.netIncome,
    };
  }

  private pickBalanceSheetTotals(report: any) {
    return {
      assets: report.assets,
      liabilities: report.liabilities,
      equity: report.equity,
    };
  }

  private pickCashFlowTotals(report: any) {
    return {
      operatingActivities: report.operatingActivities.total,
      investingActivities: report.investingActivities.total,
      financingActivities: report.financingActivities.total,
      netChangeInCash: report.netChangeInCash,
    };
  }
}
