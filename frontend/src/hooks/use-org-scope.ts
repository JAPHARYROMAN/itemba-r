'use client';

import { useEffect, useMemo, useState } from 'react';

export interface OrgCompany { id: string; name: string; code: string }
export interface OrgBranch { id: string; name: string; code: string; companyId?: string }
export interface OrgDivision { id: string; name: string; code?: string; companyId?: string }
export interface OrgEmployee {
  id: string;
  fullName?: string | null;
  employeeCode?: string | null;
  companyId?: string;
}

interface OrgScopeState {
  companies: OrgCompany[];
  branches: OrgBranch[];
  divisions: OrgDivision[];
  employees: OrgEmployee[];
  loading: boolean;
}

/**
 * Shared hook for HR/payroll forms. Loads the company list once on mount,
 * then cascades branches/divisions/employees when the active company changes.
 *
 * Usage:
 *   const { companies, branches, divisions, employees, companyOptions,
 *           branchOptions, divisionOptions, employeeOptions } =
 *     useOrgScope(form.companyId);
 *
 * The "*Options" fields are pre-mapped to the FormSelect `options` shape so
 * the page can drop them in directly. Pass `{ skipBranches: true }` etc. to
 * skip fetches you don't need.
 */
export function useOrgScope(
  companyId: string | undefined,
  opts: { skipBranches?: boolean; skipDivisions?: boolean; skipEmployees?: boolean } = {},
) {
  const [state, setState] = useState<OrgScopeState>({
    companies: [],
    branches: [],
    divisions: [],
    employees: [],
    loading: true,
  });

  // Load companies once.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list: OrgCompany[] = Array.isArray(j.data?.data)
          ? j.data.data
          : Array.isArray(j.data)
            ? j.data
            : [];
        setState((s) => ({ ...s, companies: list, loading: false }));
      })
      .catch(() => {
        if (cancelled) return;
        setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cascade branches/divisions/employees when company changes.
  useEffect(() => {
    let cancelled = false;
    if (!companyId) {
      setState((s) => ({ ...s, branches: [], divisions: [], employees: [] }));
      return;
    }
    const tasks: Array<Promise<void>> = [];

    if (!opts.skipBranches) {
      tasks.push(
        fetch(`/api/backend/branches?companyId=${companyId}&limit=200`)
          .then((r) => r.json())
          .then((j) => {
            if (cancelled) return;
            const list: OrgBranch[] = Array.isArray(j.data?.data)
              ? j.data.data
              : Array.isArray(j.data)
                ? j.data
                : [];
            setState((s) => ({ ...s, branches: list }));
          })
          .catch(() => {
            if (!cancelled) setState((s) => ({ ...s, branches: [] }));
          }),
      );
    }

    if (!opts.skipDivisions) {
      tasks.push(
        fetch(`/api/backend/divisions?companyId=${companyId}&limit=200`)
          .then((r) => r.json())
          .then((j) => {
            if (cancelled) return;
            const list: OrgDivision[] = Array.isArray(j.data?.data)
              ? j.data.data
              : Array.isArray(j.data)
                ? j.data
                : [];
            setState((s) => ({ ...s, divisions: list }));
          })
          .catch(() => {
            if (!cancelled) setState((s) => ({ ...s, divisions: [] }));
          }),
      );
    }

    if (!opts.skipEmployees) {
      tasks.push(
        fetch(`/api/backend/hr/employees?companyId=${companyId}&limit=500`)
          .then((r) => r.json())
          .then((j) => {
            if (cancelled) return;
            const list: OrgEmployee[] = Array.isArray(j.data?.data)
              ? j.data.data
              : Array.isArray(j.data)
                ? j.data
                : [];
            setState((s) => ({ ...s, employees: list }));
          })
          .catch(() => {
            if (!cancelled) setState((s) => ({ ...s, employees: [] }));
          }),
      );
    }

    void Promise.all(tasks);
    return () => {
      cancelled = true;
    };
    // opts is destructured into primitives at call time; don't add to deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const companyOptions = useMemo(
    () => state.companies.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })),
    [state.companies],
  );
  const branchOptions = useMemo(
    () =>
      state.branches.map((b) => ({
        value: b.id,
        label: `${b.code ? b.code + ' — ' : ''}${b.name}`,
      })),
    [state.branches],
  );
  const divisionOptions = useMemo(
    () =>
      state.divisions.map((d) => ({
        value: d.id,
        label: `${d.code ? d.code + ' — ' : ''}${d.name}`,
      })),
    [state.divisions],
  );
  const employeeOptions = useMemo(
    () =>
      state.employees.map((e) => ({
        value: e.id,
        label: e.fullName ?? e.employeeCode ?? e.id,
      })),
    [state.employees],
  );

  return {
    ...state,
    companyOptions,
    branchOptions,
    divisionOptions,
    employeeOptions,
  };
}
