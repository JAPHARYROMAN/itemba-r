'use client';

import { useState, useEffect, useCallback } from 'react';
import { ResponsiveDataTable } from '@/components/aurora';
import type { ResponsiveColumn } from '@/components/aurora';

interface CreditProfileRow extends Record<string, unknown> {
  id: string;
  companyId?: string;
  customerId?: string;
  creditLimit?: number | string | null;
  currency?: string | null;
  riskRating?: string | null;
  creditStatus?: string | null;
  currentOutstanding?: number | string | null;
  overdueAmount?: number | string | null;
}

function riskClasses(risk?: string | null): string {
  if (risk === 'HIGH') return 'bg-red-100 text-red-700';
  if (risk === 'MEDIUM') return 'bg-yellow-100 text-yellow-700';
  return 'bg-green-100 text-green-700';
}

function statusClasses(status?: string | null): string {
  if (status === 'ACTIVE') return 'bg-green-100 text-green-700';
  if (status === 'BLOCKED') return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-600';
}

export default function CreditProfilesPage() {
  const [data, setData] = useState<CreditProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/backend/customer-credit-profiles').then((r) => r.json());
      const rows: CreditProfileRow[] = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.data)
          ? res.data.data
          : [];
      setData(rows);
    } catch {
      setError('Failed to load credit profiles');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ResponsiveColumn<CreditProfileRow>[] = [
    { key: 'companyId', header: 'Company', priority: 2, accessor: (row) => row.companyId ?? '—' },
    {
      key: 'customerId',
      header: 'Customer',
      priority: 1,
      accessor: (row) => <span className="font-medium">{row.customerId ?? '—'}</span>,
    },
    { key: 'creditLimit', header: 'Credit Limit', priority: 2, accessor: (row) => row.creditLimit ?? '—' },
    { key: 'currency', header: 'Currency', priority: 3, accessor: (row) => row.currency ?? '—' },
    {
      key: 'riskRating',
      header: 'Risk Rating',
      priority: 1,
      accessor: (row) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${riskClasses(row.riskRating)}`}>
          {row.riskRating ?? '—'}
        </span>
      ),
    },
    {
      key: 'creditStatus',
      header: 'Credit Status',
      priority: 1,
      accessor: (row) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClasses(row.creditStatus)}`}>
          {row.creditStatus ?? '—'}
        </span>
      ),
    },
    {
      key: 'currentOutstanding',
      header: 'Outstanding',
      priority: 2,
      accessor: (row) => <span className="font-medium">{row.currentOutstanding ?? '—'}</span>,
    },
    {
      key: 'overdueAmount',
      header: 'Overdue',
      priority: 2,
      accessor: (row) => <span className="font-medium text-red-600">{row.overdueAmount ?? '—'}</span>,
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Customer Credit Profiles</h1>
        <p className="text-gray-500 mt-1">Manage customer credit limits and risk ratings</p>
      </div>

      <ResponsiveDataTable<CreditProfileRow>
        columns={columns}
        data={data}
        keyField="id"
        loading={loading}
        error={error}
        onRetry={load}
        errorTitle="Couldn't load credit profiles"
        emptyTitle="No records found"
        emptyDescription="There are no credit profiles to display."
      />
    </div>
  );
}
