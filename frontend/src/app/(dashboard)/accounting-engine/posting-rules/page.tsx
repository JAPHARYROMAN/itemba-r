'use client';

import { useCallback, useEffect, useState } from 'react';
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

interface Company {
  id: string;
  name: string;
  code?: string | null;
}
interface Account {
  id: string;
  accountCode: string;
  accountName: string;
}
interface RuleLine {
  id: string;
  lineOrder: number;
  debitCredit: string;
  accountId: string;
  amountSource: string;
  descriptionTemplate?: string | null;
}
interface PostingRule {
  id: string;
  ruleCode: string;
  companyId?: string | null;
  company?: Company | null;
  name: string;
  description?: string | null;
  sourceType: string;
  triggerAction: string;
  isActive: boolean;
  priority: number;
  lines?: RuleLine[];
}

const SOURCE_TYPES = [
  'SALES_ORDER',
  'POS_TRANSACTION',
  'PURCHASE_ORDER',
  'EXPENSE',
  'RECEIVABLE',
  'PAYABLE',
  'PAYROLL_RUN',
  'FIXED_ASSET',
  'DEPRECIATION',
  'LOAN_REPAYMENT',
  'TAX_RETURN',
  'MANUAL',
  'OTHER',
];
const TRIGGERS = [
  'CREATE',
  'ISSUE',
  'POST',
  'APPROVE',
  'PAY',
  'COMPLETE',
  'CLOSE',
  'REVERSE',
  'OTHER',
];
const AMOUNT_SOURCES = [
  'TOTAL_AMOUNT',
  'TAX_AMOUNT',
  'NET_AMOUNT',
  'COST_AMOUNT',
  'DISCOUNT_AMOUNT',
  'PAID_AMOUNT',
  'OUTSTANDING_AMOUNT',
  'CUSTOM_FORMULA',
];

function unwrapList<T>(json: any): T[] {
  const payload = json?.data ?? json;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

function label(row: {
  name?: string;
  code?: string | null;
  accountCode?: string;
  accountName?: string;
}) {
  if (row.accountCode) return `${row.accountCode} - ${row.accountName}`;
  return row.code ? `${row.code} - ${row.name}` : (row.name ?? '');
}

const blankRule = {
  ruleCode: '',
  companyId: '',
  name: '',
  description: '',
  sourceType: 'MANUAL',
  triggerAction: 'POST',
  priority: '0',
  isActive: 'true',
};

export default function PostingRulesPage() {
  const [rules, setRules] = useState<PostingRule[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [lineRule, setLineRule] = useState<PostingRule | null>(null);
  const [form, setForm] = useState(blankRule);
  const [lineForm, setLineForm] = useState({
    lineOrder: '1',
    debitCredit: 'DEBIT',
    accountId: '',
    amountSource: 'TOTAL_AMOUNT',
    descriptionTemplate: '',
  });
  const [saving, setSaving] = useState(false);

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
    if (!companyId) {
      setAccounts([]);
      return;
    }
    // The backend caps chart-of-accounts page size at 200.
    fetch(`/api/backend/chart-of-accounts?companyId=${companyId}&limit=200`)
      .then((r) => r.json())
      .then((j) => setAccounts(unwrapList<Account>(j)))
      .catch(() => setAccounts([]));
  }, [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (companyId) params.set('companyId', companyId);
      const json = await fetch(`/api/backend/posting-rules?${params}`).then((r) => r.json());
      setRules(unwrapList<PostingRule>(json));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posting rules');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setForm({ ...blankRule, companyId });
    setCreating(true);
  };

  const saveRule = async () => {
    if (!form.ruleCode.trim() || !form.name.trim()) {
      setError('Rule code and name are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        ruleCode: form.ruleCode.trim(),
        companyId: form.companyId || undefined,
        name: form.name.trim(),
        description: form.description || undefined,
        sourceType: form.sourceType,
        triggerAction: form.triggerAction,
        priority: Number(form.priority || 0),
        isActive: form.isActive === 'true',
      };
      const response = await fetch('/api/backend/posting-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Save failed');
      setCreating(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveLine = async () => {
    if (!lineRule || !lineForm.accountId) {
      setError('Select an account for the posting line');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        lineOrder: Number(lineForm.lineOrder || 1),
        debitCredit: lineForm.debitCredit,
        accountId: lineForm.accountId,
        amountSource: lineForm.amountSource,
        descriptionTemplate: lineForm.descriptionTemplate || undefined,
      };
      const response = await fetch(`/api/backend/posting-rules/${lineRule.id}/lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Line save failed');
      setLineRule(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Line save failed');
    } finally {
      setSaving(false);
    }
  };

  const activeRules = rules.filter((rule) => rule.isActive).length;
  const lineCount = rules.reduce((sum, rule) => sum + (rule.lines?.length ?? 0), 0);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Posting Rules"
        subtitle="Configure source events and the ledger lines they generate"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Rules" value={rules.length} />
        <StatCard label="Active" value={activeRules} />
        <StatCard label="Posting Lines" value={lineCount} />
        <StatCard label="Company Scope" value={companyId ? 'Company' : 'Global'} />
      </div>

      <Card className="p-4">
        <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
          <FormSelect
            label="Company Filter"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            placeholder="Global and all companies"
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {label(company)}
              </option>
            ))}
          </FormSelect>
          <Btn variant="primary" onClick={openCreate}>
            New Rule
          </Btn>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

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
                  <th className="px-4 py-3">Rule</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Trigger</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Lines</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No posting rules configured
                    </td>
                  </tr>
                ) : (
                  rules.map((rule) => (
                    <tr
                      key={rule.id}
                      className="border-t"
                      style={{ borderColor: 'var(--aurora-border)' }}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{rule.name}</div>
                        <div className="font-mono text-xs text-slate-500">{rule.ruleCode}</div>
                      </td>
                      <td className="px-4 py-3">{rule.sourceType}</td>
                      <td className="px-4 py-3">{rule.triggerAction}</td>
                      <td className="px-4 py-3">{rule.priority}</td>
                      <td className="px-4 py-3">{rule.lines?.length ?? 0}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={rule.isActive ? 'ACTIVE' : 'INACTIVE'} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Btn
                          variant="secondary"
                          size="xs"
                          onClick={() => {
                            const nextCompanyId = rule.companyId ?? companyId;
                            setCompanyId(nextCompanyId);
                            setLineForm({
                              lineOrder: String((rule.lines?.length ?? 0) + 1),
                              debitCredit: 'DEBIT',
                              accountId: '',
                              amountSource: 'TOTAL_AMOUNT',
                              descriptionTemplate: '',
                            });
                            setLineRule(rule);
                          }}
                        >
                          Add Line
                        </Btn>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <Modal
          open
          title="Create Posting Rule"
          onClose={() => setCreating(false)}
          size="xl"
          footer={
            <>
              <Btn variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Btn>
              <Btn onClick={saveRule} loading={saving}>
                Create
              </Btn>
            </>
          }
        >
          <div className="grid md:grid-cols-2 gap-3">
            <FormInput
              label="Rule Code"
              required
              value={form.ruleCode}
              onChange={(e) => setForm((f) => ({ ...f, ruleCode: e.target.value }))}
            />
            <FormInput
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <FormSelect
              label="Company"
              value={form.companyId}
              onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
              placeholder="Global rule"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {label(company)}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Source Type"
              value={form.sourceType}
              onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value }))}
            >
              {SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Trigger"
              value={form.triggerAction}
              onChange={(e) => setForm((f) => ({ ...f, triggerAction: e.target.value }))}
            >
              {TRIGGERS.map((trigger) => (
                <option key={trigger} value={trigger}>
                  {trigger}
                </option>
              ))}
            </FormSelect>
            <FormInput
              label="Priority"
              type="number"
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            />
            <FormSelect
              label="Status"
              value={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value }))}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </FormSelect>
            <div className="md:col-span-2">
              <FormTextarea
                label="Description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
        </Modal>
      )}

      {lineRule && (
        <Modal
          open
          title={`Add Line: ${lineRule.name}`}
          onClose={() => setLineRule(null)}
          size="xl"
          footer={
            <>
              <Btn variant="secondary" onClick={() => setLineRule(null)}>
                Cancel
              </Btn>
              <Btn onClick={saveLine} loading={saving}>
                Add Line
              </Btn>
            </>
          }
        >
          <div className="grid md:grid-cols-2 gap-3">
            <FormInput
              label="Line Order"
              type="number"
              value={lineForm.lineOrder}
              onChange={(e) => setLineForm((f) => ({ ...f, lineOrder: e.target.value }))}
            />
            <FormSelect
              label="Debit / Credit"
              value={lineForm.debitCredit}
              onChange={(e) => setLineForm((f) => ({ ...f, debitCredit: e.target.value }))}
            >
              <option value="DEBIT">Debit</option>
              <option value="CREDIT">Credit</option>
            </FormSelect>
            <FormSelect
              label="Account"
              required
              value={lineForm.accountId}
              onChange={(e) => setLineForm((f) => ({ ...f, accountId: e.target.value }))}
              placeholder={companyId ? 'Select account' : 'Select a company first'}
              disabled={!companyId}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {label(account)}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Amount Source"
              value={lineForm.amountSource}
              onChange={(e) => setLineForm((f) => ({ ...f, amountSource: e.target.value }))}
            >
              {AMOUNT_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </FormSelect>
            <div className="md:col-span-2">
              <FormInput
                label="Description Template"
                value={lineForm.descriptionTemplate}
                onChange={(e) =>
                  setLineForm((f) => ({ ...f, descriptionTemplate: e.target.value }))
                }
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
