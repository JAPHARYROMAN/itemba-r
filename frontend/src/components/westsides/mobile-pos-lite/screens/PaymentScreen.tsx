'use client';

import { ArrowLeft, Search } from 'lucide-react';
import type { Customer, PosScreen, PosTranslate, Session } from '../pos-types';
import { money } from '../pos-utils';

export function PaymentScreen({
  shellClass,
  session,
  online,
  cartCount,
  total,
  paymentMethod,
  setPaymentMethod,
  customer,
  setCustomer,
  customers,
  setCustomers,
  customerQuery,
  setCustomerQuery,
  receivedValue,
  setReceivedValue,
  receivedAmount,
  selectedPayment,
  paymentReference,
  setPaymentReference,
  notice,
  busy,
  completeSale,
  t,
  setScreen,
}: {
  shellClass: string;
  session: Session;
  online: boolean;
  cartCount: number;
  total: number;
  paymentMethod: string;
  setPaymentMethod: (code: string) => void;
  customer: Customer | null;
  setCustomer: (customer: Customer | null) => void;
  customers: Customer[];
  setCustomers: (customers: Customer[]) => void;
  customerQuery: string;
  setCustomerQuery: (query: string) => void;
  receivedValue: string;
  setReceivedValue: (value: string) => void;
  receivedAmount: number | null;
  selectedPayment: Session['paymentMethods'][number] | undefined;
  paymentReference: string;
  setPaymentReference: (reference: string) => void;
  notice: string;
  busy: boolean;
  completeSale: () => Promise<void>;
  t: PosTranslate;
  setScreen: (screen: PosScreen) => void;
}) {
  return (
    <main
      className={`min-h-screen px-4 py-4 pb-28${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={() => setScreen('sale')}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"
          style={{ color: 'var(--aurora-primary-text)' }}
        >
          <ArrowLeft size={18} /> {t('backToSale')}
        </button>
        <h1 className="mt-4 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
          {t('payment')}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
          {t('items', { count: cartCount })} · {money(total)}
        </p>
        {!online && (
          <p
            className="mt-3 rounded-lg px-4 py-3 text-sm font-semibold"
            style={{
              background: 'var(--aurora-warning-subtle)',
              color: 'var(--aurora-warning-text)',
            }}
          >
            {t('cashOnlyOffline')}
          </p>
        )}
        <div className="mt-6 grid grid-cols-2 gap-3">
          {session.paymentMethods.map((method) => {
            const offlineBlocked = !online && method.code !== 'CASH';
            return (
              <button
                key={method.code}
                type="button"
                disabled={offlineBlocked}
                onClick={() => {
                  setPaymentMethod(method.code);
                  setCustomer(null);
                  setCustomerQuery('');
                }}
                className="min-h-20 rounded-lg border px-3 text-left text-base font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  borderColor:
                    paymentMethod === method.code
                      ? 'var(--aurora-primary)'
                      : 'var(--aurora-border)',
                  background:
                    paymentMethod === method.code
                      ? 'var(--aurora-primary-subtle)'
                      : 'var(--aurora-card)',
                  color:
                    paymentMethod === method.code
                      ? 'var(--aurora-primary-text)'
                      : 'var(--aurora-text)',
                }}
              >
                {method.label}
              </button>
            );
          })}
        </div>
        {paymentMethod === 'CREDIT' && (
          <div className="mt-6">
            <label className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
              {t('customer')}
            </label>
            {customer ? (
              <button
                type="button"
                onClick={() => {
                  setCustomer(null);
                  setCustomerQuery('');
                }}
                className="mt-2 flex min-h-14 w-full items-center justify-between rounded-lg border px-4 text-left"
                style={{
                  borderColor: 'var(--aurora-success)',
                  background: 'var(--aurora-success-subtle)',
                  color: 'var(--aurora-success-text)',
                }}
              >
                <span className="font-semibold">{customer.name}</span>
                <span className="text-sm">{t('change')}</span>
              </button>
            ) : (
              <>
                <div className="relative mt-2">
                  <Search
                    size={19}
                    className="absolute left-4 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  />
                  <input
                    value={customerQuery}
                    onChange={(event) => setCustomerQuery(event.target.value)}
                    className="aurora-input min-h-14 w-full rounded-lg py-3 pl-11 pr-4 text-base"
                    placeholder={t('customerSearchPlaceholder')}
                    autoFocus
                  />
                </div>
                {customerQuery.trim().length > 0 && customerQuery.trim().length < 2 && (
                  <p className="mt-2 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                    {t('typeTwoLetters')}
                  </p>
                )}
                <div className="mt-2 space-y-2">
                  {customers.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => {
                        setCustomer(result);
                        setCustomers([]);
                      }}
                      className="min-h-14 w-full rounded-lg border px-4 text-left"
                      style={{
                        borderColor: 'var(--aurora-border)',
                        background: 'var(--aurora-card)',
                      }}
                    >
                      <span className="block font-semibold" style={{ color: 'var(--aurora-text)' }}>
                        {result.name}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {[result.customerCode, result.phone].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {paymentMethod === 'CASH' && (
          <div className="mt-6">
            <label className="block text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
              {t('received')}{' '}
              <span className="font-normal" style={{ color: 'var(--aurora-text-muted)' }}>
                {t('optional')}
              </span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={receivedValue}
                onChange={(event) =>
                  setReceivedValue(event.target.value.replace(/\D/g, '').slice(0, 10))
                }
                className="aurora-input mt-2 min-h-14 w-full rounded-lg px-4 text-lg font-bold"
                placeholder="0"
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { label: t('exactAmount'), amount: Math.ceil(total) },
                ...[5000, 10000, 20000, 50000]
                  .filter((amount) => amount >= total)
                  .slice(0, 3)
                  .map((amount) => ({ label: money(amount), amount })),
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setReceivedValue(String(option.amount))}
                  className="min-h-11 rounded-lg border px-3 text-sm font-semibold"
                  style={{
                    borderColor: 'var(--aurora-border)',
                    background: 'var(--aurora-card)',
                    color: 'var(--aurora-text)',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {receivedAmount !== null &&
              (receivedAmount >= total ? (
                <p
                  className="mt-3 rounded-lg px-4 py-3 text-xl font-bold"
                  style={{
                    background: 'var(--aurora-success-subtle)',
                    color: 'var(--aurora-success-text)',
                  }}
                >
                  {t('changeDue')}: {money(receivedAmount - total)}
                </p>
              ) : (
                <p
                  className="mt-3 rounded-lg px-4 py-3 text-base font-semibold"
                  style={{
                    background: 'var(--aurora-warning-subtle)',
                    color: 'var(--aurora-warning-text)',
                  }}
                >
                  {t('stillOwed')}: {money(total - receivedAmount)}
                </p>
              ))}
          </div>
        )}
        {selectedPayment?.requiresReference && (
          <label
            className="mt-6 block text-sm font-semibold"
            style={{ color: 'var(--aurora-text)' }}
          >
            {t('reference')}{' '}
            <span className="font-normal" style={{ color: 'var(--aurora-text-muted)' }}>
              {t('optional')}
            </span>
            <input
              value={paymentReference}
              onChange={(event) => setPaymentReference(event.target.value)}
              className="aurora-input mt-2 min-h-14 w-full rounded-lg px-4 text-base"
              placeholder={t('referencePlaceholder')}
            />
          </label>
        )}
        {notice && (
          <p
            className="mt-5 rounded-lg px-4 py-3 text-sm"
            style={{ background: 'var(--aurora-danger-subtle)', color: 'var(--aurora-danger)' }}
          >
            {notice}
          </p>
        )}
        <button
          type="button"
          onClick={() => void completeSale()}
          disabled={busy}
          className="mt-8 min-h-16 w-full rounded-lg bg-brand-600 px-5 text-lg font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? t('completing') : `${t('completeSale')} · ${money(total)}`}
        </button>
      </div>
    </main>
  );
}
