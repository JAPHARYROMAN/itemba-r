import { describe, expect, it } from 'vitest';
import { recordsHref, recordsRoute } from './records-routes';
import { appForPath, canOpenApp, getApp } from '@/lib/apps';
import { parseDesktopViewState } from '@/lib/desktop-view-state';
const query = new URLSearchParams();
describe('unified Records routing and recovery', () => {
  it.each([
    ['/record-book', '/records/daily-summary', 'daily-summary'],
    ['/record-book/daily-sales', '/records/daily-sales', 'daily-sales'],
    ['/record-book/expenses', '/records/money-out', 'money-out'],
    ['/record-book/categories', '/records/categories', 'categories'],
    ['/record-book/trash', '/records/trash', 'trash'],
  ])('preserves %s in Records', (legacy, canonical, kind) => {
    expect(recordsHref(legacy)).toBe(canonical);
    expect(recordsRoute(legacy, query)).toEqual({ kind });
    expect(recordsRoute(canonical, query)).toEqual({ kind });
    expect(appForPath(legacy)?.id).toBe('records');
    expect(appForPath(canonical)?.id).toBe('records');
  });
  it('preserves original IDs, report queries and existing notebook links', () => {
    expect(recordsRoute('/record-book/expenses/original-id', query)).toEqual({
      kind: 'expense',
      id: 'original-id',
    });
    expect(recordsRoute('/records/daily-sales/original-id', query)).toEqual({
      kind: 'sale',
      id: 'original-id',
    });
    expect(recordsHref('/record-book/reports?report=net-movement&_osw=one#totals')).toBe(
      '/records/reports?report=net-movement&_osw=one#totals',
    );
    expect(
      recordsRoute('/record-book/reports', new URLSearchParams('report=net-movement')),
    ).toEqual({ kind: 'reports', report: 'net-movement' });
    expect(recordsRoute('/records', new URLSearchParams('view=debtors&record=debt-id'))).toEqual({
      kind: 'notebook',
    });
    expect(recordsRoute('/records', new URLSearchParams('view=overview&record=debt-id'))).toEqual({
      kind: 'notebook',
    });
    expect(recordsRoute('/records/daily-sales/%ZZ', query)).toEqual({ kind: 'unavailable' });
    expect(recordsRoute('/record-book-extra', query)).toEqual({ kind: 'unavailable' });
  });
  it('opens for either existing view permission without creating access', () => {
    const app = getApp('records')!;
    expect(canOpenApp(app, (p) => p === 'record_book.view')).toBe(true);
    expect(canOpenApp(app, (p) => p === 'records.view')).toBe(true);
    expect(canOpenApp(app, (p) => p === 'record_book.create')).toBe(false);
    expect(appForPath('/record-book-extra')).not.toBe(app);
  });
  it('recovers only safe window filters, never editor or receipt contents', () => {
    expect(
      parseDesktopViewState('records', {
        version: 1,
        values: {
          'records.book.filters': {
            companyId: 'company',
            search: 'reference',
            dateFrom: '2026-09-01',
          },
          'records.book.sales.page': 2,
          'records.book-report.filters': { currency: 'TZS', receiptType: 'CASH' },
          'records.book-trash.search': 'archived',
          'records.book.new.amount': '45000',
          'records.book.expenses.page': -1,
          'records.book-trash.salesPage': 3,
        },
      }).values,
    ).toEqual({
      'records.book.filters': { companyId: 'company', search: 'reference', dateFrom: '2026-09-01' },
      'records.book.sales.page': 2,
      'records.book-report.filters': { currency: 'TZS', receiptType: 'CASH' },
      'records.book-trash.search': 'archived',
      'records.book-trash.salesPage': 3,
    });
    expect(
      parseDesktopViewState('records', {
        version: 1,
        values: { 'records.book.filters': { companyId: 'a', amount: 'private' } },
      }).values,
    ).toEqual({});
  });
});
