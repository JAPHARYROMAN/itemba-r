'use client';

import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useCallback, useEffect, useState } from 'react';
import { ErrorState, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';

export default function SupplierStatementsPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('supplier_statements.list');
  const beginRequest = useRequestGuard();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (authLoading || !canView) return;
    const request = beginRequest();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/backend/supplier-statements', { signal: request.signal });
      if (!request.current()) return;
      if (!response.ok) throw new Error('Failed to load supplier statements');
      const body = await response.json();
      if (!request.current()) return;
      setData(Array.isArray(body.data) ? body.data : Array.isArray(body.data?.data) ? body.data.data : []);
    } catch (err) {
      if (!request.current()) return;
      setData([]);
      setError(err instanceof Error ? err.message : 'Failed to load supplier statements');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [authLoading, beginRequest, canView]);

  useEffect(() => {
    void load();
  }, [load]);

  if (authLoading || !canView) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900">Supplier Statements</h1>
        <p className="text-gray-500 mt-1">{authLoading ? 'Loading' : 'Access Restricted'}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Supplier Statements</h1>
        <p className="text-gray-500 mt-1">View supplier account statements by period</p>
      </div>

      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <WorkspaceTable className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Run #</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Period Start</th>
                <th className="px-4 py-3">Period End</th>
                <th className="px-4 py-3">Opening Balance</th>
                <th className="px-4 py-3">Closing Balance</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.statementRunNumber}</td>
                  <td className="px-4 py-3">{row.companyId}</td>
                  <td className="px-4 py-3 font-medium">{row.supplierId}</td>
                  <td className="px-4 py-3 text-gray-400">{row.periodStart ? new Date(row.periodStart).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{row.periodEnd ? new Date(row.periodEnd).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">{row.openingBalance}</td>
                  <td className="px-4 py-3 font-medium">{row.closingBalance}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'SENT' ? 'bg-green-100 text-green-700' : row.status === 'DRAFT' ? 'bg-gray-100 text-gray-600' : 'bg-yellow-100 text-yellow-700'}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </WorkspaceTable>
        </div>
      )}
    </div>
  );
}
