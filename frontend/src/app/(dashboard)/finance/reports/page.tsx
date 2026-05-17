'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Btn, Card, FormInput, FormSelect, PageHeader, PageSpinner, StatCard } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code?: string | null }
interface Division { id: string; name: string; code?: string | null }
interface Branch { id: string; name: string; code?: string | null; divisionId: string }
interface ReportLine {
  key?: string;
  label?: string;
  account?: { accountCode: string; accountName: string };
  accountCode?: string;
  accountName?: string;
  debit?: number;
  credit?: number;
  balance?: number;
  amount?: number;
  journalEntryIds?: string[];
}

type ReportTab =
  | 'trial-balance'
  | 'pnl'
  | 'balance-sheet'
  | 'cash-flow'
  | 'scope-rollup'
  | 'ar-aging'
  | 'ap-aging'
  | 'intercompany'
  | 'group-summary'
  | 'consolidated-pnl'
  | 'consolidated-balance-sheet'
  | 'consolidated-cash-flow';

const TABS: { key: ReportTab; label: string; company: boolean; period: boolean; asOf?: boolean }[] = [
  { key: 'trial-balance', label: 'Trial Balance', company: true, period: true },
  { key: 'pnl', label: 'Profit & Loss', company: true, period: true },
  { key: 'balance-sheet', label: 'Balance Sheet', company: true, period: false, asOf: true },
  { key: 'cash-flow', label: 'Cash Flow', company: true, period: true },
  { key: 'scope-rollup', label: 'Scope Rollup', company: true, period: true },
  { key: 'ar-aging', label: 'AR Aging', company: true, period: false },
  { key: 'ap-aging', label: 'AP Aging', company: true, period: false },
  { key: 'intercompany', label: 'Intercompany', company: false, period: false },
  { key: 'group-summary', label: 'Group Summary', company: false, period: false },
  { key: 'consolidated-pnl', label: 'Consolidated P&L', company: false, period: true },
  { key: 'consolidated-balance-sheet', label: 'Consolidated BS', company: false, period: false, asOf: true },
  { key: 'consolidated-cash-flow', label: 'Consolidated Cash Flow', company: false, period: true },
];

const today = new Date().toISOString().slice(0, 10);
const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

function unwrapList<T>(json: any): T[] {
  const payload = json?.data ?? json;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

function optionLabel(row: { name: string; code?: string | null }) {
  return row.code ? `${row.code} - ${row.name}` : row.name;
}

function fmtMoney(amount: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(amount ?? 0))}`;
}

function uniqueCount(rows: ReportLine[] = []) {
  return new Set(rows.flatMap((row) => row.journalEntryIds ?? [])).size;
}

export default function FinanceReportsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);
  const [asOf, setAsOf] = useState(today);
  const [activeTab, setActiveTab] = useState<ReportTab>('trial-balance');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<any>(null);

  const canView = hasPermission('finance.reports.view');
  const currentTab = TABS.find((tab) => tab.key === activeTab)!;
  const branchOptions = divisionId ? branches.filter((branch) => branch.divisionId === divisionId) : [];

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(unwrapList<Company>(j)))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (!companyId) {
      setDivisions([]);
      setBranches([]);
      setDivisionId('');
      setBranchId('');
      return;
    }
    Promise.allSettled([
      fetch(`/api/backend/divisions?companyId=${companyId}&limit=200`).then((r) => r.json()),
      fetch(`/api/backend/branches?companyId=${companyId}&activeOnly=true&limit=500`).then((r) => r.json()),
    ]).then(([divisionResult, branchResult]) => {
      setDivisions(divisionResult.status === 'fulfilled' ? unwrapList<Division>(divisionResult.value) : []);
      setBranches(branchResult.status === 'fulfilled' ? unwrapList<Branch>(branchResult.value) : []);
    });
  }, [companyId]);

  const loadReport = useCallback(async () => {
    if (currentTab.company && !companyId) {
      setError('Select a company first');
      return;
    }
    setLoading(true);
    setError('');
    setReport(null);
    try {
      const params = new URLSearchParams();
      if (currentTab.period) {
        if (activeTab.includes('cash-flow')) {
          params.set('periodStart', dateFrom);
          params.set('periodEnd', dateTo);
        } else {
          params.set('dateFrom', dateFrom);
          params.set('dateTo', dateTo);
        }
      }
      if (currentTab.asOf) params.set('asOf', asOf);
      if (divisionId && currentTab.company) params.set('divisionId', divisionId);
      if (branchId && currentTab.company) params.set('branchId', branchId);

      const query = params.toString();
      const withQuery = (path: string) => `${path}${query ? `?${query}` : ''}`;
      const endpoints: Record<ReportTab, string> = {
        'trial-balance': withQuery(`/api/backend/financial-reports/trial-balance/${companyId}`),
        pnl: withQuery(`/api/backend/financial-reports/profit-and-loss/${companyId}`),
        'balance-sheet': withQuery(`/api/backend/financial-reports/balance-sheet/${companyId}`),
        'cash-flow': withQuery(`/api/backend/financial-reports/cash-flow/${companyId}`),
        'scope-rollup': withQuery(`/api/backend/financial-reports/scope-rollup/${companyId}`),
        'ar-aging': `/api/backend/financial-reports/receivables-aging/${companyId}`,
        'ap-aging': `/api/backend/financial-reports/payables-aging/${companyId}`,
        intercompany: '/api/backend/financial-reports/intercompany-balances',
        'group-summary': '/api/backend/financial-reports/group-summary',
        'consolidated-pnl': withQuery('/api/backend/financial-reports/group/consolidated/profit-and-loss'),
        'consolidated-balance-sheet': withQuery('/api/backend/financial-reports/group/consolidated/balance-sheet'),
        'consolidated-cash-flow': withQuery('/api/backend/financial-reports/group/consolidated/cash-flow'),
      };

      const response = await fetch(endpoints[activeTab]);
      const json = await response.json();
      if (!response.ok) throw new Error(json.message ?? 'Failed to load report');
      setReport(json.data ?? json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [activeTab, asOf, branchId, companyId, currentTab, dateFrom, dateTo, divisionId]);

  const reportRows = useMemo(() => report?.rows ?? report?.statementLines ?? [], [report]);

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Financial Reports" subtitle="Reports and analytics" />
        <div className="mt-8 text-center text-sm text-slate-500">Access Restricted</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Financial Reports" subtitle="Branch, division, company, and consolidated group statements" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active Report" value={currentTab.label} />
        <StatCard label="Scope" value={branchId ? 'Branch' : divisionId ? 'Division' : currentTab.company ? 'Company' : 'Group'} />
        <StatCard label="Rows" value={Array.isArray(reportRows) ? reportRows.length : 0} />
        <StatCard label="JE Drill-down" value={uniqueCount(reportRows)} />
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <FormSelect
            label="Company"
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setDivisionId('');
              setBranchId('');
            }}
            placeholder="All group companies"
            disabled={!currentTab.company}
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>{optionLabel(company)}</option>
            ))}
          </FormSelect>
          <FormSelect
            label="Division"
            value={divisionId}
            onChange={(e) => {
              setDivisionId(e.target.value);
              setBranchId('');
            }}
            placeholder="All divisions"
            disabled={!companyId || !currentTab.company}
          >
            {divisions.map((division) => (
              <option key={division.id} value={division.id}>{optionLabel(division)}</option>
            ))}
          </FormSelect>
          <FormSelect
            label="Branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            placeholder="All branches"
            disabled={!divisionId || !currentTab.company}
          >
            {branchOptions.map((branch) => (
              <option key={branch.id} value={branch.id}>{optionLabel(branch)}</option>
            ))}
          </FormSelect>
          <FormInput label={currentTab.asOf ? 'As Of' : 'From'} type="date" value={currentTab.asOf ? asOf : dateFrom} onChange={(e) => currentTab.asOf ? setAsOf(e.target.value) : setDateFrom(e.target.value)} />
          <FormInput label="To" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} disabled={!currentTab.period || activeTab.includes('balance-sheet')} />
          <Btn variant="primary" onClick={loadReport} loading={loading}>Load</Btn>
        </div>
      </Card>

      <div className="flex flex-wrap gap-1 border-b" style={{ borderColor: 'var(--aurora-border)' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setReport(null); setError(''); }}
            className={`px-3 py-2 text-[12px] font-medium rounded-t-lg transition border-b-2 -mb-px ${activeTab === tab.key ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <PageSpinner /> : !report ? (
        <Card className="p-12 text-center text-sm text-slate-500">Load a report to view results.</Card>
      ) : (
        <Card className="p-5">
          {activeTab === 'trial-balance' && <TrialBalanceView rows={report.rows ?? []} totalDebit={report.totalDebit} totalCredit={report.totalCredit} />}
          {(activeTab === 'pnl' || activeTab === 'consolidated-pnl') && <StatementView title={currentTab.label} rows={report.statementLines ?? []} totals={[['Gross Profit', report.grossProfit], ['Net Income', report.netIncome]]} />}
          {(activeTab === 'balance-sheet' || activeTab === 'consolidated-balance-sheet') && <StatementView title={currentTab.label} rows={report.statementLines ?? []} totals={[['Assets', report.assets], ['Liabilities', report.liabilities], ['Equity', report.equity]]} />}
          {(activeTab === 'cash-flow' || activeTab === 'consolidated-cash-flow') && <CashFlowView data={report} />}
          {activeTab === 'scope-rollup' && <ScopeRollupView data={report} />}
          {(activeTab === 'ar-aging' || activeTab === 'ap-aging') && <AgingView data={report} title={currentTab.label} />}
          {activeTab === 'intercompany' && <IntercompanyView data={Array.isArray(report) ? report : []} />}
          {activeTab === 'group-summary' && <GroupSummaryView data={report} />}
          {report.eliminations && <EliminationPanel eliminations={report.eliminations} />}
        </Card>
      )}
    </div>
  );
}

function TrialBalanceView({ rows, totalDebit, totalCredit }: { rows: ReportLine[]; totalDebit: number; totalCredit: number }) {
  return (
    <div className="overflow-x-auto">
      <h3 className="text-lg font-semibold mb-3">Trial Balance</h3>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}><th className="px-4 py-2">Code</th><th className="px-4 py-2">Account</th><th className="px-4 py-2 text-right">Debit</th><th className="px-4 py-2 text-right">Credit</th><th className="px-4 py-2 text-right">Balance</th><th className="px-4 py-2 text-right">JEs</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.account?.accountCode ?? row.accountCode}>
              <td className="px-4 py-2 font-mono text-xs">{row.account?.accountCode ?? row.accountCode}</td>
              <td className="px-4 py-2">{row.account?.accountName ?? row.accountName}</td>
              <td className="px-4 py-2 text-right font-mono">{fmtMoney(row.debit)}</td>
              <td className="px-4 py-2 text-right font-mono">{fmtMoney(row.credit)}</td>
              <td className="px-4 py-2 text-right font-mono">{fmtMoney(row.balance)}</td>
              <td className="px-4 py-2 text-right">{row.journalEntryIds?.length ?? 0}</td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-semibold"><td className="px-4 py-2" colSpan={2}>Totals</td><td className="px-4 py-2 text-right">{fmtMoney(totalDebit)}</td><td className="px-4 py-2 text-right">{fmtMoney(totalCredit)}</td><td colSpan={2} /></tr>
        </tbody>
      </table>
    </div>
  );
}

function StatementView({ title, rows, totals }: { title: string; rows: ReportLine[]; totals: Array<[string, number]> }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="divide-y divide-slate-100 text-sm">
        {rows.map((row) => (
          <div key={row.key ?? row.label} className="flex items-center justify-between gap-4 py-2">
            <div>
              <div className="font-medium">{row.label}</div>
              <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{row.journalEntryIds?.length ?? 0} journal entries</div>
            </div>
            <span className="font-mono">{fmtMoney(row.amount)}</span>
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {totals.map(([label, value]) => <StatCard key={label} label={label} value={fmtMoney(value)} />)}
      </div>
    </div>
  );
}

function CashFlowView({ data }: { data: any }) {
  const rows = [
    ['Operating Activities', data.operatingActivities?.total, data.operatingActivities?.journalEntryIds?.length],
    ['Investing Activities', data.investingActivities?.total, data.investingActivities?.journalEntryIds?.length],
    ['Financing Activities', data.financingActivities?.total, data.financingActivities?.journalEntryIds?.length],
    ['Net Change in Cash', data.netChangeInCash, undefined],
  ];
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Cash Flow</h3>
      <div className="divide-y divide-slate-100">
        {rows.map(([label, amount, count]) => (
          <div key={label as string} className="flex justify-between py-2 text-sm">
            <span>{label}{typeof count === 'number' ? <span className="ml-2 text-xs text-slate-500">{count} JEs</span> : null}</span>
            <span className="font-mono">{fmtMoney(amount as number)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScopeRollupView({ data }: { data: any }) {
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <RollupTable title="By Division" rows={data.byDivision ?? []} />
      <RollupTable title="By Branch" rows={data.byBranch ?? []} />
    </div>
  );
}

function RollupTable({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <h3 className="text-lg font-semibold mb-3">{title}</h3>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}><th className="px-3 py-2">Scope</th><th className="px-3 py-2 text-right">Income</th><th className="px-3 py-2 text-right">Expenses</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2 text-right">JEs</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => <tr key={row.id ?? row.name}><td className="px-3 py-2">{row.name}</td><td className="px-3 py-2 text-right">{fmtMoney(row.income)}</td><td className="px-3 py-2 text-right">{fmtMoney(row.expenses + row.cogs)}</td><td className="px-3 py-2 text-right">{fmtMoney(row.netIncome)}</td><td className="px-3 py-2 text-right">{row.journalEntryIds?.length ?? 0}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

function AgingView({ data, title }: { data: any; title: string }) {
  const buckets = [['Current', data.current], ['1-30', data.days1_30], ['31-60', data.days31_60], ['61-90', data.days61_90], ['Over 90', data.over90], ['Total', data.total]];
  return <div><h3 className="text-lg font-semibold mb-3">{title}</h3><div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3">{buckets.map(([label, value]) => <StatCard key={label as string} label={label as string} value={fmtMoney(value as number)} />)}</div></div>;
}

function IntercompanyView({ data }: { data: any[] }) {
  return <RollupTable title="Intercompany Balances" rows={data.map((row) => ({ name: `${row.fromCompany?.name ?? row.fromCompany} -> ${row.toCompany?.name ?? row.toCompany}`, income: row.total ?? row.amount, expenses: 0, cogs: 0, netIncome: row.total ?? row.amount, journalEntryIds: [] }))} />;
}

function GroupSummaryView({ data }: { data: any }) {
  const companies = data.companies ?? [];
  return <RollupTable title="Group Summary" rows={companies.map((row: any) => ({ name: row.company?.name ?? row.companyName ?? row.companyId, income: row.totalDebits ?? 0, expenses: row.totalCredits ?? 0, cogs: 0, netIncome: Number(row.totalDebits ?? 0) - Number(row.totalCredits ?? 0), journalEntryIds: [] }))} />;
}

function EliminationPanel({ eliminations }: { eliminations: any }) {
  return (
    <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="font-semibold">Intercompany eliminations</div>
      <div>{eliminations.method}</div>
      <div className="mt-1 text-xs">{eliminations.journalEntryIds?.length ?? 0} journal entries eliminated.</div>
    </div>
  );
}
