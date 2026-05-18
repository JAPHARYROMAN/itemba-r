'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatCard, StatusBadge, PageSpinner } from '@/components/ui';

function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

interface Company { id: string; name: string; code: string; }
interface Summary { totalProperties: number; occupiedUnits: number; vacantUnits: number; monthlyRevenue: number; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function RentalsDashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const [propsRes, unitsRes, leasesRes, invRes] = await Promise.all([
        fetch(`/api/backend/rental-properties?companyId=${companyId}&limit=100`),
        fetch(`/api/backend/rental-units?companyId=${companyId}&limit=200`),
        fetch(`/api/backend/lease-agreements?companyId=${companyId}&limit=100`),
        fetch(`/api/backend/rent-invoices?companyId=${companyId}&page=1&limit=10`),
      ]);
      const propsJson = await propsRes.json();
      const unitsJson = await unitsRes.json();
      const leasesJson = await leasesRes.json();
      const invJson = await invRes.json();
      const props = propsJson.data?.data ?? propsJson.data ?? [];
      const units = unitsJson.data?.data ?? unitsJson.data ?? [];
      const leases = leasesJson.data?.data ?? leasesJson.data ?? [];
      const occupied = units.filter((u: any) => u.status === 'OCCUPIED').length;
      const vacant = units.filter((u: any) => u.status === 'VACANT').length;
      const monthlyRev = leases.filter((l: any) => l.status === 'ACTIVE').reduce((sum: number, l: any) => sum + (l.rentAmount ?? 0), 0);
      setSummary({ totalProperties: props.length, occupiedUnits: occupied, vacantUnits: vacant, monthlyRevenue: monthlyRev });
      setInvoices(invJson.data?.data ?? invJson.data ?? []);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const quickLinks = [
    { href: '/rentals/properties', label: 'Properties', desc: 'Rental property registry' },
    { href: '/rentals/units', label: 'Units', desc: 'Individual rental units' },
    { href: '/rentals/tenants', label: 'Tenants', desc: 'Tenant management' },
    { href: '/rentals/leases', label: 'Leases', desc: 'Lease agreements' },
    { href: '/rentals/invoices', label: 'Invoices', desc: 'Rent invoices' },
    { href: '/rentals/payments', label: 'Payments', desc: 'Rent payments' },
    { href: '/rentals/maintenance', label: 'Maintenance', desc: 'Property maintenance' },
    { href: '/rentals/reports', label: 'Reports', desc: 'Rental analytics' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Rentals Dashboard" subtitle="Property Rentals & Tenant Management" />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <PageSpinner />}
      {summary && !loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Properties" value={summary.totalProperties} />
          <StatCard label="Occupied Units" value={summary.occupiedUnits} />
          <StatCard label="Vacant Units" value={summary.vacantUnits} />
          <StatCard label="Monthly Revenue" value={fmtCurrency(summary.monthlyRevenue)} />
        </div>
      )}
      {invoices.length > 0 && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs font-semibold" style={{ color: 'var(--aurora-text-secondary)' }}>Recent Invoices</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Number</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Tenant</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Period</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Amount</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Due Date</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv: any) => (
                  <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{inv.invoiceNumber}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{inv.tenant?.name ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{inv.billingPeriod ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(inv.amount ?? 0)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(inv.dueDate)}</td>
                    <td className={tdCls}><StatusBadge status={inv.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text-secondary)' }}>Quick Links</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {quickLinks.map(l => (
            <Link key={l.href} href={l.href}>
              <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
                <div className="font-medium text-sm" style={{ color: 'var(--aurora-text)' }}>{l.label}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{l.desc}</div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
