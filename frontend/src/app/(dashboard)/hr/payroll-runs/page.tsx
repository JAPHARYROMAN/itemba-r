'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Card,
  PageHeader,
  StatusBadge,
  FormInput,
  FormSelect,
  Modal,
  Btn,
  PageToolbar,
  PageSpinner,
} from '@/components/ui';

interface DisbursementFile {
  filename: string;
  mimeType: string;
  rowCount: number;
  total: number;
  content: string;
}

interface DisbursementManifest {
  runNumber: string;
  companyName: string;
  generatedAt: string;
  summary: { totalEmployees: number; viaBank: number; viaMobileMoney: number; unmapped: number };
  files: DisbursementFile[];
}

function downloadCsv(file: DisbursementFile) {
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

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface PayrollRun {
  id: string;
  runNumber: string;
  period?: string;
  periodId?: string;
  runType: string;
  totalGross?: number;
  totalNet?: number;
  status: string;
}

interface FormState {
  periodId: string;
  runType: string;
}

const empty: FormState = { periodId: '', runType: 'REGULAR' };

interface ChartAccount {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
}

function PayrollRunsContent() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [periodFilter, setPeriodFilter] = useState(searchParams.get('periodId') ?? '');
  const [filesManifest, setFilesManifest] = useState<DisbursementManifest | null>(null);
  const [filesError, setFilesError] = useState('');
  const [filesLoading, setFilesLoading] = useState(false);
  const [payModalRunId, setPayModalRunId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [disbursingAccountId, setDisbursingAccountId] = useState('');
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState('');

  const openDisbursementFiles = async (runId: string) => {
    setFilesError('');
    setFilesLoading(true);
    setFilesManifest({
      runNumber: '…',
      companyName: '',
      generatedAt: '',
      summary: { totalEmployees: 0, viaBank: 0, viaMobileMoney: 0, unmapped: 0 },
      files: [],
    });
    try {
      const res = await fetch(`/api/backend/hr/payroll-runs/${runId}/disbursement-files`, {
        method: 'POST',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Generation failed'),
        );
      }
      const j = await res.json();
      setFilesManifest(j.data ?? j);
    } catch (err: unknown) {
      setFilesError(err instanceof Error ? err.message : 'Failed');
      setFilesManifest(null);
    } finally {
      setFilesLoading(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (periodFilter) params.set('periodId', periodFilter);
    const r = await fetch(`/api/backend/hr/payroll-runs?${params}`);
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  }, [periodFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/backend/hr/payroll-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setShowModal(false);
    load();
  };

  const doAction = async (id: string, action: string) => {
    if (action === 'pay') {
      setPayError('');
      setDisbursingAccountId('');
      setPayModalRunId(id);
      // Lazy-load accounts the first time the Pay modal opens.
      if (accounts.length === 0) {
        try {
          const r = await fetch('/api/backend/finance/chart-of-accounts?limit=500');
          const j = await r.json();
          const list: ChartAccount[] = Array.isArray(j.data?.data)
            ? j.data.data
            : Array.isArray(j.data)
              ? j.data
              : [];
          // Cash + Bank accounts are the natural disbursing accounts.
          setAccounts(list.filter((a) => a.accountType === 'ASSET'));
        } catch {
          // Fall through — operator can still submit without selection.
        }
      }
      return;
    }
    setActionLoading(`${id}-${action}`);
    await fetch(`/api/backend/hr/payroll-runs/${id}/${action}`, { method: 'PATCH' });
    setActionLoading('');
    load();
  };

  const submitPay = async () => {
    if (!payModalRunId) return;
    setPaySubmitting(true);
    setPayError('');
    try {
      const res = await fetch(`/api/backend/hr/payroll-runs/${payModalRunId}/pay`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          disbursingAccountId ? { disbursingChartOfAccountId: disbursingAccountId } : {},
        ),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Pay failed'),
        );
      }
      setPayModalRunId(null);
      load();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setPaySubmitting(false);
    }
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const ACTIONS: Record<
    string,
    { action: string; label: string; variant: 'primary' | 'warning' | 'success' | 'danger' }[]
  > = {
    DRAFT: [{ action: 'calculate', label: 'Calculate', variant: 'primary' }],
    CALCULATED: [{ action: 'submit', label: 'Submit', variant: 'warning' }],
    SUBMITTED: [
      { action: 'approve', label: 'Approve', variant: 'success' },
      { action: 'cancel', label: 'Cancel', variant: 'danger' },
    ],
    APPROVED: [{ action: 'pay', label: 'Pay', variant: 'success' }],
  };

  return (
    <div className="p-6">
      <PageHeader title="Payroll Runs" subtitle="Process and manage payroll runs" />
      <PageToolbar
        filters={
          <input
            type="text"
            placeholder="Filter by period ID…"
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-brand-500"
            style={{
              borderColor: 'var(--aurora-border)',
              background: 'var(--aurora-card)',
              color: 'var(--aurora-text)',
            }}
          />
        }
        actions={
          <Btn
            variant="primary"
            onClick={() => {
              setForm(empty);
              setShowModal(true);
            }}
          >
            + New Run
          </Btn>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead
                className="bg-slate-50 border-b border-slate-100"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <tr>
                  <th className={thCls}>Run #</th>
                  <th className={thCls}>Period</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Total Gross</th>
                  <th className={thCls}>Total Net</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono font-medium`}>{r.runNumber}</td>
                    <td className={tdCls}>{r.period ?? r.periodId ?? '—'}</td>
                    <td className={tdCls}>{r.runType}</td>
                    <td className={tdCls}>
                      {r.totalGross != null
                        ? `TZS ${Number(r.totalGross).toLocaleString('en-TZ')}`
                        : '—'}
                    </td>
                    <td className={tdCls}>
                      {r.totalNet != null
                        ? `TZS ${Number(r.totalNet).toLocaleString('en-TZ')}`
                        : '—'}
                    </td>
                    <td className={tdCls}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className={tdCls}>
                      <div className="flex flex-wrap gap-1">
                        {(ACTIONS[r.status] ?? []).map((act) => (
                          <Btn
                            key={act.action}
                            variant={act.variant}
                            size="xs"
                            onClick={() => doAction(r.id, act.action)}
                            disabled={actionLoading === `${r.id}-${act.action}`}
                          >
                            {actionLoading === `${r.id}-${act.action}` ? '…' : act.label}
                          </Btn>
                        ))}
                        {['CALCULATED', 'APPROVED', 'PAID'].includes(r.status) && (
                          <>
                            <Btn
                              variant="ghost"
                              size="xs"
                              onClick={() => openDisbursementFiles(r.id)}
                            >
                              Files
                            </Btn>
                            <Link href={`/hr/payroll-runs/${r.id}/payslips`}>
                              <Btn variant="ghost" size="xs">
                                Payslips
                              </Btn>
                            </Link>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="text-center py-8 text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No payroll runs found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="New Payroll Run"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" type="submit" form="payroll-run-form" loading={saving}>
              Create
            </Btn>
          </>
        }
      >
        <form id="payroll-run-form" onSubmit={handleSubmit} className="space-y-3">
          <FormInput
            label="Payroll Period ID"
            value={form.periodId}
            onChange={f('periodId')}
            required
          />
          <FormSelect
            label="Run Type"
            value={form.runType}
            onChange={f('runType')}
            options={[
              { value: 'REGULAR', label: 'Regular' },
              { value: 'SUPPLEMENTARY', label: 'Supplementary' },
              { value: 'FINAL', label: 'Final' },
            ]}
          />
        </form>
      </Modal>

      <Modal
        open={!!filesManifest}
        onClose={() => setFilesManifest(null)}
        title="Disbursement files"
        size="lg"
        footer={
          <Btn variant="secondary" onClick={() => setFilesManifest(null)}>
            Close
          </Btn>
        }
      >
        {filesLoading ? (
          <PageSpinner />
        ) : filesError ? (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
            {filesError}
          </div>
        ) : filesManifest ? (
          <div className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1">
              <div>
                <strong>Run:</strong> {filesManifest.runNumber} · {filesManifest.companyName}
              </div>
              <div>
                <strong>Generated:</strong>{' '}
                {filesManifest.generatedAt &&
                  new Date(filesManifest.generatedAt).toLocaleString('en-GB')}
              </div>
              <div className="flex gap-3 mt-2">
                <span>
                  <strong>{filesManifest.summary.totalEmployees}</strong> employees
                </span>
                <span>
                  via bank: <strong>{filesManifest.summary.viaBank}</strong>
                </span>
                <span>
                  via mobile money: <strong>{filesManifest.summary.viaMobileMoney}</strong>
                </span>
                {filesManifest.summary.unmapped > 0 && (
                  <span className="text-amber-700">
                    ⚠ unmapped: <strong>{filesManifest.summary.unmapped}</strong>
                  </span>
                )}
              </div>
            </div>

            {filesManifest.files.length === 0 ? (
              <p className="text-sm text-slate-500 italic">
                No files generated. Make sure employees have bank or mobile-money accounts on file.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className={thCls}>Filename</th>
                    <th className={thCls}>Rows</th>
                    <th className={thCls}>Total (TZS)</th>
                    <th className={thCls + ' text-right'}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filesManifest.files.map((file) => (
                    <tr key={file.filename} className="border-b border-slate-100">
                      <td className={`${tdCls} font-mono text-xs`}>{file.filename}</td>
                      <td className={tdCls}>{file.rowCount}</td>
                      <td className={tdCls}>
                        {Number(file.total).toLocaleString('en-TZ', { minimumFractionDigits: 2 })}
                      </td>
                      <td className={tdCls + ' text-right'}>
                        <Btn variant="primary" size="xs" onClick={() => downloadCsv(file)}>
                          Download
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <p className="text-xs text-slate-500">
              Files are generated on demand and not stored on the server. Download each, sign off,
              and upload to the corresponding bank or mobile-money portal.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!payModalRunId}
        onClose={() => setPayModalRunId(null)}
        title="Pay payroll run"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setPayModalRunId(null)}>
              Cancel
            </Btn>
            <Btn variant="success" onClick={submitPay} loading={paySubmitting}>
              Confirm payment
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Choose the cash or bank account from which the net pay will be disbursed. The journal
            entry will credit this account; if left blank, the generic Bank (1010) is used as a
            fallback.
          </p>
          <FormSelect
            label="Disbursing account"
            value={disbursingAccountId}
            onChange={(e) => setDisbursingAccountId(e.target.value)}
            options={[
              { value: '', label: '— Use default Bank (1010) —' },
              ...accounts.map((a) => ({
                value: a.id,
                label: `${a.accountCode} — ${a.accountName}`,
              })),
            ]}
          />
          {payError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {payError}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default function PayrollRunsPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <PayrollRunsContent />
    </Suspense>
  );
}
