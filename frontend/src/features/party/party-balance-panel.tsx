'use client';
import type { PartyBalance } from './party-balance';

const money = (amount: string, currency: string) =>
  `${currency} ${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The resolver's balance on a profile (party linkage, PR-4): the one number per currency,
 * its ERP aging, the desk and NoteBook parts and the credit position. It reads the
 * `balance` the control centre already carries (Phase 1, W5), so a profile makes no second
 * request, and it renders nothing when that balance is absent. The cached balance is
 * never shown as a balance.
 */
export function PartyBalancePanel({
  kind,
  balance,
}: {
  kind: 'supplier' | 'customer';
  balance: PartyBalance | null | undefined;
}) {
  if (!balance || !Array.isArray(balance.total) || !Array.isArray(balance.erp)) return null;
  const b = balance;
  const register = kind === 'supplier' ? 'Payables' : 'Receivables';
  const desk = kind === 'supplier' ? 'Invoice Desk' : 'Sales Desk';
  return (
    <section className="party-balance-panel" aria-label="Balance from the party balance resolver">
      <header>
        <strong>{kind === 'supplier' ? 'Owed to this supplier' : 'Owed by this customer'}</strong>
        <small>As of {shortDate(b.asOf)} · one balance across every register</small>
      </header>
      <div className="party-balance-chips">
        {b.total.length ? (
          b.total.map((t) => (
            <em key={`total:${t.currency}`} className="is-total">
              {money(t.amount, t.currency)}
            </em>
          ))
        ) : (
          <em className="is-total">Nothing outstanding</em>
        )}
        {b.erp.map((e) => (
          <em key={`erp:${e.currency}`}>
            {register} {money(e.open, e.currency)} · overdue {money(e.overdue, e.currency)} ·
            current {money(e.current, e.currency)} · 1–30 {money(e.days1to30, e.currency)} · 31–60{' '}
            {money(e.days31to60, e.currency)} · 61–90 {money(e.days61to90, e.currency)} · 90+{' '}
            {money(e.over90, e.currency)}
          </em>
        ))}
        {(b.desk ?? []).map((d) => (
          <em key={`desk:${d.currency}`}>
            {desk} {money(d.outstanding, d.currency)} · overdue {money(d.overdue, d.currency)}
          </em>
        ))}
        {(b.notebook ?? []).map((n) => (
          <em key={`notebook:${n.currency}`}>
            NoteBook {money(n.outstanding, n.currency)} · not in total
          </em>
        ))}
        {b.creditAvailable != null && (
          <em>
            Credit {money(b.creditLimit, b.baseCurrency)} · available{' '}
            {money(b.creditAvailable, b.baseCurrency)}
          </em>
        )}
        <em>
          {b.lastPaymentAt ? `Last payment ${shortDate(b.lastPaymentAt)}` : 'No payment recorded'}
        </em>
      </div>
    </section>
  );
}
