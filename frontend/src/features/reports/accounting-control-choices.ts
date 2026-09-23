'use client';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { backendAllPages } from '@/lib/backend-all-pages';
import {
  choiceLabel,
  type ControlChoice,
  type ControlKind,
  type ControlValues,
} from './accounting-controls-types';

export function useControlChoices(kind: ControlKind, companyId: string, enabled: boolean) {
  const { hasPermission, user } = useAuth();
  const companyRead = hasPermission('companies.view');
  const periodRead =
    kind === 'period-close' || kind === 'accounting-locks' || kind === 'audit-adjustments';
  const companies = useWorkspaceChoices<ControlChoice>('/companies', {}, enabled && companyRead);
  const years = useWorkspaceChoices<ControlChoice>(
    '/fiscal-years',
    { companyId },
    enabled && !!companyId && periodRead && hasPermission('fiscal_years.view'),
  );
  const periods = useWorkspaceChoices<ControlChoice>(
    '/accounting-periods',
    { companyId },
    enabled && !!companyId && periodRead && hasPermission('accounting_periods.view'),
  );
  const accounts = useWorkspaceChoices<ControlChoice>(
    '/chart-of-accounts',
    { companyId },
    enabled &&
      !!companyId &&
      kind === 'audit-adjustments' &&
      hasPermission('chart_of_accounts.view'),
  );
  const assets = useWorkspaceChoices<ControlChoice>(
    '/fixed-assets',
    { companyId },
    enabled && !!companyId && kind === 'depreciation' && hasPermission('fixed-assets.read'),
  );
  const collections = { companies, years, periods, accounts, assets };
  const rows = {
    companies: companyRead
      ? companies.rows
      : user?.companyId
        ? [{ id: user.companyId, name: 'Assigned company' }]
        : [],
    years: years.rows.filter((r) => r.companyId === companyId),
    periods: periods.rows.filter((r) => r.companyId === companyId),
    accounts: accounts.rows.filter((r) => r.companyId === companyId && r.isActive !== false),
    assets: assets.rows.filter((r) => r.companyId === companyId),
  };
  const errors = Object.entries(collections).flatMap(([key, resource]) =>
    resource.error ? [`${key}: ${resource.error}`] : [],
  );
  const requiredPermissions =
    kind === 'period-close'
      ? ['fiscal_years.view', 'accounting_periods.view']
      : kind === 'audit-adjustments'
        ? ['chart_of_accounts.view']
        : kind === 'depreciation'
          ? ['fixed-assets.read']
          : [];
  const missingPermissions = requiredPermissions.filter((p) => !hasPermission(p));
  const loading = Object.values(collections).some((r) => r.loading);
  function validate(values: ControlValues, current = rows) {
    if (loading || errors.length || missingPermissions.length)
      throw new Error('Load the available choices and check your access before saving.');
    const f = values.fields;
    if (!current.companies.some((r) => r.id === f.companyId))
      throw new Error('Choose an available company.');
    if (
      f.fiscalYearId &&
      !current.years.some((r) => r.id === f.fiscalYearId && r.companyId === f.companyId)
    )
      throw new Error('Choose an available fiscal year for this company.');
    if (
      f.accountingPeriodId &&
      !current.periods.some(
        (r) =>
          r.id === f.accountingPeriodId &&
          r.companyId === f.companyId &&
          (!f.fiscalYearId || r.fiscalYearId === f.fiscalYearId),
      )
    )
      throw new Error('Choose a period in the selected company and fiscal year.');
    if (
      kind === 'audit-adjustments' &&
      values.lines.some(
        (line) =>
          !current.accounts.some(
            (r) => r.id === line.accountId && r.companyId === f.companyId && r.isActive !== false,
          ),
      )
    )
      throw new Error('Choose available accounts for every adjustment line.');
    if (
      kind === 'depreciation' &&
      !current.assets.some((r) => r.id === f.fixedAssetId && r.companyId === f.companyId)
    )
      throw new Error('Choose an available asset in this company.');
  }
  function selectedVersion(values: ControlValues, current = rows) {
    const f = values.fields;
    return JSON.stringify([
      current.companies.find((r) => r.id === f.companyId),
      current.years.find((r) => r.id === f.fiscalYearId),
      current.periods.find((r) => r.id === f.accountingPeriodId),
      kind === 'audit-adjustments'
        ? values.lines.map((l) => current.accounts.find((r) => r.id === l.accountId))
        : null,
      kind === 'depreciation' ? current.assets.find((r) => r.id === f.fixedAssetId) : null,
    ]);
  }
  async function refreshBeforeSave(values: ControlValues, signal: AbortSignal) {
    validate(values);
    const query = { companyId: values.fields.companyId };
    const [freshCompanies, freshYears, freshPeriods, freshAccounts, freshAssets] =
      await Promise.all([
        companyRead
          ? backendAllPages<ControlChoice>('/companies', {}, signal)
          : Promise.resolve(rows.companies),
        values.fields.fiscalYearId
          ? backendAllPages<ControlChoice>('/fiscal-years', query, signal)
          : Promise.resolve([]),
        values.fields.accountingPeriodId
          ? backendAllPages<ControlChoice>('/accounting-periods', query, signal)
          : Promise.resolve([]),
        kind === 'audit-adjustments'
          ? backendAllPages<ControlChoice>('/chart-of-accounts', query, signal)
          : Promise.resolve([]),
        kind === 'depreciation'
          ? backendAllPages<ControlChoice>('/fixed-assets', query, signal)
          : Promise.resolve([]),
      ]);
    const fresh = {
      companies: freshCompanies,
      years: freshYears,
      periods: freshPeriods,
      accounts: freshAccounts,
      assets: freshAssets,
    };
    validate(values, fresh);
    if (selectedVersion(values, fresh) !== selectedVersion(values)) {
      retry();
      throw new Error(
        'A selected company, period, account or asset changed. Your input is retained; review the refreshed choices before saving.',
      );
    }
  }
  function retry() {
    Object.values(collections).forEach((r) => r.retry());
  }
  return {
    ...rows,
    errors,
    loading,
    missingPermissions,
    companyRead,
    retry,
    validate,
    refreshBeforeSave,
    selectedVersion,
  };
}
export function controlOptions(rows: ControlChoice[], selected: string) {
  const choices = rows.map((r) => ({ value: r.id, label: choiceLabel(r) }));
  if (selected && !choices.some((r) => r.value === selected))
    choices.push({ value: selected, label: 'Previous selection — unavailable' });
  return choices;
}
