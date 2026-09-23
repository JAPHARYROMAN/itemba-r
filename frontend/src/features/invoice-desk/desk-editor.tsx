'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, FormTextarea, Modal } from '@/components/ui';
import { DraftFormNotice, useWorkspaceDraftForm } from '@/components/workspace/workspace-drafts';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendPost, backendPatch } from '@/lib/api-client';
import { Directory, Invoice, Scope, Supplier, localToday, money } from './types';

export function DeskEditor({
  kind,
  scope,
  directory,
  invoice,
  paymentId,
  draftId,
  needsReview,
  onClose,
  onSaved,
}: {
  kind: 'invoice' | 'edit' | 'supplier' | 'payment' | 'void' | 'reverse';
  scope: Scope;
  directory: Directory;
  invoice?: Invoice;
  paymentId?: string;
  draftId?: string;
  needsReview?: boolean;
  onClose: () => void;
  onSaved: (id?: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const draft = useWorkspaceDraftForm(
    {
      ...scope,
      ...(invoice
        ? {
            companyId: invoice.companyId,
            divisionId: invoice.divisionId,
            branchId: invoice.branchId,
          }
        : {}),
      supplierId: '',
      name: '',
      email: '',
      phone: '',
      invoiceNumber: invoice?.invoiceNumber ?? '',
      description: invoice?.description ?? '',
      currency: invoice?.currency ?? 'TZS',
      invoiceDate: invoice?.invoiceDate.slice(0, 10) ?? localToday(),
      dueDate: invoice?.dueDate.slice(0, 10) ?? localToday(),
      totalAmount: invoice?.totalAmount ?? '',
      notes: invoice?.notes ?? '',
      amount: invoice?.outstanding ?? '',
      paymentDate: localToday(),
      method: 'Bank transfer',
      reference: '',
      reason: '',
    },
    {
      appId: 'invoice-desk',
      title: {
        invoice: 'New invoice',
        edit: 'Edit invoice',
        supplier: 'New supplier',
        payment: 'Invoice payment',
        void: 'Void invoice',
        reverse: 'Reverse payment',
      }[kind],
      describe: (values) =>
        values.invoiceNumber || values.description || values.name || invoice?.invoiceNumber || '',
      context: {
        kind,
        invoiceId: invoice?.id ?? '',
        version: invoice ? String(invoice.version) : '',
        paymentId: paymentId ?? '',
      },
      draftId,
      needsReview,
      busy,
      onClose,
    },
  );
  const { form, setForm, guard, requestId: requestId } = draft;
  const pending = useRef(false),
    id = useId();
  const suppliers = useWorkspaceResource<Supplier[]>(
    '/invoice-desk/suppliers',
    { companyId: form.companyId },
    kind === 'invoice' && !!form.companyId,
  );
  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === 'companyId'
        ? { divisionId: '', branchId: '', supplierId: '' }
        : key === 'divisionId'
          ? { branchId: '' }
          : {}),
    }));
  const close = () => {
    if (!pending.current) void guard.requestClose(onClose);
  };
  const title = {
    invoice: 'New invoice',
    edit: 'Edit invoice',
    supplier: 'New supplier',
    payment: 'Record a payment',
    void: 'Void invoice',
    reverse: 'Reverse payment',
  }[kind];
  const choices = (items: { id: string; name: string }[], placeholder: string) => [
    { value: '', label: placeholder },
    ...items.map((x) => ({ value: x.id, label: x.name })),
  ];
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      let result: { id?: string };
      if (kind === 'invoice' || kind === 'edit') {
        if (kind === 'invoice' && !suppliers.data?.some((s) => s.id === form.supplierId))
          throw new Error('Select an available supplier for this company.');
        const {
          companyId,
          divisionId,
          branchId,
          supplierId,
          invoiceNumber,
          description,
          currency,
          invoiceDate,
          dueDate,
          totalAmount,
          notes,
        } = form;
        const values = {
          invoiceNumber,
          description,
          currency,
          invoiceDate,
          dueDate,
          totalAmount,
          notes,
        };
        result =
          kind === 'edit' && invoice
            ? await backendPatch(`/invoice-desk/invoices/${invoice.id}`, {
                ...values,
                version: invoice.version,
              })
            : await backendPost('/invoice-desk/invoices', {
                companyId,
                divisionId,
                branchId,
                supplierId,
                invoiceNumber,
                description,
                currency,
                invoiceDate,
                dueDate,
                totalAmount,
                notes,
              });
      } else if (kind === 'supplier') {
        result = await backendPost('/invoice-desk/suppliers', {
          companyId: form.companyId,
          name: form.name,
          ...(form.email ? { email: form.email } : {}),
          ...(form.phone ? { phone: form.phone } : {}),
        });
      } else {
        if (!invoice) throw new Error('Refresh the invoice before continuing.');
        if (kind === 'payment') {
          await draft.beginRequest();
          const { amount, paymentDate, method, reference } = form;
          result = await backendPost(`/invoice-desk/invoices/${invoice.id}/payments`, {
            amount,
            paymentDate,
            method,
            reference,
            version: Number(draft.requestContext.current?.version || invoice.version),
            requestId: requestId.current,
          });
        } else
          result = await backendPost(
            `/invoice-desk/invoices/${invoice.id}/${kind === 'void' ? 'void' : `payments/${paymentId}/reverse`}`,
            { version: invoice.version, reason: form.reason },
          );
      }
      draft.markSaved();
      onSaved(kind === 'invoice' ? result.id : invoice?.id);
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
      size={kind === 'invoice' || kind === 'edit' ? 'lg' : 'md'}
      onClose={close}
      subtitle={
        kind === 'payment'
          ? 'Record money already paid. This does not send a payment.'
          : kind === 'invoice'
            ? 'Keep the original supplier invoice number for easy reconciliation.'
            : undefined
      }
      footer={
        <>
          {draft.canRetain && (
            <Btn variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" form={id} loading={busy}>
            {kind === 'invoice' ? 'Save invoice' : kind === 'supplier' ? 'Save supplier' : title}
          </Btn>
        </>
      }
    >
      <form id={id} onSubmit={submit} className="desk-form" {...guard.capture}>
        <DraftFormNotice draft={draft}>
          {invoice && (
            <p>
              Latest saved invoice: {invoice.invoiceNumber} · {invoice.description} · Total{' '}
              {money(invoice.totalAmount, invoice.currency)} · Outstanding{' '}
              {money(invoice.outstanding, invoice.currency)} · Invoice date{' '}
              {invoice.invoiceDate.slice(0, 10)} · Due {invoice.dueDate.slice(0, 10)}
              {invoice.notes ? ` · Notes: ${invoice.notes}` : ''}
              {invoice.voidedAt ? ' · Voided' : ''}
            </p>
          )}
        </DraftFormNotice>
        {error && (
          <p className="desk-error" role="alert">
            {error}
          </p>
        )}
        {(kind === 'invoice' || kind === 'supplier') && (
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            onChange={(e) => set('companyId', e.target.value)}
            options={choices(directory.companies, 'Select company')}
          />
        )}
        {kind === 'supplier' && (
          <>
            <FormInput
              label="Supplier name"
              required
              maxLength={160}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
            <FormInput
              label="Email"
              type="email"
              maxLength={254}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
            <FormInput
              label="Phone"
              maxLength={60}
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </>
        )}
        {(kind === 'invoice' || kind === 'edit') && (
          <>
            {kind === 'invoice' && (
              <>
                <div className="desk-form-pair">
                  <FormSelect
                    label="Division"
                    required
                    disabled={!form.companyId}
                    value={form.divisionId}
                    onChange={(e) => set('divisionId', e.target.value)}
                    options={choices(
                      directory.divisions.filter((d) => d.companyId === form.companyId),
                      'Select division',
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
                      'Select branch',
                    )}
                  />
                </div>
                <FormSelect
                  label="Supplier"
                  required
                  disabled={!form.companyId || suppliers.loading}
                  value={form.supplierId}
                  onChange={(e) => set('supplierId', e.target.value)}
                  options={choices(
                    suppliers.data ?? [],
                    suppliers.loading ? 'Loading suppliers…' : 'Select supplier',
                  )}
                />
                {suppliers.error && (
                  <p role="alert" className="desk-error">
                    {suppliers.error}{' '}
                    <button type="button" onClick={suppliers.reload}>
                      Retry
                    </button>
                  </p>
                )}
                {!!form.companyId &&
                  !suppliers.loading &&
                  !suppliers.error &&
                  !suppliers.data?.length && (
                    <p className="desk-muted">
                      Create a supplier in the Suppliers view before recording your first invoice.
                    </p>
                  )}
              </>
            )}
            <FormInput
              label="Supplier invoice number"
              required
              maxLength={100}
              value={form.invoiceNumber}
              onChange={(e) => set('invoiceNumber', e.target.value)}
            />
            <FormInput
              label="What was purchased?"
              required
              maxLength={500}
              placeholder="e.g. Office supplies for September"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
            <div className="desk-form-pair">
              <FormDateField
                label="Invoice date"
                required
                max={localToday()}
                value={form.invoiceDate}
                onChange={(value) => set('invoiceDate', value)}
              />
              <FormDateField
                label="Due date"
                required
                min={form.invoiceDate}
                value={form.dueDate}
                onChange={(value) => set('dueDate', value)}
              />
            </div>
            <div className="desk-form-pair">
              <FormSelect
                label="Currency"
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
                options={['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP'].map((c) => ({
                  value: c,
                  label: c,
                }))}
              />
              <FormInput
                label="Invoice total (including tax)"
                required
                inputMode="decimal"
                pattern="[0-9]{1,16}(\.[0-9]{1,2})?"
                value={form.totalAmount}
                onChange={(e) => set('totalAmount', e.target.value)}
              />
            </div>
            <FormTextarea
              label="Notes / purchase reference"
              maxLength={4000}
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
            <p className="desk-muted">
              For a cash purchase, save the invoice and record its payment. Attach the original
              invoice from its detail view.
            </p>
          </>
        )}
        {kind === 'payment' && invoice && (
          <>
            <div className="desk-payment-balance">
              <span>Outstanding</span>
              <strong>{money(invoice.outstanding, invoice.currency)}</strong>
            </div>
            <FormInput
              label={`Amount (${invoice.currency})`}
              required
              inputMode="decimal"
              pattern="[0-9]{1,16}(\.[0-9]{1,2})?"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
            />
            <FormDateField
              label="Payment date"
              required
              min={invoice.invoiceDate.slice(0, 10)}
              max={localToday()}
              value={form.paymentDate}
              onChange={(value) => set('paymentDate', value)}
            />
            <FormSelect
              label="Payment method"
              value={form.method}
              onChange={(e) => set('method', e.target.value)}
              options={['Bank transfer', 'Cash', 'Mobile money', 'Cheque', 'Other'].map((m) => ({
                value: m,
                label: m,
              }))}
            />
            <FormInput
              label="Payment reference"
              maxLength={160}
              value={form.reference}
              onChange={(e) => set('reference', e.target.value)}
            />
          </>
        )}
        {(kind === 'void' || kind === 'reverse') && (
          <>
            <p className="desk-muted">
              {kind === 'void'
                ? 'The invoice stays in your records, but is excluded from balances. Its invoice number remains reserved.'
                : 'This corrects the recorded balance and preserves the original payment in the history. It does not refund money.'}
            </p>
            <FormTextarea
              label="Reason"
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
            />
          </>
        )}
      </form>
    </Modal>
  );
}
