'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { backendPage } from '@/lib/api-client';

export interface OrgCompany {
  id: string;
  name: string;
  code: string;
}
export interface OrgBranch {
  id: string;
  name: string;
  code: string;
  companyId?: string;
  divisionId?: string;
  division?: { id?: string; companyId?: string };
}
export interface OrgDivision {
  id: string;
  name: string;
  code?: string;
  companyId?: string;
}
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
}

// Selectors must include every accessible option, not only the first API page.
async function allOptions<T>(path: string, signal: AbortSignal, companyId?: string): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;
  while (!signal.aborted) {
    const result = await backendPage<T>(path, { query: { companyId, page, limit: 100 }, signal });
    rows.push(...result.data);
    if (result.data.length === 0 || rows.length >= result.total) break;
    page += 1;
  }
  return rows;
}

/** Accessible company and hierarchy choices for HR forms, with stale-response protection. */
export function useOrgScope(
  companyId: string | undefined,
  {
    skipBranches = false,
    skipDivisions = false,
    skipEmployees = false,
  }: {
    skipBranches?: boolean;
    skipDivisions?: boolean;
    skipEmployees?: boolean;
  } = {},
) {
  const [state, setState] = useState<OrgScopeState>({
    companies: [],
    branches: [],
    divisions: [],
    employees: [],
  });
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [companiesError, setCompaniesError] = useState('');
  const [scopeError, setScopeError] = useState('');
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setCompaniesLoading(true);
    setCompaniesError('');
    allOptions<OrgCompany>('/companies', controller.signal)
      .then((companies) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, companies }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setCompaniesError('Company choices could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setCompaniesLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, branches: [], divisions: [], employees: [] }));
    setScopeError('');
    if (!companyId) {
      setScopeLoading(false);
      return () => controller.abort();
    }
    setScopeLoading(true);
    const tasks = [
      skipBranches
        ? Promise.resolve([] as OrgBranch[])
        : allOptions<OrgBranch>('/branches', controller.signal, companyId),
      skipDivisions
        ? Promise.resolve([] as OrgDivision[])
        : allOptions<OrgDivision>('/divisions', controller.signal, companyId),
      skipEmployees
        ? Promise.resolve([] as OrgEmployee[])
        : allOptions<OrgEmployee>('/hr/employees', controller.signal, companyId),
    ] as const;
    void Promise.allSettled(tasks).then(([branches, divisions, employees]) => {
      if (controller.signal.aborted) return;
      setState((current) => ({
        ...current,
        branches:
          branches.status === 'fulfilled'
            ? branches.value.map((branch) => ({
                ...branch,
                companyId: branch.companyId ?? branch.division?.companyId,
                divisionId: branch.divisionId ?? branch.division?.id,
              }))
            : [],
        divisions: divisions.status === 'fulfilled' ? divisions.value : [],
        employees: employees.status === 'fulfilled' ? employees.value : [],
      }));
      const failed = [
        branches.status === 'rejected' && 'branches',
        divisions.status === 'rejected' && 'divisions',
        employees.status === 'rejected' && 'employees',
      ].filter(Boolean);
      if (failed.length)
        setScopeError(
          `Could not load ${failed.join(', ')}. Try again before editing the organisation assignment.`,
        );
      setScopeLoading(false);
    });
    return () => controller.abort();
  }, [companyId, skipBranches, skipDivisions, skipEmployees, revision]);

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
    loading: companiesLoading || scopeLoading,
    scopeLoading,
    companiesError,
    scopeError,
    error: [companiesError, scopeError].filter(Boolean).join(' '),
    retry,
    companyOptions,
    branchOptions,
    divisionOptions,
    employeeOptions,
  };
}
