'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageSpinner, Modal, Btn, FormInput, FormSelect, showToast } from '@/components/ui';
import { backendPost, backendPut, ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }

interface Sequence {
  id: string;
  companyId?: string | null;
  sequenceCode: string;
  entityType: string;
  prefix?: string | null;
  suffix?: string | null;
  currentNumber: number;
  padding?: number | null;
  resetFrequency?: string | null;
  isActive: boolean;
}

const RESET_FREQUENCIES = ['NEVER', 'DAILY', 'MONTHLY', 'YEARLY'];

interface SequenceForm {
  companyId: string; sequenceCode: string; entityType: string; prefix: string; suffix: string;
  padding: string; startNumber: string; currentNumber: string; resetFrequency: string; isActive: string;
}
const BLANK: SequenceForm = { companyId: '', sequenceCode: '', entityType: '', prefix: '', suffix: '', padding: '', startNumber: '', currentNumber: '', resetFrequency: '', isActive: 'true' };

function SequenceModal({ mode, initial, companies, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: Sequence; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<SequenceForm>(() => initial ? {
    companyId: initial.companyId ?? '', sequenceCode: initial.sequenceCode, entityType: initial.entityType,
    prefix: initial.prefix ?? '', suffix: initial.suffix ?? '',
    padding: initial.padding != null ? String(initial.padding) : '',
    startNumber: '', currentNumber: String(initial.currentNumber),
    resetFrequency: initial.resetFrequency ?? '', isActive: String(initial.isActive),
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof SequenceForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (mode === 'create' && (!form.sequenceCode.trim() || !form.entityType.trim())) { setError('Sequence code and entity type are required'); return; }
    setSaving(true); setError('');
    try {
      if (mode === 'create') {
        await backendPost('/document-number-sequences', {
          companyId: form.companyId || undefined,
          sequenceCode: form.sequenceCode.trim(),
          entityType: form.entityType.trim(),
          prefix: form.prefix || undefined,
          suffix: form.suffix || undefined,
          padding: form.padding ? Number(form.padding) : undefined,
          startNumber: form.startNumber ? Number(form.startNumber) : undefined,
          resetFrequency: form.resetFrequency || undefined,
          isActive: form.isActive === 'true',
        });
      } else {
        await backendPut(`/document-number-sequences/${initial!.id}`, {
          prefix: form.prefix || undefined,
          suffix: form.suffix || undefined,
          padding: form.padding ? Number(form.padding) : undefined,
          currentNumber: form.currentNumber ? Number(form.currentNumber) : undefined,
          resetFrequency: form.resetFrequency || undefined,
          isActive: form.isActive === 'true',
        });
      }
      showToast('success', mode === 'create' ? 'Sequence created' : 'Sequence updated');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Sequence' : 'Edit Sequence'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        {mode === 'create' ? (
          <>
            <FormSelect label="Company" value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Group level (all companies)">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FormSelect>
            <FormInput label="Sequence Code" required value={form.sequenceCode} onChange={(e) => set('sequenceCode', e.target.value)} placeholder="e.g. INV-SEQ" />
            <FormInput label="Entity Type" required value={form.entityType} onChange={(e) => set('entityType', e.target.value)} placeholder="e.g. INVOICE" />
          </>
        ) : (
          <>
            <FormInput label="Sequence Code" value={form.sequenceCode} disabled />
            <FormInput label="Entity Type" value={form.entityType} disabled />
          </>
        )}
        <FormInput label="Prefix" value={form.prefix} onChange={(e) => set('prefix', e.target.value)} placeholder="e.g. INV-" />
        <FormInput label="Suffix" value={form.suffix} onChange={(e) => set('suffix', e.target.value)} />
        <FormInput label="Padding" type="number" min={1} max={20} value={form.padding} onChange={(e) => set('padding', e.target.value)} hint="Digits to pad the number to (1–20)" />
        {mode === 'create' ? (
          <FormInput label="Start Number" type="number" min={0} value={form.startNumber} onChange={(e) => set('startNumber', e.target.value)} hint="Defaults to 1" />
        ) : (
          <FormInput label="Current Number" type="number" min={0} value={form.currentNumber} onChange={(e) => set('currentNumber', e.target.value)} />
        )}
        <FormSelect label="Reset Frequency" value={form.resetFrequency} onChange={(e) => set('resetFrequency', e.target.value)} placeholder="—">
          {RESET_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
        </FormSelect>
        <FormSelect label="Status" value={form.isActive} onChange={(e) => set('isActive', e.target.value)}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </FormSelect>
      </div>
    </Modal>
  );
}

export default function DocumentNumberSequencesPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('doc_sequences.create');
  const canUpdate = hasPermission('doc_sequences.update');

  const [data, setData] = useState<Sequence[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Sequence | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    fetch('/api/backend/document-number-sequences')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.items) ? res.data.items : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {
        setData([]);
        setLoadError('Failed to load number sequences. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!canCreate) return;
    // Company dropdown options for the create modal only; failure just leaves the select empty.
    fetch('/api/backend/companies?limit=100')
      .then(r => r.json())
      .then(j => setCompanies(j.data?.data ?? j.data ?? []))
      .catch(() => undefined);
  }, [canCreate]);

  const onSaved = () => { setCreating(false); setEditing(null); load(); };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Document Number Sequences</h1>
          <p className="text-gray-500 mt-1">Manage auto-numbering sequences for documents</p>
        </div>
        {canCreate && <Btn variant="primary" onClick={() => setCreating(true)}>+ New Sequence</Btn>}
      </div>

      {loadError && (
        <div className="mb-4 flex items-center justify-between text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span>{loadError}</span>
          <button onClick={load} className="text-red-700 font-medium hover:underline ml-3">Retry</button>
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Sequence Code</th>
                <th className="px-4 py-3">Entity Type</th>
                <th className="px-4 py-3">Prefix</th>
                <th className="px-4 py-3">Suffix</th>
                <th className="px-4 py-3">Current #</th>
                <th className="px-4 py-3">Padding</th>
                <th className="px-4 py-3">Reset Frequency</th>
                <th className="px-4 py-3">Active</th>
                {canUpdate && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={canUpdate ? 9 : 8} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.sequenceCode}</td>
                  <td className="px-4 py-3">{row.entityType}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.prefix ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.suffix ?? '—'}</td>
                  <td className="px-4 py-3 font-bold">{row.currentNumber}</td>
                  <td className="px-4 py-3">{row.padding}</td>
                  <td className="px-4 py-3">{row.resetFrequency ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {row.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canUpdate && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Btn variant="ghost" size="xs" onClick={() => setEditing(row)}>Edit</Btn>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <SequenceModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <SequenceModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}
