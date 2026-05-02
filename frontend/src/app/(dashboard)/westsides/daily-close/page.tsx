'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Btn, Card, FormSelect, FormInput, PageHeader, PageSpinner, PageToolbar } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MethodLine {
  paymentMethod: string;
  cashAccountId: string | null;
  cashAccountName: string | null;
  cashAccountType: string | null;
  count: number;
  expected: number;
  paid: number;
}
interface SalespersonLine { salespersonId: string | null; name: string | null; count: number; total: number; }
interface SalesTypeLine { salesType: string; count: number; total: number; }
interface ProductLine { productId: string; productName: string; sku: string | null; quantity: number; total: number; }
interface OrderLine {
  id: string;
  salesOrderNumber: string;
  orderDate: string;
  customerName: string;
  salesperson: string | null;
  totalAmount: number;
  paymentMethod: string;
  paymentReference?: string | null;
}
interface MmRef {
  id: string;
  salesOrderNumber: string;
  reference: string | null;
  amount: number;
  cashAccountId: string | null;
  cashAccountName: string | null;
}
interface DailyClose {
  date: string;
  companyId: string;
  branchId: string | null;
  totals: {
    salesCount: number;
    totalSales: number;
    paidAmount: number;
    outstandingAmount: number;
    taxAmount: number;
    discountAmount: number;
    averageOrder: number;
  };
  yesterday: { salesCount: number; totalSales: number };
  byMethod: MethodLine[];
  bySalesType: SalesTypeLine[];
  bySalesperson: SalespersonLine[];
  topProducts: ProductLine[];
  orders: OrderLine[];
  mobileMoneyReferences: MmRef[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DailyClosePage() {
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<DailyClose | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  const { companyOptions, branchOptions } = useOrgScope(companyId, { skipDivisions: true, skipEmployees: true });

  const load = useCallback(async () => {
    if (!companyId) { setData(null); return; }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ companyId, date });
      if (branchId) params.set('branchId', branchId);
      const res = await fetch(`/api/backend/westsides/reports/daily-close?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      setData(j.data ?? j);
      setCounted({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [companyId, branchId, date]);

  useEffect(() => { void load(); }, [load]);

  const dayDelta = useMemo(() => {
    if (!data) return null;
    const today = data.totals.totalSales;
    const yest = data.yesterday.totalSales;
    if (yest === 0) return today > 0 ? { pct: 100, sign: '+' as '+' | '−' | '' } : { pct: 0, sign: '' as '+' | '−' | '' };
    const pct = ((today - yest) / yest) * 100;
    return { pct: Math.abs(pct), sign: (pct >= 0 ? '+' : '−') as '+' | '−' | '' };
  }, [data]);

  const totalCounted = useMemo(() => {
    if (!data) return 0;
    return data.byMethod.reduce((s, m) => {
      const key = `${m.paymentMethod}|${m.cashAccountId ?? ''}`;
      return s + (Number(counted[key] ?? 0));
    }, 0);
  }, [counted, data]);

  const totalVariance = useMemo(() => {
    if (!data) return 0;
    return data.byMethod.reduce((s, m) => {
      const key = `${m.paymentMethod}|${m.cashAccountId ?? ''}`;
      const c = counted[key];
      if (!c) return s;
      return s + (Number(c) - m.expected);
    }, 0);
  }, [counted, data]);

  return (
    <div className="p-6 space-y-4 daily-close-page">
      <PageHeader
        title="Daily Close"
        subtitle="End-of-day reconciliation. Count the drawer, match mobile-money receipts, print the Z-report."
        breadcrumbs={[{ label: 'Westsides', href: '/westsides' }, { label: 'Daily Close' }]}
      />

      <PageToolbar
        filters={
          <>
            <div className="w-56">
              <FormSelect value={companyId} onChange={(e) => { setCompanyId(e.target.value); setBranchId(''); }} options={companyOptions} placeholder="Pick company" />
            </div>
            <div className="w-44">
              <FormSelect value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branchOptions} placeholder={companyId ? 'All branches' : 'Pick company'} />
            </div>
            <div className="w-44">
              <FormInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </>
        }
        actions={
          <>
            <Btn variant="secondary" size="sm" onClick={load} loading={loading} disabled={!companyId}>Refresh</Btn>
            {data && (
              <Btn variant="primary" size="sm" onClick={() => window.print()}>Print Z-Report</Btn>
            )}
          </>
        }
      />

      {error && <Card className="p-3 bg-red-50 border-red-200 text-red-700 text-sm">{error}</Card>}
      {!data && !loading && !error && (
        <Card className="p-8 text-center text-sm text-slate-400">Pick a company to load the day&apos;s close.</Card>
      )}

      {data && (
        <>
          {/* Top-line tiles */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Tile label="Sales today" value={String(data.totals.salesCount)} hint={`avg TZS ${fmt(data.totals.averageOrder)}`} />
            <Tile label="Total revenue" value={`TZS ${fmt(data.totals.totalSales)}`} highlight />
            <Tile
              label="vs yesterday"
              value={dayDelta && dayDelta.pct !== 0 ? `${dayDelta.sign}${dayDelta.pct.toFixed(1)}%` : '—'}
              hint={`yest. TZS ${fmt(data.yesterday.totalSales)}`}
              tone={dayDelta && dayDelta.sign === '+' ? 'good' : dayDelta && dayDelta.sign === '−' ? 'warn' : undefined}
            />
            <Tile label="Cash collected" value={`TZS ${fmt(data.totals.paidAmount)}`} hint="non-credit" tone="good" />
            <Tile label="Outstanding" value={`TZS ${fmt(data.totals.outstandingAmount)}`} hint="credit invoices" tone={data.totals.outstandingAmount > 0 ? 'warn' : undefined} />
          </div>

          {/* Variance reconciliation */}
          <Card className="overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Cash drawer reconciliation</h3>
              <span className="text-xs text-slate-500">enter counted amounts → variance computed live</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase">Method</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase">Account</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Txns</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Expected</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase w-44">Counted</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byMethod.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-6 text-slate-400 italic text-sm">No payments today.</td></tr>
                  )}
                  {data.byMethod.map((m, i) => {
                    const key = `${m.paymentMethod}|${m.cashAccountId ?? ''}`;
                    const c = counted[key];
                    const cN = c ? Number(c) : NaN;
                    const variance = !isNaN(cN) ? cN - m.expected : null;
                    return (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="px-4 py-2 font-medium">{m.paymentMethod.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-2 text-xs text-slate-600">{m.cashAccountName ?? <span className="italic text-slate-400">unassigned</span>}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{m.count}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(m.expected)}</td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            step="any"
                            value={c ?? ''}
                            onChange={(e) => setCounted(p => ({ ...p, [key]: e.target.value }))}
                            placeholder="—"
                            className="w-full text-right border rounded px-2 py-1 tabular-nums"
                            style={{ borderColor: 'var(--aurora-border)' }}
                          />
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums font-medium ${
                          variance == null ? 'text-slate-400' :
                          Math.abs(variance) < 0.005 ? 'text-emerald-600' :
                          variance < 0 ? 'text-red-600' : 'text-amber-600'
                        }`}>
                          {variance == null ? '—' : `${variance >= 0 ? '+' : ''}${fmt(variance)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {data.byMethod.length > 0 && (
                  <tfoot className="bg-slate-50 border-t border-slate-200">
                    <tr>
                      <td className="px-4 py-2 text-xs font-semibold" colSpan={3}>Totals</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmt(data.totals.totalSales)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmt(totalCounted)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums font-bold ${
                        Math.abs(totalVariance) < 0.005 ? 'text-emerald-600' :
                        totalVariance < 0 ? 'text-red-600' : 'text-amber-600'
                      }`}>
                        {`${totalVariance >= 0 ? '+' : ''}${fmt(totalVariance)}`}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* By salesperson */}
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100"><h3 className="text-sm font-semibold">By salesperson</h3></div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase">Name</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Sales</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bySalesperson.map((s, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="px-4 py-2">{s.name ?? <span className="italic text-slate-400">unattributed</span>}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.count}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(s.total)}</td>
                    </tr>
                  ))}
                  {data.bySalesperson.length === 0 && (
                    <tr><td colSpan={3} className="text-center py-6 text-slate-400 italic text-sm">No data.</td></tr>
                  )}
                </tbody>
              </table>
            </Card>

            {/* By sales type / channel */}
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100"><h3 className="text-sm font-semibold">By channel</h3></div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase">Channel</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Sales</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bySalesType.map((s, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="px-4 py-2">{s.salesType.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.count}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(s.total)}</td>
                    </tr>
                  ))}
                  {data.bySalesType.length === 0 && (
                    <tr><td colSpan={3} className="text-center py-6 text-slate-400 italic text-sm">No data.</td></tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>

          {/* Top SKUs */}
          <Card className="overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-100"><h3 className="text-sm font-semibold">Top SKUs today</h3></div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase">#</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase">Product</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Qty</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((p, i) => (
                  <tr key={p.productId} className="border-b border-slate-50">
                    <td className="px-4 py-2 text-xs text-slate-500">{i + 1}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{p.productName}</div>
                      {p.sku && <div className="text-[11px] font-mono text-slate-400">{p.sku}</div>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.quantity.toFixed(0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(p.total)}</td>
                  </tr>
                ))}
                {data.topProducts.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-6 text-slate-400 italic text-sm">No items sold today.</td></tr>
                )}
              </tbody>
            </table>
          </Card>

          {/* Mobile-money references */}
          {data.mobileMoneyReferences.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100">
                <h3 className="text-sm font-semibold">Mobile-money references</h3>
                <p className="text-[11px] text-slate-500">For manual reconciliation against the M-Pesa / Tigo Pesa paybill statement.</p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase">Order</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase">Account</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase">Reference</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.mobileMoneyReferences.map(r => (
                    <tr key={r.id} className="border-b border-slate-50">
                      <td className="px-4 py-2 font-mono text-xs">{r.salesOrderNumber}</td>
                      <td className="px-4 py-2 text-xs">{r.cashAccountName ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.reference ?? <span className="italic text-amber-600">missing!</span>}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Operator notes */}
          <Card className="p-4">
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Operator notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any anomalies — e.g. card-machine offline, late M-Pesa confirmations…"
              className="w-full text-sm border rounded-lg px-3 py-2"
              style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}
            />
          </Card>

          {/* Z-Report (printable) */}
          <ZReport data={data} counted={counted} totalCounted={totalCounted} totalVariance={totalVariance} notes={notes} />

          <style jsx global>{`
            @media print {
              body * { visibility: hidden !important; }
              .z-report, .z-report * { visibility: visible !important; }
              .z-report {
                position: absolute !important;
                left: 0; top: 0;
                width: 100%;
                padding: 24px;
                background: white;
                color: black;
                font-family: 'Courier New', monospace;
                font-size: 12px;
              }
            }
          `}</style>
        </>
      )}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function Tile({ label, value, hint, tone, highlight }: { label: string; value: string; hint?: string; tone?: 'good' | 'warn' | 'danger'; highlight?: boolean }) {
  const cls =
    tone === 'danger' ? 'bg-red-50 border-red-200' :
    tone === 'warn' ? 'bg-amber-50 border-amber-200' :
    tone === 'good' ? 'bg-emerald-50 border-emerald-200' :
    highlight ? 'bg-slate-900 text-white' : '';
  return (
    <Card className={`p-3 ${cls}`}>
      <div className={`text-[11px] uppercase tracking-wide ${highlight ? 'text-slate-300' : 'text-slate-500'}`}>{label}</div>
      <div className={`text-xl font-bold mt-1 ${highlight ? 'text-white' : ''}`}>{value}</div>
      {hint && <div className={`text-[11px] mt-0.5 ${highlight ? 'text-slate-300' : 'text-slate-500'}`}>{hint}</div>}
    </Card>
  );
}

function ZReport({
  data,
  counted,
  totalCounted,
  totalVariance,
  notes,
}: {
  data: DailyClose;
  counted: Record<string, string>;
  totalCounted: number;
  totalVariance: number;
  notes: string;
}) {
  const dateStr = new Date(data.date).toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <div className="z-report" aria-hidden="true">
      <div className="text-center mb-4">
        <div className="text-base font-bold uppercase">Daily Close — Z-Report</div>
        <div className="text-xs">{dateStr}</div>
        <div className="text-[10px] text-slate-500">Generated {new Date().toLocaleString('en-GB')}</div>
      </div>

      <Section title="Summary">
        <Row label="Sales count" value={String(data.totals.salesCount)} />
        <Row label="Total revenue" value={`TZS ${fmt(data.totals.totalSales)}`} bold />
        <Row label="Average order" value={`TZS ${fmt(data.totals.averageOrder)}`} />
        <Row label="Tax collected" value={`TZS ${fmt(data.totals.taxAmount)}`} />
        <Row label="Discounts given" value={`TZS ${fmt(data.totals.discountAmount)}`} />
        <Row label="Cash collected (paid)" value={`TZS ${fmt(data.totals.paidAmount)}`} />
        <Row label="On credit (outstanding)" value={`TZS ${fmt(data.totals.outstandingAmount)}`} />
      </Section>

      <Section title="Reconciliation">
        {data.byMethod.length === 0 && <div className="text-center italic">— no payments —</div>}
        {data.byMethod.map((m, i) => {
          const key = `${m.paymentMethod}|${m.cashAccountId ?? ''}`;
          const c = counted[key];
          const cN = c ? Number(c) : null;
          const variance = cN != null ? cN - m.expected : null;
          return (
            <div key={i} className="mb-1">
              <div className="font-bold">{m.paymentMethod.replace(/_/g, ' ')} — {m.cashAccountName ?? 'unassigned'}</div>
              <Row label="  Expected" value={`TZS ${fmt(m.expected)}`} />
              <Row label="  Counted" value={cN != null ? `TZS ${fmt(cN)}` : '—'} />
              <Row label="  Variance" value={variance != null ? `${variance >= 0 ? '+' : ''}TZS ${fmt(variance)}` : '—'} />
            </div>
          );
        })}
        {data.byMethod.length > 0 && (
          <div className="border-t border-slate-300 pt-1 mt-2">
            <Row label="Total expected" value={`TZS ${fmt(data.totals.totalSales)}`} bold />
            <Row label="Total counted" value={`TZS ${fmt(totalCounted)}`} bold />
            <Row label="Total variance" value={`${totalVariance >= 0 ? '+' : ''}TZS ${fmt(totalVariance)}`} bold />
          </div>
        )}
      </Section>

      <Section title="By salesperson">
        {data.bySalesperson.length === 0 && <div className="text-center italic">— none —</div>}
        {data.bySalesperson.map((s, i) => (
          <Row key={i} label={`${s.name ?? 'unattributed'} (${s.count})`} value={`TZS ${fmt(s.total)}`} />
        ))}
      </Section>

      <Section title="Top SKUs">
        {data.topProducts.length === 0 && <div className="text-center italic">— none —</div>}
        {data.topProducts.map((p, i) => (
          <Row key={p.productId} label={`${i + 1}. ${p.productName} × ${p.quantity.toFixed(0)}`} value={`TZS ${fmt(p.total)}`} />
        ))}
      </Section>

      {notes.trim() && (
        <Section title="Notes">
          <div className="whitespace-pre-wrap text-xs">{notes}</div>
        </Section>
      )}

      <div className="text-center mt-4 text-[10px] border-t border-slate-300 pt-2">
        Counted by ____________________ &nbsp; Approved by ____________________
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="border-b border-slate-300 pb-0.5 mb-1.5 font-bold uppercase text-xs">{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
