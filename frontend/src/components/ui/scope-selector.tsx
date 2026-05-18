'use client';

import { useEffect, useState } from 'react';
import { FormSelect } from './forms';

interface Company {
  id: string;
  name: string;
  code: string;
}

interface Division {
  id: string;
  name: string;
  code: string;
  companyId: string;
}

interface Branch {
  id: string;
  name: string;
  code: string;
  divisionId: string;
}

export interface ScopeValue {
  companyId: string;
  divisionId: string;
  branchId: string;
}

interface ScopeSelectorProps {
  value: ScopeValue;
  onChange: (next: ScopeValue) => void;
  /** When true, Division and Branch selectors are hidden and only Company is shown. */
  companyOnly?: boolean;
  /** When true, Branch selector is hidden. */
  divisionOnly?: boolean;
  /** Optional flag — disables the whole selector (e.g. for group-level views). */
  disabled?: boolean;
  /** Optional custom labels. */
  labels?: { company?: string; division?: string; branch?: string };
}

/**
 * Phase 4 — Hierarchy scope selector. Three cascading dropdowns:
 * Company → Division → Branch. Changing Company resets Division + Branch.
 * Changing Division resets Branch.
 *
 * Drop into any finance page that wants division/branch scoping. The page
 * passes the resulting IDs as query params to its backend list/report calls.
 */
export function ScopeSelector({
  value,
  onChange,
  companyOnly,
  divisionOnly,
  disabled,
  labels,
}: ScopeSelectorProps) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  // Load companies once. The backend already enforces scope, so we just fetch
  // and show whatever it returns for the current user.
  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        const list = Array.isArray(j?.data?.data)
          ? j.data.data
          : Array.isArray(j?.data)
            ? j.data
            : [];
        setCompanies(list);
      })
      .catch(() => setCompanies([]));
  }, []);

  // Load divisions when the selected company changes.
  useEffect(() => {
    if (!value.companyId || companyOnly) {
      setDivisions([]);
      return;
    }
    fetch(`/api/backend/divisions?companyId=${encodeURIComponent(value.companyId)}&limit=100`)
      .then((r) => r.json())
      .then((j) => {
        const list = Array.isArray(j?.data?.data)
          ? j.data.data
          : Array.isArray(j?.data)
            ? j.data
            : [];
        setDivisions(list);
      })
      .catch(() => setDivisions([]));
  }, [value.companyId, companyOnly]);

  // Load branches when the selected division changes.
  useEffect(() => {
    if (!value.divisionId || companyOnly || divisionOnly) {
      setBranches([]);
      return;
    }
    fetch(`/api/backend/branches?divisionId=${encodeURIComponent(value.divisionId)}&limit=100`)
      .then((r) => r.json())
      .then((j) => {
        const list = Array.isArray(j?.data?.data)
          ? j.data.data
          : Array.isArray(j?.data)
            ? j.data
            : [];
        setBranches(list);
      })
      .catch(() => setBranches([]));
  }, [value.divisionId, companyOnly, divisionOnly]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[180px] flex-1">
        <FormSelect
          label={labels?.company ?? 'Company'}
          value={value.companyId}
          onChange={(e) =>
            onChange({ companyId: e.target.value, divisionId: '', branchId: '' })
          }
          disabled={disabled}
          placeholder="All companies"
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </FormSelect>
      </div>

      {!companyOnly ? (
        <div className="min-w-[180px] flex-1">
          <FormSelect
            label={labels?.division ?? 'Division'}
            value={value.divisionId}
            onChange={(e) =>
              onChange({ ...value, divisionId: e.target.value, branchId: '' })
            }
            disabled={disabled || !value.companyId}
            placeholder="All divisions"
          >
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </FormSelect>
        </div>
      ) : null}

      {!companyOnly && !divisionOnly ? (
        <div className="min-w-[180px] flex-1">
          <FormSelect
            label={labels?.branch ?? 'Branch'}
            value={value.branchId}
            onChange={(e) => onChange({ ...value, branchId: e.target.value })}
            disabled={disabled || !value.divisionId}
            placeholder="All branches"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </FormSelect>
        </div>
      ) : null}
    </div>
  );
}

/** Convenience: turn a ScopeValue into a query-string param fragment. */
export function scopeToQueryString(scope: ScopeValue): string {
  const parts: string[] = [];
  if (scope.divisionId) parts.push(`divisionId=${encodeURIComponent(scope.divisionId)}`);
  if (scope.branchId) parts.push(`branchId=${encodeURIComponent(scope.branchId)}`);
  return parts.join('&');
}
