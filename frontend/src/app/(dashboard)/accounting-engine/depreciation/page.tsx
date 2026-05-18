'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Btn,
  Card,
  EmptyState,
  FormInput,
  Modal,
  PageHeader,
  StatusBadge,
} from '@/components/ui';

interface DepreciationSchedule {
  id: string;
  scheduleNumber: string;
  companyId: string;
  fixedAssetId: string;
  depreciationMethod: 'STRAIGHT_LINE' | 'REDUCING_BALANCE' | 'MANUAL';
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  totalDepreciableAmount: number;
  accumulatedDepreciation: number;
  salvageValue?: number;
  usefulLifeMonths?: number;
}

interface DepreciationEntry {
  id: string;
  depreciationScheduleId: string;
  depreciationDate: string;
  amount: number;
  accumulatedDepreciationAfter: number;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  journalEntryId?: string;
}

export default function DepreciationPage() {
  const [schedules, setSchedules] = useState<DepreciationSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DepreciationSchedule | null>(null);
  const [entries, setEntries] = useState<DepreciationEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [generateMonths, setGenerateMonths] = useState(12);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/backend/depreciation');
      const j = await r.json();
      const list = Array.isArray(j.data)
        ? j.data
        : Array.isArray(j.data?.data)
          ? j.data.data
          : Array.isArray(j.items)
            ? j.items
            : [];
      setSchedules(list);
    } catch {
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const loadEntries = async (scheduleId: string) => {
    setEntriesLoading(true);
    try {
      const r = await fetch(`/api/backend/depreciation/${scheduleId}/entries`);
      const j = await r.json();
      setEntries(Array.isArray(j.data) ? j.data : Array.isArray(j.items) ? j.items : []);
    } catch {
      setEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  };

  const openSchedule = (s: DepreciationSchedule) => {
    setSelected(s);
    setEntries([]);
    loadEntries(s.id);
  };

  const generateEntries = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await fetch(`/api/backend/depreciation/${selected.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: generateMonths }),
      });
      await loadEntries(selected.id);
    } finally {
      setBusy(false);
    }
  };

  const postEntry = async (entryId: string) => {
    setBusy(true);
    try {
      await fetch(`/api/backend/depreciation/entries/${entryId}/post`, { method: 'PATCH' });
      if (selected) await loadEntries(selected.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Depreciation Schedules"
        subtitle="Generate and post fixed-asset depreciation entries"
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading…</div>
        ) : schedules.length === 0 ? (
          <EmptyState
            title="No depreciation schedules yet"
            description="Schedules are created when a fixed asset is set up with a depreciable cost and useful life."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-slate-50 text-slate-500">
                <th className="px-4 py-3">Schedule #</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Depreciable</th>
                <th className="px-4 py-3">Accumulated</th>
                <th className="px-4 py-3">Remaining</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schedules.map((s) => {
                const remaining = Number(s.totalDepreciableAmount) - Number(s.accumulatedDepreciation);
                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs">{s.scheduleNumber}</td>
                    <td className="px-4 py-2 text-xs">{s.depreciationMethod}</td>
                    <td className="px-4 py-2 font-mono text-xs">{s.totalDepreciableAmount}</td>
                    <td className="px-4 py-2 font-mono text-xs">{s.accumulatedDepreciation}</td>
                    <td className="px-4 py-2 font-mono text-xs">{remaining.toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        className="text-xs text-blue-600 hover:underline"
                        onClick={() => openSchedule(s)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {selected ? (
        <Modal
          open={true}
          onClose={() => setSelected(null)}
          title={`Schedule ${selected.scheduleNumber}`}
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <div className="text-slate-500">Method</div>
                <div className="font-mono">{selected.depreciationMethod}</div>
              </div>
              <div>
                <div className="text-slate-500">Depreciable amount</div>
                <div className="font-mono">{selected.totalDepreciableAmount}</div>
              </div>
              <div>
                <div className="text-slate-500">Accumulated</div>
                <div className="font-mono">{selected.accumulatedDepreciation}</div>
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Generate entries</h3>
                  <p className="text-xs text-slate-500">
                    Generate the next N months of DRAFT entries (idempotent — already-generated
                    months are skipped).
                  </p>
                </div>
                <div className="flex gap-2 items-end">
                  <FormInput
                    label="Months"
                    type="number"
                    value={String(generateMonths)}
                    onChange={(e) => setGenerateMonths(Number(e.target.value) || 1)}
                  />
                  <Btn variant="secondary" onClick={generateEntries} loading={busy}>
                    Generate
                  </Btn>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-2">Entries</h3>
              {entriesLoading ? (
                <div className="text-xs text-slate-500">Loading…</div>
              ) : entries.length === 0 ? (
                <div className="text-xs text-slate-500">No entries yet.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1">Amount</th>
                      <th className="px-2 py-1">Cumulative</th>
                      <th className="px-2 py-1">Status</th>
                      <th className="px-2 py-1">JE</th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className="border-t">
                        <td className="px-2 py-1">
                          {new Date(e.depreciationDate).toLocaleDateString()}
                        </td>
                        <td className="px-2 py-1 font-mono">{e.amount}</td>
                        <td className="px-2 py-1 font-mono">{e.accumulatedDepreciationAfter}</td>
                        <td className="px-2 py-1">
                          <StatusBadge status={e.status} />
                        </td>
                        <td className="px-2 py-1 font-mono">{e.journalEntryId ?? '—'}</td>
                        <td className="px-2 py-1 text-right">
                          {e.status === 'DRAFT' ? (
                            <button
                              className="text-blue-600 hover:underline"
                              onClick={() => postEntry(e.id)}
                              disabled={busy}
                            >
                              Post
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
