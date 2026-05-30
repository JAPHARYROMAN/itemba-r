'use client';

import { useState, useEffect } from 'react';

interface ReportDefinition {
  id: string;
  reportCode: string;
  name: string;
  reportCategory: string;
  datasetKey: string;
  isSystemReport: boolean;
  isActive: boolean;
  isSensitive: boolean;
  requiredPermission: string | null;
}

function extractRows<T>(payload: unknown): T[] {
  const data = (payload as { data?: unknown })?.data;
  const nested = (data as { data?: unknown })?.data;
  if (Array.isArray(payload)) return payload as T[];
  if (Array.isArray(data)) return data as T[];
  if (Array.isArray(nested)) return nested as T[];
  return [];
}

export default function ReportDefinitionsPage() {
  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/bi/report-definitions?limit=50')
      .then((r) => r.json())
      .then((data) => setReports(extractRows<ReportDefinition>(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Report Definitions</h1>

      {loading ? (
        <p className="text-gray-500 animate-pulse">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Dataset Key</th>
                <th className="px-4 py-3">System</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Sensitive</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                    No report definitions found
                  </td>
                </tr>
              ) : (
                reports.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{r.reportCode}</td>
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2">{r.reportCategory}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{r.datasetKey}</td>
                    <td className="px-4 py-2">
                      {r.isSystemReport && (
                        <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                          System
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${r.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {r.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {r.isSensitive && (
                        <span className="px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-700">
                          Sensitive
                        </span>
                      )}
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
