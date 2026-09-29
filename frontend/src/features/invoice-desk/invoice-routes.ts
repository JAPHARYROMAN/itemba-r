export const invoiceSections = [
  {
    id: 'drafts',
    label: 'Order drafts',
    href: '/operations/purchase-orders/order-drafts',
    permission: 'supplier_order_drafts.view',
    description: 'Prepare and send supplier order drafts before purchasing.',
  },
  {
    id: 'suppliers',
    label: 'Suppliers',
    href: '/invoice-desk?view=suppliers',
    permission: 'suppliers.view',
    description: 'Shared profiles, purchasing history and statements.',
  },
  {
    id: 'purchases',
    label: 'Purchase orders',
    href: '/invoice-desk?view=purchases',
    permission: 'purchases.view',
    description: 'Order products from your inventory catalogue.',
  },
  {
    id: 'receiving',
    label: 'Goods received',
    href: '/invoice-desk?view=receiving',
    permission: 'grn.list',
    description: 'Receive and inspect deliveries before posting stock.',
  },
  {
    id: 'invoices',
    label: 'Supplier invoices',
    href: '/invoice-desk?view=invoices',
    permission: 'supplier_invoices.list',
    description: 'Connect supplier invoices, purchase orders and payables.',
  },
  {
    id: 'matching',
    label: 'Invoice matching',
    href: '/invoice-desk?view=matching',
    permission: 'three_way_match.list',
    description: 'Review quantities and amounts against orders and receipts.',
  },
] as const;
type View = (typeof invoiceSections)[number]['id'];
export type InvoiceRoute =
  | { kind: View | 'overview' | 'direct' | 'unavailable' | 'drafts' }
  | { kind: 'supplier' | 'purchase' | 'print' | 'draft' | 'draftPrint'; id: string };
export function invoiceRoute(path: string, params: Pick<URLSearchParams, 'get'>): InvoiceRoute {
  if (path === '/invoice-desk' && (params.get('source') === 'direct' || params.get('record')))
    return { kind: 'direct' };
  if (path === '/operations/purchase-orders/order-drafts') return { kind: 'drafts' };
  const draft = /^\/operations\/purchase-orders\/order-drafts\/([^/]+)(\/print)?$/.exec(path);
  const supplier = /^(?:\/invoice-desk\/suppliers|\/operations\/suppliers)\/([^/]+)$/.exec(path);
  const purchase = /^\/operations\/purchase-orders\/([^/]+)(\/print)?$/.exec(path);
  try {
    if (draft) return { kind: draft[2] ? 'draftPrint' : 'draft', id: decodeURIComponent(draft[1]) };
    if (supplier) return { kind: 'supplier', id: decodeURIComponent(supplier[1]) };
    if (purchase)
      return { kind: purchase[2] ? 'print' : 'purchase', id: decodeURIComponent(purchase[1]) };
  } catch {
    return { kind: 'unavailable' };
  }
  const aliases: Record<string, View> = {
    '/operations/suppliers': 'suppliers',
    '/operations/purchase-orders': 'purchases',
    '/procurement/grns': 'receiving',
    '/procurement/supplier-invoices': 'invoices',
    '/procurement/three-way-matching': 'matching',
  };
  if (aliases[path]) return { kind: aliases[path] };
  if (path !== '/invoice-desk') return { kind: 'unavailable' };
  const view = params.get('view');
  return { kind: invoiceSections.find((s) => s.id === view)?.id ?? 'overview' };
}
