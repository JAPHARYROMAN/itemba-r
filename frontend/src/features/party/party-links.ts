export type PartyKind = 'supplier' | 'customer';
export type PartyApp = 'profile' | 'cash-desk' | 'records' | 'statements' | 'reports';

/**
 * One place that knows where a party opens in each app (party linkage, Phase 2 PR-5).
 * Every "open in" action in the OS builds its href here, so a route change is one edit
 * and a party is never opened by a guessed path.
 */
export function openPartyIn(app: PartyApp, kind: PartyKind, id: string): string {
  const key = encodeURIComponent(id);
  const param = kind === 'supplier' ? `supplierId=${key}` : `customerId=${key}`;
  switch (app) {
    case 'profile':
      return kind === 'supplier'
        ? `/invoice-desk/suppliers/${key}`
        : `/sales-desk/customers/${key}`;
    case 'cash-desk':
      return `/cash-desk?view=movements&${param}`;
    case 'records':
      return `/records?${param}`;
    case 'statements':
      return kind === 'supplier'
        ? `/crm/supplier-statements?${param}`
        : `/crm/customer-statements?${param}`;
    case 'reports':
      return kind === 'supplier' ? `/operations/reports/suppliers?${param}` : `/reports?${param}`;
  }
}
