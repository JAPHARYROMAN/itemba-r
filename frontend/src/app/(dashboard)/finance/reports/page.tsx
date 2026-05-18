'use client';

import { useEffect, useState } from 'react';
import {
  Card,
  PageHeader,
  Btn,
  PageSpinner,
  FormSelect,
  ScopeSelector,
  scopeToQueryString,
  type ScopeValue,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code: string }

interface TrialBalanceLine { accountCode: string; accountName: string; debit: number; credit: number; balance: number }
interface PnLLine { accountCode: string; accountName: string; amount: number }
interface PnLData { income: PnLLine[]; cogs: PnLLine[]; expenses: PnLLine[]; totalIncome: number; totalCogs: number; grossProfit: number; totalExpenses: number; netIncome: number }
interface BalanceSheetData { assets: PnLLine[]; liabilities: PnLLine[]; equity: PnLLine[]; totalAssets: number; totalLiabilities: number; totalEquity: number }
interface AgingBucket { current: number; days1_30: number; days31_60: number; days61_90: number; days90plus: number; total: number }
interface IntercompanyBalance { fromCompany: string; toCompany: string; amount: number; currency: string }
interface GroupCompany { companyId: string; companyName: string; totalIncome: number; totalExpenses: number; netPosition: number; cashBalance: number }
interface CashFlowSection { items: { description: string; amount: number }[]; total: number }
interface CashFlowData {
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: number;
  openingCash: number;
  closingCash: number;
  unexplainedDelta?: number;
  periodStart?: string;
  periodEnd?: string;
}

type ReportTab =
  | 'trial-balance' | 'pnl' | 'balance-sheet' | 'cash-flow'
  | 'ar-aging' | 'ap-aging' | 'intercompany' | 'group-summary';

const TABS: { key: ReportTab; label: string; needsCompany: boolean }[] = [
  { key: 'trial-balance', label: 'Trial Balance', needsCompany: true },
  { key: 'pnl', label: 'Profit & Loss', needsCompany: true },
  { key: 'balance-sheet', label: 'Balance Sheet', needsCompany: true },
  { key: 'cash-flow', label: 'Cash Flow', needsCompany: true },
  { key: 'ar-aging', label: 'AR Aging', needsCompany: true },
  { key: 'ap-aging', label: 'AP Aging', needsCompany: true },
  { key: 'intercompany', label: 'Inter-Company Balances', needsCompany: false },
  { key: 'group-summary', label: 'Group Summary', needsCompany: false },
];

function fmtMoney(amount: number, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(amount ?? 0)}`;
}

export default function FinanceReportsPage() {
  const { hasPermission } = useAuth();
  // Phase 4 — full hierarchy scope. ScopeSelector handles its own company list.
  const [scope, setScope] = useState<ScopeValue>({ companyId: '', divisionId: '', branchId: '' });
  const companyId = scope.companyId;
  const [activeTab, setActiveTab] = useState<ReportTab>('trial-balance');
  const [comparePeriod, setComparePeriod] = useState<'NONE' | 'PRIOR_PERIOD' | 'PRIOR_YEAR' | 'YTD'>('NONE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<unknown>(null);

  const canView = hasPermission('finance.reports.view');

  const loadReport = async () => {
    const tab = TABS.find((t) => t.key === activeTab)!;
    if (tab.needsCompany && !companyId) { setError('Please select a company'); return; }
    setLoading(true); setError(''); setReport(null);
    try {
      let url = '';
      // Phase 4: branch/division scope query params for the reports that support them.
      const scopeQs = scopeToQueryString(scope);
      const withScope = (base: string) => scopeQs ? `${base}${base.includes('?') ? '&' : '?'}${scopeQs}` : base;

      switch (activeTab) {
        case 'trial-balance': url = `/api/backend/financial-reports/trial-balance/${companyId}`; break;
        case 'pnl':
          // Phase 4: optional comparative column.
          url = `/api/backend/financial-reports/profit-and-loss/${companyId}`;
          if (comparePeriod !== 'NONE') url += `?comparePeriod=${comparePeriod}`;
          break;
        case 'balance-sheet': url = `/api/backend/financial-reports/balance-sheet/${companyId}`; break;
        case 'cash-flow': url = `/api/backend/financial-reports/cash-flow/${companyId}`; break;
        case 'ar-aging': url = withScope(`/api/backend/financial-reports/receivables-aging/${companyId}`); break;
        case 'ap-aging': url = withScope(`/api/backend/financial-reports/payables-aging/${companyId}`); break;
        case 'intercompany': url = '/api/backend/financial-reports/intercompany-balances'; break;
        case 'group-summary': url = '/api/backend/financial-reports/group-summary'; break;
      }
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Failed to load report');
      setReport(json.data ?? json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally { setLoading(false); }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Financial Reports" subtitle="Reports & analytics" />
        <div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div>
      </div>
    );
  }

  const currentTab = TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Financial Reports" subtitle="View ledger reports, statements, and group summaries" />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Phase 4: Company → Division → Branch cascading scope selector.
              AR/AP aging endpoints honor division/branch; other reports
              ignore them (no harm in passing extras). */}
          <div className="flex-1 min-w-[600px]">
            <ScopeSelector
              value={scope}
              onChange={setScope}
              disabled={!currentTab.needsCompany}
            />
          </div>
          {activeTab === 'pnl' ? (
            <div className="min-w-[180px]">
              <FormSelect
                label="Compare to"
                value={comparePeriod}
                onChange={(e) => setComparePeriod(e.target.value as typeof comparePeriod)}
              >
                <option value="NONE">No comparison</option>
                <option value="PRIOR_PERIOD">Prior period</option>
                <option value="PRIOR_YEAR">Prior year</option>
                <option value="YTD">Year-to-date prior</option>
              </FormSelect>
            </div>
          ) : null}
          <Btn variant="primary" onClick={loadReport} loading={loading}>Load Report</Btn>
        </div>
      </Card>

      <div className="flex flex-wrap gap-1 border-b" style={{ borderColor: 'var(--aurora-border)' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setReport(null); setError(''); }}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition border-b-2 -mb-px ${activeTab === t.key ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? <PageSpinner /> : !report ? (
        <Card className="p-12 text-center text-sm">
          <span style={{ color: 'var(--aurora-text-muted)' }}>Click &quot;Load Report&quot; to view {currentTab.label}.</span>
        </Card>
      ) : (
        <Card className="p-5">
          {activeTab === 'trial-balance' && <TrialBalanceView data={report as TrialBalanceLine[]} />}
          {activeTab === 'pnl' && <PnLView data={report as PnLData} />}
          {activeTab === 'balance-sheet' && <BalanceSheetView data={report as BalanceSheetData} />}
          {activeTab === 'cash-flow' && <CashFlowView data={report as CashFlowData} />}
          {activeTab === 'ar-aging' && <AgingView data={report as AgingBucket} title="Accounts Receivable Aging" />}
          {activeTab === 'ap-aging' && <AgingView data={report as AgingBucket} title="Accounts Payable Aging" />}
          {activeTab === 'intercompany' && <IntercompanyView data={report as IntercompanyBalance[]} />}
          {activeTab === 'group-summary' && <GroupSummaryView data={report as { companies: GroupCompany[] }} />}
        </Card>
      )}
    </div>
  );
}

function TrialBalanceView({ data }: { data: TrialBalanceLine[] }) {
  const totalDebit = data.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = data.reduce((s, l) => s + (l.credit || 0), 0);
  return (
    <div className="overflow-x-auto">
      <h3 className="text-lg font-semibold mb-3">Trial Balance</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
            <th className="px-4 py-2">Code</th>
            <th className="px-4 py-2">Account</th>
            <th className="px-4 py-2 text-right">Debit</th>
            <th className="px-4 py-2 text-right">Credit</th>
            <th className="px-4 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((l) => (
            <tr key={l.accountCode}>
              <td className="px-4 py-2 font-mono text-xs">{l.accountCode}</td>
              <td className="px-4 py-2">{l.accountName}</td>
              <td className="px-4 py-2 text-right font-mono">{l.debit ? fmtMoney(l.debit) : '—'}</td>
              <td className="px-4 py-2 text-right font-mono">{l.credit ? fmtMoney(l.credit) : '—'}</td>
              <td className="px-4 py-2 text-right font-mono">{fmtMoney(l.balance)}</td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-semibold">
            <td className="px-4 py-2" colSpan={2}>Totals</td>
            <td className="px-4 py-2 text-right font-mono">{fmtMoney(totalDebit)}</td>
            <td className="px-4 py-2 text-right font-mono">{fmtMoney(totalCredit)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PnLView({ data }: { data: PnLData }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Profit & Loss Statement</h3>
      <Section title="Income" lines={data.income} total={data.totalIncome} color="emerald" />
      <Section title="Cost of Goods Sold" lines={data.cogs} total={data.totalCogs} color="amber" />
      <div className="border-t pt-3 flex justify-between font-semibold" style={{ borderColor: 'var(--aurora-border)' }}>
        <span>Gross Profit</span><span className="font-mono">{fmtMoney(data.grossProfit)}</span>
      </div>
      <Section title="Expenses" lines={data.expenses} total={data.totalExpenses} color="red" />
      <div className="border-t pt-3 flex justify-between text-lg font-bold" style={{ borderColor: 'var(--aurora-border)' }}>
        <span>Net Income</span><span className={`font-mono ${data.netIncome >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtMoney(data.netIncome)}</span>
      </div>
    </div>
  );
}

function Section({ title, lines, total, color }: { title: string; lines: PnLLine[]; total: number; color: string }) {
  return (
    <div>
      <h4 className={`text-sm font-medium mb-1 text-${color}-700`}>{title}</h4>
      <div className="text-sm divide-y divide-slate-100">
        {lines.map((l) => (
          <div key={l.accountCode} className="flex justify-between py-1">
            <span><span className="font-mono text-xs mr-2" style={{ color: 'var(--aurora-text-muted)' }}>{l.accountCode}</span>{l.accountName}</span>
            <span className="font-mono">{fmtMoney(l.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between py-1 font-semibold">
          <span>Total {title}</span><span className="font-mono">{fmtMoney(total)}</span>
        </div>
      </div>
    </div>
  );
}

function BalanceSheetView({ data }: { data: BalanceSheetData }) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">Balance Sheet</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Section title="Assets" lines={data.assets} total={data.totalAssets} color="blue" />
        <div className="space-y-4">
          <Section title="Liabilities" lines={data.liabilities} total={data.totalLiabilities} color="orange" />
          <Section title="Equity" lines={data.equity} total={data.totalEquity} color="purple" />
          <div className="border-t pt-3 flex justify-between font-semibold" style={{ borderColor: 'var(--aurora-border)' }}>
            <span>Total Liabilities + Equity</span>
            <span className="font-mono">{fmtMoney(data.totalLiabilities + data.totalEquity)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CashFlowView({ data }: { data: CashFlowData }) {
  const renderSection = (label: string, section: CashFlowSection) => (
    <div className="mb-5">
      <div className="text-sm font-semibold mb-2">{label}</div>
      <div className="space-y-1">
        {(section.items ?? []).map((it, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-slate-600">{it.description}</span>
            <span className="font-mono">{fmtMoney(it.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between text-sm font-semibold pt-1 border-t border-slate-200">
          <span>Total {label}</span>
          <span className="font-mono">{fmtMoney(section.total)}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <h3 className="text-lg font-semibold mb-1">Cash Flow Statement</h3>
      <p className="text-xs text-slate-500 mb-4">
        Indirect method — derived from posted journal entries for the selected period.
        {data.periodStart && data.periodEnd ? ` ${data.periodStart} → ${data.periodEnd}` : null}
      </p>
      {renderSection('Operating Activities', data.operating ?? { items: [], total: 0 })}
      {renderSection('Investing Activities', data.investing ?? { items: [], total: 0 })}
      {renderSection('Financing Activities', data.financing ?? { items: [], total: 0 })}
      <div className="border-t border-slate-300 pt-3 mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span>Opening Cash</span>
          <span className="font-mono">{fmtMoney(data.openingCash)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Net Change in Cash</span>
          <span className="font-mono">{fmtMoney(data.netChange)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Closing Cash</span>
          <span className="font-mono">{fmtMoney(data.closingCash)}</span>
        </div>
        {data.unexplainedDelta !== undefined && Math.abs(data.unexplainedDelta) > 0.01 ? (
          <div className="flex justify-between text-amber-700 text-xs pt-2">
            <span>⚠ Unexplained delta (review)</span>
            <span className="font-mono">{fmtMoney(data.unexplainedDelta)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AgingView({ data, title }: { data: AgingBucket; title: string }) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
              <th className="px-4 py-2 text-right">Current</th>
              <th className="px-4 py-2 text-right">1-30 Days</th>
              <th className="px-4 py-2 text-right">31-60 Days</th>
              <th className="px-4 py-2 text-right">61-90 Days</th>
              <th className="px-4 py-2 text-right">90+ Days</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="font-mono">
              <td className="px-4 py-2 text-right">{fmtMoney(data.current)}</td>
              <td className="px-4 py-2 text-right">{fmtMoney(data.days1_30)}</td>
              <td className="px-4 py-2 text-right">{fmtMoney(data.days31_60)}</td>
              <td className="px-4 py-2 text-right">{fmtMoney(data.days61_90)}</td>
              <td className="px-4 py-2 text-right">{fmtMoney(data.days90plus)}</td>
              <td className="px-4 py-2 text-right font-semibold">{fmtMoney(data.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IntercompanyView({ data }: { data: IntercompanyBalance[] }) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">Inter-Company Balances</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
            <th className="px-4 py-2">From</th>
            <th className="px-4 py-2">To</th>
            <th className="px-4 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.length === 0 ? (
            <tr><td colSpan={3} className="px-4 py-6 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No inter-company balances</td></tr>
          ) : data.map((b, i) => (
            <tr key={i}>
              <td className="px-4 py-2">{b.fromCompany}</td>
              <td className="px-4 py-2">{b.toCompany}</td>
              <td className="px-4 py-2 text-right font-mono">{fmtMoney(b.amount, b.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupSummaryView({ data }: { data: { companies: GroupCompany[] } }) {
  const list = data?.companies ?? [];
  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">Group Summary</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
              <th className="px-4 py-2">Company</th>
              <th className="px-4 py-2 text-right">Income</th>
              <th className="px-4 py-2 text-right">Expenses</th>
              <th className="px-4 py-2 text-right">Net Position</th>
              <th className="px-4 py-2 text-right">Cash Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((c) => (
              <tr key={c.companyId}>
                <td className="px-4 py-2 font-medium">{c.companyName}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtMoney(c.totalIncome)}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtMoney(c.totalExpenses)}</td>
                <td className={`px-4 py-2 text-right font-mono ${c.netPosition >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtMoney(c.netPosition)}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtMoney(c.cashBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
