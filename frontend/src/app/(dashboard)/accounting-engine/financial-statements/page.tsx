'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  Modal,
  PageHeader,
  PageSpinner,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { unwrapList, unwrapOne } from '@/lib/unwrap';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface StatementRun {
  id: string;
  statementRunNumber: string;
  companyId?: string | null;
  statementType: string;
  periodStart: string;
  periodEnd: string;
  currency?: string | null;
  status: string;
  generatedAt?: string | null;
  resultSummary?: unknown;
  errorMessage?: string | null;
}

interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

const today = new Date().toISOString().slice(0, 10);
const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  .toISOString()
  .slice(0, 10);

const STATEMENT_TYPES = [
  'TRIAL_BALANCE',
  'PROFIT_AND_LOSS',
  'BALANCE_SHEET',
  'CASH_FLOW',
  'EQUITY_STATEMENT',
  'GENERAL_LEDGER',
  'CUSTOM',
];

function optionLabel(row: { name: string; code?: string | null }) {
  return row.code ? `${row.code} - ${row.name}` : row.name;
}

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('en-GB') : '-';
}

function fmtMoney(value: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(value ?? 0))}`;
}

function errorMessage(json: any, fallback: string) {
  if (Array.isArray(json?.message)) return json.message.join(', ');
  return json?.message ?? json?.error ?? fallback;
}

function trialRows(summary: unknown): TrialBalanceRow[] {
  if (!Array.isArray(summary)) return [];
  return summary.filter((row): row is TrialBalanceRow => Boolean(row && typeof row === 'object' && 'accountId' in row));
}

export default function FinancialStatementsPage() {
  const [rows, setRows] = useState<StatementRun[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<StatementRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    companyId: '',
    statementType: 'TRIAL_BALANCE',
    periodStart: monthStart,
    periodEnd: today,
    currency: 'TZS',
  });

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(unwrapList<Company>(j)))
      .catch(() => setCompanies([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (companyId) params.set('companyId', companyId);
      const json = await fetch(`/api/backend/financial-statements?${params}`).then((r) => r.json());
      const list = unwrapList<StatementRun>(json);
      setRows(list);
      setSelected((current) => current ? list.find((row) => row.id === current.id) ?? current : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load financial statement runs');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const filteredRows = status ? rows.filter((row) => row.status === status) : rows;
  const generatedCount = rows.filter((row) => row.status === 'GENERATED').length;
  const failedCount = rows.filter((row) => row.status === 'FAILED').length;
  const selectedRows = trialRows(selected?.resultSummary);

  const openCreate = () => {
    setForm({
      companyId,
      statementType: 'TRIAL_BALANCE',
      periodStart: monthStart,
      periodEnd: today,
      currency: 'TZS',
    });
    setCreating(true);
  };

  const generate = async () => {
    if (!form.companyId || !form.periodStart || !form.periodEnd) {
      setError('Company, period start, and period end are required');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/backend/financial-statements/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: form.companyId,
          statementType: form.statementType,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          currency: form.currency || undefined,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(json, 'Statement generation failed'));
      const payload = unwrapOne<{ run?: StatementRun }>(json);
      setSelected(payload?.run ?? null);
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Statement generation failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Financial Statements"
        subtitle="Generate statement runs from posted journal entries and review the generated balances"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Runs" value={rows.length} />
        <StatCard label="Generated" value={generatedCount} />
        <StatCard label="Failed" value={failedCount} />
        <StatCard label="Selected Lines" value={selectedRows.length} />
      </div>

      <Card className="p-4">
        <div className="grid md:grid-cols-[1fr_180px_auto] gap-3 items-end">
          <FormSelect
            label="Company"
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setSelected(null);
            }}
            placeholder="All companies"
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {optionLabel(company)}
              </option>
            ))}
          </FormSelect>
          <FormSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses">
            {['REQUESTED', 'GENERATED', 'FAILED', 'CANCELLED'].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </FormSelect>
          <Btn onClick={openCreate}>Generate Statement</Btn>
        </div>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_460px] gap-5">
        <Card className="overflow-hidden">
          {loading ? (
            <PageSpinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-4 py-3">Run</th>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Statement</th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Generated</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                        No statement runs
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => setSelected(row)}
                        className="border-t cursor-pointer hover:bg-slate-50"
                        style={{ borderColor: 'var(--aurora-border)' }}
                      >
                        <td className="px-4 py-3 font-mono text-xs">{row.statementRunNumber}</td>
                        <td className="px-4 py-3">{row.companyId ? optionLabel(companyById.get(row.companyId) ?? { name: row.companyId }) : 'Group / all companies'}</td>
                        <td className="px-4 py-3">{row.statementType}</td>
                        <td className="px-4 py-3 text-xs">{fmtDate(row.periodStart)} to {fmtDate(row.periodEnd)}</td>
                        <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                        <td className="px-4 py-3 text-xs">{fmtDate(row.generatedAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          {!selected ? (
            <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              Select a generated run to inspect its summarized accounts.
            </div>
          ) : (
            <>
              <div>
                <div className="font-semibold">{selected.statementRunNumber}</div>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  {selected.statementType} - {fmtDate(selected.periodStart)} to {fmtDate(selected.periodEnd)}
                </div>
              </div>
              {selected.errorMessage && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {selected.errorMessage}
                </div>
              )}
              <div className="max-h-[480px] overflow-auto border rounded-lg" style={{ borderColor: 'var(--aurora-border)' }}>
                {selectedRows.length === 0 ? (
                  <div className="p-4 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                    No account rows were stored for this statement run.
                  </div>
                ) : (
                  selectedRows.map((row) => (
                    <div key={row.accountId} className="border-b p-3 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                      <div className="font-medium">{row.accountCode} - {row.accountName}</div>
                      <div className="mt-1 grid grid-cols-2 gap-2 font-mono text-xs">
                        <span>DR {fmtMoney(row.debit, selected.currency ?? 'TZS')}</span>
                        <span>CR {fmtMoney(row.credit, selected.currency ?? 'TZS')}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      {creating && (
        <Modal
          open
          title="Generate Financial Statement"
          onClose={() => setCreating(false)}
          size="lg"
          footer={
            <>
              <Btn variant="secondary" onClick={() => setCreating(false)}>Cancel</Btn>
              <Btn loading={saving} onClick={generate}>Generate</Btn>
            </>
          }
        >
          <div className="grid md:grid-cols-2 gap-3">
            <FormSelect
              label="Company"
              required
              value={form.companyId}
              onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
              placeholder="Select company"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>{optionLabel(company)}</option>
              ))}
            </FormSelect>
            <FormSelect
              label="Statement Type"
              value={form.statementType}
              onChange={(e) => setForm((f) => ({ ...f, statementType: e.target.value }))}
            >
              {STATEMENT_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
            </FormSelect>
            <FormInput label="Period Start" required type="date" value={form.periodStart} onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))} />
            <FormInput label="Period End" required type="date" value={form.periodEnd} onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} />
            <FormInput label="Currency" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
          </div>
        </Modal>
      )}
    </div>
  );
}
