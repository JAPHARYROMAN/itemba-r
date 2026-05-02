'use client';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';

const reports = [
  { title: 'Occupancy Report', description: 'Current occupancy rates across all properties and units.', href: '/rentals/reports/occupancy' },
  { title: 'Arrears Report', description: 'Tenants with outstanding rent balances and overdue invoices.', href: '/rentals/reports/arrears' },
  { title: 'Revenue by Property', description: 'Monthly and cumulative revenue broken down per property.', href: '/rentals/reports/revenue' },
];

export default function RentalsReportsPage() {
  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Rental Reports" subtitle="Analytics and insights for your rental portfolio" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {reports.map(r => (
          <Link key={r.href} href={r.href}>
            <Card className="p-5 hover:shadow-md transition-shadow cursor-pointer h-full">
              <div className="font-semibold text-sm mb-1" style={{ color: 'var(--aurora-text)' }}>{r.title}</div>
              <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{r.description}</div>
            </Card>
          </Link>
        ))}
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-lg px-5 py-4 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
        Select a report above to view detailed analytics. Reports are filtered by company and date range.
      </div>
    </div>
  );
}
