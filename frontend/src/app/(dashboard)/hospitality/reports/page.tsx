'use client';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';

const reports = [
  { title: 'Room Occupancy', description: 'Occupancy rates by room type, floor, and date range.', href: '/hospitality/reports/occupancy' },
  { title: 'Restaurant Revenue', description: 'Food sales, order counts, and revenue breakdown.', href: '/hospitality/reports/restaurant' },
  { title: 'Bar Revenue', description: 'Bar sales, beverage categories, and alcoholic vs non-alcoholic split.', href: '/hospitality/reports/bar' },
];

export default function HospitalityReportsPage() {
  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Hospitality Reports" subtitle="Analytics for hotel, restaurant and bar operations" />
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
