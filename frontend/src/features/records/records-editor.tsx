'use client';
import { useId, useRef, useState, type RefObject } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, FormTextarea, Modal } from '@/components/ui';
import { useFormGuard } from '@/components/workspace/unsaved-work-provider';
import { ApiError, backendPatch, backendPost } from '@/lib/api-client';
import {
  Directory,
  Editor,
  Scope,
  isDebt,
  localToday,
  money,
  registers,
  paymentRemaining,
} from './types';

export function RecordsEditor({
  editor,
  scope,
  directory,
  onClose,
  onSaved,
  returnFocusRef,
}: {
  editor: Editor;
  scope: Scope;
  directory: Directory;
  onClose: () => void;
  onSaved: (id: string) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { entry, mode } = editor;
  const register = registers.find((r) => r.kind === editor.kind)!;
  const [form, setForm] = useState({
    title: entry?.title ?? '',
    counterparty: entry?.counterparty ?? '',
    contact: entry?.contact ?? '',
    reference: mode === 'settle' ? '' : (entry?.reference ?? ''),
    category: entry?.category ?? '',
    notes: mode === 'settle' ? '' : (entry?.notes ?? ''),
    currency: entry?.currency ?? 'TZS',
    amount: mode === 'settle' ? '' : (entry?.amount ?? ''),
    recordDate: entry?.recordDate.slice(0, 10) ?? localToday(),
    dueDate: entry?.dueDate?.slice(0, 10) ?? '',
    companyId: entry?.companyId ?? scope.companyId,
    divisionId: entry?.divisionId ?? scope.divisionId,
    branchId: entry?.branchId ?? scope.branchId,
    date: localToday(),
    reason: '',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false);
  const guard = useFormGuard(form, setForm),
    pending = useRef(false),
    requestId = useRef(''),
    frozen = useRef<object | null>(null),
    formId = useId();
  const set = (key: keyof typeof form, value: string) =>
    guard.change(() =>
      setForm((f) => ({
        ...f,
        [key]: value,
        ...(key === 'companyId'
          ? { divisionId: '', branchId: '' }
          : key === 'divisionId'
            ? { branchId: '' }
            : {}),
      })),
    );
  const close = () => {
    if (!pending.current) guard.requestClose(onClose);
  };
  const title =
    mode === 'create'
      ? `New ${register.singular}`
      : mode === 'edit'
        ? `Edit ${register.singular}`
        : mode === 'settle'
          ? editor.kind === 'DEBTOR'
            ? 'Receive payment'
            : 'Pay creditor'
          : mode === 'reverse'
            ? 'Reverse settlement'
            : 'Void record';
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    if (mode === 'settle' && paymentRemaining(entry!.balance, form.amount) === null) {
      setError('Enter a payment greater than zero and no more than the outstanding balance.');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (!requestId.current) requestId.current = crypto.randomUUID();
      const payload =
        frozen.current ??
        (mode === 'create' || mode === 'edit'
          ? {
              kind: editor.kind,
              title: form.title,
              counterparty: form.counterparty,
              contact: form.contact,
              reference: form.reference,
              category: form.category,
              notes: form.notes,
              companyId: form.companyId || null,
              divisionId: form.divisionId || null,
              branchId: form.branchId || null,
              currency: form.currency,
              amount: editor.kind === 'NOTE' ? '0' : form.amount,
              recordDate: form.recordDate,
              dueDate: isDebt(editor.kind) && form.dueDate ? form.dueDate : null,
              ...(mode === 'create'
                ? { requestId: requestId.current }
                : { version: entry!.version }),
            }
          : mode === 'settle'
            ? {
                requestId: requestId.current,
                version: entry!.version,
                amount: form.amount,
                date: form.date,
                reference: form.reference,
                notes: form.notes,
              }
            : { version: entry!.version, reason: form.reason });
      frozen.current = payload;
      const base = `/records/${entry?.id}`;
      const saved =
        mode === 'edit'
          ? await backendPatch<{ id: string }>(base, payload)
          : await backendPost<{ id: string }>(
              mode === 'create'
                ? '/records'
                : mode === 'settle'
                  ? `${base}/settlements`
                  : mode === 'reverse'
                    ? `${base}/settlements/${editor.settlementId}/reverse`
                    : `${base}/void`,
              payload,
            );
      guard.markSaved();
      onSaved(saved.id);
    } catch (e) {
      const unknown = !(e instanceof ApiError) || e.status >= 500;
      setUncertain(unknown);
      if (!unknown) frozen.current = null;
      setError(
        unknown
          ? 'The save outcome could not be confirmed. Keep this form open and retry the same request, or refresh the register to check it before creating another entry.'
          : e instanceof Error
            ? e.message
            : 'Unable to save.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const options = (rows: { id: string; name: string }[], placeholder: string) => [
    { value: '', label: placeholder },
    ...rows.map((r) => ({ value: r.id, label: r.name })),
  ];
  const details = mode === 'create' || mode === 'edit';
  const remaining = mode === 'settle' ? paymentRemaining(entry!.balance, form.amount) : null;
  return (
    <Modal
      open
      returnFocusRef={returnFocusRef}
      onClose={close}
      title={title}
      subtitle={entry?.title ?? register.description}
      size="lg"
      dismissOnBackdrop={false}
      footer={
        <>
          <Btn variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Btn>
          <Btn
            type="submit"
            form={formId}
            loading={busy}
            variant={mode === 'void' || mode === 'reverse' ? 'danger' : 'primary'}
          >
            {uncertain
              ? 'Retry same request'
              : mode === 'void'
                ? 'Void record'
                : mode === 'reverse'
                  ? 'Reverse settlement'
                  : mode === 'settle'
                    ? 'Record payment'
                    : 'Save record'}
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="records-form" {...guard.capture}>
        <p className={details ? 'records-form-context' : 'records-callout'}>
          {mode === 'settle'
            ? 'This records a payment already made. No money is transferred and other apps are unchanged.'
            : mode === 'void'
              ? 'The record stays in history and is excluded from active totals. Reverse any settlements first.'
              : mode === 'reverse'
                ? 'This removes the settlement from the recorded balance and preserves its history.'
                : 'An independent record. Other apps and accounting balances are unchanged.'}
        </p>
        {error && (
          <p role="alert" className="records-error">
            {error}
          </p>
        )}
        <fieldset disabled={busy || uncertain} className="records-fields">
          {details ? (
            <>
              <FormInput
                label="Title"
                required
                maxLength={180}
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder={
                  editor.kind === 'NOTE'
                    ? 'What would you like to remember?'
                    : 'A short description'
                }
                className="records-full"
                autoFocus
              />
              <FormInput
                label={
                  editor.kind === 'DEBTOR'
                    ? 'Debtor name'
                    : editor.kind === 'CREDITOR'
                      ? 'Creditor name'
                      : 'Person or business'
                }
                required={isDebt(editor.kind)}
                maxLength={180}
                value={form.counterparty}
                onChange={(e) => set('counterparty', e.target.value)}
              />
              {editor.kind !== 'NOTE' && (
                <>
                  <FormInput
                    label={isDebt(editor.kind) ? 'Debt amount' : 'Amount'}
                    required
                    inputMode="decimal"
                    pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
                    value={form.amount}
                    onChange={(e) => set('amount', e.target.value)}
                  />
                  <FormSelect
                    label="Currency"
                    disabled={mode === 'edit'}
                    value={form.currency}
                    onChange={(e) => set('currency', e.target.value)}
                    options={['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP'].map((c) => ({
                      value: c,
                      label: c,
                    }))}
                  />
                </>
              )}
              <FormDateField
                label="Record date"
                required
                disabled={mode === 'edit' && isDebt(editor.kind)}
                max={isDebt(editor.kind) ? localToday() : undefined}
                value={form.recordDate}
                onChange={(v) => set('recordDate', v)}
              />
              {isDebt(editor.kind) && (
                <FormDateField
                  label="Due date (optional)"
                  value={form.dueDate}
                  min={form.recordDate}
                  onChange={(v) => set('dueDate', v)}
                />
              )}
              <details
                className="records-disclosure records-full"
                open={!!entry?.companyId || !!scope.companyId || undefined}
              >
                <summary>
                  Organisation & visibility{' '}
                  <span>
                    {form.companyId
                      ? (directory.companies.find((c) => c.id === form.companyId)?.name ??
                        'Company linked')
                      : 'Private to you'}
                  </span>
                </summary>
                <div className="records-fields">
                  <div className="records-full records-scope-note">
                    {form.companyId
                      ? 'Shared with people who have Records access to this organisation.'
                      : 'Without a company link, this record is private to you.'}
                  </div>
                  <FormSelect
                    label="Company (optional)"
                    disabled={mode === 'edit'}
                    value={form.companyId}
                    onChange={(e) => set('companyId', e.target.value)}
                    options={options(directory.companies, 'No company · private')}
                  />
                  <FormSelect
                    label="Division (optional)"
                    disabled={mode === 'edit' || !form.companyId}
                    value={form.divisionId}
                    onChange={(e) => set('divisionId', e.target.value)}
                    options={options(
                      directory.divisions.filter((d) => d.companyId === form.companyId),
                      'No division',
                    )}
                  />
                  <FormSelect
                    label="Branch (optional)"
                    disabled={mode === 'edit' || !form.divisionId}
                    value={form.branchId}
                    onChange={(e) => set('branchId', e.target.value)}
                    options={options(
                      directory.branches.filter((b) => b.divisionId === form.divisionId),
                      'No branch',
                    )}
                  />
                  {mode === 'edit' && (
                    <p className="records-scope-note">
                      The register, currency and organisation are fixed. Void an incorrect entry and
                      create a replacement.{' '}
                      {isDebt(editor.kind) &&
                        'The debt date is also fixed. Amount corrections appear as a new statement movement dated today.'}
                    </p>
                  )}
                </div>
              </details>
              <details
                className="records-disclosure records-full"
                open={
                  !!(entry?.contact || entry?.reference || entry?.category || entry?.notes) ||
                  editor.kind === 'NOTE' ||
                  undefined
                }
              >
                <summary>
                  Additional details <span>Contact, reference & notes</span>
                </summary>
                <div className="records-fields">
                  <FormInput
                    label="Contact (optional)"
                    maxLength={160}
                    value={form.contact}
                    onChange={(e) => set('contact', e.target.value)}
                    placeholder="Phone or email"
                  />
                  <FormInput
                    label="Reference (optional)"
                    maxLength={100}
                    value={form.reference}
                    onChange={(e) => set('reference', e.target.value)}
                    placeholder="Invoice, receipt or your own reference"
                  />
                  <FormInput
                    label="Category (optional)"
                    maxLength={80}
                    value={form.category}
                    onChange={(e) => set('category', e.target.value)}
                    placeholder="e.g. Transport, supplies, personal"
                  />
                  <FormTextarea
                    className="records-full"
                    label="Notes"
                    maxLength={10000}
                    rows={4}
                    value={form.notes}
                    onChange={(e) => set('notes', e.target.value)}
                  />
                </div>
              </details>
            </>
          ) : mode === 'settle' ? (
            <>
              <div className="records-full records-payment-summary">
                <p className="records-balance">
                  Outstanding: <strong>{money(entry!.balance, entry!.currency)}</strong>
                </p>
                <p>
                  Enter the amount actually {editor.kind === 'DEBTOR' ? 'received' : 'paid'}.
                  Part-payments leave the remainder outstanding.
                </p>
                <Btn type="button" variant="ghost" onClick={() => set('amount', entry!.balance)}>
                  Use full balance
                </Btn>
              </div>
              <FormInput
                label={editor.kind === 'DEBTOR' ? 'Amount received' : 'Amount paid'}
                required
                inputMode="decimal"
                pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
                autoFocus
              />
              <FormDateField
                label="Payment date"
                required
                min={(entry!.lastActivityDate ?? entry!.recordDate).slice(0, 10)}
                max={localToday()}
                value={form.date}
                onChange={(v) => set('date', v)}
              />
              {remaining !== null && (
                <p className="records-full records-payment-preview" role="status">
                  {remaining === '0.00'
                    ? 'Paid in full after this payment.'
                    : `Part-payment · Remaining balance: ${money(remaining, entry!.currency)}`}
                </p>
              )}
              <FormInput
                className="records-full"
                label="Payment reference (optional)"
                maxLength={160}
                value={form.reference}
                onChange={(e) => set('reference', e.target.value)}
              />
              <FormTextarea
                className="records-full"
                label="Notes (optional)"
                maxLength={500}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </>
          ) : (
            <FormTextarea
              className="records-full"
              label="Reason"
              required
              minLength={3}
              maxLength={500}
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
              autoFocus
            />
          )}
        </fieldset>
        <p className="records-scope-note">
          Save before closing. Unsaved inputs stay in this window while it is open.
        </p>
      </form>
    </Modal>
  );
}
