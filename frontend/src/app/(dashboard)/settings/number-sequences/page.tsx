'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Hash, ListFilter, Plus, RefreshCw, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { Card, PageHeader, FormInput, FormSelect, Btn, Modal, ConfirmDialog } from '@/components/ui';

interface Company { id: string; name: string; code: string; }

interface NumberSequence {
  id: string;
  sequenceCode: string;
  companyId?: string | null;
  entityType: string;
  prefix?: string | null;
  suffix?: string | null;
  currentNumber: number;
  padding: number;
  resetFrequency: 'NEVER' | 'DAILY' | 'MONTHLY' | 'YEARLY';
  lastResetAt?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const RESET_FREQUENCIES = [
  { value: 'NEVER', label: 'Never' },
  { value: 'DAILY', label: 'Daily' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY', label: 'Yearly' },
];

interface FormState {
  sequenceCode: string;
  companyId: string;
  entityType: string;
  prefix: string;
  suffix: string;
  startNumber: string;
  padding: string;
  resetFrequency: 'NEVER' | 'DAILY' | 'MONTHLY' | 'YEARLY';
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  sequenceCode: '',
  companyId: '',
  entityType: '',
  prefix: '',
  suffix: '',
  startNumber: '0',
  padding: '5',
  resetFrequency: 'NEVER',
  isActive: true,
};

function preview(form: { prefix: string; padding: string; suffix: string; startNumber: string }) {
  const next = (Number.parseInt(form.startNumber, 10) || 0) + 1;
  const pad = Math.max(Number.parseInt(form.padding, 10) || 0, 0);
  return `${form.prefix ?? ''}${String(next).padStart(pad, '0')}${form.suffix ?? ''}`;
}

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString() : '—');

function formFromSequence(seq: NumberSequence): FormState {
  return {
    sequenceCode: seq.sequenceCode,
    companyId: seq.companyId ?? '',
    entityType: seq.entityType,
    prefix: seq.prefix ?? '',
    suffix: seq.suffix ?? '',
    startNumber: String(seq.currentNumber),
    padding: String(seq.padding),
    resetFrequency: seq.resetFrequency,
    isActive: seq.isActive,
  };
}

export default function NumberSequencesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [sequences, setSequences] = useState<NumberSequence[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NumberSequence | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [advancing, setAdvancing] = useState<NumberSequence | null>(null);
  const activeCount = useMemo(() => sequences.filter((seq) => seq.isActive).length, [sequences]);
  const globalCount = useMemo(() => sequences.filter((seq) => !seq.companyId).length, [sequences]);
  const selectedCompany = companies.find((company) => company.id === companyId);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        const inner = j.data?.data ?? j.data;
        const rows: Company[] = Array.isArray(inner) ? inner : Array.isArray(inner?.data) ? inner.data : [];
        setCompanies(rows);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      params.set('limit', '100');
      const res = await fetch(`/api/backend/document-number-sequences?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const inner = json.data ?? json;
      setSequences(Array.isArray(inner.items) ? inner.items : Array.isArray(inner.data) ? inner.data : []);
      setTotal(typeof inner.total === 'number' ? inner.total : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sequences');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, companyId });
    setOpen(true);
    setInfo(''); setError('');
  };
  const openEdit = (seq: NumberSequence) => {
    setEditing(seq);
    setForm(formFromSequence(seq));
    setOpen(true);
    setInfo(''); setError('');
  };

  const resetForm = () => {
    setForm(editing ? formFromSequence(editing) : { ...EMPTY_FORM, companyId });
    setError('');
  };

  const submit = async () => {
    setSaving(true); setError(''); setInfo('');
    try {
      const body: Record<string, unknown> = {
        sequenceCode: form.sequenceCode.trim(),
        entityType: form.entityType.trim(),
        prefix: form.prefix.trim() || null,
        suffix: form.suffix.trim() || null,
        padding: Number.parseInt(form.padding, 10) || 5,
        resetFrequency: form.resetFrequency,
        isActive: form.isActive,
      };
      if (form.companyId) body.companyId = form.companyId;
      if (!editing) body.startNumber = Number.parseInt(form.startNumber, 10) || 0;

      const url = editing
        ? `/api/backend/document-number-sequences/${editing.id}`
        : `/api/backend/document-number-sequences`;
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      setOpen(false);
      setInfo(editing ? 'Sequence updated.' : 'Sequence created.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const advance = async (seq: NumberSequence) => {
    try {
      const res = await fetch(`/api/backend/document-number-sequences/${seq.id}/next`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data = json.data ?? json;
      setInfo(`Advanced ${seq.sequenceCode} → ${data.formatted ?? data.number}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance');
    }
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Number Sequences"
        subtitle="Prefixes, padding, and counters for auto-generated entity numbers."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Number Sequences' }]}
        actions={
          <div className="flex items-center gap-2">
            <Btn
              variant="secondary"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={load}
              disabled={loading}
            >
              Reload
            </Btn>
            <Btn icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>New sequence</Btn>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SequenceSummary
          icon={<Hash className="h-4 w-4" />}
          label="Registered sequences"
          value={String(total || sequences.length)}
          note={`${activeCount} active in the current view.`}
        />
        <SequenceSummary
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Scope"
          value={selectedCompany?.name ?? 'All companies'}
          note={companyId ? 'Showing company-specific and linked numbering.' : `${globalCount} global sequences visible.`}
        />
        <SequenceSummary
          icon={<ListFilter className="h-4 w-4" />}
          label="Reset rules"
          value={sequences.some((seq) => seq.resetFrequency !== 'NEVER') ? 'Configured' : 'Manual counters'}
          note="Daily, monthly, or yearly reset rules appear in the table."
        />
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)] lg:items-end">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Find a sequence</div>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Filter by company before editing counters so document numbers stay scoped to the right business.
            </p>
          </div>
          <FormSelect
            label="Filter by Company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            placeholder="— All companies —"
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {info && <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">{info}</div>}
      {loading && <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}

      {!loading && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-1 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Document number rules</div>
              <div className="text-xs text-slate-500">{total} sequence{total === 1 ? '' : 's'} in this view</div>
            </div>
            <div className="text-xs text-slate-500">Next number is shown before you edit or advance a counter.</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Code</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Entity</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Company</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Prefix</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Suffix</th>
                  <th className="px-4 py-2 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Current</th>
                  <th className="px-4 py-2 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Pad</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Reset</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Next preview</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sequences.length === 0 ? (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-slate-400">No sequences yet. Click <strong>New Sequence</strong> to define one.</td></tr>
                ) : sequences.map((seq) => {
                  const company = companies.find((c) => c.id === seq.companyId);
                  const next = `${seq.prefix ?? ''}${String(seq.currentNumber + 1).padStart(seq.padding, '0')}${seq.suffix ?? ''}`;
                  return (
                    <tr key={seq.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-xs text-slate-800">{seq.sequenceCode}</td>
                      <td className="px-4 py-2 text-slate-700">{seq.entityType}</td>
                      <td className="px-4 py-2 text-slate-700">{company?.name ?? (seq.companyId ? '—' : <span className="text-slate-400">All</span>)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-600">{seq.prefix || '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-600">{seq.suffix || '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700">{seq.currentNumber}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700">{seq.padding}</td>
                      <td className="px-4 py-2 text-slate-700">{seq.resetFrequency}</td>
                      <td className="px-4 py-2 font-mono text-xs text-indigo-700">{next}</td>
                      <td className="px-4 py-2">
                        {seq.isActive
                          ? <span className="inline-flex items-center px-2 py-0.5 border rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border-emerald-200">Active</span>
                          : <span className="inline-flex items-center px-2 py-0.5 border rounded-full text-[10px] font-medium bg-zinc-100 text-zinc-500 border-zinc-200">Inactive</span>}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setAdvancing(seq)} className="text-xs text-indigo-600 hover:underline mr-3">Advance</button>
                        <button onClick={() => openEdit(seq)} className="text-xs text-slate-600 hover:underline">Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Sequence' : 'New Sequence'}
        subtitle="Define the prefix, counter, reset rule, and company scope for generated document numbers."
        size="lg"
      >
        <div className="space-y-4">
          <SequenceEditorIntro
            title={editing ? 'Update an existing sequence' : 'Create a new sequence'}
            description={
              editing
                ? 'Code and current counter are protected here. Use Advance for audit-logged manual number use.'
                : 'Start number is the last number used. The first generated number will be start number plus one.'
            }
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput
              label="Sequence Code"
              value={form.sequenceCode}
              onChange={(e) => setForm((f) => ({ ...f, sequenceCode: e.target.value }))}
              required
              hint="Unique code, e.g. TRIP-MAIN, INV-WST."
              disabled={!!editing}
            />
            <FormInput
              label="Entity Type"
              value={form.entityType}
              onChange={(e) => setForm((f) => ({ ...f, entityType: e.target.value }))}
              required
              hint="Trip, Invoice, PurchaseOrder, …"
            />
            <FormSelect
              label="Company"
              value={form.companyId}
              onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
              placeholder="— All companies —"
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              hint="Leave blank for a global sequence."
            />
            <FormSelect
              label="Reset Frequency"
              value={form.resetFrequency}
              onChange={(e) => setForm((f) => ({ ...f, resetFrequency: e.target.value as FormState['resetFrequency'] }))}
              options={RESET_FREQUENCIES}
            />
            <FormInput
              label="Prefix"
              value={form.prefix}
              onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value }))}
              placeholder="TRIP-"
            />
            <FormInput
              label="Suffix"
              value={form.suffix}
              onChange={(e) => setForm((f) => ({ ...f, suffix: e.target.value }))}
              placeholder=""
            />
            <FormInput
              label={editing ? 'Current Number' : 'Start Number'}
              value={form.startNumber}
              onChange={(e) => setForm((f) => ({ ...f, startNumber: e.target.value }))}
              type="number"
              min={0}
              hint={editing ? 'Last number used. Next will be this + 1.' : 'First issued will be this + 1.'}
              disabled={!!editing}
            />
            <FormInput
              label="Padding"
              value={form.padding}
              onChange={(e) => setForm((f) => ({ ...f, padding: e.target.value }))}
              type="number"
              min={0}
              max={12}
              hint="Number is left-padded with zeros to this width."
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="np_active"
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="rounded border-slate-300"
            />
            <label htmlFor="np_active" className="text-sm text-slate-700">Active</label>
          </div>

          <div className="border border-dashed border-slate-200 rounded-md p-3 bg-slate-50">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Next number preview</div>
            <div className="font-mono text-base text-indigo-700">{preview(form)}</div>
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Btn
              variant="secondary"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={resetForm}
              disabled={saving}
            >
              Reset form
            </Btn>
            <Btn variant="secondary" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn
              icon={<Save className="h-3.5 w-3.5" />}
              onClick={submit}
              disabled={saving || !form.sequenceCode.trim() || !form.entityType.trim()}
            >
              {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
            </Btn>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!advancing}
        title="Advance Sequence"
        variant="warning"
        confirmLabel="Advance"
        message={
          advancing
            ? `Advance "${advancing.sequenceCode}" — preview ${advancing.prefix ?? ''}${String(advancing.currentNumber + 1).padStart(advancing.padding, '0')}${advancing.suffix ?? ''}? This consumes the number and is an audit-logged operation.`
            : ''
        }
        onConfirm={async () => {
          const seq = advancing;
          if (!seq) return;
          await advance(seq);
          setAdvancing(null);
        }}
        onCancel={() => setAdvancing(null)}
      />

      {sequences.length > 0 && (
        <p className="text-[11px] text-slate-400">
          Last updated {fmtDate(sequences[0]?.updatedAt)}.
          <span className="ml-2">
            Integration note: verify each document workflow before treating a sequence as official.
          </span>
        </p>
      )}
    </div>
  );
}

function SequenceSummary({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-900">{value}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">{note}</div>
        </div>
      </div>
    </Card>
  );
}

function SequenceEditorIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <p className="mt-1 text-xs leading-5 text-slate-600">{description}</p>
    </div>
  );
}
