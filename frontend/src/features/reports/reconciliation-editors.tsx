'use client';

import { useEffect, useRef, useState } from 'react';
import { Btn, FormDateField, Modal } from '@/components/ui';
import {
  FormInput,
  FormSelect,
  FormSection,
  FormShell,
  FormTextarea,
} from '@/components/aurora';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useAuth } from '@/hooks/use-auth';
import { backendPost } from '@/lib/api-client';
import { localToday, money as formatMoney } from '@/features/invoice-desk/types';
import {
  AccountingAcknowledgement,
  AccountingReviewShell,
  useAccountingReview,
} from './accounting-review-form';
import { StatementImport } from './statement-import';
import { publishMatching } from './reconciliation-events';
import {
  entryAmount,
  reconciliationActions,
  reconciliationVersion,
  validStatementDate,
  type CashAccountChoice,
  type CompanyChoice,
  type MatchingResult,
  type Reconciliation,
  type ReconciliationEvidence,
  type ReconciliationTarget,
} from './reconciliation-types';
import './reconciliation-workspace.css';
const money = (value: string | number, currency: string) => formatMoney(String(value), currency);

type Props = {
  target: ReconciliationTarget;
  source?: WorkspaceDraft;
  close: () => void;
  done: (message: string) => void;
};
export function ReconciliationEditor(props: Props) {
  if (props.target.kind === 'reconciliation-create')
    return <CreateReconciliation {...props} target={props.target} />;
  if (props.target.kind === 'reconciliation-import')
    return (
      <StatementImport
        id={props.target.id}
        source={props.source}
        close={props.close}
        done={props.done}
      />
    );
  if (props.target.kind === 'reconciliation-line')
    return <StatementLineEditor {...props} id={props.target.id} />;
  if (props.target.kind === 'reconciliation-action')
    return <ReconciliationActionEditor {...props} target={props.target} />;
  return null;
}
function CreateReconciliation({
  target,
  source,
  close,
  done,
}: Props & { target: Extract<ReconciliationTarget, { kind: 'reconciliation-create' }> }) {
  const { hasPermission, user } = useAuth();
  const allowed = hasPermission('bank_reconciliations.create'),
    canChooseCompany = hasPermission('companies.view');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const draft = useWorkspaceDraftForm(
    () => ({
      reconciliationNumber: `BR-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      companyId: target.companyId || user?.companyId || '',
      cashAccountId: '',
      statementStartDate: `${localToday().slice(0, 7)}-01`,
      statementEndDate: localToday(),
      statementOpeningBalance: '0',
      statementClosingBalance: '0',
      bookOpeningBalance: '0',
      bookClosingBalance: '0',
      notes: '',
    }),
    {
      appId: 'reports',
      title: 'New reconciliation',
      describe: (values) => values.reconciliationNumber,
      context: (values) => ({ kind: target.kind, companyId: values.companyId }),
      draftId: source?.id,
      busy,
      onClose: close,
    },
  );
  const { form, setForm } = draft;
  const companies = useWorkspaceChoices<CompanyChoice>(
    '/companies',
    {},
    allowed && canChooseCompany,
  );
  const accounts = useWorkspaceChoices<CashAccountChoice>(
    '/cash-accounts',
    { companyId: form.companyId, isActive: true },
    allowed && !!form.companyId && hasPermission('cash_accounts.view'),
  );
  const companyOptions = canChooseCompany
    ? companies.rows.map((row) => ({ value: row.id, label: row.name }))
    : user?.companyId
      ? [{ value: user.companyId, label: 'Assigned company' }]
      : [];
  if (form.companyId && !companyOptions.some((row) => row.value === form.companyId))
    companyOptions.push({
      value: form.companyId,
      label: 'Previously selected company — check access',
    });
  const availableAccounts = accounts.rows.filter(
    (row) => row.companyId === form.companyId && row.isActive !== false,
  );
  const accountOptions = availableAccounts.map((row) => ({
    value: row.id,
    label: `${row.accountName} · ${row.currency}`,
  }));
  if (form.cashAccountId && !accountOptions.some((row) => row.value === form.cashAccountId))
    accountOptions.push({
      value: form.cashAccountId,
      label: 'Previously selected account — unavailable',
    });
  const onClose = () => {
    if (!pending.current) draft.guard.requestClose(close);
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || !allowed) return;
    pending.current = true;
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      if (!form.reconciliationNumber.trim()) throw new Error('Enter a reconciliation number.');
      if (
        !form.companyId ||
        (canChooseCompany
          ? companies.loading ||
            !!companies.error ||
            !companies.rows.some((row) => row.id === form.companyId)
          : form.companyId !== user?.companyId)
      )
        throw new Error('Choose an available company.');
      if (
        !hasPermission('cash_accounts.view') ||
        accounts.loading ||
        accounts.error ||
        !availableAccounts.some((row) => row.id === form.cashAccountId)
      )
        throw new Error('Choose an available cash account.');
      if (
        !validStatementDate(form.statementStartDate) ||
        !validStatementDate(form.statementEndDate) ||
        form.statementStartDate > form.statementEndDate
      )
        throw new Error('Enter a valid statement period, with the start before the end.');
      const body = {
        ...form,
        reconciliationNumber: form.reconciliationNumber.trim(),
        statementOpeningBalance: entryAmount(form.statementOpeningBalance),
        statementClosingBalance: entryAmount(form.statementClosingBalance),
        bookOpeningBalance: entryAmount(form.bookOpeningBalance),
        bookClosingBalance: entryAmount(form.bookClosingBalance),
        notes: form.notes.trim() || undefined,
      };
            setBusy(true);
      await backendPost('/bank-reconciliations', body);
      if (mounted.current) {
        draft.markSaved();
        done(`Created ${body.reconciliationNumber}. Add or import statement lines next.`);
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'The reconciliation could not be created. Your input is still here.',
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="New reconciliation"
      subtitle="Choose the account, statement period and opening position"
      onClose={onClose}
      size="lg"
      dismissOnBackdrop={!busy}
    >
      <div {...draft.guard.capture}>
        <FormShell onSubmit={submit}>
          <DraftFormNotice draft={draft} />
          {error && (
            <p role="alert" className="workspace-notice">
              {error}
            </p>
          )}
          {!allowed && (
            <p role="alert">
              Your role cannot create reconciliations. You can keep this draft for later.
            </p>
          )}
          <FormSection title="Account and period">
            <FormInput
              label="Reconciliation number"
              required
              value={form.reconciliationNumber}
              disabled={busy}
              onChange={(event) =>
                setForm((value) => ({ ...value, reconciliationNumber: event.target.value }))
              }
            />
            <FormSelect
              label="Company"
              value={form.companyId}
              disabled={busy || !canChooseCompany}
              options={companyOptions}
              placeholder="Choose company"
              onChange={(event) =>
                setForm((value) => ({ ...value, companyId: event.target.value, cashAccountId: '' }))
              }
            />
            {companies.error && (
              <p role="alert">
                {companies.error}{' '}
                <Btn type="button" variant="secondary" onClick={companies.retry}>
                  Retry companies
                </Btn>
              </p>
            )}
            <FormSelect
              label="Cash account"
              value={form.cashAccountId}
              disabled={busy}
              options={accountOptions}
              placeholder="Choose cash account"
              onChange={(event) =>
                setForm((value) => ({ ...value, cashAccountId: event.target.value }))
              }
            />
            {accounts.loading && <p role="status">Loading cash accounts…</p>}
            {accounts.error && (
              <p role="alert">
                {accounts.error}{' '}
                <Btn type="button" variant="secondary" onClick={accounts.retry}>
                  Retry cash accounts
                </Btn>
              </p>
            )}
            {!hasPermission('cash_accounts.view') && (
              <p role="alert">Cash account access is required to choose an account.</p>
            )}
            <FormDateField
              label="Statement start"
              value={form.statementStartDate}
              disabled={busy}
              onChange={(value) => setForm((current) => ({ ...current, statementStartDate: value }))}
            />
            <FormDateField
              label="Statement end"
              value={form.statementEndDate}
              disabled={busy}
              onChange={(value) => setForm((current) => ({ ...current, statementEndDate: value }))}
            />
          </FormSection>
          <FormSection title="Opening and closing balances">
            {(
              [
                ['statementOpeningBalance', 'Statement opening balance'],
                ['statementClosingBalance', 'Statement closing balance'],
                ['bookOpeningBalance', 'Book opening balance'],
                ['bookClosingBalance', 'Book closing balance'],
              ] as const
            ).map(([key, label]) => (
              <FormInput
                key={key}
                label={label}
                inputMode="decimal"
                value={form[key]}
                disabled={busy}
                onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))}
              />
            ))}
            <FormTextarea
              label="Notes"
              value={form.notes}
              disabled={busy}
              onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))}
            />
          </FormSection>
          <div className="reconciliation-form-actions">
            <Btn type="button" variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Btn>
            {draft.canRetain && (
              <Btn type="button" variant="secondary" disabled={busy} onClick={draft.keep}>
                Keep draft
              </Btn>
            )}
            <Btn type="submit" loading={busy} disabled={!allowed}>
              Create reconciliation
            </Btn>
          </div>
        </FormShell>
      </div>
    </Modal>
  );
}
function StatementLineEditor({ id, source, close, done }: Props & { id: string }) {
  const { hasPermission } = useAuth();
  const form = useAccountingReview({
    path: `/bank-reconciliations/${encodeURIComponent(id)}`,
    readAllowed: hasPermission('bank_reconciliations.view'),
    writeAllowed: hasPermission('bank_reconciliations.update'),
    initial: {
      transactionDate: localToday(),
      description: '',
      reference: '',
      debitAmount: '0',
      creditAmount: '0',
      balance: '',
    },
    title: 'New statement line',
    summary: (row: Reconciliation | null) => row?.reconciliationNumber || '',
    context: { kind: 'reconciliation-line', recordId: id },
    version: reconciliationVersion,
    source,
    close,
    done,
  });
  const values = form.draft.form,
    row = form.data;
  return (
    <AccountingReviewShell
      form={form}
      title="Add statement line"
      subtitle={row?.reconciliationNumber || source?.summary}
      action="Add line"
      disabled={row?.status !== 'DRAFT'}
      onSubmit={() =>
        void form.submit(
          (current) => {
            if (current.id !== id || current.status !== 'DRAFT')
              throw new Error('Only a draft reconciliation can receive statement lines.');
            if (
              !validStatementDate(values.transactionDate) ||
              values.transactionDate < current.statementStartDate.slice(0, 10) ||
              values.transactionDate > current.statementEndDate.slice(0, 10)
            )
              throw new Error('Choose a date inside the statement period.');
            if (
              !values.description.trim() ||
              values.description.length > 500 ||
              values.reference.length > 200
            )
              throw new Error(
                'Enter a description of up to 500 characters and a reference of up to 200 characters.',
              );
            const debit = entryAmount(values.debitAmount),
              credit = entryAmount(values.creditAmount);
            if (debit < 0 || credit < 0 || debit > 0 === credit > 0)
              throw new Error('Enter exactly one positive debit or credit.');
            if (values.balance) entryAmount(values.balance);
          },
          async () => {
            await backendPost(`/bank-reconciliations/${encodeURIComponent(id)}/lines`, {
              ...values,
              description: values.description.trim(),
              reference: values.reference.trim() || undefined,
              debitAmount: entryAmount(values.debitAmount),
              creditAmount: entryAmount(values.creditAmount),
              balance: values.balance ? entryAmount(values.balance) : undefined,
            });
            return 'Statement line added. Review its journal match next.';
          },
        )
      }
    >
      {row && (
        <>
          {row.status !== 'DRAFT' && (
            <p role="alert" className="workspace-notice">
              This reconciliation is {row.status.toLowerCase()}. Its statement lines cannot be
              changed.
            </p>
          )}
          <FormSection title="Statement details">
            <FormDateField
              label="Transaction date"
              value={values.transactionDate}
              disabled={form.busy}
              min={row.statementStartDate.slice(0, 10)}
              max={row.statementEndDate.slice(0, 10)}
              onChange={(value) =>
                form.draft.setForm((current) => ({ ...current, transactionDate: value }))
              }
            />
            <FormInput
              label="Description"
              value={values.description}
              maxLength={500}
              disabled={form.busy}
              onChange={(event) =>
                form.draft.setForm((value) => ({ ...value, description: event.target.value }))
              }
            />
            <FormInput
              label="Reference"
              value={values.reference}
              maxLength={200}
              disabled={form.busy}
              onChange={(event) =>
                form.draft.setForm((value) => ({ ...value, reference: event.target.value }))
              }
            />
            {(
              [
                ['debitAmount', 'Debit · money out'],
                ['creditAmount', 'Credit · money in'],
                ['balance', 'Running balance (optional)'],
              ] as const
            ).map(([key, label]) => (
              <FormInput
                key={key}
                label={label}
                inputMode="decimal"
                value={values[key]}
                disabled={form.busy}
                onChange={(event) =>
                  form.draft.setForm((value) => ({ ...value, [key]: event.target.value }))
                }
              />
            ))}
          </FormSection>
          <AccountingAcknowledgement
            label="I checked this statement line, its date and debit/credit direction."
            checked={form.ack}
            disabled={form.busy}
            onChange={form.setAck}
          />
        </>
      )}
    </AccountingReviewShell>
  );
}
function ReconciliationActionEditor({
  target,
  source,
  close,
  done,
}: Props & { target: Extract<ReconciliationTarget, { kind: 'reconciliation-action' }> }) {
  const { hasPermission } = useAuth();
  const spec = reconciliationActions[target.action];
  const form = useAccountingReview({
    path: `/bank-reconciliations/${encodeURIComponent(target.id)}`,
    readAllowed: hasPermission('bank_reconciliations.view'),
    writeAllowed: hasPermission(spec.permission),
    initial: { journalEntryLineId: target.journalEntryLineId || '' },
    title: spec.label,
    summary: (row: Reconciliation | null) => row?.reconciliationNumber || '',
    context: {
      kind: target.kind,
      recordId: target.id,
      action: target.action,
      lineId: target.lineId || '',
      journalEntryLineId: target.journalEntryLineId || '',
      candidateLabel: target.candidateLabel || '',
    },
    version: reconciliationVersion,
    source,
    close,
    done,
  });
  const row = form.data,
    finalizing = target.action === 'approve' || target.action === 'close';
  const evidence = useWorkspaceResource<ReconciliationEvidence>(
    `/bank-reconciliations/${encodeURIComponent(target.id)}/evidence`,
    {},
    finalizing && form.readAllowed,
  );
  const version = row ? reconciliationVersion(row) : '',
    seen = useRef(version),
    reload = evidence.reload;
  useEffect(() => {
    if (seen.current !== version) {
      seen.current = version;
      if (finalizing) reload();
    }
  }, [version, finalizing, reload]);
  const eligible = (current: Reconciliation) =>
    current.id === target.id &&
    current.status === spec.status &&
    (target.action !== 'match' ||
      (!!form.draft.form.journalEntryLineId &&
        current.statementLines?.some((line) => line.id === target.lineId && !line.matched))) &&
    (target.action !== 'unmatch' ||
      current.statementLines?.some((line) => line.id === target.lineId && line.matched));
  const line = row?.statementLines?.find((value) => value.id === target.lineId);
  return (
    <AccountingReviewShell
      form={form}
      title={spec.label}
      subtitle={row?.reconciliationNumber || source?.summary}
      action={spec.submit}
      disabled={
        !row ||
        !eligible(row) ||
        (finalizing && (evidence.loading || !!evidence.error || !evidence.data?.ready))
      }
      onSubmit={() =>
        void form.submit(
          (current) => {
            if (!eligible(current))
              throw new Error('This action is no longer available for the current statement.');
            if (finalizing && (evidence.loading || evidence.error || !evidence.data?.ready))
              throw new Error('Resolve the current approval checks before continuing.');
          },
          async () => {
            const body =
              target.action === 'run-matching'
                ? { dateWindowDays: 3, amountToleranceCents: 0 }
                : target.action === 'match'
                  ? {
                      statementLineId: target.lineId,
                      journalEntryLineId: form.draft.form.journalEntryLineId,
                    }
                  : target.action === 'unmatch'
                    ? { statementLineId: target.lineId }
                    : undefined;
            const result = await backendPost<MatchingResult>(
              `/bank-reconciliations/${encodeURIComponent(target.id)}/${target.action}`,
              body,
            );
            if (target.action === 'run-matching') {
              publishMatching(target.id, result);
              return `${result.summary.autoMatched} lines matched; ${result.summary.ambiguous} need a choice; ${result.summary.stillUnmatched} remain unmatched.`;
            }
            return target.action === 'approve'
              ? 'Reconciliation approved.'
              : target.action === 'close'
                ? 'Reconciliation closed.'
                : target.action === 'match'
                  ? 'Statement line matched.'
                  : 'Statement line match removed.';
          },
        )
      }
    >
      {row && (
        <>
          <FormSection title="Current statement">
            <p>
              {row.statementStartDate.slice(0, 10)} – {row.statementEndDate.slice(0, 10)} ·{' '}
              {row.currency} · {row.status}
            </p>
            <p>
              Statement close {money(row.statementClosingBalance, row.currency)} · Reconciled{' '}
              {money(row.reconciledBalance, row.currency)}
            </p>
            <p>{spec.effect}</p>
          </FormSection>
          {!eligible(row) && (
            <p role="alert" className="workspace-notice">
              This action is no longer available for the current statement.
            </p>
          )}
          {line && (
            <FormSection title="Statement line">
              <p>
                {line.description} · {line.transactionDate.slice(0, 10)}
              </p>
              <p>
                Debit {money(line.debitAmount, row.currency)} · Credit{' '}
                {money(line.creditAmount, row.currency)}
              </p>
            </FormSection>
          )}
          {target.action === 'match' && (
            <FormSection title="Selected journal candidate">
              <p>{target.candidateLabel || 'Previously selected journal entry'}</p>
              <p>
                The selected journal entry must still be eligible and unused when the match is
                saved.
              </p>
            </FormSection>
          )}
          {finalizing && (
            <FormSection title="Approval evidence">
              {evidence.loading && <p role="status">Checking current statement evidence…</p>}
              {evidence.error && <p role="alert">{evidence.error}</p>}
              {evidence.data && (
                <>
                  <strong>
                    {evidence.data.ready
                      ? 'Statement and matching checks passed'
                      : 'Resolve before approval'}
                  </strong>
                  <ul>
                    {evidence.data.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                  <p>{evidence.data.note}</p>
                </>
              )}
              <Btn type="button" variant="secondary" disabled={form.busy} onClick={evidence.reload}>
                Refresh approval checks
              </Btn>
            </FormSection>
          )}
          <AccountingAcknowledgement
            label="I reviewed the current statement and the effect of this action."
            checked={form.ack}
            disabled={form.busy}
            onChange={form.setAck}
          />
          {!form.writeAllowed && (
            <p>Your current role cannot perform this action. You can keep the review for later.</p>
          )}
        </>
      )}
    </AccountingReviewShell>
  );
}
