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

interface FiscalYear {
  id: string;
  name: string;
  companyId: string;
  status: string;
}

interface AccountingPeriod {
  id: string;
  name: string;
  companyId: string;
  fiscalYearId: string;
  status: string;
}

interface Account {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
}

interface AdjustmentLine {
  id?: string;
  accountId: string;
  description?: string | null;
  debit: number | string;
  credit: number | string;
}

interface AuditAdjustment {
  id: string;
  adjustmentNumber: string;
  companyId: string;
  fiscalYearId?: string | null;
  accountingPeriodId?: string | null;
  description: string;
  reason: string;
  status: string;
  journalEntryId?: string | null;
  reversalJournalEntryId?: string | null;
  approvedAt?: string | null;
  postedAt?: string | null;
  reversedAt?: string | null;
  createdAt: string;
  lines?: AdjustmentLine[];
}

type DraftLine = {
  accountId: string;
  description: string;
  debit: string;
  credit: string;
};

function optionLabel(row: { name: string; code?: string | null }) {
  return row.code ? `${row.code} - ${row.name}` : row.name;
}

function accountLabel(row: Account) {
  return `${row.accountCode} - ${row.accountName}`;
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

const emptyLine = (): DraftLine => ({ accountId: '', description: '', debit: '0', credit: '0' });

export default function AuditAdjustmentsPage() {
  const [rows, setRows] = useState<AuditAdjustment[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<AuditAdjustment | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    companyId: '',
    fiscalYearId: '',
    accountingPeriodId: '',
    description: '',
    reason: '',
    lines: [emptyLine(), emptyLine()],
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

  useEffect(() => {
    const id = form.companyId || companyId;
    if (!id) {
      setFiscalYears([]);
      setPeriods([]);
      setAccounts([]);
      return;
    }

    Promise.allSettled([
      fetch(`/api/backend/fiscal-years?companyId=${id}&limit=200`).then((r) => r.json()),
      fetch(`/api/backend/accounting-periods?companyId=${id}&limit=500`).then((r) => r.json()),
      fetch(`/api/backend/chart-of-accounts?companyId=${id}&isActive=true&limit=500`).then((r) =>
        r.json(),
      ),
    ]).then(([fyResult, periodResult, accountResult]) => {
      setFiscalYears(fyResult.status === 'fulfilled' ? unwrapList<FiscalYear>(fyResult.value) : []);
      setPeriods(
        periodResult.status === 'fulfilled' ? unwrapList<AccountingPeriod>(periodResult.value) : [],
      );
      setAccounts(
        accountResult.status === 'fulfilled' ? unwrapList<Account>(accountResult.value) : [],
      );
    });
  }, [companyId, form.companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      const json = await fetch(`/api/backend/audit-adjustments?${params}`).then((r) => r.json());
      const list = unwrapList<AuditAdjustment>(json);
      setRows(list);
      setSelected((current) =>
        current ? (list.find((row) => row.id === current.id) ?? current) : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit adjustments');
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
  const fyById = useMemo(() => new Map(fiscalYears.map((fy) => [fy.id, fy])), [fiscalYears]);
  const periodById = useMemo(
    () => new Map(periods.map((period) => [period.id, period])),
    [periods],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const draftCount = rows.filter((row) => row.status === 'DRAFT').length;
  const postedCount = rows.filter((row) => row.status === 'POSTED').length;
  const submittedCount = rows.filter((row) => row.status === 'SUBMITTED').length;
  const formDebit = form.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const formCredit = form.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  const selectedDebit = (selected?.lines ?? []).reduce(
    (sum, line) => sum + Number(line.debit || 0),
    0,
  );
  const selectedCredit = (selected?.lines ?? []).reduce(
    (sum, line) => sum + Number(line.credit || 0),
    0,
  );
  const selectablePeriods = form.fiscalYearId
    ? periods.filter((period) => period.fiscalYearId === form.fiscalYearId)
    : periods;

  const openCreate = () => {
    setForm({
      companyId,
      fiscalYearId: '',
      accountingPeriodId: '',
      description: '',
      reason: '',
      lines: [emptyLine(), emptyLine()],
    });
    setCreating(true);
  };

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  };

  const addLine = () => {
    setForm((current) => ({ ...current, lines: [...current.lines, emptyLine()] }));
  };

  const removeLine = (index: number) => {
    setForm((current) => ({ ...current, lines: current.lines.filter((_, i) => i !== index) }));
  };

  const saveAdjustment = async () => {
    const cleanLines = form.lines
      .map((line) => ({
        accountId: line.accountId,
        description: line.description || undefined,
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
      }))
      .filter((line) => line.accountId && (line.debit > 0 || line.credit > 0));

    if (!form.companyId || !form.description.trim() || !form.reason.trim()) {
      setError('Company, description, and reason are required');
      return;
    }
    if (cleanLines.length < 2) {
      setError('At least two adjustment lines are required');
      return;
    }
    if (Math.abs(formDebit - formCredit) > 0.01) {
      setError('Adjustment lines must balance before saving');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/backend/audit-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: form.companyId,
          fiscalYearId: form.fiscalYearId || undefined,
          accountingPeriodId: form.accountingPeriodId || undefined,
          description: form.description.trim(),
          reason: form.reason.trim(),
          lines: cleanLines,
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

  const runAction = async (
    row: AuditAdjustment,
    action: 'submit' | 'approve' | 'post' | 'reverse',
  ) => {
    const body =
      action === 'reverse' ? { reason: window.prompt('Reason for reversal')?.trim() } : undefined;
    if (action === 'reverse' && !body?.reason) return;

    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/backend/audit-adjustments/${row.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
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
        title="Audit Adjustments"
        subtitle="Create balanced auditor adjustments and move them through submit, approve, post, and reverse controls"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Adjustments" value={rows.length} />
        <StatCard label="Draft" value={draftCount} />
        <StatCard label="Submitted" value={submittedCount} />
        <StatCard label="Posted" value={postedCount} />
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
            {['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED', 'REJECTED', 'CANCELLED'].map(
              (item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ),
            )}
          </FormSelect>
          <Btn onClick={openCreate}>New Adjustment</Btn>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_460px] gap-5">
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
                    <th className="px-4 py-3">Adjustment</th>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Description</th>
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
                        No audit adjustments
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const debit = (row.lines ?? []).reduce(
                        (sum, line) => sum + Number(line.debit || 0),
                        0,
                      );
                      const credit = (row.lines ?? []).reduce(
                        (sum, line) => sum + Number(line.credit || 0),
                        0,
                      );
                      return (
                        <tr
                          key={row.id}
                          onClick={() => setSelected(row)}
                          className="border-t cursor-pointer hover:bg-slate-50"
                          style={{ borderColor: 'var(--aurora-border)' }}
                        >
                          <td className="px-4 py-3">
                            <div className="font-mono text-xs">{row.adjustmentNumber}</div>
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {fmtDate(row.createdAt)}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {optionLabel(companyById.get(row.companyId) ?? { name: row.companyId })}
                          </td>
                          <td className="px-4 py-3">{row.description}</td>
                          <td className="px-4 py-3 text-right font-mono">{fmtMoney(debit)}</td>
                          <td className="px-4 py-3 text-right font-mono">{fmtMoney(credit)}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="px-4 py-3 text-xs">{fmtDate(row.postedAt)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          {!selected ? (
            <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              Select an adjustment to review lines and workflow actions.
            </div>
          ) : (
            <>
              <div>
                <div className="font-semibold">{selected.adjustmentNumber}</div>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  {selected.description}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <StatCard label="Debit" value={fmtMoney(selectedDebit)} />
                <StatCard label="Credit" value={fmtMoney(selectedCredit)} />
              </div>
              <div
                className="rounded-lg border p-3 text-sm space-y-2"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <div className="flex justify-between gap-3">
                  <span>Fiscal Year</span>
                  <span>
                    {selected.fiscalYearId
                      ? (fyById.get(selected.fiscalYearId)?.name ?? selected.fiscalYearId)
                      : '-'}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Period</span>
                  <span>
                    {selected.accountingPeriodId
                      ? (periodById.get(selected.accountingPeriodId)?.name ??
                        selected.accountingPeriodId)
                      : '-'}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Journal Entry</span>
                  <span className="font-mono text-xs">{selected.journalEntryId ?? '-'}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Reversal JE</span>
                  <span className="font-mono text-xs">
                    {selected.reversalJournalEntryId ?? '-'}
                  </span>
                </div>
              </div>
              <div
                className="max-h-[280px] overflow-auto border rounded-lg"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                {(selected.lines ?? []).map((line, index) => (
                  <div
                    key={line.id ?? index}
                    className="border-b p-3 text-sm"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <div className="font-medium">
                      {line.accountId
                        ? accountLabel(
                            accountById.get(line.accountId) ?? {
                              id: line.accountId,
                              accountCode: line.accountId,
                              accountName: 'Unknown account',
                              accountType: '',
                            },
                          )
                        : 'No account'}
                    </div>
                    {line.description && (
                      <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {line.description}
                      </div>
                    )}
                    <div className="mt-1 grid grid-cols-2 gap-2 font-mono text-xs">
                      <span>DR {fmtMoney(line.debit)}</span>
                      <span>CR {fmtMoney(line.credit)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn
                  size="sm"
                  variant="secondary"
                  loading={saving}
                  disabled={selected.status !== 'DRAFT'}
                  onClick={() => runAction(selected, 'submit')}
                >
                  Submit
                </Btn>
                <Btn
                  size="sm"
                  variant="success"
                  loading={saving}
                  disabled={selected.status !== 'SUBMITTED'}
                  onClick={() => runAction(selected, 'approve')}
                >
                  Approve
                </Btn>
                <Btn
                  size="sm"
                  variant="primary"
                  loading={saving}
                  disabled={selected.status !== 'APPROVED'}
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
          title="Create Audit Adjustment"
          onClose={() => setCreating(false)}
          size="3xl"
          footer={
            <>
              <div
                className="mr-auto text-xs"
                style={{
                  color:
                    Math.abs(formDebit - formCredit) <= 0.01
                      ? 'var(--aurora-success)'
                      : 'var(--aurora-danger)',
                }}
              >
                Debit {fmtMoney(formDebit)} / Credit {fmtMoney(formCredit)}
              </div>
              <Btn variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Btn>
              <Btn loading={saving} onClick={saveAdjustment}>
                Create
              </Btn>
            </>
          }
        >
          <div className="space-y-5">
            <div className="grid md:grid-cols-2 gap-3">
              <FormSelect
                label="Company"
                required
                value={form.companyId}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    companyId: e.target.value,
                    fiscalYearId: '',
                    accountingPeriodId: '',
                    lines: f.lines.map((line) => ({ ...line, accountId: '' })),
                  }))
                }
                placeholder="Select company"
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {optionLabel(company)}
                  </option>
                ))}
              </FormSelect>
              <FormSelect
                label="Fiscal Year"
                value={form.fiscalYearId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fiscalYearId: e.target.value, accountingPeriodId: '' }))
                }
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
                <FormInput
                  label="Description"
                  required
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <FormTextarea
                  label="Reason"
                  required
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Adjustment Lines</div>
                <Btn size="sm" variant="secondary" onClick={addLine}>
                  Add Line
                </Btn>
              </div>
              {form.lines.map((line, index) => (
                <div
                  key={index}
                  className="grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_150px_150px_auto] gap-2 items-end"
                >
                  <FormSelect
                    label={index === 0 ? 'Account' : undefined}
                    value={line.accountId}
                    onChange={(e) => updateLine(index, { accountId: e.target.value })}
                    placeholder={form.companyId ? 'Select account' : 'Select company first'}
                    disabled={!form.companyId}
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {accountLabel(account)}
                      </option>
                    ))}
                  </FormSelect>
                  <FormInput
                    label={index === 0 ? 'Description' : undefined}
                    value={line.description}
                    onChange={(e) => updateLine(index, { description: e.target.value })}
                  />
                  <FormInput
                    label={index === 0 ? 'Debit' : undefined}
                    type="number"
                    value={line.debit}
                    onChange={(e) => updateLine(index, { debit: e.target.value })}
                  />
                  <FormInput
                    label={index === 0 ? 'Credit' : undefined}
                    type="number"
                    value={line.credit}
                    onChange={(e) => updateLine(index, { credit: e.target.value })}
                  />
                  <Btn
                    size="sm"
                    variant="ghost"
                    disabled={form.lines.length <= 2}
                    onClick={() => removeLine(index)}
                  >
                    Remove
                  </Btn>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
