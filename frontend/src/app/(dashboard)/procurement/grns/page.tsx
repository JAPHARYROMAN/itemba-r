'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendPage } from '@/lib/api-client';

interface Grn {
  id: string;
  grnNumber: string;
  companyId: string;
  supplierId?: string | null;
  receivedDate?: string | null;
  status: string;
  postedAt?: string | null;
}

export default function GRNsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('grn.list');
  const [data, setData] = useState<Grn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await backendPage<Grn>('/goods-received-notes', { query: { limit: 50 } });
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load goods received notes');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Goods Received Notes" subtitle="Record and track goods received from suppliers" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Goods Received Notes</h1>
        <p className="text-gray-500 mt-1">Record and track goods received from suppliers</p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">GRN #</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Received Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Posted At</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No records found
                  </td>
                </tr>
              ) : (
                data.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{row.grnNumber}</td>
                    <td className="px-4 py-3">{row.companyId}</td>
                    <td className="px-4 py-3">{row.supplierId ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {row.receivedDate ? new Date(row.receivedDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          row.status === 'POSTED'
                            ? 'bg-green-100 text-green-700'
                            : row.status === 'APPROVED'
                              ? 'bg-blue-100 text-blue-700'
                              : row.status === 'DRAFT'
                                ? 'bg-gray-100 text-gray-600'
                                : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {row.postedAt ? new Date(row.postedAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
