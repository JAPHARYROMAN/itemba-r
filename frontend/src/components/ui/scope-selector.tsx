'use client';

import { useEffect, useState } from 'react';
import { FormSelect } from './forms';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface Division {
  id: string;
  name: string;
  code?: string | null;
  companyId: string;
}

interface Branch {
  id: string;
  name: string;
  code?: string | null;
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
  companyOnly?: boolean;
  divisionOnly?: boolean;
  disabled?: boolean;
  labels?: { company?: string; division?: string; branch?: string };
}

function unwrapList<T>(json: any): T[] {
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json)) return json;
  return [];
}

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

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((response) => response.json())
      .then((json) => setCompanies(unwrapList<Company>(json)))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (!value.companyId || companyOnly) {
      setDivisions([]);
      return;
    }
    fetch(`/api/backend/divisions?companyId=${encodeURIComponent(value.companyId)}&limit=100`)
      .then((response) => response.json())
      .then((json) => setDivisions(unwrapList<Division>(json)))
      .catch(() => setDivisions([]));
  }, [value.companyId, companyOnly]);

  useEffect(() => {
    if (!value.divisionId || companyOnly || divisionOnly) {
      setBranches([]);
      return;
    }
    fetch(`/api/backend/branches?divisionId=${encodeURIComponent(value.divisionId)}&limit=100`)
      .then((response) => response.json())
      .then((json) => setBranches(unwrapList<Branch>(json)))
      .catch(() => setBranches([]));
  }, [value.divisionId, companyOnly, divisionOnly]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <FormSelect
        className="min-w-[180px] flex-1"
        label={labels?.company ?? 'Company'}
        value={value.companyId}
        onChange={(event) => onChange({ companyId: event.target.value, divisionId: '', branchId: '' })}
        disabled={disabled}
        placeholder="All companies"
      >
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.code ? `${company.name} (${company.code})` : company.name}
          </option>
        ))}
      </FormSelect>

      {!companyOnly && (
        <FormSelect
          className="min-w-[180px] flex-1"
          label={labels?.division ?? 'Division'}
          value={value.divisionId}
          onChange={(event) => onChange({ ...value, divisionId: event.target.value, branchId: '' })}
          disabled={disabled || !value.companyId}
          placeholder="All divisions"
        >
          {divisions.map((division) => (
            <option key={division.id} value={division.id}>
              {division.code ? `${division.name} (${division.code})` : division.name}
            </option>
          ))}
        </FormSelect>
      )}

      {!companyOnly && !divisionOnly && (
        <FormSelect
          className="min-w-[180px] flex-1"
          label={labels?.branch ?? 'Branch'}
          value={value.branchId}
          onChange={(event) => onChange({ ...value, branchId: event.target.value })}
          disabled={disabled || !value.divisionId}
          placeholder="All branches"
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.code ? `${branch.name} (${branch.code})` : branch.name}
            </option>
          ))}
        </FormSelect>
      )}
    </div>
  );
}

export function scopeToQueryString(scope: ScopeValue): string {
  const params = new URLSearchParams();
  if (scope.companyId) params.set('companyId', scope.companyId);
  if (scope.divisionId) params.set('divisionId', scope.divisionId);
  if (scope.branchId) params.set('branchId', scope.branchId);
  return params.toString();
}
