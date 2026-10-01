'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { backendGet, backendPost, ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { WorkspaceLink } from '@/components/workspace/workspace-navigation';
import { amount, type Report } from '@/components/fuel-reporting/types';
import { FormDateField } from '@/components/ui/date-field';

type Choice = { id: string; name: string };
type Selections = {
  retailCustomerId?: string;
  cashAccountId?: string;
  mobileAccountId?: string;
  bankAccountId?: string;
  receivableAccountId: string;
  revenueAccountId: string;
  payableAccountId: string;
  inventoryAccountId: string;
  costAccountId: string;
  expenseAccountId: string;
  varianceAccountId: string;
  credits: { customerId: string; dueDate: string }[];
  deliveries: { supplierId: string; dueDate: string; accountId?: string }[];
  expenses: { accountId: string }[];
};
type Posting = {
  id: string;
  createdAt: string;
  reversedAt: string | null;
  reportVersion: number;
  evidence: {
    saleIds: string[];
    invoiceIds: string[];
    movementIds: string[];
    journalIds: string[];
  };
};
type Review = {
  version: number;
  fingerprint: string;
  postings: Posting[];
  customers: Choice[];
  suppliers: Choice[];
  accounts: (Choice & { connected: boolean; balance: string })[];
  ledger: { id: string; accountCode: string; accountName: string; accountType: string }[];
  issues: string[];
  missingPermissions: string[];
  canPost: boolean;
};
type Attempt = { requestId: string; version: number; fingerprint: string; selections: Selections };
const empty = (report: Report): Selections => ({
  receivableAccountId: '',
  revenueAccountId: '',
  payableAccountId: '',
  inventoryAccountId: '',
  costAccountId: '',
  expenseAccountId: '',
  varianceAccountId: '',
  credits: report.payload.creditSales.map(() => ({
    customerId: '',
    dueDate: report.businessDate.slice(0, 10),
  })),
  deliveries: report.payload.deliveries.map(() => ({
    supplierId: '',
    dueDate: report.businessDate.slice(0, 10),
  })),
  expenses: report.payload.expenses.map(() => ({ accountId: '' })),
});

function Select({
  label,
  value = '',
  choices,
  onChange,
  disabled,
}: {
  label: string;
  value?: string;
  choices: Choice[];
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="pd-post-field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Choose…</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PetroDollarPosting({
  report,
  onLock,
}: {
  report: Report;
  onLock: (value: boolean) => void;
}) {
  const { hasPermission } = useAuth();
  const canReview = [
    'journal_entries.view',
    'sales_desk.view',
    'cash_desk.view',
    'customers.view',
    'inventory.view',
  ].every((p) => hasPermission(p));
  const [review, setReview] = useState<Review | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selections, setSelections] = useState<Selections>(() => empty(report));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [retryReady, setRetryReady] = useState(false);
  const [reason, setReason] = useState('');
  const submitting = useRef(false);
  const active = review?.postings.find((p) => !p.reversedAt);
  const load = useCallback(async () => {
    const data = await backendGet<Review>(`/petrodollar/reports/${report.id}/posting`);
    setReview(data);
    if (data.postings.some((p) => !p.reversedAt)) {
      setAttempt(null);
      setDirty(false);
    } else setRetryReady(true);
    return data;
  }, [report.id]);
  useEffect(() => {
    if (!canReview) return;
    let cancelled = false;
    backendGet<Review>(`/petrodollar/reports/${report.id}/posting`)
      .then((data) => {
        if (!cancelled) setReview(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load posting status.');
      });
    return () => {
      cancelled = true;
    };
  }, [canReview, report.id, report.version]);
  useEffect(() => {
    onLock(busy || dirty || !!attempt);
    return () => onLock(false);
  }, [busy, dirty, attempt, onLock]);
  const change = (next: Selections) => {
    setSelections(next);
    setDirty(true);
    setError('');
    setNotice('');
  };
  const update = (key: keyof Selections, value: string) => change({ ...selections, [key]: value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!review || submitting.current || active || (attempt && !retryReady)) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const sent = attempt ?? {
      requestId: crypto.randomUUID(),
      version: review.version,
      fingerprint: review.fingerprint,
      selections,
    };
    setAttempt(sent);
    setRetryReady(false);
    try {
      await backendPost(`/petrodollar/reports/${report.id}/posting`, sent);
      setDirty(false);
      setAttempt(null);
      setNotice('Shift posted. Sales, supplier balances, cash, stock and journals are connected.');
      await load().catch(() =>
        setError('Posting succeeded. Check status to reload its linked records.'),
      );
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) setAttempt(null);
      setError(
        e instanceof Error
          ? e.message
          : 'The posting outcome is uncertain. Check its status before retrying.',
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function reverse() {
    if (!active || submitting.current || reason.trim().length < 3) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await backendPost(`/petrodollar/reports/${report.id}/posting/reverse`, {
        postingId: active.id,
        reason,
      });
      setReason('');
      setDirty(false);
      setExpanded(false);
      setNotice(
        'Posting reversed. You can now reopen the shift, correct it and review a new posting.',
      );
      await load();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not reverse. Check the posting status before trying again.',
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const disabled = busy || !!attempt;
  const cashChoices =
    review?.accounts
      .filter((a) => a.connected)
      .map((a) => ({ id: a.id, name: `${a.name} · TZS ${amount(Number(a.balance))}` })) ?? [];
  const ledgerFields = [
    ['receivableAccountId', 'Customer receivables', ['ASSET']],
    ['revenueAccountId', 'Sales revenue', ['INCOME']],
    ['payableAccountId', 'Supplier payables', ['LIABILITY']],
    ['inventoryAccountId', 'Fuel inventory', ['ASSET']],
    ['costAccountId', 'Cost of fuel sold', ['COST_OF_GOODS_SOLD']],
    ['expenseAccountId', 'Operating expenses', ['EXPENSE']],
    ['varianceAccountId', 'Stock variance', ['EXPENSE', 'COST_OF_GOODS_SOLD']],
  ] as const;
  if (!canReview)
    return (
      <section className="pd-posting">
        <h3>Connect this shift to your apps</h3>
        <p>
          A user with sales, cash, inventory and accounting access can review and post this closed
          shift.
        </p>
      </section>
    );
  return (
    <section className="pd-posting" aria-label="Shift posting">
      <div className="pd-post-heading">
        <div>
          <h3>{active ? 'Connected to your apps' : 'Connect this shift to your apps'}</h3>
          <p>
            {active
              ? `Posted from revision ${active.reportVersion}. Its linked records are available below.`
              : 'Review the people and accounts once. Posting records this shift across the apps in one step.'}
          </p>
        </div>
        <button
          type="button"
          className="desk-secondary"
          disabled={busy}
          onClick={() => {
            setError('');
            setBusy(true);
            void load()
              .catch((e) =>
                setError(e instanceof Error ? e.message : 'Could not check posting status.'),
              )
              .finally(() => setBusy(false));
          }}
        >
          Check status
        </button>
      </div>
      {error && (
        <p className="fr-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="fr-success" role="status">
          {notice}
        </p>
      )}
      {!review && !error && <p role="status">Checking connected records…</p>}
      {active ? (
        <>
          <div className="pd-post-links">
            <WorkspaceLink href="/sales-desk?source=direct&view=sales">
              Sales · {active.evidence.saleIds.length}
            </WorkspaceLink>
            <WorkspaceLink href="/invoice-desk?source=direct&view=invoices">
              Supplier invoices · {active.evidence.invoiceIds.length}
            </WorkspaceLink>
            <WorkspaceLink href="/cash-desk?view=movements">
              Cash movements · {active.evidence.movementIds.length}
            </WorkspaceLink>
            <WorkspaceLink href="/inventory?tab=stock&view=movements">
              Stock movements
            </WorkspaceLink>
            <WorkspaceLink href="/reports?view=accounting">
              Accounting journals · {active.evidence.journalIds.length}
            </WorkspaceLink>
          </div>
          {review?.canPost &&
            hasPermission('journal_entries.reverse') &&
            hasPermission('cash_desk.reverse') && (
              <details className="pd-post-correction">
                <summary>Correct this posting</summary>
                <p>
                  Reverse the entire posting before reopening the shift. Later payments and stock
                  activity must be reversed first.
                </p>
                <label className="pd-post-field">
                  <span>Reversal reason</span>
                  <input
                    value={reason}
                    maxLength={500}
                    disabled={busy}
                    onChange={(e) => {
                      setReason(e.target.value);
                      setDirty(!!e.target.value);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="desk-secondary"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => void reverse()}
                >
                  Reverse shift posting
                </button>
              </details>
            )}
        </>
      ) : (
        review && (
          <>
            {!!review.issues.length && (
              <div className="pd-notice" role="status">
                <p>Resolve these before posting:</p>
                <ul>
                  {review.issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            )}
            {!review.canPost && (
              <p className="pd-notice">
                Your role can review this shift. A user with the required posting permissions must
                submit it.
              </p>
            )}
            {!expanded ? (
              <button
                type="button"
                className="desk-primary"
                disabled={busy || !review.canPost || !!review.issues.length}
                onClick={() => setExpanded(true)}
              >
                Review &amp; post shift
              </button>
            ) : (
              <form onSubmit={submit} className="pd-post-form">
                <p className="pd-notice">
                  Posting uses TZS. Opening floats and cash handovers are checks on this shift; they
                  are not new income or new cash receipts.
                </p>
                {(report.summary.collected > 0 || report.summary.cashOut > 0) && (
                  <fieldset>
                    <legend>Collected sales and shift cash</legend>
                    <div className="pd-post-grid">
                      {report.summary.collected > 0 && (
                        <Select
                          label="Walk-in / retail customer"
                          value={selections.retailCustomerId}
                          choices={review.customers}
                          disabled={disabled}
                          onChange={(v) => update('retailCustomerId', v)}
                        />
                      )}
                      {(report.payload.collections.cash! > 0 || report.summary.cashOut > 0) && (
                        <Select
                          label="Cash receiving account"
                          value={selections.cashAccountId}
                          choices={cashChoices}
                          disabled={disabled}
                          onChange={(v) => update('cashAccountId', v)}
                        />
                      )}
                      {report.payload.collections.mobile! > 0 && (
                        <Select
                          label="Mobile money receiving account"
                          value={selections.mobileAccountId}
                          choices={cashChoices}
                          disabled={disabled}
                          onChange={(v) => update('mobileAccountId', v)}
                        />
                      )}
                      {report.payload.collections.bank! > 0 && (
                        <Select
                          label="Bank / card receiving account"
                          value={selections.bankAccountId}
                          choices={cashChoices}
                          disabled={disabled}
                          onChange={(v) => update('bankAccountId', v)}
                        />
                      )}
                    </div>
                  </fieldset>
                )}
                {report.payload.creditSales.map((credit, i) => (
                  <fieldset key={i}>
                    <legend>
                      Credit sale · {credit.customer} · TZS {amount(credit.amount)}
                    </legend>
                    <div className="pd-post-grid">
                      <Select
                        label={`Customer for credit sale ${i + 1}`}
                        value={selections.credits[i].customerId}
                        choices={review.customers}
                        disabled={disabled}
                        onChange={(v) =>
                          change({
                            ...selections,
                            credits: selections.credits.map((c, j) =>
                              j === i ? { ...c, customerId: v } : c,
                            ),
                          })
                        }
                      />
                      <FormDateField
                        label={`Due date for credit sale ${i + 1}`}
                        min={report.businessDate.slice(0, 10)}
                        value={selections.credits[i].dueDate}
                        disabled={disabled}
                        required
                        onChange={(v) =>
                          change({
                            ...selections,
                            credits: selections.credits.map((c, j) =>
                              j === i ? { ...c, dueDate: v } : c,
                            ),
                          })
                        }
                      />
                    </div>
                  </fieldset>
                ))}
                {report.payload.deliveries.map((delivery, i) => (
                  <fieldset key={i}>
                    <legend>
                      Delivery · {delivery.supplier} · {amount(delivery.litres, 3)} L
                    </legend>
                    <div className="pd-post-grid">
                      <Select
                        label={`Supplier for delivery ${i + 1}`}
                        value={selections.deliveries[i].supplierId}
                        choices={review.suppliers}
                        disabled={disabled}
                        onChange={(v) =>
                          change({
                            ...selections,
                            deliveries: selections.deliveries.map((d, j) =>
                              j === i ? { ...d, supplierId: v } : d,
                            ),
                          })
                        }
                      />
                      <FormDateField
                        label={`Due date for delivery ${i + 1}`}
                        min={report.businessDate.slice(0, 10)}
                        value={selections.deliveries[i].dueDate}
                        disabled={disabled}
                        required
                        onChange={(v) =>
                          change({
                            ...selections,
                            deliveries: selections.deliveries.map((d, j) =>
                              j === i ? { ...d, dueDate: v } : d,
                            ),
                          })
                        }
                      />
                      {delivery.paidAmount > 0 && (
                        <Select
                          label={`Payment account for delivery ${i + 1}`}
                          value={selections.deliveries[i].accountId}
                          choices={cashChoices}
                          disabled={disabled}
                          onChange={(v) =>
                            change({
                              ...selections,
                              deliveries: selections.deliveries.map((d, j) =>
                                j === i ? { ...d, accountId: v } : d,
                              ),
                            })
                          }
                        />
                      )}
                    </div>
                  </fieldset>
                ))}
                {report.payload.expenses.map((expense, i) => (
                  <fieldset key={i}>
                    <legend>
                      Expense · {expense.description} · TZS {amount(expense.amount)}
                    </legend>
                    <Select
                      label={`Payment account for expense ${i + 1}`}
                      value={selections.expenses[i].accountId}
                      choices={cashChoices}
                      disabled={disabled}
                      onChange={(v) =>
                        change({
                          ...selections,
                          expenses: selections.expenses.map((x, j) =>
                            j === i ? { ...x, accountId: v } : x,
                          ),
                        })
                      }
                    />
                  </fieldset>
                ))}
                <fieldset>
                  <legend>Accounting</legend>
                  <div className="pd-post-grid">
                    {ledgerFields.map(([key, label, types]) => (
                      <Select
                        key={key}
                        label={label}
                        value={selections[key]}
                        choices={review.ledger
                          .filter((a) => (types as readonly string[]).includes(a.accountType))
                          .map((a) => ({ id: a.id, name: `${a.accountCode} · ${a.accountName}` }))}
                        disabled={disabled}
                        onChange={(v) => update(key, v)}
                      />
                    ))}
                  </div>
                </fieldset>
                {!cashChoices.length && (
                  <p className="pd-notice">
                    Connect this station’s payment accounts to cash ledger accounts in Cash Desk
                    before posting.
                  </p>
                )}
                {attempt && (
                  <p role="status" className="pd-notice">
                    Check status first. If no posting appears, retry this exact request; its
                    reference is preserved to prevent duplicates.
                  </p>
                )}
                <div className="pd-post-actions">
                  <button
                    className="desk-primary"
                    type="submit"
                    disabled={busy || !!review.issues.length || (!!attempt && !retryReady)}
                  >
                    {busy ? 'Posting…' : attempt ? 'Retry same posting' : 'Post shift to apps'}
                  </button>
                  <button
                    className="desk-secondary"
                    type="button"
                    disabled={busy || !!attempt}
                    onClick={() => {
                      setExpanded(false);
                      setDirty(false);
                      setSelections(empty(report));
                    }}
                  >
                    Cancel review
                  </button>
                </div>
              </form>
            )}
          </>
        )
      )}
      {!!review?.postings.some((p) => p.reversedAt) && (
        <p className="pd-post-history">Previous reversed postings remain in the audit history.</p>
      )}
    </section>
  );
}
