'use client';

import { useState, useEffect } from 'react';
import { PageSpinner } from '@/components/ui';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

function unwrapList<T>(json: any): T[] {
  const payload = json?.data ?? json;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

export default function AccountingLocksPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        const rows = unwrapList<Company>(j);
        setCompanies(rows);
        if (rows.length > 0) setCompanyId((current) => current || rows[0].id);
      })
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (!companyId) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/backend/accounting-locks?companyId=${companyId}`)
      .then((r) => r.json())
      .then((res) =>
        setData(
          Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : [],
        ),
      )
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Accounting Locks</h1>
        <p className="text-gray-500 mt-1">Manage accounting period and entity locks</p>
      </div>
      <div className="mb-4">
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white"
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.code ? `${company.code} - ${company.name}` : company.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Lock Code</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Lock Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Locked From</th>
                <th className="px-4 py-3">Locked To</th>
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
                data.map((row: any) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{row.lockCode}</td>
                    <td className="px-4 py-3">{row.companyId}</td>
                    <td className="px-4 py-3">{row.lockType}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'ACTIVE' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {row.lockedFrom ? new Date(row.lockedFrom).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {row.lockedTo ? new Date(row.lockedTo).toLocaleDateString() : '—'}
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
