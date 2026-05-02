'use client';

import { useEffect, useState } from 'react';

/**
 * Company + Branch combo selector used across the petroleum module.
 *
 * Mwanjalisi Oil runs multiple petrol stations (each modelled as a Branch
 * under a Division under the Company). Operations like shifts, deliveries,
 * tank dips, and reconciliations are all branch-scoped. This picker keeps the
 * two selectors in sync — change the company and the branch list re-loads —
 * and reports both values up to the page.
 *
 * Either selector may be empty:
 *  - empty `companyId` means "no scope picked yet" (caller should suppress
 *    data loading until the user chooses).
 *  - empty `branchId` means "all branches under the selected company"
 *    (group view across stations).
 *
 * The picker renders bare <select>s so each consuming page can inline it
 * without forcing a layout. Default arrangement is two side-by-side dropdowns.
 */
interface Company {
  id: string;
  name: string;
  code: string;
}

interface Branch {
  id: string;
  name: string;
  code: string;
  type?: string;
  location?: string | null;
  isActive?: boolean;
}

interface CompanyBranchPickerProps {
  companyId: string;
  branchId: string;
  onCompanyChange: (id: string) => void;
  onBranchChange: (id: string) => void;
  /** Optional label override for the empty-branch option. */
  allBranchesLabel?: string;
  /** Pre-filter to a specific company (e.g. only Mwanjalisi). */
  restrictCompanyId?: string;
  className?: string;
}

export function CompanyBranchPicker({
  companyId,
  branchId,
  onCompanyChange,
  onBranchChange,
  allBranchesLabel = 'All branches',
  restrictCompanyId,
  className = '',
}: CompanyBranchPickerProps) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        const list: Company[] = Array.isArray(j.data?.data)
          ? j.data.data
          : Array.isArray(j.data)
          ? j.data
          : [];
        setCompanies(restrictCompanyId ? list.filter((c) => c.id === restrictCompanyId) : list);
      })
      .catch(() => setCompanies([]));
  }, [restrictCompanyId]);

  // Re-load branches whenever the company changes. Reset branch to "all"
  // when switching company so we don't carry a now-invalid branchId across.
  useEffect(() => {
    if (!companyId) {
      setBranches([]);
      return;
    }
    fetch(`/api/backend/branches?companyId=${companyId}&activeOnly=true`)
      .then((r) => r.json())
      .then((j) => {
        const list: Branch[] = Array.isArray(j.data?.data)
          ? j.data.data
          : Array.isArray(j.data)
          ? j.data
          : [];
        setBranches(list);
        // Drop a stale branchId that no longer belongs to this company.
        if (branchId && !list.some((b) => b.id === branchId)) {
          onBranchChange('');
        }
      })
      .catch(() => setBranches([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <select
        value={companyId}
        onChange={(e) => {
          onCompanyChange(e.target.value);
          onBranchChange(''); // reset branch when company changes
        }}
        className="text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        style={{
          background: 'var(--aurora-card)',
          color: 'var(--aurora-text)',
          border: '1px solid var(--aurora-border)',
        }}
        aria-label="Company"
      >
        <option value="">— Select Company —</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.code})
          </option>
        ))}
      </select>

      <select
        value={branchId}
        onChange={(e) => onBranchChange(e.target.value)}
        disabled={!companyId}
        className="text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: 'var(--aurora-card)',
          color: 'var(--aurora-text)',
          border: '1px solid var(--aurora-border)',
        }}
        aria-label="Branch"
      >
        <option value="">{allBranchesLabel}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {b.code ? ` (${b.code})` : ''}
            {b.location ? ` — ${b.location}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
