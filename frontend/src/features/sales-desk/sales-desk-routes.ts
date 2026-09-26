export const SALES_DESK_PERMISSIONS = ['sales.view', 'customers.view', 'sales_desk.view'];

export type SalesDeskRoute =
  | { kind: 'overview' | 'sales' | 'customers' | 'direct' }
  | { kind: 'sale' | 'customer' | 'print'; id: string }
  | { kind: 'unavailable' };

/** Old bookmarks and the new workspace refer to the same records, never copies. */
export function salesDeskRoute(path: string, params: Pick<URLSearchParams, 'get'>): SalesDeskRoute {
  const recordRoute = (kind: 'customer' | 'sale' | 'print', id: string): SalesDeskRoute => {
    try {
      return { kind, id: decodeURIComponent(id) };
    } catch {
      return { kind: 'unavailable' };
    }
  };
  const customer = /^(?:\/sales-desk\/customers|\/operations\/customers)\/([^/]+)$/.exec(path);
  if (customer) return recordRoute('customer', customer[1]);
  const sale = /^(?:\/sales-desk\/sales|\/operations\/sales-orders)\/([^/]+)(\/print)?$/.exec(path);
  if (sale) return recordRoute(sale[2] ? 'print' : 'sale', sale[1]);
  if (['/sales-desk/customers', '/operations/customers'].includes(path))
    return { kind: 'customers' };
  if (['/sales-desk/sales', '/operations/sales-orders'].includes(path)) return { kind: 'sales' };
  if (path !== '/sales-desk') return { kind: 'unavailable' };
  if (params.get('source') === 'direct' || params.get('record')) return { kind: 'direct' };
  const view = params.get('view');
  return { kind: view === 'sales' || view === 'customers' ? view : 'overview' };
}
