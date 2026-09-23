'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, FormTextarea, Modal } from '@/components/ui';
import { DraftFormNotice, useWorkspaceDraftForm } from '@/components/workspace/workspace-drafts';
import { useLoanOptions, LoanLedgerChoice } from '@/features/loans/loan-finance';
import { backendPost } from '@/lib/api-client';
import {
  Account,
  Directory,
  Editor,
  Scope,
  localToday,
  money,
  movementLabels,
  expenseCategories,
} from './types';

export function CashEditor({
  editor,
  accounts,
  directory,
  scope,
  onClose,
  onSaved,
}: {
  editor: Editor;
  accounts: Account[];
  directory: Directory;
  scope: Scope;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const draft = useWorkspaceDraftForm(
    {
      ...scope,
      name: '',
      accountKind: 'CASH',
      currency: 'TZS',
      openingBalance: '0',
      kind: editor.loan
        ? 'LOAN_REPAYMENT'
        : editor.invoice
          ? 'SUPPLIER_PAYMENT'
          : editor.movementKind || 'DAILY_SALES',
      accountId: editor.loan?.borrower.id || '',
      targetAccountId: editor.loan?.lender.id || '',
      amount: editor.invoice?.outstanding || editor.loan?.outstanding || '',
      businessDate: localToday(),
      dueDate: '',
      description: editor.invoice
        ? `Payment · ${editor.invoice.invoiceNumber}`
        : editor.loan
          ? `Repayment · ${editor.loan.description}`
          : '',
      reference: '',
      expenseCategory: '',
      payee: '',
      expenseNotes: '',
      reason: '',
      principal: '',
      interest: '0',
      fees: '0',
      receivableAccountId: '',
      payableAccountId: '',
      interestIncomeAccountId: '',
      interestExpenseAccountId: '',
      feeIncomeAccountId: '',
      feeExpenseAccountId: '',
    },
    {
      appId: 'cash-desk',
      title:
        editor.kind === 'account'
          ? 'New cash account'
          : editor.kind === 'reverse'
            ? 'Reverse movement'
            : 'Cash movement',
      describe: (values) => values.description || values.name,
      context: {
        kind: editor.kind,
        movementKind: editor.movementKind ?? '',
        invoiceId: editor.invoice?.id ?? '',
        version: editor.invoice ? String(editor.invoice.version) : '',
        loanId: editor.loan?.id ?? '',
        loanBalance: editor.loan?.outstanding ?? '',
        loanVoided: editor.loan?.voidedAt ?? '',
        movementId: editor.movement?.id ?? '',
        movementReversed: editor.movement?.reversedAt ?? '',
      },
      draftId: editor.draftId,
      needsReview: editor.needsReview,
      busy,
      onClose,
    },
  );
  const { form, setForm, guard, requestId: request } = draft;
  const pending = useRef(false),
    id = useId();
  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === 'companyId'
        ? { divisionId: '', branchId: '' }
        : key === 'divisionId'
          ? { branchId: '' }
          : key === 'accountId'
            ? { targetAccountId: '' }
            : {}),
    }));
  const account = accounts.find((a) => a.id === form.accountId);
  const two = ['TRANSFER', 'LOAN', 'LOAN_REPAYMENT'].includes(form.kind);
  const target = accounts.find((a) => a.id === form.targetAccountId);
  const intercompany = editor.kind === 'movement' && ['LOAN', 'LOAN_REPAYMENT'].includes(form.kind);
  const lenderOptions = useLoanOptions(
    (form.kind === 'LOAN' ? account : target)?.companyId || '',
    intercompany,
  );
  const borrowerOptions = useLoanOptions(
    (form.kind === 'LOAN' ? target : account)?.companyId || '',
    intercompany,
  );
  const eligible = accounts.filter(
    (a) =>
      !editor.invoice ||
      (a.companyId === editor.invoice.companyId && a.currency === editor.invoice.currency),
  );
  const targets = accounts.filter(
    (a) =>
      a.id !== account?.id &&
      a.currency === account?.currency &&
      (form.kind === 'TRANSFER'
        ? a.companyId === account?.companyId
        : a.companyId !== account?.companyId),
  );
  const choices = (items: { id: string; name: string }[], placeholder: string) => [
    { value: '', label: placeholder },
    ...items.map((x) => ({ value: x.id, label: x.name })),
  ];
  const accountChoices = (items: Account[]) =>
    choices(
      items.map((a) => ({
        id: a.id,
        name: `${a.name} · ${a.branch.name} · ${a.company.name} · ${money(a.balance, a.currency)}`,
      })),
      'Choose account',
    );
  const close = () => {
    if (!pending.current) void guard.requestClose(onClose);
  };
  const title =
    editor.kind === 'account'
      ? 'New cash account'
      : editor.kind === 'reverse'
        ? 'Reverse movement'
        : movementLabels[form.kind];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      draft.validateReview();
      await draft.beginRequest();
      await draft.saveNow();
      if (editor.kind === 'account')
        await backendPost('/cash-desk/accounts', {
          requestId: request.current,
          companyId: form.companyId,
          divisionId: form.divisionId,
          branchId: form.branchId,
          name: form.name,
          kind: form.accountKind,
          currency: form.currency,
          openingDate: form.businessDate,
          openingBalance: form.openingBalance,
        });
      else if (editor.kind === 'reverse')
        await backendPost(`/cash-desk/movements/${editor.movement!.id}/reverse`, {
          requestId: request.current,
          reason: form.reason,
          businessDate: form.businessDate,
        });
      else {
        if (!account) throw new Error('Choose an available account.');
        if (form.kind === 'EXPENSE' && (!form.expenseCategory || !form.payee.trim()))
          throw new Error('Choose an expense category and enter who was paid.');
        await backendPost('/cash-desk/movements', {
          requestId: request.current,
          kind: form.kind,
          accountId: form.accountId,
          ...(two ? { targetAccountId: form.targetAccountId } : {}),
          ...(editor.loan ? { loanId: editor.loan.id } : {}),
          ...(editor.invoice
            ? {
                invoiceId: editor.invoice.id,
                invoiceVersion: Number(
                  draft.requestContext.current?.version || editor.invoice.version,
                ),
              }
            : {}),
          ...(form.kind === 'LOAN' && form.dueDate ? { dueDate: form.dueDate } : {}),
          ...(form.kind === 'LOAN'
            ? {
                receivableAccountId: form.receivableAccountId,
                payableAccountId: form.payableAccountId,
              }
            : {}),
          ...(form.kind === 'LOAN_REPAYMENT'
            ? {
                principal: form.principal || undefined,
                interest: form.interest,
                fees: form.fees,
                interestIncomeAccountId: form.interestIncomeAccountId || undefined,
                interestExpenseAccountId: form.interestExpenseAccountId || undefined,
                feeIncomeAccountId: form.feeIncomeAccountId || undefined,
                feeExpenseAccountId: form.feeExpenseAccountId || undefined,
              }
            : {}),
          amount: form.amount,
          businessDate: form.businessDate,
          description: form.description,
          reference: form.reference,
          ...(form.kind === 'EXPENSE'
            ? {
                expenseCategory: form.expenseCategory,
                payee: form.payee,
                expenseNotes: form.expenseNotes,
              }
            : {}),
        });
      }
      draft.markSaved();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save. Please try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={title}
      size="md"
      onClose={close}
      subtitle={
        editor.kind === 'reverse'
          ? 'Keep the original record and add a correcting entry.'
          : editor.kind === 'account'
            ? 'A place where your company holds money.'
            : 'Record money already received or paid.'
      }
      footer={
        <>
          {draft.canRetain && (
            <Btn variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          <Btn type="submit" form={id} loading={busy}>
            {editor.kind === 'account'
              ? 'Create account'
              : editor.kind === 'reverse'
                ? 'Confirm reversal'
                : 'Save movement'}
          </Btn>
        </>
      }
    >
      <form id={id} className="desk-form" onSubmit={submit} {...guard.capture}>
        <DraftFormNotice draft={draft}>
          {editor.invoice && (
            <p>
              Latest invoice balance: {money(editor.invoice.outstanding, editor.invoice.currency)}
              {editor.invoice.voidedAt ? ' · Voided' : ''}
            </p>
          )}
          {editor.loan && (
            <p>
              Latest loan balance: {money(editor.loan.outstanding, editor.loan.currency)}
              {editor.loan.voidedAt ? ' · Voided' : ''}
            </p>
          )}
          {editor.movement && (
            <p>
              {editor.movement.description} ·{' '}
              {money(editor.movement.amount, editor.movement.currency)} ·{' '}
              {editor.movement.reversedAt ? 'Already reversed' : 'Recorded'}
            </p>
          )}
        </DraftFormNotice>
        {error && (
          <p className="desk-error" role="alert">
            {error}
          </p>
        )}
        {editor.kind === 'account' ? (
          <>
            <FormSelect
              label="Company"
              required
              value={form.companyId}
              onChange={(e) => set('companyId', e.target.value)}
              options={choices(directory.companies, 'Choose company')}
            />
            <div className="desk-form-pair">
              <FormSelect
                label="Division"
                required
                disabled={!form.companyId}
                value={form.divisionId}
                onChange={(e) => set('divisionId', e.target.value)}
                options={choices(
                  directory.divisions.filter((d) => d.companyId === form.companyId),
                  'Choose division',
                )}
              />
              <FormSelect
                label="Branch"
                required
                disabled={!form.divisionId}
                value={form.branchId}
                onChange={(e) => set('branchId', e.target.value)}
                options={choices(
                  directory.branches.filter((b) => b.divisionId === form.divisionId),
                  'Choose branch',
                )}
              />
            </div>
            <FormInput
              label="Account name"
              placeholder="e.g. Main cash till"
              required
              maxLength={120}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
            <div className="desk-form-pair">
              <FormSelect
                label="Account type"
                value={form.accountKind}
                onChange={(e) => set('accountKind', e.target.value)}
                options={[
                  { value: 'CASH', label: 'Cash' },
                  { value: 'BANK', label: 'Bank' },
                  { value: 'MOBILE_MONEY', label: 'Mobile money' },
                ]}
              />
              <FormSelect
                label="Currency"
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
                options={['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP'].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </div>
            <FormInput
              label="Opening balance"
              required
              inputMode="decimal"
              pattern="\d{1,16}(\.\d{1,2})?"
              value={form.openingBalance}
              onChange={(e) => set('openingBalance', e.target.value)}
            />
          </>
        ) : editor.kind === 'reverse' ? (
          <>
            <p className="desk-payment-balance">
              {editor.movement?.description}
              <strong>{money(editor.movement!.amount, editor.movement!.currency)}</strong>
            </p>
            <FormTextarea
              label="Reason for reversal"
              required
              minLength={3}
              maxLength={500}
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
            />
          </>
        ) : (
          <>
            {editor.invoice && (
              <p className="desk-payment-balance">
                {editor.invoice.supplier.name} · {editor.invoice.invoiceNumber}
                <strong>
                  Outstanding {money(editor.invoice.outstanding, editor.invoice.currency)}
                </strong>
              </p>
            )}
            {editor.loan && (
              <p className="desk-payment-balance">
                {editor.loan.borrower.company.name} → {editor.loan.lender.company.name}
                <strong>Remaining {money(editor.loan.outstanding, editor.loan.currency)}</strong>
              </p>
            )}
            {!editor.loan && !editor.invoice && (
              <FormSelect
                label="Movement type"
                value={form.kind}
                onChange={(e) => {
                  setForm((f) => ({
                    ...f,
                    kind: e.target.value,
                    targetAccountId: '',
                    dueDate: '',
                  }));
                }}
                options={['DAILY_SALES', 'OTHER_IN', 'EXPENSE', 'TRANSFER', 'LOAN'].map(
                  (value) => ({ value, label: movementLabels[value] }),
                )}
              />
            )}
            <FormSelect
              label={
                ['DAILY_SALES', 'OTHER_IN'].includes(form.kind)
                  ? 'Receiving account'
                  : 'Paying account'
              }
              required
              disabled={!!editor.loan}
              value={form.accountId}
              onChange={(e) => set('accountId', e.target.value)}
              options={accountChoices(eligible)}
            />
            {two && (
              <FormSelect
                label={form.kind === 'LOAN' ? 'Borrower account' : 'Receiving account'}
                required
                disabled={!!editor.loan || !account}
                value={form.targetAccountId}
                onChange={(e) => set('targetAccountId', e.target.value)}
                options={accountChoices(targets)}
              />
            )}
            <FormInput
              label={`Amount${account ? ` (${account.currency})` : ''}`}
              required
              inputMode="decimal"
              pattern="\d{1,16}(\.\d{1,2})?"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
            />
            {intercompany && (
              <div className="space-y-3 rounded-xl border p-3">
                <p className="text-sm">
                  This saves the loan balance, both cash movements and a journal for each company
                  together. Cash accounts must be connected to their ledgers.
                </p>
                {(lenderOptions.error || borrowerOptions.error) && (
                  <p role="alert">{lenderOptions.error || borrowerOptions.error}</p>
                )}
                {form.kind === 'LOAN' ? (
                  <>
                    <LoanLedgerChoice
                      label="Lender intercompany receivable"
                      accounts={lenderOptions.data?.ledger || []}
                      type="ASSET"
                      value={form.receivableAccountId}
                      onChange={(v) => set('receivableAccountId', v)}
                    />
                    <LoanLedgerChoice
                      label="Borrower intercompany payable"
                      accounts={borrowerOptions.data?.ledger || []}
                      type="LIABILITY"
                      value={form.payableAccountId}
                      onChange={(v) => set('payableAccountId', v)}
                    />
                  </>
                ) : (
                  <>
                    <FormInput
                      label="Principal (blank = amount less charges)"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.principal}
                      onChange={(e) => set('principal', e.target.value)}
                    />
                    <FormInput
                      label="Interest included in payment"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.interest}
                      onChange={(e) => set('interest', e.target.value)}
                    />
                    <FormInput
                      label="Fees included in payment"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.fees}
                      onChange={(e) => set('fees', e.target.value)}
                    />
                    {Number(form.interest) > 0 && (
                      <>
                        <LoanLedgerChoice
                          label="Lender interest income"
                          accounts={lenderOptions.data?.ledger || []}
                          type="INCOME"
                          value={form.interestIncomeAccountId}
                          onChange={(v) => set('interestIncomeAccountId', v)}
                        />
                        <LoanLedgerChoice
                          label="Borrower interest expense"
                          accounts={borrowerOptions.data?.ledger || []}
                          type="EXPENSE"
                          value={form.interestExpenseAccountId}
                          onChange={(v) => set('interestExpenseAccountId', v)}
                        />
                      </>
                    )}
                    {Number(form.fees) > 0 && (
                      <>
                        <LoanLedgerChoice
                          label="Lender fee income"
                          accounts={lenderOptions.data?.ledger || []}
                          type="INCOME"
                          value={form.feeIncomeAccountId}
                          onChange={(v) => set('feeIncomeAccountId', v)}
                        />
                        <LoanLedgerChoice
                          label="Borrower fee expense"
                          accounts={borrowerOptions.data?.ledger || []}
                          type="EXPENSE"
                          value={form.feeExpenseAccountId}
                          onChange={(v) => set('feeExpenseAccountId', v)}
                        />
                      </>
                    )}
                  </>
                )}
              </div>
            )}
            {form.kind === 'EXPENSE' && (
              <>
                <FormSelect
                  label="Expense category"
                  required
                  value={form.expenseCategory}
                  onChange={(e) => set('expenseCategory', e.target.value)}
                  options={[
                    { value: '', label: 'Choose category' },
                    ...Object.entries(expenseCategories).map(([value, label]) => ({
                      value,
                      label,
                    })),
                  ]}
                />
                <FormInput
                  label="Paid to"
                  placeholder="Person or business paid"
                  required
                  maxLength={160}
                  value={form.payee}
                  onChange={(e) => set('payee', e.target.value)}
                />
              </>
            )}
            <FormInput
              label="Description"
              required
              maxLength={500}
              placeholder={
                form.kind === 'DAILY_SALES' ? 'Daily cash sales' : 'What was this money for?'
              }
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
            <FormInput
              label="Reference (optional)"
              maxLength={160}
              value={form.reference}
              onChange={(e) => set('reference', e.target.value)}
            />
            {form.kind === 'EXPENSE' && (
              <>
                <FormTextarea
                  label="Expense notes (optional)"
                  maxLength={2000}
                  placeholder="Purpose, people involved or other supporting details"
                  value={form.expenseNotes}
                  onChange={(e) => set('expenseNotes', e.target.value)}
                />
                <p className="desk-muted">
                  Record expenses already paid. For an invoice tracked in Invoice Desk, use Supplier
                  balances → Record payment so its outstanding balance updates too.
                </p>
              </>
            )}
            {form.kind === 'DAILY_SALES' && (
              <p className="desk-muted">
                Enter the total received into this account for the day. Use this only when receipts
                for this account and date are not recorded through Sales Desk. Reverse an existing
                total before correcting it or switching to individual receipts.
              </p>
            )}
          </>
        )}
        <FormDateField
          label={
            editor.kind === 'account'
              ? 'Opening date'
              : editor.kind === 'reverse'
                ? 'Reversal date'
                : 'Transaction date'
          }
          required
          max={localToday()}
          value={form.businessDate}
          onChange={(value) => set('businessDate', value)}
        />
        {editor.kind === 'movement' && form.kind === 'LOAN' && (
          <FormDateField
            label="Repayment due date (optional)"
            min={form.businessDate}
            value={form.dueDate}
            onChange={(value) => set('dueDate', value)}
          />
        )}
      </form>
    </Modal>
  );
}
