'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Btn,
  Card,
  EmptyState,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  StatusBadge,
} from '@/components/ui';

interface PostingRule {
  id: string;
  ruleCode: string;
  name: string;
  description?: string;
  sourceType: string;
  triggerAction: string;
  isActive: boolean;
  priority: number;
  companyId?: string | null;
  lines?: RuleLine[];
}

interface RuleLine {
  id?: string;
  lineOrder: number;
  debitCredit: 'DEBIT' | 'CREDIT';
  accountId: string;
  amountSource: string;
  descriptionTemplate?: string;
  account?: { accountCode?: string; accountName?: string };
}

interface ChartAccount {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
}
interface Company {
  id: string;
  name: string;
  code: string;
}

const SOURCE_TYPES = [
  'SALES_ORDER',
  'PURCHASE_ORDER',
  'PAYROLL',
  'EXPENSE',
  'INVENTORY_MOVEMENT',
  'CUSTOM',
];
const TRIGGER_ACTIONS = ['ON_CONFIRM', 'ON_POST', 'ON_APPROVE', 'ON_PAY', 'ON_CANCEL'];
const AMOUNT_SOURCES = [
  'LINE_TOTAL',
  'TAX_AMOUNT',
  'DISCOUNT_AMOUNT',
  'NET_AMOUNT',
  'FIXED',
  'FORMULA',
];

const EMPTY_RULE: PostingRule = {
  id: '',
  ruleCode: '',
  name: '',
  sourceType: 'SALES_ORDER',
  triggerAction: 'ON_POST',
  isActive: true,
  priority: 0,
  lines: [],
};

export default function PostingRulesPage() {
  const [rules, setRules] = useState<PostingRule[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PostingRule | null>(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/backend/posting-rules');
      const j = await r.json();
      const list: PostingRule[] = Array.isArray(j.data)
        ? j.data
        : Array.isArray(j.data?.data)
          ? j.data.data
          : [];
      setRules(list);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        setCompanies(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        );
      });
  }, [reload]);

  // Load chart of accounts for the rule's company so the line editor has accounts to choose from.
  useEffect(() => {
    if (!editing?.companyId) {
      setAccounts([]);
      return;
    }
    fetch(
      `/api/backend/chart-of-accounts?companyId=${encodeURIComponent(editing.companyId)}&limit=500`,
    )
      .then((r) => r.json())
      .then((j) => {
        setAccounts(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        );
      });
  }, [editing?.companyId]);

  const openCreate = () => setEditing({ ...EMPTY_RULE });
  const openEdit = (r: PostingRule) => setEditing({ ...r, lines: r.lines ?? [] });

  const addLine = () => {
    if (!editing) return;
    setEditing({
      ...editing,
      lines: [
        ...(editing.lines ?? []),
        {
          lineOrder: (editing.lines?.length ?? 0) + 1,
          debitCredit: 'DEBIT',
          accountId: '',
          amountSource: 'LINE_TOTAL',
        },
      ],
    });
  };

  const updateLine = (idx: number, patch: Partial<RuleLine>) => {
    if (!editing) return;
    const next = [...(editing.lines ?? [])];
    next[idx] = { ...next[idx], ...patch };
    setEditing({ ...editing, lines: next });
  };

  const removeLine = (idx: number) => {
    if (!editing) return;
    setEditing({ ...editing, lines: (editing.lines ?? []).filter((_, i) => i !== idx) });
  };

  const save = async () => {
    if (!editing) return;
    setSaveError('');
    // Sanity check: a rule with lines should have at least one DR and one CR.
    const lines = editing.lines ?? [];
    const hasDebit = lines.some((l) => l.debitCredit === 'DEBIT' && l.accountId);
    const hasCredit = lines.some((l) => l.debitCredit === 'CREDIT' && l.accountId);
    if (lines.length > 0 && (!hasDebit || !hasCredit)) {
      setSaveError('A rule with lines must have at least one DEBIT and one CREDIT line.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ruleCode: editing.ruleCode,
        name: editing.name,
        description: editing.description,
        sourceType: editing.sourceType,
        triggerAction: editing.triggerAction,
        isActive: editing.isActive,
        priority: editing.priority,
        companyId: editing.companyId ?? null,
        lines: (editing.lines ?? []).map((l, i) => ({
          lineOrder: i + 1,
          debitCredit: l.debitCredit,
          accountId: l.accountId,
          amountSource: l.amountSource,
          descriptionTemplate: l.descriptionTemplate,
        })),
      };
      const url = editing.id
        ? `/api/backend/posting-rules/${editing.id}`
        : '/api/backend/posting-rules';
      const method = editing.id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
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
        title="Posting Rules"
        subtitle="Configure and manage journal posting rules"
        actions={
          <Btn variant="primary" onClick={openCreate}>
            + New Posting Rule
          </Btn>
        }
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading…</div>
        ) : rules.length === 0 ? (
          <EmptyState
            title="No posting rules yet"
            description="Create your first posting rule to map source events (sale confirmed, payroll approved, etc.) to journal entries."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-slate-50 text-slate-500">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Lines</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs">{r.ruleCode}</td>
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-4 py-2 text-xs">{r.sourceType}</td>
                  <td className="px-4 py-2 text-xs">{r.triggerAction}</td>
                  <td className="px-4 py-2 text-xs">{r.lines?.length ?? 0}</td>
                  <td className="px-4 py-2 text-xs">{r.priority}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => openEdit(r)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editing ? (
        <Modal
          open={true}
          onClose={() => setEditing(null)}
          title={editing.id ? `Edit rule ${editing.ruleCode}` : 'New posting rule'}
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormInput
                label="Rule code"
                value={editing.ruleCode}
                onChange={(e) => setEditing({ ...editing, ruleCode: e.target.value })}
              />
              <FormInput
                label="Name"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
              <FormSelect
                label="Company"
                value={editing.companyId ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, companyId: e.target.value || null })
                }
              >
                <option value="">— Group-wide rule —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </FormSelect>
              <FormSelect
                label="Source type"
                value={editing.sourceType}
                onChange={(e) => setEditing({ ...editing, sourceType: e.target.value })}
              >
                {SOURCE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </FormSelect>
              <FormSelect
                label="Trigger action"
                value={editing.triggerAction}
                onChange={(e) => setEditing({ ...editing, triggerAction: e.target.value })}
              >
                {TRIGGER_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </FormSelect>
              <FormInput
                label="Priority"
                type="number"
                value={String(editing.priority)}
                onChange={(e) =>
                  setEditing({ ...editing, priority: Number(e.target.value) || 0 })
                }
              />
            </div>
            <FormTextarea
              label="Description"
              value={editing.description ?? ''}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing.isActive}
                onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
              />
              Active
            </label>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold">Posting Lines</h3>
                  <p className="text-xs text-slate-500">
                    DR/CR pairs that the engine emits when this rule fires.
                  </p>
                </div>
                <Btn
                  variant="secondary"
                  size="sm"
                  onClick={addLine}
                  disabled={!editing.companyId}
                >
                  + Add line
                </Btn>
              </div>
              {!editing.companyId ? (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  Select a company to load its chart of accounts before adding lines.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="px-2 py-1">#</th>
                      <th className="px-2 py-1">DR/CR</th>
                      <th className="px-2 py-1">Account</th>
                      <th className="px-2 py-1">Amount source</th>
                      <th className="px-2 py-1">Description template</th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(editing.lines ?? []).map((line, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-2 py-1">{idx + 1}</td>
                        <td className="px-2 py-1">
                          <select
                            className="border rounded px-1 py-0.5"
                            value={line.debitCredit}
                            onChange={(e) =>
                              updateLine(idx, {
                                debitCredit: e.target.value as 'DEBIT' | 'CREDIT',
                              })
                            }
                          >
                            <option value="DEBIT">DR</option>
                            <option value="CREDIT">CR</option>
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <select
                            className="border rounded px-1 py-0.5 w-full max-w-[260px]"
                            value={line.accountId}
                            onChange={(e) => updateLine(idx, { accountId: e.target.value })}
                          >
                            <option value="">— select —</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.accountCode} · {a.accountName}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <select
                            className="border rounded px-1 py-0.5"
                            value={line.amountSource}
                            onChange={(e) =>
                              updateLine(idx, { amountSource: e.target.value })
                            }
                          >
                            {AMOUNT_SOURCES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <input
                            className="border rounded px-1 py-0.5 w-full"
                            value={line.descriptionTemplate ?? ''}
                            onChange={(e) =>
                              updateLine(idx, { descriptionTemplate: e.target.value })
                            }
                            placeholder="e.g. {{ docNumber }}"
                          />
                        </td>
                        <td className="px-2 py-1 text-right">
                          <button
                            className="text-red-600 hover:underline"
                            onClick={() => removeLine(idx)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {saveError ? <div className="text-sm text-red-600">{saveError}</div> : null}

            <div className="flex gap-2 justify-end pt-2">
              <Btn variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </Btn>
              <Btn variant="primary" onClick={save} loading={saving}>
                {editing.id ? 'Save changes' : 'Create rule'}
              </Btn>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
