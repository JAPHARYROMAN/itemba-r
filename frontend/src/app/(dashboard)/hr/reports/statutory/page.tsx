'use client';

import { useEffect, useMemo, useState } from 'react';
import { Btn, Card, FormSelect, PageHeader, PageSpinner, StatusBadge } from '@/components/ui';

type ReturnKey = 'paye' | 'nssf' | 'psssf' | 'wcf' | 'sdl' | 'nhif' | 'heslb';

interface Company { id: string; name: string; code: string }

interface CsvFile {
  filename: string;
  mimeType: string;
  rowCount: number;
  content: string;
}

interface ReturnHeader {
  companyId: string;
  companyName: string;
  companyTin?: string | null;
  periodLabel: string;
  taxType: string;
}

interface BaseReturn {
  header: ReturnHeader;
  formCode: string;
  formName: string;
  summary: Record<string, number | boolean>;
  rows: Array<Record<string, unknown>>;
  file: CsvFile;
}

const TABS: { key: ReturnKey; label: string; portal: string; description: string }[] = [
  { key: 'paye', label: 'PAYE', portal: 'TRA', description: 'Pay As You Earn — monthly withholding return (ITX 215.01.E).' },
  { key: 'nssf', label: 'NSSF', portal: 'NSSF', description: 'National Social Security Fund — private-sector pension contributions.' },
  { key: 'psssf', label: 'PSSSF', portal: 'PSSSF', description: 'Public Service Social Security Fund — public-sector pension.' },
  { key: 'wcf', label: 'WCF', portal: 'WCF', description: 'Workers Compensation Fund — employer-only contribution.' },
  { key: 'sdl', label: 'SDL', portal: 'TRA', description: 'Skills Development Levy — bundled with PAYE return.' },
  { key: 'nhif', label: 'NHIF', portal: 'NHIF', description: 'National Health Insurance Fund — health contributions.' },
  { key: 'heslb', label: 'HESLB', portal: 'HESLB', description: 'Higher Education Students Loans Board — graduate loan repayments.' },
];

function fmt(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function downloadCsv(file: CsvFile) {
  const blob = new Blob([file.content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function StatutoryReturnsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [activeTab, setActiveTab] = useState<ReturnKey>('paye');
  const [data, setData] = useState<BaseReturn | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Years range — current year ± 5
  const yearOptions = useMemo(() => {
    const cy = now.getFullYear();
    const arr: string[] = [];
    for (let y = cy - 5; y <= cy + 1; y++) arr.push(String(y));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthOptions = useMemo(() =>
    Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const label = new Date(2000, i, 1).toLocaleDateString('en-GB', { month: 'long' });
      return { value: String(m).padStart(2, '0'), label };
    }), []);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json())
      .then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setCompanies([]));
  }, []);

  const load = async () => {
    if (!companyId) { setError('Pick a company first.'); return; }
    setLoading(true); setError(''); setData(null);
    try {
      const params = new URLSearchParams({ companyId, year, month: String(Number(month)) });
      const res = await fetch(`/api/backend/hr/statutory-returns/${activeTab}?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Failed to load return'));
      }
      const j = await res.json();
      setData(j.data ?? j);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  // Reload on tab change if we already have a company picked
  useEffect(() => {
    if (companyId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const activeMeta = TABS.find(t => t.key === activeTab)!;

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Statutory Returns"
        subtitle="Monthly PAYE / NSSF / PSSSF / WCF / SDL / NHIF / HESLB returns — view, sign-off, and download for portal upload."
        breadcrumbs={[{ label: 'HR', href: '/hr' }, { label: 'Reports', href: '/hr/reports' }, { label: 'Statutory' }]}
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <FormSelect label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}
            options={companies.map(c => ({ value: c.id, label: `${c.name} (${c.code})` }))}
            placeholder="Select company"
          />
          <FormSelect label="Year" value={year} onChange={(e) => setYear(e.target.value)}
            options={yearOptions.map(y => ({ value: y, label: y }))}
          />
          <FormSelect label="Month" value={month} onChange={(e) => setMonth(e.target.value)}
            options={monthOptions}
          />
          <div>
            <Btn variant="primary" onClick={load} loading={loading} disabled={!companyId}>Generate</Btn>
          </div>
        </div>
      </Card>

      <div className="border-b" style={{ borderColor: 'var(--aurora-border)' }}>
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === t.key ? 'border-brand-600' : 'border-transparent'}`}
              style={{ color: activeTab === t.key ? 'var(--aurora-text)' : 'var(--aurora-text-muted)' }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>{activeMeta.label} return</div>
            <div className="text-xs mt-1" style={{ color: 'var(--aurora-text-muted)' }}>{activeMeta.description}</div>
          </div>
          <span className="text-xs px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700">
            Portal: {activeMeta.portal}
          </span>
        </div>
      </Card>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading && <PageSpinner />}

      {!loading && data && (
        <>
          {/* Header summary */}
          <Card className="p-4">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Form</div>
                <div className="text-sm font-semibold mt-1">{data.formCode} — {data.formName}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {data.header.companyName}{data.header.companyTin ? ` · TIN ${data.header.companyTin}` : ''}
                </div>
                <div className="text-xs text-slate-500">Period: {data.header.periodLabel}</div>
              </div>
              <div>
                <Btn variant="primary" size="sm" onClick={() => downloadCsv(data.file)}>
                  Download CSV ({data.file.rowCount} rows)
                </Btn>
              </div>
            </div>
          </Card>

          {/* Summary tiles */}
          {Object.keys(data.summary).length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(data.summary).map(([k, v]) => (
                <Card key={k} className="p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{humanize(k)}</div>
                  <div className="text-xl font-bold mt-1">
                    {typeof v === 'boolean' ? (
                      <StatusBadge status={v ? 'YES' : 'NO'} />
                    ) : isCurrencyKey(k) ? (
                      <>TZS {fmt(v as number)}</>
                    ) : (
                      String(v)
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Rows table — column set varies per return */}
          <ReturnsTable returnKey={activeTab} rows={data.rows} />
        </>
      )}

      {!loading && !data && !error && (
        <div className="text-center py-12 text-sm text-slate-400">
          Pick a company, year and month, then click <strong>Generate</strong>.
        </div>
      )}
    </div>
  );
}

function humanize(k: string): string {
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

function isCurrencyKey(k: string): boolean {
  return /total|amount|salary|pay|gross|deduction|contribution/i.test(k);
}

function ReturnsTable({ returnKey, rows }: { returnKey: ReturnKey; rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) {
    return (
      <Card className="p-10 text-center text-sm text-slate-400">
        No employees with {returnKey.toUpperCase()} contributions in the selected period.
      </Card>
    );
  }

  const columns = COLUMNS[returnKey];
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
            <tr>
              {columns.map(col => (
                <th key={col.key} className={`px-4 py-2 text-${col.align ?? 'left'} text-xs font-semibold uppercase tracking-wide`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ color: 'var(--aurora-text)' }}>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                {columns.map(col => (
                  <td key={col.key} className={`px-4 py-2 ${col.mono ? 'font-mono text-xs' : 'text-sm'} text-${col.align ?? 'left'} ${col.align === 'right' ? 'tabular-nums' : ''}`}>
                    {col.format ? col.format(r[col.key]) : String(r[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

interface Col { key: string; label: string; align?: 'left' | 'right' | 'center'; mono?: boolean; format?: (v: unknown) => string }
const moneyCol = (key: string, label: string): Col => ({ key, label, align: 'right', format: (v) => fmt(v as number) });
const codeCol = (key: string, label: string): Col => ({ key, label, mono: true, format: (v) => v ? String(v) : '—' });
const textCol = (key: string, label: string): Col => ({ key, label, format: (v) => v != null && v !== '' ? String(v) : '—' });

const COLUMNS: Record<ReturnKey, Col[]> = {
  paye: [
    codeCol('employeeCode', 'Code'),
    textCol('fullName', 'Employee'),
    codeCol('tin', 'TIN'),
    codeCol('nidaNumber', 'NIDA'),
    moneyCol('taxableIncome', 'Taxable income'),
    moneyCol('payeAmount', 'PAYE'),
  ],
  nssf: [
    codeCol('employeeCode', 'Code'),
    textCol('fullName', 'Employee'),
    codeCol('memberNumber', 'NSSF #'),
    moneyCol('pensionableSalary', 'Pensionable'),
    moneyCol('employeeContribution', 'Employee 10%'),
    moneyCol('employerContribution', 'Employer 10%'),
    moneyCol('totalContribution', 'Total'),
  ],
  psssf: [
    codeCol('employeeCode', 'Code'),
    textCol('fullName', 'Employee'),
    codeCol('memberNumber', 'PSSSF #'),
    moneyCol('pensionableSalary', 'Pensionable'),
    moneyCol('employeeContribution', 'Employee 10%'),
    moneyCol('employerContribution', 'Employer 10%'),
    moneyCol('totalContribution', 'Total'),
  ],
  wcf: [
    codeCol('employeeCode', 'Code'),
    textCol('fullName', 'Employee'),
    codeCol('wcfNumber', 'WCF #'),
    moneyCol('gross', 'Gross'),
    { key: 'rate', label: 'Rate', align: 'right', format: (v) => v != null ? `${(Number(v) * 100).toFixed(2)}%` : '—' },
    moneyCol('wcfAmount', 'WCF'),
  ],
  sdl: [
    codeCol('employeeCode', 'Code'),
    textCol('fullName', 'Employee'),
    moneyCol('gross', 'Gross'),
    moneyCol('sdlAmount', 'SDL'),
  ],
  nhif: [
    codeCol('employeeCode', 'Code'),
    textCol('fullName', 'Employee'),
    codeCol('nhifNumber', 'NHIF #'),
    moneyCol('employeeContribution', 'Employee'),
    moneyCol('employerContribution', 'Employer'),
  ],
  heslb: [
    codeCol('employeeCode', 'Code'),
    textCol('fullName', 'Employee'),
    codeCol('heslbNumber', 'HESLB #'),
    moneyCol('basicSalary', 'Basic'),
    moneyCol('deduction', '15% deduction'),
  ],
};
