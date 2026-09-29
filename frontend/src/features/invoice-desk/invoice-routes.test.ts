import { describe, expect, it } from 'vitest';
import { invoiceRoute } from './invoice-routes';
import { appForPath } from '@/lib/apps';
const resolve = (href: string) => {
  const u = new URL(href, 'https://example.test');
  return invoiceRoute(u.pathname, u.searchParams);
};
describe('Invoice Desk shared workflows', () => {
  it.each([
    ['/invoice-desk', 'overview'],
    ['/invoice-desk?view=invoices', 'invoices'],
    ['/invoice-desk?source=direct&view=invoices', 'direct'],
    ['/invoice-desk?record=old', 'direct'],
    ['/operations/purchase-orders', 'purchases'],
    ['/operations/purchase-orders/order-drafts', 'drafts'],
    ['/operations/purchase-orders/order-drafts/id/print', 'draftPrint'],
    ['/operations/purchase-orders/id/print', 'print'],
    ['/procurement/grns', 'receiving'],
    ['/procurement/three-way-matching', 'matching'],
    ['/operations/suppliers/id', 'supplier'],
  ])('keeps %s in its explicit host', (href, kind) => {
    expect(resolve(href).kind).toBe(kind);
    expect(appForPath(new URL(href, 'https://example.test').pathname)?.id).toBe('invoice-desk');
  });
  it('fails closed for unknown child paths and malformed record identifiers', () => {
    expect(resolve('/invoice-desk/unsupported').kind).toBe('unavailable');
    expect(resolve('/operations/suppliers/%ZZ').kind).toBe('unavailable');
  });
});
