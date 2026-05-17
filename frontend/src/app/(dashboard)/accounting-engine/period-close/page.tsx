'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  PageSpinner,
  StatCard,
  StatusBadge,
} from '@/components/ui';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface FiscalYear {
  id: string;
  name: string;
  companyId: string;
  status: string;
  startDate: string;
  endDate: string;
}

interface AccountingPeriod {
  id: string;
  name: string;
  companyId: string;
  fiscalYearId: string;
  status: string;
  startDate: string;
  endDate: string;
}

interface PeriodClose {
  id: string;
  closeNumber: string;
  companyId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  status: string;
  reviewNotes?: string | null;
  closedAt?: string | null;
  reopenedAt?: string | null;
  createdAt: string;
}

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

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('en-GB') : '-';
}

function closeCode() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `PC-${stamp}-${Date.now().toString(36).toUpperCase()}`;
}

export default function PeriodClosePage() {
  const [rows, setRows] = useState<PeriodClose[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<PeriodClose | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    closeNumber: '',
    companyId: '',
    fiscalYearId: '',
    accountingPeriodId: '',
    reviewNotes: '',
  });

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(unwrapList<Company>(j)))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    const id = form.companyId || companyId;
    if (!id) {
      setFiscalYears([]);
      setPeriods([]);
      return;
    }

    Promise.allSettled([
      fetch(`/api/backend/fiscal-years?companyId=${id}&limit=200`).then((r) => r.json()),
      fetch(`/api/backend/accounting-periods?companyId=${id}&limit=500`).then((r) => r.json()),
    ]).then(([fyResult, periodResult]) => {
      setFiscalYears(fyResult.status === 'fulfilled' ? unwrapList<FiscalYear>(fyResult.value) : []);
      setPeriods(
        periodResult.status === 'fulfilled'
          ? unwrapList<AccountingPeriod>(periodResult.value)
          : [],
      );
    });
  }, [companyId, form.companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (companyId) params.set('companyId', companyId);
      const json = await fetch(`/api/backend/period-close?${params}`).then((r) => r.json());
      setRows(unwrapList<PeriodClose>(json));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load period closes');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const fyById = useMemo(() => new Map(fiscalYears.map((fy) => [fy.id, fy])), [fiscalYears]);
  const periodById = useMemo(() => new Map(periods.map((period) => [period.id, period])), [periods]);
  const filteredRows = status ? rows.filter((row) => row.status === status) : rows;
  const openCount = rows.filter((row) => ['DRAFT', 'REVIEWING', 'REOPENED'].includes(row.status)).length;
  const closedCount = rows.filter((row) => row.status === 'CLOSED').length;
  const selectedPeriod = selected ? periodById.get(selected.accountingPeriodId) : null;

  const openCreate = () => {
    setForm({
      closeNumber: closeCode(),
      companyId,
      fiscalYearId: '',
      accountingPeriodId: '',
      reviewNotes: '',
    });
    setCreating(true);
  };

  const saveClose = async () => {
    if (!form.companyId || !form.fiscalYearId || !form.accountingPeriodId) {
      setError('Company, fiscal year, and accounting period are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/backend/period-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closeNumber: form.closeNumber,
          companyId: form.companyId,
          fiscalYearId: form.fiscalYearId,
          accountingPeriodId: form.accountingPeriodId,
          reviewNotes: form.reviewNotes || undefined,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Create failed');
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (row: PeriodClose, action: 'close' | 'reopen') => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/backend/period-close/${row.id}/${action}`, {
        method: 'POST',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? `${action} failed`);
      setSelected(json.data ?? json);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setSaving(false);
    }
  };

  const selectablePeriods = form.fiscalYearId
    ? periods.filter((period) => period.fiscalYearId === form.fiscalYearId)
    : periods;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Period Close"
        subtitle="Create close workpapers, review the period, then close or reopen accounting periods"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Close Runs" value={rows.length} />
        <StatCard label="Open" value={openCount} />
        <StatCard label="Closed" value={closedCount} />
        <StatCard label="Selected Status" value={selected?.status ?? '-'} />
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
            {['DRAFT', 'REVIEWING', 'CLOSED', 'REOPENED', 'CANCELLED'].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </FormSelect>
          <Btn onClick={openCreate}>New Close</Btn>
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
                  <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-4 py-3">Close</th>
                    <th className="px-4 py-3">Fiscal Year</th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                        No close records
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
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs">{row.closeNumber}</div>
                          <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                            Created {fmtDate(row.createdAt)}
                          </div>
                        </td>
                        <td className="px-4 py-3">{fyById.get(row.fiscalYearId)?.name ?? row.fiscalYearId}</td>
                        <td className="px-4 py-3">{periodById.get(row.accountingPeriodId)?.name ?? row.accountingPeriodId}</td>
                        <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                        <td className="px-4 py-3 text-xs">{fmtDate(row.closedAt)}</td>
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
              Select a close record to review the checklist and run close actions.
            </div>
          ) : (
            <>
              <div>
                <div className="font-semibold">{selected.closeNumber}</div>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  {selectedPeriod?.name ?? selected.accountingPeriodId}
                </div>
              </div>

              <div className="space-y-2 text-sm">
                {[
                  ['Period selected', Boolean(selected.accountingPeriodId)],
                  ['Fiscal year selected', Boolean(selected.fiscalYearId)],
                  ['Backend will block draft journals', true],
                  ['Accounting period will be marked closed', selected.status === 'CLOSED'],
                ].map(([label, done]) => (
                  <div key={label as string} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: 'var(--aurora-border)' }}>
                    <span>{label}</span>
                    <StatusBadge status={done ? 'COMPLETED' : 'PENDING'} />
                  </div>
                ))}
              </div>

              {selected.reviewNotes && (
                <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                  <div className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--aurora-text-muted)' }}>Review notes</div>
                  {selected.reviewNotes}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Btn
                  variant="success"
                  size="sm"
                  loading={saving}
                  disabled={selected.status === 'CLOSED'}
                  onClick={() => runAction(selected, 'close')}
                >
                  Close Period
                </Btn>
                <Btn
                  variant="warning"
                  size="sm"
                  loading={saving}
                  disabled={selected.status !== 'CLOSED'}
                  onClick={() => runAction(selected, 'reopen')}
                >
                  Reopen
                </Btn>
              </div>
            </>
          )}
        </Card>
      </div>

      {creating && (
        <Modal
          open
          title="Create Period Close"
          onClose={() => setCreating(false)}
          size="xl"
          footer={
            <>
              <Btn variant="secondary" onClick={() => setCreating(false)}>Cancel</Btn>
              <Btn onClick={saveClose} loading={saving}>Create</Btn>
            </>
          }
        >
          <div className="grid md:grid-cols-2 gap-3">
            <FormSelect
              label="Company"
              required
              value={form.companyId}
              onChange={(e) => setForm((f) => ({
                ...f,
                companyId: e.target.value,
                fiscalYearId: '',
                accountingPeriodId: '',
              }))}
              placeholder="Select company"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>{optionLabel(company)}</option>
              ))}
            </FormSelect>
            <FormSelect
              label="Fiscal Year"
              required
              value={form.fiscalYearId}
              onChange={(e) => setForm((f) => ({ ...f, fiscalYearId: e.target.value, accountingPeriodId: '' }))}
              placeholder={form.companyId ? 'Select fiscal year' : 'Select company first'}
              disabled={!form.companyId}
            >
              {fiscalYears.map((fy) => (
                <option key={fy.id} value={fy.id}>
                  {fy.name} ({fy.status})
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Accounting Period"
              required
              value={form.accountingPeriodId}
              onChange={(e) => setForm((f) => ({ ...f, accountingPeriodId: e.target.value }))}
              placeholder={form.fiscalYearId ? 'Select period' : 'Select fiscal year first'}
              disabled={!form.fiscalYearId}
            >
              {selectablePeriods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.name} ({period.status})
                </option>
              ))}
            </FormSelect>
            <div />
            <div className="md:col-span-2">
              <FormTextarea
                label="Review Notes"
                value={form.reviewNotes}
                onChange={(e) => setForm((f) => ({ ...f, reviewNotes: e.target.value }))}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
