'use client';
import { useId, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Btn, FormDateField, FormInput, FormSelect, FormTextarea, Modal } from '@/components/ui';
import { DraftFormNotice, useWorkspaceDraftForm } from '@/components/workspace/workspace-drafts';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendPost } from '@/lib/api-client';
import { Account } from '../cash-desk/types';
import {
  Customer,
  Directory,
  Editor,
  Scope,
  localToday,
  money,
  lineTotal,
  saleTotal,
} from './types';
export function SalesEditor({
  editor,
  scope,
  directory,
  onClose,
  onSaved,
}: {
  editor: Editor;
  scope: Scope;
  directory: Directory;
  onClose: () => void;
  onSaved: (id?: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const draft = useWorkspaceDraftForm(
    {
      ...scope,
      name: '',
      email: '',
      phone: '',
      customerId: '',
      currency: 'TZS',
      saleDate: localToday(),
      dueDate: localToday(),
      notes: '',
      lines: [{ description: '', quantity: '1', unitPrice: '' }],
      accountId: '',
      amount: editor.sale?.outstanding ?? '',
      paymentDate: localToday(),
      reference: '',
      reason: '',
    },
    {
      appId: 'sales-desk',
      title: {
        sale: 'New sale',
        customer: 'New customer',
        payment: 'Sales payment',
        void: 'Void sale',
      }[editor.kind],
      describe: (values) =>
        values.name ||
        values.lines
          .map((line) => line.description)
          .filter(Boolean)
          .join(', ') ||
        editor.sale?.saleNumber ||
        '',
      context: {
        kind: editor.kind,
        saleId: editor.sale?.id ?? '',
        version: editor.sale ? String(editor.sale.version) : '',
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
  const customers = useWorkspaceResource<Customer[]>(
    '/sales-desk/customers',
    { companyId: form.companyId },
    editor.kind === 'sale' && !!form.companyId,
  );
  const accounts = useWorkspaceResource<Account[]>(
    '/cash-desk/accounts',
    { companyId: editor.sale?.companyId ?? '' },
    editor.kind === 'payment' && !!editor.sale,
  );
  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === 'companyId'
        ? { divisionId: '', branchId: '', customerId: '' }
        : key === 'divisionId'
          ? { branchId: '' }
          : {}),
    }));
  const close = () => {
    if (!pending.current) void guard.requestClose(onClose);
  };
  const choices = (rows: { id: string; name: string }[], placeholder: string) => [
    { value: '', label: placeholder },
    ...rows.map((r) => ({ value: r.id, label: r.name })),
  ];
  const total = saleTotal(form.lines),
    eligible = accounts.data?.filter((a) => a.currency === editor.sale?.currency) ?? [];
  const title = {
    sale: 'New sale',
    customer: 'New customer',
    payment: 'Record payment',
    void: 'Void sale',
  }[editor.kind];
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
      let row: { id?: string };
      if (editor.kind === 'customer')
        row = await backendPost('/sales-desk/customers', {
          companyId: form.companyId,
          name: form.name,
          ...(form.email ? { email: form.email } : {}),
          ...(form.phone ? { phone: form.phone } : {}),
        });
      else if (editor.kind === 'sale') {
        if (!customers.data?.some((c) => c.id === form.customerId))
          throw new Error('Choose an available customer.');
        if (!total)
          throw new Error('Check quantities and prices. Each line must have a positive amount.');
        row = await backendPost('/sales-desk/sales', {
          requestId: request.current,
          companyId: form.companyId,
          divisionId: form.divisionId,
          branchId: form.branchId,
          customerId: form.customerId,
          currency: form.currency,
          saleDate: form.saleDate,
          dueDate: form.dueDate,
          notes: form.notes,
          lines: form.lines,
        });
      } else {
        if (!editor.sale) throw new Error('Refresh the sale.');
        if (editor.kind === 'payment') {
          if (!eligible.some((a) => a.id === form.accountId))
            throw new Error('Choose an available cash account for this sale.');
          row = await backendPost(`/sales-desk/sales/${editor.sale.id}/payments`, {
            requestId: request.current,
            version: Number(draft.requestContext.current?.version || editor.sale.version),
            accountId: form.accountId,
            amount: form.amount,
            paymentDate: form.paymentDate,
            reference: form.reference,
          });
        } else
          row = await backendPost(`/sales-desk/sales/${editor.sale.id}/void`, {
            version: editor.sale.version,
            reason: form.reason,
          });
      }
      draft.markSaved();
      onSaved(editor.kind === 'sale' ? row.id : editor.sale?.id);
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
      size={editor.kind === 'sale' ? 'lg' : 'md'}
      onClose={close}
      subtitle={
        editor.kind === 'sale'
          ? 'Record the final agreed prices for goods or services.'
          : editor.kind === 'payment'
            ? 'Money already received will also be added to Cash Desk.'
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
          <Btn form={id} type="submit" loading={busy}>
            {editor.kind === 'sale'
              ? 'Save sale'
              : editor.kind === 'customer'
                ? 'Save customer'
                : title}
          </Btn>
        </>
      }
    >
      <form id={id} className="desk-form" onSubmit={submit} {...guard.capture}>
        <DraftFormNotice draft={draft}>
          {editor.sale && (
            <p>
              Latest saved sale: {editor.sale.saleNumber} · Outstanding{' '}
              {money(editor.sale.outstanding, editor.sale.currency)}
              {editor.sale.voidedAt ? ' · Voided' : ''}
            </p>
          )}
        </DraftFormNotice>
        {error && (
          <p className="desk-error" role="alert">
            {error}
          </p>
        )}
        {(editor.kind === 'sale' || editor.kind === 'customer') && (
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            onChange={(e) => set('companyId', e.target.value)}
            options={choices(directory.companies, 'Choose company')}
          />
        )}
        {editor.kind === 'customer' && (
          <>
            <FormInput
              label="Customer name"
              required
              maxLength={160}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
            <div className="desk-form-pair">
              <FormInput
                label="Phone (optional)"
                maxLength={60}
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
              <FormInput
                label="Email (optional)"
                type="email"
                maxLength={254}
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </div>
          </>
        )}
        {editor.kind === 'sale' && (
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
            <div className="desk-form-pair">
              <FormSelect
                label="Customer"
                required
                disabled={!form.companyId || customers.loading}
                value={form.customerId}
                onChange={(e) => set('customerId', e.target.value)}
                options={choices(customers.data ?? [], 'Choose customer')}
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
            {customers.error && (
              <p className="desk-error" role="alert">
                {customers.error}
                <button type="button" onClick={customers.reload}>
                  Retry
                </button>
              </p>
            )}
            {!!form.companyId &&
              !customers.loading &&
              !customers.error &&
              !customers.data?.length && (
                <p className="desk-muted">
                  Add a customer in the Customers section before recording a sale.
                </p>
              )}
            <div className="desk-form-pair">
              <FormDateField
                label="Sale date"
                required
                max={localToday()}
                value={form.saleDate}
                onChange={(value) => set('saleDate', value)}
              />
              <FormDateField
                label="Payment due date"
                required
                min={form.saleDate}
                value={form.dueDate}
                onChange={(value) => set('dueDate', value)}
              />
            </div>
            <div className="sales-line-editor">
              <h3>What did you sell?</h3>
              {form.lines.map((line, index) => (
                <fieldset key={index}>
                  <legend>Item {index + 1}</legend>
                  <FormInput
                    label={`Item ${index + 1} description`}
                    placeholder="Product or service"
                    required
                    maxLength={250}
                    value={line.description}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        lines: f.lines.map((l, i) =>
                          i === index ? { ...l, description: e.target.value } : l,
                        ),
                      }))
                    }
                  />
                  <div className="sales-line-values">
                    <FormInput
                      label={`Item ${index + 1} quantity`}
                      required
                      inputMode="decimal"
                      pattern="\d{1,9}(\.\d{1,3})?"
                      value={line.quantity}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          lines: f.lines.map((l, i) =>
                            i === index ? { ...l, quantity: e.target.value } : l,
                          ),
                        }))
                      }
                    />
                    <FormInput
                      label={`Item ${index + 1} unit price`}
                      required
                      inputMode="decimal"
                      pattern="\d{1,16}(\.\d{1,2})?"
                      value={line.unitPrice}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          lines: f.lines.map((l, i) =>
                            i === index ? { ...l, unitPrice: e.target.value } : l,
                          ),
                        }))
                      }
                    />
                    <span>
                      {lineTotal(line.quantity, line.unitPrice)
                        ? money(lineTotal(line.quantity, line.unitPrice)!)
                        : '—'}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove item ${index + 1}`}
                      disabled={form.lines.length === 1}
                      onClick={() =>
                        setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== index) }))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </fieldset>
              ))}
              <Btn
                type="button"
                variant="secondary"
                icon={<Plus size={14} />}
                disabled={form.lines.length >= 30}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    lines: [...f.lines, { description: '', quantity: '1', unitPrice: '' }],
                  }))
                }
              >
                Add item
              </Btn>
            </div>
            <p className="sales-form-total">
              Sale total <strong>{total ? money(total, form.currency) : '—'}</strong>
            </p>
            <p className="desk-muted">
              Use final prices, including any taxes or discounts already agreed. Record payments
              after saving the sale.
            </p>
            <FormTextarea
              label="Notes (optional)"
              maxLength={2000}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </>
        )}
        {editor.kind === 'payment' && editor.sale && (
          <>
            <p className="desk-payment-balance">
              {editor.sale.customer.name} · {editor.sale.saleNumber}
              <strong>Outstanding {money(editor.sale.outstanding, editor.sale.currency)}</strong>
            </p>
            <FormSelect
              label="Receiving account"
              required
              value={form.accountId}
              onChange={(e) => set('accountId', e.target.value)}
              options={choices(
                eligible.map((a) => ({
                  id: a.id,
                  name: `${a.name} · ${a.branch.name} · ${a.company.name}`,
                })),
                accounts.loading ? 'Loading accounts…' : 'Choose account',
              )}
            />
            {accounts.error && (
              <p className="desk-error" role="alert">
                {accounts.error}
                <button type="button" onClick={accounts.reload}>
                  Retry
                </button>
              </p>
            )}
            {!accounts.loading && !accounts.error && !eligible.length && (
              <p className="desk-muted">
                Create a Cash Desk account in this company and currency before receiving payment.
              </p>
            )}
            <FormInput
              label="Amount received"
              required
              inputMode="decimal"
              pattern="\d{1,16}(\.\d{1,2})?"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
            />
            <FormDateField
              label="Payment date"
              required
              min={editor.sale.saleDate.slice(0, 10)}
              max={localToday()}
              value={form.paymentDate}
              onChange={(value) => set('paymentDate', value)}
            />
            <FormInput
              label="Payment reference (optional)"
              maxLength={160}
              value={form.reference}
              onChange={(e) => set('reference', e.target.value)}
            />
            <p className="desk-muted">
              Cash Desk receives this payment automatically. Do not also enter it as a manual
              daily-sales total.
            </p>
          </>
        )}
        {editor.kind === 'void' && (
          <>
            <p className="desk-muted">
              The sale stays in your history and is removed from sales and customer balances.
              Reverse any payments in Cash Desk first.
            </p>
            <FormTextarea
              label="Reason for voiding"
              required
              minLength={3}
              maxLength={500}
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
            />
          </>
        )}
      </form>
    </Modal>
  );
}
