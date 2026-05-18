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

interface Company { id: string; name: string; code?: string | null }
interface FixedAsset {
  id: string;
  assetCode?: string | null;
  name: string;
  companyId: string;
  acquisitionCost?: number | string | null;
  currentBookValue?: number | string | null;
  residualValue?: number | string | null;
  usefulLifeYears?: number | null;
  depreciationRate?: number | string | null;
}
interface DepreciationSchedule {
  id: string;
  scheduleNumber: string;
  companyId: string;
  fixedAssetId: string;
  depreciationMethod: string;
  startDate: string;
  endDate?: string | null;
  usefulLifeMonths?: number | null;
  salvageValue: number;
  depreciationRate?: number | null;
  totalDepreciableAmount: number;
  accumulatedDepreciation: number;
  status: string;
  createdAt: string;
}
interface DepreciationEntry {
  id: string;
  depreciationDate: string;
  amount: number;
  accumulatedDepreciationAfter: number;
  status: string;
  journalEntryId?: string | null;
}

const today = new Date().toISOString().slice(0, 10);
const METHODS = ['STRAIGHT_LINE', 'REDUCING_BALANCE', 'MANUAL', 'OTHER'];

function unwrapList<T>(json: any): T[] {
  const payload = json?.data ?? json;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

function optionLabel(row: { name: string; code?: string | null; assetCode?: string | null }) {
  const code = row.assetCode ?? row.code;
  return code ? `${code} - ${row.name}` : row.name;
}

function fmtMoney(amount: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number.isFinite(Number(amount ?? 0)) ? Number(amount ?? 0) : 0)}`;
}

function scheduleNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `DEP-${stamp}-${Date.now().toString(36).toUpperCase()}`;
}

export default function DepreciationPage() {
  const [rows, setRows] = useState<DepreciationSchedule[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [entries, setEntries] = useState<DepreciationEntry[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<DepreciationSchedule | null>(null);
  const [creating, setCreating] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [months, setMonths] = useState('12');
  const [form, setForm] = useState({
    scheduleNumber: '',
    companyId: '',
    fixedAssetId: '',
    depreciationMethod: 'STRAIGHT_LINE',
    startDate: today,
    endDate: '',
    usefulLifeMonths: '60',
    salvageValue: '0',
    depreciationRate: '',
    totalDepreciableAmount: '0',
    accumulatedDepreciation: '0',
    status: 'ACTIVE',
  });
  const [entryForm, setEntryForm] = useState({
    depreciationDate: today,
    amount: '',
    accumulatedDepreciationAfter: '',
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
      setAssets([]);
      return;
    }
    fetch(`/api/backend/fixed-assets?companyId=${id}&limit=300`)
      .then((r) => r.json())
      .then((j) => setAssets(unwrapList<FixedAsset>(j)))
      .catch(() => setAssets([]));
  }, [companyId, form.companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (companyId) params.set('companyId', companyId);
      const json = await fetch(`/api/backend/depreciation?${params}`).then((r) => r.json());
      setRows(unwrapList<DepreciationSchedule>(json));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load depreciation schedules');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const filteredRows = status ? rows.filter((row) => row.status === status) : rows;
  const activeCount = rows.filter((row) => row.status === 'ACTIVE').length;
  const accumulated = rows.reduce((sum, row) => sum + Number(row.accumulatedDepreciation ?? 0), 0);

  const loadEntries = async (schedule: DepreciationSchedule) => {
    setSelected(schedule);
    try {
      const json = await fetch(`/api/backend/depreciation/${schedule.id}/entries`).then((r) => r.json());
      setEntries(unwrapList<DepreciationEntry>(json));
    } catch {
      setEntries([]);
    }
  };

  const openCreate = () => {
    setForm({
      scheduleNumber: scheduleNumber(),
      companyId,
      fixedAssetId: '',
      depreciationMethod: 'STRAIGHT_LINE',
      startDate: today,
      endDate: '',
      usefulLifeMonths: '60',
      salvageValue: '0',
      depreciationRate: '',
      totalDepreciableAmount: '0',
      accumulatedDepreciation: '0',
      status: 'ACTIVE',
    });
    setCreating(true);
  };

  const pickAsset = (assetId: string) => {
    const asset = assets.find((item) => item.id === assetId);
    const acquisition = Number(asset?.acquisitionCost ?? asset?.currentBookValue ?? 0);
    const salvage = Number(asset?.residualValue ?? 0);
    setForm((f) => ({
      ...f,
      fixedAssetId: assetId,
      usefulLifeMonths: asset?.usefulLifeYears ? String(asset.usefulLifeYears * 12) : f.usefulLifeMonths,
      salvageValue: String(salvage),
      depreciationRate: asset?.depreciationRate ? String(asset.depreciationRate) : f.depreciationRate,
      totalDepreciableAmount: String(Math.max(acquisition - salvage, 0)),
    }));
  };

  const saveSchedule = async () => {
    if (!form.companyId || !form.fixedAssetId || !form.scheduleNumber.trim()) {
      setError('Company, fixed asset, and schedule number are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        scheduleNumber: form.scheduleNumber,
        companyId: form.companyId,
        fixedAssetId: form.fixedAssetId,
        depreciationMethod: form.depreciationMethod,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        usefulLifeMonths: form.usefulLifeMonths ? Number(form.usefulLifeMonths) : undefined,
        salvageValue: Number(form.salvageValue || 0),
        depreciationRate: form.depreciationRate ? Number(form.depreciationRate) : undefined,
        totalDepreciableAmount: Number(form.totalDepreciableAmount || 0),
        accumulatedDepreciation: Number(form.accumulatedDepreciation || 0),
        status: form.status,
      };
      const response = await fetch('/api/backend/depreciation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  const generateEntries = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/backend/depreciation/${selected.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: Number(months || 12) }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Generate failed');
      await loadEntries(selected);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generate failed');
    } finally {
      setSaving(false);
    }
  };

  const addEntry = async () => {
    if (!selected || !entryForm.amount) {
      setError('Amount is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/backend/depreciation/${selected.id}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selected.companyId,
          fixedAssetId: selected.fixedAssetId,
          depreciationDate: entryForm.depreciationDate,
          amount: Number(entryForm.amount),
          accumulatedDepreciationAfter: Number(entryForm.accumulatedDepreciationAfter || entryForm.amount),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Entry save failed');
      setEntryOpen(false);
      setEntryForm({ depreciationDate: today, amount: '', accumulatedDepreciationAfter: '' });
      await loadEntries(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Entry save failed');
    } finally {
      setSaving(false);
    }
  };

  const postEntry = async (entry: DepreciationEntry) => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/backend/depreciation/entries/${entry.id}/post`, {
        method: 'POST',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Post failed');
      if (selected) await loadEntries(selected);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Post failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Depreciation Manager" subtitle="Create schedules, generate monthly entries, and post depreciation to the ledger" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Schedules" value={rows.length} />
        <StatCard label="Active" value={activeCount} />
        <StatCard label="Accumulated" value={fmtMoney(accumulated)} />
        <StatCard label="Selected Entries" value={entries.length} />
      </div>

      <Card className="p-4">
        <div className="grid md:grid-cols-[1fr_180px_auto] gap-3 items-end">
          <FormSelect label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="All companies">
            {companies.map((company) => <option key={company.id} value={company.id}>{optionLabel(company)}</option>)}
          </FormSelect>
          <FormSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses">
            {['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'].map((item) => <option key={item} value={item}>{item}</option>)}
          </FormSelect>
          <Btn onClick={openCreate}>New Schedule</Btn>
        </div>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_460px] gap-5">
        <Card className="overflow-hidden">
          {loading ? <PageSpinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-4 py-3">Schedule</th>
                    <th className="px-4 py-3">Asset</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3 text-right">Depreciable</th>
                    <th className="px-4 py-3 text-right">Accumulated</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No schedules</td></tr>
                  ) : filteredRows.map((row) => (
                    <tr key={row.id} onClick={() => loadEntries(row)} className="border-t cursor-pointer hover:bg-slate-50" style={{ borderColor: 'var(--aurora-border)' }}>
                      <td className="px-4 py-3 font-mono text-xs">{row.scheduleNumber}</td>
                      <td className="px-4 py-3">{assetById.get(row.fixedAssetId)?.name ?? row.fixedAssetId}</td>
                      <td className="px-4 py-3">{row.depreciationMethod}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmtMoney(row.totalDepreciableAmount)}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmtMoney(row.accumulatedDepreciation)}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          {!selected ? (
            <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a schedule to manage entries.</div>
          ) : (
            <>
              <div>
                <div className="font-semibold">{selected.scheduleNumber}</div>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{assetById.get(selected.fixedAssetId)?.name ?? selected.fixedAssetId}</div>
              </div>
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
                <FormInput label="Months" type="number" min="1" max="600" value={months} onChange={(e) => setMonths(e.target.value)} />
                <Btn variant="secondary" loading={saving} onClick={generateEntries}>Generate</Btn>
                <Btn variant="primary" onClick={() => setEntryOpen(true)}>Add Entry</Btn>
              </div>
              <div className="max-h-[420px] overflow-auto border rounded-lg" style={{ borderColor: 'var(--aurora-border)' }}>
                {entries.length === 0 ? (
                  <div className="p-4 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No entries generated yet.</div>
                ) : entries.map((entry) => (
                  <div key={entry.id} className="border-b p-3 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{new Date(entry.depreciationDate).toLocaleDateString('en-GB')}</div>
                        <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>After: {fmtMoney(entry.accumulatedDepreciationAfter)}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono">{fmtMoney(entry.amount)}</div>
                        <StatusBadge status={entry.status} />
                      </div>
                    </div>
                    {entry.status === 'DRAFT' && (
                      <div className="mt-2 text-right">
                        <Btn size="xs" variant="success" loading={saving} onClick={() => postEntry(entry)}>Post</Btn>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {creating && (
        <Modal open title="Create Depreciation Schedule" onClose={() => setCreating(false)} size="xl" footer={<><Btn variant="secondary" onClick={() => setCreating(false)}>Cancel</Btn><Btn loading={saving} onClick={saveSchedule}>Create</Btn></>}>
          <div className="grid md:grid-cols-2 gap-3">
            <FormInput label="Schedule Number" required value={form.scheduleNumber} onChange={(e) => setForm((f) => ({ ...f, scheduleNumber: e.target.value }))} />
            <FormSelect label="Company" required value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, fixedAssetId: '' }))} placeholder="Select company">
              {companies.map((company) => <option key={company.id} value={company.id}>{optionLabel(company)}</option>)}
            </FormSelect>
            <FormSelect label="Fixed Asset" required value={form.fixedAssetId} onChange={(e) => pickAsset(e.target.value)} placeholder={form.companyId ? 'Select asset' : 'Select company first'} disabled={!form.companyId}>
              {assets.filter((asset) => asset.companyId === form.companyId).map((asset) => <option key={asset.id} value={asset.id}>{optionLabel(asset)}</option>)}
            </FormSelect>
            <FormSelect label="Method" value={form.depreciationMethod} onChange={(e) => setForm((f) => ({ ...f, depreciationMethod: e.target.value }))}>
              {METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
            </FormSelect>
            <FormInput label="Start Date" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            <FormInput label="End Date" type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
            <FormInput label="Useful Life (months)" type="number" value={form.usefulLifeMonths} onChange={(e) => setForm((f) => ({ ...f, usefulLifeMonths: e.target.value }))} />
            <FormInput label="Annual Rate" type="number" step="0.0001" value={form.depreciationRate} onChange={(e) => setForm((f) => ({ ...f, depreciationRate: e.target.value }))} />
            <FormInput label="Salvage Value" type="number" value={form.salvageValue} onChange={(e) => setForm((f) => ({ ...f, salvageValue: e.target.value }))} />
            <FormInput label="Total Depreciable" type="number" value={form.totalDepreciableAmount} onChange={(e) => setForm((f) => ({ ...f, totalDepreciableAmount: e.target.value }))} />
            <FormInput label="Accumulated To Date" type="number" value={form.accumulatedDepreciation} onChange={(e) => setForm((f) => ({ ...f, accumulatedDepreciation: e.target.value }))} />
            <FormSelect label="Status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              {['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'].map((item) => <option key={item} value={item}>{item}</option>)}
            </FormSelect>
          </div>
        </Modal>
      )}

      {entryOpen && selected && (
        <Modal open title="Add Depreciation Entry" onClose={() => setEntryOpen(false)} size="lg" footer={<><Btn variant="secondary" onClick={() => setEntryOpen(false)}>Cancel</Btn><Btn loading={saving} onClick={addEntry}>Add Entry</Btn></>}>
          <div className="grid md:grid-cols-2 gap-3">
            <FormInput label="Date" type="date" value={entryForm.depreciationDate} onChange={(e) => setEntryForm((f) => ({ ...f, depreciationDate: e.target.value }))} />
            <FormInput label="Amount" required type="number" value={entryForm.amount} onChange={(e) => setEntryForm((f) => ({ ...f, amount: e.target.value }))} />
            <FormInput label="Accumulated After" type="number" value={entryForm.accumulatedDepreciationAfter} onChange={(e) => setEntryForm((f) => ({ ...f, accumulatedDepreciationAfter: e.target.value }))} />
          </div>
        </Modal>
      )}
    </div>
  );
}
