import { describe, expect, it } from 'vitest';
import { salesDeskRoute } from './sales-desk-routes';
const route = (href: string) => {
  const url = new URL(href, 'https://example.test');
  return salesDeskRoute(url.pathname, url.searchParams);
};
describe('Sales Desk record continuity', () => {
  it('opens customer performance without changing original customer records or direct links', () => {
    expect(route('/sales-desk/customer-performance?customerId=customer-id')).toEqual({
      kind: 'customer-performance',
    });
    expect(route('/sales-desk?view=customer-performance')).toEqual({
      kind: 'customer-performance',
    });
    expect(route('/sales-desk?source=direct&view=customer-performance')).toEqual({
      kind: 'direct',
    });
  });
  it('uses the existing record identity from old and new customer links', () => {
    expect(route('/operations/customers/customer-id')).toEqual(
      route('/sales-desk/customers/customer-id'),
    );
    expect(route('/operations/customers/customer-id')).toEqual({
      kind: 'customer',
      id: 'customer-id',
    });
  });
  it('keeps orders and their print views attached to the original sale', () => {
    expect(route('/operations/sales-orders/sale-id')).toEqual(route('/sales-desk/sales/sale-id'));
    expect(route('/operations/sales-orders/sale-id/print')).toEqual({
      kind: 'print',
      id: 'sale-id',
    });
    expect(route('/sales-desk?view=sales')).toEqual({ kind: 'sales' });
    expect(route('/sales-desk?view=customers')).toEqual({ kind: 'customers' });
  });
  it('preserves direct-entry deep links without treating them as business sales', () => {
    expect(route('/sales-desk?record=direct-id')).toEqual({ kind: 'direct' });
    expect(route('/sales-desk?source=direct&view=sales')).toEqual({ kind: 'direct' });
    expect(route('/sales-desk/sales/order-id?source=direct')).toEqual({
      kind: 'sale',
      id: 'order-id',
    });
    expect(route('/sales-desk')).toEqual({ kind: 'overview' });
  });
  it('does not claim unrelated legacy routes', () => {
    expect(route('/operations/suppliers')).toEqual({ kind: 'unavailable' });
    expect(route('/operations/sales-orders-other')).toEqual({ kind: 'unavailable' });
    expect(route('/sales-desk/sales/%')).toEqual({ kind: 'unavailable' });
  });
});
