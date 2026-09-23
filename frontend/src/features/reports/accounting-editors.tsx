'use client';

import dynamic from 'next/dynamic';

import type { WorkspaceDraft } from '@/components/workspace/workspace-drafts';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { FormSelect, FormSection } from '@/components/aurora';
import { Btn } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendPost } from '@/lib/api-client';
import { money } from '@/features/invoice-desk/types';
import {
  AccountingAcknowledgement,
  AccountingReviewShell,
  accountingChoices,
  useAccountingReview,
} from './accounting-review-form';
import {
  compatible,
  movementLabel,
  type AccountingTarget,
  type InvoiceReview,
  type CashReview,
  type Connections,
  type Desk,
  type UnlinkedPayment,
} from './accounting-types';

type Props = {
  target: AccountingTarget;
  source?: WorkspaceDraft;
  close: () => void;
  done: (message: string) => void;
};
const ReconciliationEditor = dynamic(() =>
  import('./reconciliation-editors').then((module) => module.ReconciliationEditor),
);
const SavedViewEditor = dynamic(() =>
  import('./report-saved-views').then((module) => module.SavedViewEditor),
);
const ControlEditor = dynamic(() =>
  import('./accounting-control-actions').then((m) => m.ControlEditor),
);
export function AccountingEditor(props: Props) {
  if (props.target.kind === 'control-create' || props.target.kind === 'control-action')
    return <ControlEditor {...props} target={props.target} />;
  if (props.target.kind === 'saved-view-create' || props.target.kind === 'saved-view-action')
    return <SavedViewEditor {...props} target={props.target} />;
  if (
    props.target.kind === 'reconciliation-create' ||
    props.target.kind === 'reconciliation-import' ||
    props.target.kind === 'reconciliation-line' ||
    props.target.kind === 'reconciliation-action'
  )
    return <ReconciliationEditor {...props} target={props.target} />;
  if (props.target.kind === 'invoice-posting')
    return <InvoicePosting {...props} target={props.target} />;
  if (props.target.kind === 'cash-posting') return <CashPosting {...props} target={props.target} />;
  if (props.target.kind === 'account-connection')
    return <AccountConnection {...props} target={props.target} />;
  return <PaymentLink {...props} target={props.target} />;
}
const journalVersion = (data: InvoiceReview | CashReview) =>
  JSON.stringify([
    data.source.id,
    data.fingerprint,
    'status' in data
      ? [data.status, data.blocked]
      : [data.source.status, data.issues, data.offsetId],
    data.journals,
    data.accounts.map((row) => [row.id, row.accountType]),
  ]);
function Journals({ rows }: { rows: InvoiceReview['journals'] }) {
  if (!rows.length) return null;
  return (
    <FormSection title="Linked journal history">
      {rows.map((row) => (
        <p key={row.id}>
          Journal {row.number} · {row.status}
        </p>
      ))}
      <Link href="/finance/journal-entries">Open journal entries →</Link>
    </FormSection>
  );
}
function InvoicePosting({
  target,
  source,
  close,
  done,
}: Props & { target: Extract<AccountingTarget, { kind: 'invoice-posting' }> }) {
  const { hasPermission } = useAuth();
  const sales = target.sourceKind === 'sales';
  const readAllowed =
    hasPermission('journal_entries.view') &&
    hasPermission(sales ? 'sales_desk.view' : 'invoice_desk.view');
  const writeAllowed =
    hasPermission('journal_entries.create') && hasPermission('journal_entries.post');
  const form = useAccountingReview<InvoiceReview, { debit: string; credit: string }>({
    path: `/desk-posting/${target.sourceKind}/${encodeURIComponent(target.id)}`,
    readAllowed,
    writeAllowed,
    initial: { debit: '', credit: '' },
    title: 'Invoice journal review',
    summary: (data) => data?.source.reference || '',
    context: { kind: target.kind, recordId: target.id, sourceKind: target.sourceKind },
    version: journalVersion,
    source,
    close,
    done,
  });
  const data = form.data,
    values = form.draft.form;
  const debitTypes = sales ? ['ASSET'] : ['ASSET', 'EXPENSE', 'COST_OF_GOODS_SOLD'];
  const eligible = (value: InvoiceReview) =>
    value.source.id === target.id &&
    value.status === 'Unposted' &&
    !value.blocked &&
    !value.journals.length &&
    values.debit !== values.credit &&
    value.accounts.some((a) => a.id === values.debit && debitTypes.includes(a.accountType)) &&
    value.accounts.some(
      (a) => a.id === values.credit && a.accountType === (sales ? 'INCOME' : 'LIABILITY'),
    );
  const submit = () =>
    void form.submit(
      (value) => {
        if (!eligible(value))
          throw new Error(
            'Choose available accounts and resolve the posting checks before continuing.',
          );
      },
      async (value) => {
        const result = await backendPost<{ journalNumber: string }>(
          `/desk-posting/${target.sourceKind}/${encodeURIComponent(target.id)}`,
          {
            fingerprint: value.fingerprint,
            debitAccountId: values.debit,
            creditAccountId: values.credit,
          },
        );
        return `Posted ${result.journalNumber}. The journal is linked to its source document.`;
      },
    );
  return (
    <AccountingReviewShell
      form={form}
      title={`Review ${data?.source.reference || source?.summary || 'invoice'}`}
      subtitle="Post one balanced journal to the existing ledger"
      action="Post balanced journal"
      disabled={!data || !eligible(data)}
      onSubmit={submit}
    >
      {data && (
        <>
          <FormSection title="Document">
            <p>
              {data.source.date} ·{' '}
              <strong>{money(data.source.amount, data.source.currency)}</strong> · {data.status}
            </p>
          </FormSection>
          <Journals rows={data.journals} />
          {(data.blocked || data.status !== 'Unposted') && (
            <p role="status" className="workspace-notice">
              {data.blocked ||
                'This document cannot be posted again. Review its linked journal and any source corrections.'}
            </p>
          )}
          <FormSection title="Ledger accounts">
            <FormSelect
              label={`Debit · ${sales ? 'Customer receivables' : 'Expense or asset'}`}
              value={values.debit}
              disabled={form.busy}
              placeholder="Choose debit account"
              options={accountingChoices(
                data.accounts.filter((a) => debitTypes.includes(a.accountType)),
                values.debit,
              )}
              onChange={(e) => form.draft.setForm((v) => ({ ...v, debit: e.target.value }))}
            />
            <FormSelect
              label={`Credit · ${sales ? 'Sales income' : 'Supplier payables'}`}
              value={values.credit}
              disabled={form.busy}
              placeholder="Choose credit account"
              options={accountingChoices(
                data.accounts.filter((a) => a.accountType === (sales ? 'INCOME' : 'LIABILITY')),
                values.credit,
              )}
              onChange={(e) => form.draft.setForm((v) => ({ ...v, credit: e.target.value }))}
            />
            <p>
              Debit {money(data.source.amount, data.source.currency)} · Credit{' '}
              {money(data.source.amount, data.source.currency)} · Difference 0.00
            </p>
          </FormSection>
          <AccountingAcknowledgement
            label="I checked the accounts, confirmed no separate ERP entry already records this invoice, and confirmed this total needs no tax split."
            checked={form.ack}
            disabled={form.busy}
            onChange={form.setAck}
          />
          {!writeAllowed && <p>Your role can review but cannot post journals.</p>}
        </>
      )}
    </AccountingReviewShell>
  );
}

function CashPosting({
  target,
  source,
  close,
  done,
}: Props & { target: Extract<AccountingTarget, { kind: 'cash-posting' }> }) {
  const { hasPermission } = useAuth();
  const readAllowed = hasPermission('cash_desk.view') && hasPermission('journal_entries.view');
  const writeAllowed =
    hasPermission('journal_entries.create') && hasPermission('journal_entries.post');
  const form = useAccountingReview<CashReview, { offset: string }>({
    path: `/cash-connections/movements/${encodeURIComponent(target.id)}`,
    readAllowed,
    writeAllowed,
    initial: { offset: '' },
    title: 'Cash journal review',
    summary: (data) => data?.source.description || '',
    context: { kind: target.kind, recordId: target.id },
    version: journalVersion,
    source,
    close,
    done,
  });
  const data = form.data,
    selected = data?.offsetId || form.draft.form.offset,
    transfer = data?.source.kind === 'TRANSFER';
  const eligible = (value: CashReview) =>
    value.source.id === target.id &&
    !value.issues.length &&
    !value.journals.length &&
    (value.source.kind === 'TRANSFER' ||
      value.accounts.some((row) => row.id === (value.offsetId || form.draft.form.offset)));
  const lines =
    data?.cashAccounts.map((account) => ({
      name: account.name || 'Unconnected cash account',
      debit: Number(account.amount) > 0 ? account.amount : '0',
      credit: Number(account.amount) < 0 ? account.amount.slice(1) : '0',
    })) || [];
  if (data && !transfer && selected && lines.length === 1)
    lines.push({
      name: data.accounts.find((a) => a.id === selected)?.accountName || 'Offset account',
      debit: lines[0].credit,
      credit: lines[0].debit,
    });
  return (
    <AccountingReviewShell
      form={form}
      title="Review cash posting"
      subtitle="One movement, one balanced journal"
      action={data?.journals.length ? undefined : 'Post cash movement'}
      disabled={!data || !eligible(data)}
      onSubmit={() =>
        void form.submit(
          (value) => {
            if (!eligible(value))
              throw new Error(
                'Choose an available account and resolve the posting checks before continuing.',
              );
          },
          async (value) => {
            const offset = value.offsetId || form.draft.form.offset;
            const result = await backendPost<{ journalNumber: string }>(
              `/cash-connections/movements/${encodeURIComponent(target.id)}`,
              {
                fingerprint: value.fingerprint,
                ...(value.source.kind !== 'TRANSFER' && offset ? { offsetAccountId: offset } : {}),
              },
            );
            return `Posted ${result.journalNumber}. Cash Desk and the ledger are linked.`;
          },
        )
      }
    >
      {data && (
        <>
          <FormSection title="Movement">
            <p>
              <strong>
                {movementLabel(data.source.kind)} ·{' '}
                {money(data.source.amount, data.source.currency)}
              </strong>
              <br />
              {data.source.date} · {data.source.description}
            </p>
          </FormSection>
          {data.issues.map((issue) => (
            <p className="workspace-notice" role="alert" key={issue}>
              {issue}
            </p>
          ))}
          <Journals rows={data.journals} />
          {!transfer && (
            <FormSelect
              label={data.offsetId ? 'Invoice control account' : 'Offset account'}
              disabled={!!data.offsetId || form.busy || !!data.journals.length}
              value={selected}
              placeholder="Choose an account"
              options={accountingChoices(data.accounts, selected)}
              onChange={(e) => form.draft.setForm({ offset: e.target.value })}
            />
          )}
          <div
            className="accounting-table"
            role="region"
            aria-label="Cash posting preview"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Debit</th>
                  <th>Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td>{line.name}</td>
                    <td>{money(line.debit, data.source.currency)}</td>
                    <td>{money(line.credit, data.source.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.journals.length && (
            <AccountingAcknowledgement
              label="I have checked that this movement is not already included in another journal or opening balance."
              checked={form.ack}
              disabled={form.busy}
              onChange={form.setAck}
            />
          )}
          {!writeAllowed && (
            <p>
              Your role can review this movement. Journal creation and posting permissions are
              required to post it.
            </p>
          )}
        </>
      )}
    </AccountingReviewShell>
  );
}

function AccountConnection({
  target,
  source,
  close,
  done,
}: Props & { target: Extract<AccountingTarget, { kind: 'account-connection' }> }) {
  const { hasPermission } = useAuth();
  const readAllowed = hasPermission('cash_desk.view') && hasPermission('journal_entries.view');
  const writeAllowed = hasPermission('cash_desk.manage') && hasPermission('cash_accounts.manage');
  const form = useAccountingReview<Connections, { bankId: string; ledgerId: string }>({
    path: '/cash-connections/accounts',
    query: target.query,
    readAllowed,
    writeAllowed,
    initial: { bankId: target.accountKind === 'bank' ? target.id : '', ledgerId: '' },
    title: 'Account connection',
    summary: (data) =>
      target.accountKind === 'desk'
        ? data?.desk.find((r) => r.id === target.id)?.name || ''
        : data?.bank.find((r) => r.id === target.id)?.accountName || '',
    context: {
      kind: target.kind,
      recordId: target.id,
      accountKind: target.accountKind,
      query: JSON.stringify(target.query),
    },
    version: (data) =>
      JSON.stringify([
        data.desk.map((r) => [
          r.id,
          r.companyId,
          r.divisionId,
          r.branchId,
          r.currency,
          r.canConnect,
          r.erpCashAccountId,
        ]),
        data.bank.map((r) => [
          r.id,
          r.companyId,
          r.divisionId,
          r.branchId,
          r.currency,
          r.canConnect,
          r.ledgerAccountId,
          r.recordedBalance,
          r.ledgerBalance,
        ]),
        data.ledger.map((r) => [
          r.id,
          r.companyId,
          r.divisionId,
          r.branchId,
          r.accountType,
          r.ledgerBalance,
        ]),
      ]),
    source,
    close,
    done,
  });
  const data = form.data,
    values = form.draft.form;
  const choices = (value: Connections) => {
    const desk =
      target.accountKind === 'desk' ? value.desk.find((d) => d.id === target.id) : undefined;
    const bank =
      target.accountKind === 'bank' ? value.bank.find((b) => b.id === target.id) : undefined;
    const selected = value.bank.find((b) => b.id === values.bankId);
    const ledgerId = selected?.ledgerAccountId || values.ledgerId;
    const banks = value.bank.filter(
      (b) =>
        !desk ||
        (compatible(b, desk) &&
          b.currency === desk.currency &&
          !value.desk.some((d) => d.id !== desk.id && d.erpCashAccountId === b.id)),
    );
    const ledgers = value.ledger.filter(
      (l) =>
        selected &&
        l.accountType === 'ASSET' &&
        compatible(l, selected) &&
        (!desk || compatible(l, desk)) &&
        !value.bank.some((b) => b.id !== selected.id && b.ledgerAccountId === l.id),
    );
    const exists = !!(desk || bank),
      saved = !!(bank?.ledgerAccountId || desk?.erpCashAccountId);
    const canSave = exists && !saved && !!(desk || bank)?.canConnect && !!selected?.canConnect;
    return { desk, bank, selected, ledgerId, banks, ledgers, exists, saved, canSave };
  };
  const current = data ? choices(data) : null;
  const ledgerBalance =
    data?.ledger.find((l) => l.id === current?.ledgerId)?.ledgerBalance ??
    current?.selected?.ledgerBalance;
  const selected = current?.selected,
    name = current?.desk?.name || current?.bank?.accountName || source?.summary || 'account';
  const canSave = writeAllowed && current?.canSave;
  const banks =
    current?.banks.map((b) => ({ value: b.id, label: `${b.accountName} · ${b.currency}` })) || [];
  if (values.bankId && !banks.some((b) => b.value === values.bankId))
    banks.push({ value: values.bankId, label: 'Previously selected account — unavailable' });
  return (
    <AccountingReviewShell
      form={form}
      title={`${canSave ? 'Connect' : 'Review'} ${name}`}
      action={canSave ? 'Save connection' : undefined}
      disabled={!current?.ledgerId || !current.ledgers.some((l) => l.id === current.ledgerId)}
      onSubmit={() =>
        void form.submit(
          (value) => {
            const latest = choices(value);
            if (
              !latest.canSave ||
              !latest.banks.some((b) => b.id === values.bankId) ||
              !latest.ledgers.some((l) => l.id === latest.ledgerId)
            )
              throw new Error(
                'Choose available, compatible accounts and check current write access before saving.',
              );
          },
          async (value) => {
            const latest = choices(value);
            await backendPost('/cash-connections/accounts', {
              deskAccountId: latest.desk?.id,
              cashAccountId: values.bankId,
              ledgerAccountId: latest.ledgerId,
            });
            return 'Connection saved. Review cash movements to post their journals.';
          },
        )
      }
    >
      {data && current && (
        <>
          {!current.exists && (
            <p role="alert" className="workspace-notice">
              This account is no longer available in the retained organisation scope.
            </p>
          )}
          <FormSection title="Matching accounts">
            <FormSelect
              label="Cash / bank account"
              value={values.bankId}
              disabled={target.accountKind === 'bank' || form.busy}
              placeholder="Choose the matching account"
              options={banks}
              onChange={(e) => form.draft.setForm({ bankId: e.target.value, ledgerId: '' })}
            />
            <FormSelect
              label="Dedicated asset ledger account"
              value={current.ledgerId}
              disabled={!!selected?.ledgerAccountId || form.busy}
              placeholder="Choose a ledger account"
              options={accountingChoices(current.ledgers, current.ledgerId)}
              onChange={(e) => form.draft.setForm((v) => ({ ...v, ledgerId: e.target.value }))}
            />
            <p>
              Use a dedicated ledger account for this cash box or bank account. Review any existing
              entries before connecting it. Opening balances are posted separately.
            </p>
          </FormSection>
          {selected && current.ledgerId && ledgerBalance != null && (
            <FormSection title="Balance review">
              <p>
                Recorded balance:{' '}
                {selected.recordedBalance == null
                  ? 'Unavailable'
                  : money(selected.recordedBalance, selected.currency)}
                <br />
                Ledger balance · all dates: {money(ledgerBalance, selected.currency)}
              </p>
              <p>
                {selected.recordedBalance == null
                  ? 'Reload account connections to compare the recorded balance.'
                  : selected.recordedBalance === ledgerBalance
                    ? 'The amounts match. Check the underlying entries before connecting.'
                    : 'The balances differ. Review the opening balances and underlying entries; saving a connection will not adjust either balance.'}
              </p>
            </FormSection>
          )}
          {canSave ? (
            <AccountingAcknowledgement
              label="These accounts represent the same cash box or bank account, and the ledger is not shared with another account."
              checked={form.ack}
              disabled={form.busy}
              onChange={form.setAck}
            />
          ) : (
            <p className="accounting-note">
              {current.saved
                ? 'This connection is saved. Historical connections cannot be reassigned here.'
                : 'Review only. Saving requires Cash Desk management, cash account management and write access to this company and organisation.'}
            </p>
          )}
        </>
      )}
    </AccountingReviewShell>
  );
}

function PaymentLink({
  target,
  source,
  close,
  done,
}: Props & { target: Extract<AccountingTarget, { kind: 'payment-link' }> }) {
  const { hasPermission } = useAuth();
  const readAllowed = ['cash_desk.view', 'invoice_desk.view', 'journal_entries.view'].every((p) =>
    hasPermission(p),
  );
  const writeAllowed = hasPermission('cash_desk.record') && hasPermission('invoice_desk.payments');
  const form = useAccountingReview<UnlinkedPayment[], { accountId: string }>({
    path: '/cash-connections/unlinked-payments',
    query: target.query,
    readAllowed,
    writeAllowed,
    initial: { accountId: '' },
    title: 'Supplier payment link',
    summary: (data) => data?.find((p) => p.id === target.id)?.invoice.invoiceNumber || '',
    context: { kind: target.kind, recordId: target.id, query: JSON.stringify(target.query) },
    version: (data) => {
      const payment = data.find((p) => p.id === target.id);
      return JSON.stringify(
        payment
          ? [
              payment.id,
              payment.amount,
              payment.paymentDate,
              payment.reference,
              payment.invoice.id,
              payment.invoice.invoiceNumber,
              payment.invoice.companyId,
              payment.invoice.divisionId,
              payment.invoice.branchId,
              payment.invoice.currency,
            ]
          : null,
      );
    },
    source,
    close,
    done,
  });
  const payment = form.data?.find((p) => p.id === target.id);
  const accounts = useWorkspaceResource<Desk[]>(
    '/cash-desk/accounts',
    { companyId: payment?.invoice.companyId || '' },
    readAllowed && !!payment,
  );
  const eligible =
    accounts.data?.filter(
      (a) => a.companyId === payment?.invoice.companyId && a.currency === payment.invoice.currency,
    ) || [];
  const { accountId } = form.draft.form;
  const choices = eligible.map((a) => ({ value: a.id, label: a.name }));
  if (accountId && !choices.some((a) => a.value === accountId))
    choices.push({ value: accountId, label: 'Previously selected account — unavailable' });
  return (
    <AccountingReviewShell
      form={form}
      title="Link existing supplier payment"
      action="Link payment and record cash outflow"
      disabled={
        !payment ||
        accounts.loading ||
        !!accounts.error ||
        !eligible.some((a) => a.id === accountId)
      }
      onSubmit={() =>
        void form.submit(
          (rows) => {
            if (!rows.some((p) => p.id === target.id))
              throw new Error(
                'This payment is no longer available to link. It may already be linked, reversed or outside your current access.',
              );
            if (accounts.loading || accounts.error || !eligible.some((a) => a.id === accountId))
              throw new Error('Choose an available cash account.');
          },
          async (rows) => {
            const current = rows.find((p) => p.id === target.id)!;
            await backendPost('/cash-desk/movements', {
              requestId: form.draft.requestId.current,
              kind: 'SUPPLIER_PAYMENT',
              accountId,
              invoiceId: current.invoice.id,
              existingInvoicePaymentId: current.id,
              amount: current.amount,
              businessDate: current.paymentDate.slice(0, 10),
              description: `Payment for ${current.invoice.invoiceNumber}`,
              reference: current.reference || '',
            });
            return `Linked ${current.invoice.invoiceNumber}. Its original paid amount is preserved.`;
          },
        )
      }
    >
      {form.data && !payment && (
        <p role="alert" className="workspace-notice">
          This payment is no longer available to link. It may already be linked, reversed or outside
          your current access.
        </p>
      )}
      {payment && (
        <>
          <FormSection title="Existing payment">
            <p>
              {payment.invoice.invoiceNumber} · {money(payment.amount, payment.invoice.currency)}
              <br />
              {payment.paymentDate.slice(0, 10)} · {payment.invoice.supplier.name}
            </p>
          </FormSection>
          <FormSelect
            label="Account that paid"
            value={accountId}
            disabled={form.busy || !!form.draft.requestId.current}
            placeholder="Choose cash account"
            options={choices}
            onChange={(e) => form.draft.setForm({ accountId: e.target.value })}
          />
          {accounts.loading && <p role="status">Loading available cash accounts…</p>}
          {accounts.error && (
            <div role="alert">
              <p>{accounts.error}</p>
              <Btn type="button" variant="secondary" disabled={form.busy} onClick={accounts.reload}>
                Retry cash accounts
              </Btn>
            </div>
          )}
          {!!form.draft.requestId.current && (
            <p className="workspace-notice">
              This link has already been attempted. Retry keeps the same account and request
              identity.
            </p>
          )}
          <AccountingAcknowledgement
            label="This payment is not already included in this account’s opening balance or another cash movement."
            checked={form.ack}
            disabled={form.busy}
            onChange={form.setAck}
          />
          <p>
            The original payment date must be on or after the account’s opening date. Its historical
            cash balance must cover this payment.
          </p>
          {!writeAllowed && (
            <p>Your role can review this payment but cannot link its cash account.</p>
          )}
        </>
      )}
    </AccountingReviewShell>
  );
}
