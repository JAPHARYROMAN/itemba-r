/** Versioned view settings only. Never add form values, attachments or API responses here.
 * Keep this contract identical to backend workspace-view-state.ts (parity tested).
 */
export type DesktopViewState = { version: 1; values: Record<string, unknown> };
const text = (value: unknown) => typeof value === 'string' && value.length <= 256;
const scope = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).every((key) => ['companyId', 'divisionId', 'branchId'].includes(key)) &&
    Object.values(row).every(text)
  );
};
const fields: Record<string, string[]> = {
  'invoice-desk': ['section', 'scope', 'status', 'search', 'page', 'supplierId', 'currency'],
  'cash-desk': ['section', 'scope', 'date', 'currency', 'search', 'kind', 'accountId', 'page'],
  'sales-desk': [
    'section',
    'scope',
    'search',
    'status',
    'from',
    'to',
    'page',
    'customerId',
    'currency',
  ],
  documents: ['view', 'company'],
  records: ['section', 'scope', 'search', 'status', 'from', 'to', 'page', 'currency', 'visibility'],
};
export function isDesktopViewValue(appId: string, key: string, value: unknown): boolean {
  if (key.length > 256) return false;
  let field = key.slice(appId.length + 1);
  let allowed = key.startsWith(`${appId}.`) && fields[appId]?.includes(field);
  if (appId === 'records') {
    const filterKeys =
      key === 'records.book.filters'
        ? [
            'companyId',
            'divisionId',
            'branchId',
            'dateFrom',
            'dateTo',
            'status',
            'currency',
            'search',
          ]
        : key === 'records.book-report.filters'
          ? [
              'companyId',
              'divisionId',
              'branchId',
              'dateFrom',
              'dateTo',
              'currency',
              'reportStatus',
              'expenseCategoryId',
              'receiptType',
              'paymentMethod',
              'search',
            ]
          : null;
    if (filterKeys)
      return (
        !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.entries(value).every(([name, item]) => filterKeys.includes(name) && text(item))
      );
    if (
      /^records\.book\.(sales|expenses|categories)\.page$/.test(key) ||
      /^records\.book-trash\.(salesPage|expensePage|categoryPage)$/.test(key)
    ) {
      allowed = true;
      field = 'page';
    }
    if (/^records\.book-trash\.(companyId|search)$/.test(key)) {
      allowed = true;
      field = 'search';
    }
  }
  if (appId === 'sales-desk') {
    const match =
      /^sales-desk\.(business-sales|customers)\.(search|page|view|companyId|type|status|payment|from|to|filters)$/.exec(
        key,
      );
    if (match) {
      field = match[2];
      allowed = true;
      if (field === 'filters') {
        if (match[1] !== 'customers' || !value || typeof value !== 'object' || Array.isArray(value))
          return false;
        return Object.entries(value).every(
          ([name, item]) =>
            ['companyId', 'divisionId', 'branchId', 'productCategoryId', 'type', 'status'].includes(
              name,
            ) && text(item),
        );
      }
    }
  }
  if (appId === 'payroll') {
    const match =
      /^payroll\.(?:window:[\w-]+|main)\.(employees|departments|positions|assignments|employment-contracts|attendance|leave-types|leave-requests|leave-balances|payroll-periods|payroll-runs|salary-advances|salary-payments)\.(search|page|status|company|companyFilter|companyId|employee|type|year|period|dateFrom|dateTo)$/.exec(
        key,
      );
    allowed = !!match;
    field = match?.[2] ?? '';
  }
  if (appId === 'reports') {
    const match =
      /^reports\.list\.(customers|suppliers|sales|purchases|expenses|cash|loans)\.(scope|from|to|search|status|category|kind|page)$/.exec(
        key,
      );
    allowed = !!match || key === 'reports.search';
    field = match?.[2] ?? 'search';
  }
  if (!allowed) return false;
  if (field === 'scope') return scope(value);
  if (field === 'page')
    return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100000;
  return text(value);
}
export function parseDesktopViewState(appId: string, input: unknown): DesktopViewState {
  const result: DesktopViewState = { version: 1, values: {} };
  if (!input || typeof input !== 'object') return result;
  const row = input as Partial<DesktopViewState>;
  if (
    row.version !== 1 ||
    !row.values ||
    typeof row.values !== 'object' ||
    Array.isArray(row.values)
  )
    return result;
  for (const [key, value] of Object.entries(row.values).slice(0, 100))
    if (isDesktopViewValue(appId, key, value)) result.values[key] = value;
  return result;
}
