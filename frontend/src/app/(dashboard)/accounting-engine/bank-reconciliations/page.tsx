'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Btn,
  Card,
  EmptyState,
  FormInput,
  FormSelect,
  Modal,
  PageHeader,
  StatusBadge,
} from '@/components/ui';

interface BankReconciliation {
  id: string;
  reconciliationNumber: string;
  companyId: string;
  cashAccountId: string;
  status: 'DRAFT' | 'IN_PROGRESS' | 'RECONCILED' | 'CLOSED';
  statementStartDate?: string;
  statementEndDate?: string;
  openingBookBalance?: number;
  closingBookBalance?: number;
  closingBankBalance?: number;
  differenceAmount?: number;
}

interface Company { id: string; name: string }
interface CashAccount { id: string; accountName: string; companyId: string }

const EMPTY: Partial<BankReconciliation> = {
  status: 'DRAFT',
};

export default function BankReconciliationsPage() {
  const [data, setData] = useState<BankReconciliation[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<BankReconciliation> | null>(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/backend/bank-reconciliations');
      const j = await r.json();
      const list = Array.isArray(j.data)
        ? j.data
        : Array.isArray(j.data?.data)
          ? j.data.data
          : [];
      setData(list);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) =>
        setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []),
      );
  }, [reload]);

  useEffect(() => {
    if (!editing?.companyId) {
      setCashAccounts([]);
      return;
    }
    fetch(`/api/backend/cash-accounts?companyId=${encodeURIComponent(editing.companyId)}&limit=200`)
      .then((r) => r.json())
      .then((j) =>
        setCashAccounts(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      );
  }, [editing?.companyId]);

  const advance = async (id: string, action: 'start' | 'reconcile' | 'close') => {
    const map: Record<string, string> = {
      start: 'start',
      reconcile: 'reconcile',
      close: 'close',
    };
    await fetch(`/api/backend/bank-reconciliations/${id}/${map[action]}`, { method: 'PATCH' });
    await reload();
  };

  const save = async () => {
    if (!editing) return;
    setSaveError('');
    setSaving(true);
    try {
      const payload = {
        companyId: editing.companyId,
        cashAccountId: editing.cashAccountId,
        statementStartDate: editing.statementStartDate,
        statementEndDate: editing.statementEndDate,
        openingBookBalance: editing.openingBookBalance,
        closingBookBalance: editing.closingBookBalance,
        closingBankBalance: editing.closingBankBalance,
        differenceAmount:
          editing.closingBankBalance != null && editing.closingBookBalance != null
            ? Number(editing.closingBankBalance) - Number(editing.closingBookBalance)
            : 0,
      };
      const res = await fetch('/api/backend/bank-reconciliations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? 'Save failed');
      setEditing(null);
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Bank Reconciliations"
        subtitle="Reconcile bank statements with accounting records"
        actions={
          <Btn variant="primary" onClick={() => setEditing({ ...EMPTY })}>
            + New Reconciliation
          </Btn>
        }
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading…</div>
        ) : data.length === 0 ? (
          <EmptyState
            title="No reconciliations yet"
            description="Start your first reconciliation by selecting a cash account and entering the bank statement closing balance."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-slate-50 text-slate-500">
                <th className="px-4 py-3">Reconciliation #</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Book balance</th>
                <th className="px-4 py-3">Bank balance</th>
                <th className="px-4 py-3">Difference</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((r) => {
                const diff = r.differenceAmount ?? 0;
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs">{r.reconciliationNumber}</td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {r.statementStartDate ? new Date(r.statementStartDate).toLocaleDateString() : '—'} →{' '}
                      {r.statementEndDate ? new Date(r.statementEndDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{r.closingBookBalance ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.closingBankBalance ?? '—'}</td>
                    <td
                      className={`px-4 py-2 font-mono text-xs ${diff === 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {diff}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-2 text-right text-xs space-x-2">
                      {r.status === 'DRAFT' ? (
                        <button
                          className="text-blue-600 hover:underline"
                          onClick={() => advance(r.id, 'start')}
                        >
                          Start
                        </button>
                      ) : null}
                      {r.status === 'IN_PROGRESS' && diff === 0 ? (
                        <button
                          className="text-green-600 hover:underline"
                          onClick={() => advance(r.id, 'reconcile')}
                        >
                          Reconcile
                        </button>
                      ) : null}
                      {r.status === 'RECONCILED' ? (
                        <button
                          className="text-slate-600 hover:underline"
                          onClick={() => advance(r.id, 'close')}
                        >
                          Close
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {editing ? (
        <Modal open={true} onClose={() => setEditing(null)} title="New bank reconciliation">
          <div className="space-y-3">
            <FormSelect
              label="Company"
              value={editing.companyId ?? ''}
              onChange={(e) =>
                setEditing({ ...editing, companyId: e.target.value, cashAccountId: '' })
              }
            >
              <option value="">— select —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Cash account"
              value={editing.cashAccountId ?? ''}
              onChange={(e) => setEditing({ ...editing, cashAccountId: e.target.value })}
              disabled={!editing.companyId}
            >
              <option value="">— select —</option>
              {cashAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountName}
                </option>
              ))}
            </FormSelect>
            <div className="grid grid-cols-2 gap-3">
              <FormInput
                label="Statement start"
                type="date"
                value={editing.statementStartDate?.slice(0, 10) ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, statementStartDate: e.target.value })
                }
              />
              <FormInput
                label="Statement end"
                type="date"
                value={editing.statementEndDate?.slice(0, 10) ?? ''}
                onChange={(e) => setEditing({ ...editing, statementEndDate: e.target.value })}
              />
              <FormInput
                label="Opening book balance"
                type="number"
                value={String(editing.openingBookBalance ?? '')}
                onChange={(e) =>
                  setEditing({ ...editing, openingBookBalance: Number(e.target.value) })
                }
              />
              <FormInput
                label="Closing book balance"
                type="number"
                value={String(editing.closingBookBalance ?? '')}
                onChange={(e) =>
                  setEditing({ ...editing, closingBookBalance: Number(e.target.value) })
                }
              />
              <FormInput
                label="Closing bank balance (statement)"
                type="number"
                value={String(editing.closingBankBalance ?? '')}
                onChange={(e) =>
                  setEditing({ ...editing, closingBankBalance: Number(e.target.value) })
                }
              />
            </div>
            {editing.closingBankBalance != null && editing.closingBookBalance != null ? (
              <div className="text-sm text-slate-600">
                Computed difference:{' '}
                <span
                  className={`font-mono ${
                    Number(editing.closingBankBalance) - Number(editing.closingBookBalance) === 0
                      ? 'text-green-600'
                      : 'text-red-600'
                  }`}
                >
                  {Number(editing.closingBankBalance) - Number(editing.closingBookBalance)}
                </span>
              </div>
            ) : null}
            {saveError ? <div className="text-sm text-red-600">{saveError}</div> : null}
            <div className="flex gap-2 justify-end pt-2">
              <Btn variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </Btn>
              <Btn variant="primary" onClick={save} loading={saving}>
                Create reconciliation
              </Btn>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
