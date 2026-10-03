'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, Modal } from '@/components/ui';
import { backendGet, backendPost } from '@/lib/api-client';
import type { PartyBalanceSummary } from '@/features/party/party-balance';
import { localToday, money } from './types';

type OpenPayable = {
  id: string;
  payableNumber: string;
  currency: string;
  outstandingAmount: string;
  dueDate: string | null;
  status: string;
};
type CashAccount = {
  id: string;
  accountName: string;
  currency: string;
  isActive: boolean;
  branch?: { name: string } | null;
};
const OPEN = new Set(['OPEN', 'PARTIALLY_PAID', 'OVERDUE']);
const methods = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MOBILE_MONEY', label: 'Mobile money' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'BANK_CARD', label: 'Bank card' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OTHER', label: 'Other' },
];
/** Exact money arithmetic for two-decimal strings; avoids float drift on sums. */
const toCents = (value: string | undefined) => {
  const n = Number(value ?? '');
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const fromCents = (cents: number) => (cents / 100).toFixed(2);

/**
 * Record one supplier payment from Cash Desk and allocate it across the supplier's open
 * payables (party linkage, Phase 2). It goes through /supplier-payments, so the payment
 * gets its number, its allocations, its journal and, with the cash book on, its Cash Desk
 * movement with the supplier and the payable attached. One requestId per dialog keeps a
 * retried submit idempotent.
 */
export function SupplierPaymentDialog({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: PartyBalanceSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const requestId = useRef(crypto.randomUUID());
  const [payables, setPayables] = useState<OpenPayable[] | null>(null);
  const [accounts, setAccounts] = useState<CashAccount[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [paymentDate, setPaymentDate] = useState(localToday());
  const [method, setMethod] = useState('CASH');
  const [cashAccountId, setCashAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    Promise.all([
      backendGet<{ data: OpenPayable[] }>('/payables', {
        query: { supplierId: supplier.partyId, companyId: supplier.companyId, limit: 100 },
      }),
      backendGet<{ data: CashAccount[] }>('/cash-accounts', {
        query: { companyId: supplier.companyId, limit: 100 },
      }),
    ])
      .then(([p, a]) => {
        if (cancelled) return;
        setPayables(
          (p.data ?? []).filter((x) => OPEN.has(x.status) && toCents(x.outstandingAmount) > 0),
        );
        setAccounts((a.data ?? []).filter((x) => x.isActive));
      })
      .catch((e) => {
        if (!cancelled)
          setLoadError(e instanceof Error ? e.message : 'Unable to load open payables.');
      });
    return () => {
      cancelled = true;
    };
  }, [supplier.partyId, supplier.companyId]);

  const selected = (payables ?? []).filter((p) => toCents(amounts[p.id]) > 0);
  const currency = selected[0]?.currency ?? payables?.[0]?.currency ?? supplier.baseCurrency;
  const mixed = selected.some((p) => p.currency !== currency);
  const totalCents = selected.reduce((sum, p) => sum + toCents(amounts[p.id]), 0);
  const over = selected.find((p) => toCents(amounts[p.id]) > toCents(p.outstandingAmount));
  const eligibleAccounts = (accounts ?? []).filter((a) => a.currency === currency);
  const toggle = (p: OpenPayable, on: boolean) =>
    setAmounts((a) => ({ ...a, [p.id]: on ? p.outstandingAmount : '' }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    const problem = !selected.length
      ? 'Choose at least one payable to pay.'
      : mixed
        ? 'Pay one currency at a time.'
        : over
          ? `The amount for ${over.payableNumber} is more than its balance.`
          : !cashAccountId
            ? 'Choose the account the money leaves.'
            : '';
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await backendPost('/supplier-payments', {
        requestId: requestId.current,
        companyId: supplier.companyId,
        supplierId: supplier.partyId,
        amount: Number(fromCents(totalCents)),
        currency,
        method,
        paymentDate,
        cashAccountId,
        reference: reference.trim() || undefined,
        allocations: selected.map((p) => ({
          payableId: p.id,
          amount: Number(fromCents(toCents(amounts[p.id]))),
        })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record the payment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`Pay ${supplier.name}`}
      size="md"
      onClose={onClose}
      subtitle="Allocate one payment across the supplier's open payables."
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit" form={id} loading={busy} disabled={!payables?.length}>
            Record payment
          </Btn>
        </>
      }
    >
      <form id={id} className="desk-form" onSubmit={submit}>
        {error && (
          <p className="desk-error" role="alert">
            {error}
          </p>
        )}
        {loadError ? (
          <p className="desk-error" role="alert">
            {loadError}
          </p>
        ) : payables === null || accounts === null ? (
          <p role="status">Loading open payables…</p>
        ) : !payables.length ? (
          <p className="desk-muted">
            No open payables for this supplier. Invoice Desk balances are paid from the invoice
            itself.
          </p>
        ) : (
          <>
            <div className="cash-payment-allocations">
              {payables.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    aria-label={`Pay ${p.payableNumber}`}
                    checked={toCents(amounts[p.id]) > 0}
                    onChange={(e) => toggle(p, e.target.checked)}
                  />
                  <span>
                    {p.payableNumber}
                    <small>
                      {money(p.outstandingAmount, p.currency)} outstanding
                      {p.dueDate ? ` · Due ${p.dueDate.slice(0, 10)}` : ''}
                    </small>
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Amount for ${p.payableNumber}`}
                    value={amounts[p.id] ?? ''}
                    placeholder="0.00"
                    onChange={(e) => setAmounts((a) => ({ ...a, [p.id]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <p>
              <strong>Total {money(fromCents(totalCents), currency)}</strong>
              {mixed ? ' · Pay one currency at a time' : ''}
            </p>
            <div className="desk-form-pair">
              <FormDateField
                label="Payment date"
                required
                value={paymentDate}
                onChange={setPaymentDate}
              />
              <FormSelect
                label="Method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                options={methods}
              />
            </div>
            <FormSelect
              label="Paid from"
              required
              value={cashAccountId}
              onChange={(e) => setCashAccountId(e.target.value)}
              options={[
                {
                  value: '',
                  label: eligibleAccounts.length
                    ? 'Choose business account'
                    : `No active ${currency} business account`,
                },
                ...eligibleAccounts.map((a) => ({
                  value: a.id,
                  label: `${a.accountName}${a.branch?.name ? ` · ${a.branch.name}` : ''}`,
                })),
              ]}
            />
            <FormInput
              label="Reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Receipt or transfer reference"
            />
          </>
        )}
      </form>
    </Modal>
  );
}
