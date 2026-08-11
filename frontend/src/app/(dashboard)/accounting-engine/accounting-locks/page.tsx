'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageSpinner, Modal, Btn, ConfirmDialog, FormInput, FormSelect, FormTextarea, showToast } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendPost, ApiError } from '@/lib/api-client';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

const LOCK_TYPES = ['PERIOD_LOCK', 'FISCAL_YEAR_LOCK', 'MODULE_LOCK', 'CUSTOM'];

function unwrapList<T>(json: any): T[] {
  const payload = json?.data ?? json;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

interface LockForm {
  lockCode: string;
  companyId: string;
  lockType: string;
  moduleName: string;
  lockedFrom: string;
  lockedTo: string;
  reason: string;
}

function LockModal({ companies, defaultCompanyId, onClose, onSaved }: { companies: Company[]; defaultCompanyId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<LockForm>({
    lockCode: '',
    companyId: defaultCompanyId,
    lockType: 'PERIOD_LOCK',
    moduleName: '',
    lockedFrom: '',
    lockedTo: '',
    reason: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof LockForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.lockCode || !form.companyId || !form.lockType) {
      setError('Lock code, company and lock type are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await backendPost('/accounting-locks', {
        lockCode: form.lockCode,
        companyId: form.companyId,
        lockType: form.lockType,
        moduleName: form.moduleName || undefined,
        lockedFrom: form.lockedFrom || undefined,
        lockedTo: form.lockedTo || undefined,
        reason: form.reason || undefined,
      });
      showToast('success', 'Accounting lock created');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create lock');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New Accounting Lock" size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Create Lock</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Lock Code" required value={form.lockCode} onChange={(e) => set('lockCode', e.target.value)} />
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.code ? `${c.code} - ${c.name}` : c.name}</option>)}
        </FormSelect>
        <FormSelect label="Lock Type" required value={form.lockType} onChange={(e) => set('lockType', e.target.value)}>
          {LOCK_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </FormSelect>
        <FormInput label="Module Name" value={form.moduleName} onChange={(e) => set('moduleName', e.target.value)} hint="For module locks" />
        <FormInput label="Locked From" type="date" value={form.lockedFrom} onChange={(e) => set('lockedFrom', e.target.value)} />
        <FormInput label="Locked To" type="date" value={form.lockedTo} onChange={(e) => set('lockedTo', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Reason" rows={2} value={form.reason} onChange={(e) => set('reason', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function AccountingLocksPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('accounting_locks.create');
  const canRelease = hasPermission('accounting_locks.release');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [releasing, setReleasing] = useState<any | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);

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

  const load = useCallback(() => {
    if (!companyId) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    fetch(`/api/backend/accounting-locks?companyId=${companyId}`)
      .then((r) => r.json())
      .then((res) =>
        setData(
          Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : [],
        ),
      )
      .catch((err) => {
        setData([]);
        setError(err instanceof Error ? err.message : 'Failed to load accounting locks');
      })
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const doRelease = async () => {
    if (!releasing) return;
    setReleaseBusy(true);
    try {
      await backendPost(`/accounting-locks/${releasing.id}/release`);
      showToast('success', 'Lock released');
      setReleasing(null);
      load();
    } catch (err) {
      showToast('error', 'Release failed', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setReleaseBusy(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Accounting Locks</h1>
        <p className="text-gray-500 mt-1">Manage accounting period and entity locks</p>
      </div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white"
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.code ? `${company.code} - ${company.name}` : company.name}
            </option>
          ))}
        </select>
        {canCreate && <Btn variant="primary" onClick={() => setCreating(true)}>+ New Lock</Btn>}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Lock Code</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Lock Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Locked From</th>
                <th className="px-4 py-3">Locked To</th>
                {canRelease && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={canRelease ? 7 : 6} className="px-4 py-8 text-center text-gray-400">
                    No records found
                  </td>
                </tr>
              ) : (
                data.map((row: any) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{row.lockCode}</td>
                    <td className="px-4 py-3">{row.companyId}</td>
                    <td className="px-4 py-3">{row.lockType}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'ACTIVE' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {row.lockedFrom ? new Date(row.lockedFrom).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {row.lockedTo ? new Date(row.lockedTo).toLocaleDateString() : '—'}
                    </td>
                    {canRelease && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {row.status === 'ACTIVE' && (
                          <Btn variant="ghost" size="xs" onClick={() => setReleasing(row)}>Release</Btn>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <LockModal
          companies={companies}
          defaultCompanyId={companyId}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}
      <ConfirmDialog
        open={!!releasing}
        title="Release Lock"
        message={`Release lock ${releasing?.lockCode ?? ''}? Transactions in the locked scope will become editable again.`}
        confirmLabel="Release"
        variant="danger"
        loading={releaseBusy}
        onConfirm={doRelease}
        onCancel={() => setReleasing(null)}
      />
    </div>
  );
}
