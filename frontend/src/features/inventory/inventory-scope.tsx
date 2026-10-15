'use client';
import { useCallback, useEffect, useRef } from 'react';
import { FormSelect, type ScopeValue } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { CatalogueChoiceError } from '@/components/workspace/catalogue-editors';

interface Choice {
  id: string;
  name: string;
  code?: string | null;
  divisionId?: string | null;
}
export function InventoryScope({
  value,
  onChange,
}: {
  value: ScopeValue;
  onChange: (scope: ScopeValue) => void;
}) {
  const { hasPermission, user } = useAuth();
  const companies = useWorkspaceChoices<Choice>('/companies', {}, hasPermission('companies.read'));
  const divisions = useWorkspaceChoices<Choice>(
    '/divisions',
    { companyId: value.companyId },
    !!value.companyId && hasPermission('divisions.read'),
  );
  const branches = useWorkspaceChoices<Choice>(
    '/branches',
    { companyId: value.companyId, divisionId: value.divisionId || undefined, activeOnly: true },
    !!value.companyId && hasPermission('branches.read'),
  );
  const initialSelection = useRef(false),
    attemptedBranches = useRef(new Set<string>());
  const retainedKey = `inventory.lastBranch.${user?.id || 'session'}`;
  const retained = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem(retainedKey) || 'null') as ScopeValue | null;
    } catch {
      return null;
    }
  }, [retainedKey]);
  useEffect(() => {
    if (initialSelection.current || companies.loading) return;
    if (companies.error) return;
    initialSelection.current = true;
    if (value.companyId) return;
    const saved = retained();
    const companyId = hasPermission('companies.read')
      ? companies.rows.some((row) => row.id === saved?.companyId)
        ? saved!.companyId
        : companies.rows.length === 1
          ? companies.rows[0].id
          : ''
      : user?.companyId || '';
    if (companyId) onChange({ companyId, divisionId: '', branchId: '' });
  }, [
    companies.loading,
    companies.error,
    companies.rows,
    hasPermission,
    onChange,
    user?.companyId,
    value.companyId,
    retained,
  ]);
  useEffect(() => {
    if (!value.companyId || !hasPermission('branches.read') || branches.loading || branches.error)
      return;
    const key = `${value.companyId}:${value.divisionId}`;
    const current = branches.rows.find((row) => row.id === value.branchId);
    if (value.branchId && !current) {
      attemptedBranches.current.delete(key);
      onChange({ ...value, branchId: '' });
      return;
    }
    if (current) {
      try {
        localStorage.setItem(
          retainedKey,
          JSON.stringify({ ...value, divisionId: current.divisionId || value.divisionId }),
        );
      } catch {
        /* Storage may be unavailable. */
        attemptedBranches.current.add(key);
      }
      if (!value.divisionId && current.divisionId)
        onChange({ ...value, divisionId: current.divisionId });
      return;
    }
    if (attemptedBranches.current.has(key)) return;
    attemptedBranches.current.add(key);
    const saved = retained();
    const branch =
      (saved?.companyId === value.companyId
        ? branches.rows.find((row) => row.id === saved.branchId)
        : undefined) ?? (branches.rows.length === 1 ? branches.rows[0] : undefined);
    if (branch)
      onChange({
        ...value,
        branchId: branch.id,
        divisionId: branch.divisionId || value.divisionId,
      });
  }, [
    value,
    branches.loading,
    branches.error,
    branches.rows,
    onChange,
    hasPermission,
    retainedKey,
    retained,
  ]);
  const options = (rows: Choice[], selected: string) => (
    <>
      {selected && !rows.some((r) => r.id === selected) && (
        <option value={selected}>{selected}</option>
      )}
      {rows.map((r) => (
        <option key={r.id} value={r.id}>
          {r.code ? `${r.name} (${r.code})` : r.name}
        </option>
      ))}
    </>
  );
  return (
    <div className="inventory-scope">
      <FormSelect
        label="Company"
        value={value.companyId}
        placeholder="All companies"
        disabled={companies.loading || !hasPermission('companies.read')}
        onChange={(e) => onChange({ companyId: e.target.value, divisionId: '', branchId: '' })}
      >
        {options(companies.rows, value.companyId)}
      </FormSelect>
      <FormSelect
        label="Division"
        value={value.divisionId}
        placeholder="All divisions"
        disabled={!value.companyId || divisions.loading || !hasPermission('divisions.read')}
        onChange={(e) => onChange({ ...value, divisionId: e.target.value, branchId: '' })}
      >
        {options(divisions.rows, value.divisionId)}
      </FormSelect>
      <FormSelect
        label="Branch"
        value={value.branchId}
        placeholder="Choose a branch to see stock"
        disabled={!value.companyId || branches.loading || !hasPermission('branches.read')}
        onChange={(e) => {
          const branch = branches.rows.find((r) => r.id === e.target.value);
          onChange({
            ...value,
            branchId: e.target.value,
            divisionId: branch?.divisionId || value.divisionId,
          });
        }}
      >
        {options(branches.rows, value.branchId)}
      </FormSelect>
      <div className="inventory-scope-errors">
        <CatalogueChoiceError label="Company" source={companies} />
        <CatalogueChoiceError label="Division" source={divisions} />
        <CatalogueChoiceError label="Branch" source={branches} />
      </div>
    </div>
  );
}
