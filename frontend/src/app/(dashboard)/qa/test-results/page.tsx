'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList, unwrapTotal } from '@/lib/unwrap';

export default function TestResultsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/backend/qa/test-results?pageSize=50').then(r => r.json()).then(d => {
      setItems(unwrapList(d));
      setTotal(unwrapTotal(d));
      setLoading(false);
    });
  }, []);

  const resultColor: Record<string, string> = { PASSED: 'bg-green-100 text-green-800', FAILED: 'bg-red-100 text-red-800', BLOCKED: 'bg-orange-100 text-orange-800', SKIPPED: 'bg-gray-100 text-gray-600', NOT_RUN: 'bg-gray-100 text-gray-400' };

  return (
    <AuroraPage>
      <AuroraPageHeader title="Test Results" subtitle="Test execution results across all runs" />
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <span className="font-semibold text-gray-900 dark:text-white">Results ({total})</span>
          </div>
          {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>{['Run #', 'Test Case', 'Result', 'Blocker Created', 'Notes', 'Executed By', 'Date'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-mono text-xs">{r.testRun?.runCode || '—'}</td>
                    <td className="px-4 py-3 font-medium">{r.testCase?.title || r.qATestCase?.title || '—'}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${resultColor[r.result] || 'bg-gray-100'}`}>{r.result}</span></td>
                    <td className="px-4 py-3">{r.blockerCreated ? <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-800">Yes</span> : '—'}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{r.notes || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{r.executedBy?.name || r.executedBy?.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No results yet. Run a test suite to see results here.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AuroraPage>
  );
}