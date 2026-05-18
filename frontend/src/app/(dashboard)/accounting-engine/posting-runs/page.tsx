'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  PageSpinner,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface PostingRun {
  id: string;
  postingRunNumber: string;
  companyId: string;
  sourceType: string;
  sourceId: string;
  postingRuleId?: string | null;
  journalEntryId?: string | null;
  status: string;
  totalDebit: number | string;
  totalCredit: number | string;
  currency: string;
  errorMessage?: string | null;
  postedAt?: string | null;
  reversedAt?: string | null;
  createdAt: string;
}

const SOURCE_TYPES = [
  'SALES_ORDER',
  'POS_TRANSACTION',
  'PURCHASE_ORDER',
  'EXPENSE',
  'RECEIVABLE',
  'PAYABLE',
  'PAYROLL_RUN',
  'SALARY_PAYMENT',
  'RENT_INVOICE',
  'RENT_PAYMENT',
  'PARKING_SESSION',
  'PARKING_PAYMENT',
  'ROOM_BOOKING',
  'RESTAURANT_ORDER',
  'FUEL_DELIVERY',
  'FUEL_SHIFT',
  'STOCK_ADJUSTMENT',
  'INVENTORY_MOVEMENT',
  'FIXED_ASSET',
  'DEPRECIATION',
  'LOAN_REPAYMENT',
  'TAX_RETURN',
  'PROJECT_BILLING',
  'MANUAL',
  'OTHER',
];

function optionLabel(row: { name: string; code?: string | null }) {
  return row.code ? `${row.code} - ${row.name}` : row.name;
}

function runNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `PR-${stamp}-${Date.now().toString(36).toUpperCase()}`;
}

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('en-GB') : '-';
}

function fmtMoney(value: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0)}`;
}

function errorMessage(json: any, fallback: string) {
  if (Array.isArray(json?.message)) return json.message.join(', ');
  return json?.message ?? json?.error ?? fallback;
}

export default function PostingRunsPage() {
  const [rows, setRows] = useState<PostingRun[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<PostingRun | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    postingRunNumber: '',
    companyId: '',
    sourceType: 'MANUAL',
    sourceId: '',
    postingRuleId: '',
    totalDebit: '0',
    totalCredit: '0',
    currency: 'TZS',
    errorMessage: '',
  });

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        const rows = unwrapList<Company>(j);
        setCompanies(rows);
        if (rows.length > 0) setCompanyId((current) => current || rows[0].id);
      })
      .catch(() => setCompanies([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      const json = await fetch(`/api/backend/posting-runs?${params}`).then((r) => r.json());
      const list = unwrapList<PostingRun>(json);
      setRows(list);
      setSelected((current) =>
        current ? (list.find((row) => row.id === current.id) ?? current) : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posting runs');
    } finally {
      setLoading(false);
    }
  }, [companyId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies],
  );
  const draftCount = rows.filter((row) => row.status === 'DRAFT').length;
  const postedCount = rows.filter((row) => row.status === 'POSTED').length;
  const failedCount = rows.filter((row) => row.status === 'FAILED').length;

  const openCreate = () => {
    setForm({
      postingRunNumber: runNumber(),
      companyId,
      sourceType: 'MANUAL',
      sourceId: `manual-${Date.now()}`,
      postingRuleId: '',
      totalDebit: '0',
      totalCredit: '0',
      currency: 'TZS',
      errorMessage: '',
    });
    setCreating(true);
  };

  const saveRun = async () => {
    if (
      !form.companyId ||
      !form.postingRunNumber.trim() ||
      !form.sourceType ||
      !form.sourceId.trim()
    ) {
      setError('Company, run number, source type, and source id are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/backend/posting-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postingRunNumber: form.postingRunNumber.trim(),
          companyId: form.companyId,
          sourceType: form.sourceType,
          sourceId: form.sourceId.trim(),
          postingRuleId: form.postingRuleId || undefined,
          totalDebit: Number(form.totalDebit || 0),
          totalCredit: Number(form.totalCredit || 0),
          currency: form.currency || 'TZS',
          errorMessage: form.errorMessage || undefined,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(json, 'Create failed'));
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (row: PostingRun, action: 'post' | 'reverse') => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/backend/posting-runs/${row.id}/${action}`, {
        method: 'POST',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(json, `${action} failed`));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Posting Runs"
        subtitle="Review posting attempts, create manual posting run records, and control draft or posted run status"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Runs" value={rows.length} />
        <StatCard label="Draft" value={draftCount} />
        <StatCard label="Posted" value={postedCount} />
        <StatCard label="Failed" value={failedCount} />
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
          <FormSelect
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All statuses"
          >
            {['DRAFT', 'POSTED', 'FAILED', 'REVERSED', 'CANCELLED'].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </FormSelect>
          <Btn onClick={openCreate}>New Run</Btn>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_420px] gap-5">
        <Card className="overflow-hidden">
          {loading ? (
            <PageSpinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-xs uppercase bg-gray-50"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    <th className="px-4 py-3">Run</th>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3 text-right">Debit</th>
                    <th className="px-4 py-3 text-right">Credit</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Posted</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-8 text-center text-sm"
                        style={{ color: 'var(--aurora-text-muted)' }}
                      >
                        No posting runs
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => setSelected(row)}
                        className="border-t cursor-pointer hover:bg-slate-50"
                        style={{ borderColor: 'var(--aurora-border)' }}
                      >
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs">{row.postingRunNumber}</div>
                          <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                            {fmtDate(row.createdAt)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {optionLabel(companyById.get(row.companyId) ?? { name: row.companyId })}
                        </td>
                        <td className="px-4 py-3">
                          <div>{row.sourceType}</div>
                          <div
                            className="font-mono text-xs"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            {row.sourceId}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {fmtMoney(row.totalDebit, row.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {fmtMoney(row.totalCredit, row.currency)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="px-4 py-3 text-xs">{fmtDate(row.postedAt)}</td>
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
              Select a run to inspect references and run status actions.
            </div>
          ) : (
            <>
              <div>
                <div className="font-semibold">{selected.postingRunNumber}</div>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  {selected.sourceType} - {selected.sourceId}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <StatCard label="Debit" value={fmtMoney(selected.totalDebit, selected.currency)} />
                <StatCard
                  label="Credit"
                  value={fmtMoney(selected.totalCredit, selected.currency)}
                />
              </div>
              <div
                className="rounded-lg border p-3 text-sm space-y-2"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <div className="flex justify-between gap-3">
                  <span>Posting Rule</span>
                  <span className="font-mono text-xs">{selected.postingRuleId ?? '-'}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Journal Entry</span>
                  <span className="font-mono text-xs">{selected.journalEntryId ?? '-'}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Reversed</span>
                  <span>{fmtDate(selected.reversedAt)}</span>
                </div>
              </div>
              {selected.errorMessage && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {selected.errorMessage}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Btn
                  size="sm"
                  variant="success"
                  loading={saving}
                  disabled={selected.status !== 'DRAFT'}
                  onClick={() => runAction(selected, 'post')}
                >
                  Post
                </Btn>
                <Btn
                  size="sm"
                  variant="warning"
                  loading={saving}
                  disabled={selected.status !== 'POSTED'}
                  onClick={() => runAction(selected, 'reverse')}
                >
                  Reverse
                </Btn>
              </div>
            </>
          )}
        </Card>
      </div>

      {creating && (
        <Modal
          open
          title="Create Posting Run"
          onClose={() => setCreating(false)}
          size="xl"
          footer={
            <>
              <Btn variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Btn>
              <Btn loading={saving} onClick={saveRun}>
                Create
              </Btn>
            </>
          }
        >
          <div className="grid md:grid-cols-2 gap-3">
            <FormInput
              label="Run Number"
              required
              value={form.postingRunNumber}
              onChange={(e) => setForm((f) => ({ ...f, postingRunNumber: e.target.value }))}
            />
            <FormSelect
              label="Company"
              required
              value={form.companyId}
              onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
              placeholder="Select company"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {optionLabel(company)}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Source Type"
              value={form.sourceType}
              onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value }))}
            >
              {SOURCE_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </FormSelect>
            <FormInput
              label="Source ID"
              required
              value={form.sourceId}
              onChange={(e) => setForm((f) => ({ ...f, sourceId: e.target.value }))}
            />
            <FormInput
              label="Posting Rule ID"
              value={form.postingRuleId}
              onChange={(e) => setForm((f) => ({ ...f, postingRuleId: e.target.value }))}
            />
            <FormInput
              label="Currency"
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
            />
            <FormInput
              label="Total Debit"
              type="number"
              value={form.totalDebit}
              onChange={(e) => setForm((f) => ({ ...f, totalDebit: e.target.value }))}
            />
            <FormInput
              label="Total Credit"
              type="number"
              value={form.totalCredit}
              onChange={(e) => setForm((f) => ({ ...f, totalCredit: e.target.value }))}
            />
            <div className="md:col-span-2">
              <FormTextarea
                label="Error Message"
                value={form.errorMessage}
                onChange={(e) => setForm((f) => ({ ...f, errorMessage: e.target.value }))}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
