'use client';
import { useEffect, useRef } from 'react';
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
    resolved = useRef(new Set<string>());
  useEffect(() => {
    if (initialSelection.current || companies.loading) return;
    if (companies.error) return;
    initialSelection.current = true;
    if (value.companyId) return;
    const companyId = hasPermission('companies.read')
      ? companies.rows.length === 1
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
  ]);
  useEffect(() => {
    if (
      !value.companyId ||
      value.divisionId ||
      !value.branchId ||
      branches.loading ||
      branches.error
    )
      return;
    const key = `${value.companyId}:${value.branchId}`;
    const branch = branches.rows.find((r) => r.id === value.branchId);
    if (!branch?.divisionId || resolved.current.has(key)) return;
    resolved.current.add(key);
    onChange({ ...value, divisionId: branch.divisionId });
  }, [value, branches.loading, branches.error, branches.rows, onChange]);
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
        placeholder="All branches"
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
