'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, RotateCcw, Save } from 'lucide-react';
import {
  PageHeader,
  FormInput,
  FormSelect,
  Btn,
  Modal,
  ConfirmDialog,
  PermissionDeniedState,
} from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { useFormGuard } from '@/components/workspace/unsaved-work-provider';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';
import '@/components/workspace/workspace.css';

interface Company {
  id: string;
  name: string;
  code: string;
}

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
  const pad = Math.min(20, Math.max(Number.parseInt(form.padding, 10) || 1, 1));
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
  const { hasPermission } = useAuth();
  const canRead = hasPermission('doc_sequences.list');
  const canCreate = hasPermission('doc_sequences.create');
  const canUpdate = hasPermission('doc_sequences.update');
  const startRequest = useRequestGuard();
  const [page, setPage] = useState(1);
  const pageSize = 20;
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
  const draft = useFormGuard(form, setForm);
  const closeEditor = () => draft.requestClose(() => setOpen(false));
  const activeCount = useMemo(() => sequences.filter((seq) => seq.isActive).length, [sequences]);
  const globalCount = useMemo(() => sequences.filter((seq) => !seq.companyId).length, [sequences]);
  const selectedCompany = companies.find((company) => company.id === companyId);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        const inner = j.data?.data ?? j.data;
        const rows: Company[] = Array.isArray(inner)
          ? inner
          : Array.isArray(inner?.data)
            ? inner.data
            : [];
        setCompanies(rows);
      })
      // Company filter dropdown only: the sequences load has its own error state; failure just leaves the filter empty.
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    if (!canRead) return;
    const request = startRequest();
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      params.set('limit', String(pageSize));
      params.set('page', String(page));
      const res = await fetch(`/api/backend/document-number-sequences?${params}`, {
        signal: request.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const inner = json.data ?? json;
      if (!request.current()) return;
      setSequences(
        Array.isArray(inner.items) ? inner.items : Array.isArray(inner.data) ? inner.data : [],
      );
      setTotal(typeof inner.total === 'number' ? inner.total : 0);
    } catch (err) {
      if (request.current())
        setError(err instanceof Error ? err.message : 'Failed to load sequences');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [companyId, page, canRead, startRequest]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    if (!canCreate) return;
    draft.markSaved();
    setEditing(null);
    setForm({ ...EMPTY_FORM, companyId });
    setOpen(true);
    setInfo('');
    setError('');
  };
  const openEdit = (seq: NumberSequence) => {
    if (!canUpdate) return;
    draft.markSaved();
    setEditing(seq);
    setForm(formFromSequence(seq));
    setOpen(true);
    setInfo('');
    setError('');
  };

  const resetForm = () => {
    setForm(editing ? formFromSequence(editing) : { ...EMPTY_FORM, companyId });
    setError('');
  };

  const submit = async () => {
    if (editing ? !canUpdate : !canCreate) return;
    const padding = Number(form.padding);
    const start = Number(form.startNumber);
    if (
      !Number.isInteger(padding) ||
      padding < 1 ||
      padding > 20 ||
      (!editing && (!Number.isSafeInteger(start) || start < 0))
    ) {
      setError('Use a padding between 1 and 20 and a non-negative whole start number.');
      return;
    }
    setSaving(true);
    setError('');
    setInfo('');
    try {
      const body: Record<string, unknown> = {
        prefix: form.prefix.trim() || null,
        suffix: form.suffix.trim() || null,
        padding,
        resetFrequency: form.resetFrequency,
        isActive: form.isActive,
      };
      if (!editing) {
        body.sequenceCode = form.sequenceCode.trim();
        body.entityType = form.entityType.trim();
        if (form.companyId) body.companyId = form.companyId;
        body.startNumber = start;
      }

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
      draft.markSaved();
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
    if (!canUpdate) return;
    try {
      const res = await fetch(`/api/backend/document-number-sequences/${seq.id}/next`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data = json.data ?? json;
      setInfo(`Advanced ${seq.sequenceCode} → ${data.formatted ?? data.number}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance');
    }
  };

  if (!canRead) return <PermissionDeniedState />;

  return (
    <div className="business-workspace record-workspace space-y-5">
      <PageHeader
        title="Document numbers"
        subtitle="A clear sequence for every business document."
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
            <>
              {canCreate && (
                <Btn icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>
                  New sequence
                </Btn>
              )}
            </>
          </div>
        }
      />

      <div className="workspace-summary">
        <div>
          <span>Sequences</span>
          <strong>{total}</strong>
        </div>
        <div>
          <span>Active on this page</span>
          <strong>{activeCount}</strong>
        </div>
        <div>
          <span>Global on this page</span>
          <strong>{globalCount}</strong>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="w-full sm:max-w-sm">
          <FormSelect
            label="Company"
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value);
              setPage(1);
            }}
            placeholder="All companies"
            options={companies.map((company) => ({ value: company.id, label: company.name }))}
          />
        </div>
        <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
          {selectedCompany?.name ?? 'Your accessible companies and global sequences'}
        </p>
      </div>
      {info && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {info}
        </p>
      )}
      <RecordBrowser
        records={sequences}
        title="Number sequences"
        name={(seq) => seq.sequenceCode}
        reference={(seq) => seq.entityType}
        status={(seq) => (seq.isActive ? 'ACTIVE' : 'INACTIVE')}
        fields={[
          { label: 'Next number', value: (seq) => preview(formFromSequence(seq)) },
          {
            label: 'Company',
            value: (seq) =>
              companies.find((company) => company.id === seq.companyId)?.name ??
              (seq.companyId ? 'Company sequence' : 'Global'),
          },
        ]}
        details={[
          { label: 'Current number', value: (seq) => seq.currentNumber },
          { label: 'Prefix', value: (seq) => seq.prefix || 'None' },
          { label: 'Suffix', value: (seq) => seq.suffix || 'None' },
          { label: 'Padding', value: (seq) => seq.padding },
          { label: 'Reset frequency', value: (seq) => seq.resetFrequency },
          { label: 'Last reset', value: (seq) => fmtDate(seq.lastResetAt) },
          { label: 'Updated', value: (seq) => fmtDate(seq.updatedAt) },
        ]}
        actions={(seq) =>
          canUpdate && (
            <>
              <Btn onClick={() => openEdit(seq)}>Edit sequence</Btn>
              <Btn variant="secondary" onClick={() => setAdvancing(seq)}>
                Advance number
              </Btn>
            </>
          )
        }
        page={page}
        pageSize={pageSize}
        total={total}
        onPage={setPage}
        loading={loading}
        error={!open ? error : undefined}
        onRetry={load}
        empty="No numbering rules in this scope."
      />

      <Modal
        open={open}
        onClose={closeEditor}
        onChangeCapture={draft.touch}
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
              disabled={!!editing}
              value={form.entityType}
              onChange={(e) => setForm((f) => ({ ...f, entityType: e.target.value }))}
              required
              hint="Trip, Invoice, PurchaseOrder, …"
            />
            <FormSelect
              label="Company"
              disabled={!!editing}
              value={form.companyId}
              onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
              placeholder="— All companies —"
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              hint="Leave blank for a global sequence."
            />
            <FormSelect
              label="Reset Frequency"
              value={form.resetFrequency}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  resetFrequency: e.target.value as FormState['resetFrequency'],
                }))
              }
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
              hint={
                editing
                  ? 'Last number used. Next will be this + 1.'
                  : 'First issued will be this + 1.'
              }
              disabled={!!editing}
            />
            <FormInput
              label="Padding"
              value={form.padding}
              onChange={(e) => setForm((f) => ({ ...f, padding: e.target.value }))}
              type="number"
              min={1}
              max={20}
              hint="Number is left-padded with zeros to this width."
            />
          </div>

          <div className="flex items-center gap-2">
            <input aria-label="Active"
              id="np_active"
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="rounded border-slate-300"
            />
            <label htmlFor="np_active" className="text-sm text-slate-700">
              Active
            </label>
          </div>

          <div className="border border-dashed border-slate-200 rounded-md p-3 bg-slate-50">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Next number preview
            </div>
            <div className="font-mono text-base text-indigo-700">{preview(form)}</div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Btn
              variant="secondary"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => draft.requestClose(resetForm)}
              disabled={saving}
            >
              Reset form
            </Btn>
            <Btn variant="secondary" onClick={closeEditor}>
              Cancel
            </Btn>
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
    </div>
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
