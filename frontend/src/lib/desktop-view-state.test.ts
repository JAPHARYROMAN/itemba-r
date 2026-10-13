import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { parseDesktopViewState } from './desktop-view-state';
describe('desktop view contract', () => {
  it('persists overview scope without retaining financial responses or form fields', () => {
    const filters = {
      companyId: 'company',
      divisionId: 'division',
      branchId: 'branch',
      currency: 'USD',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-13',
      preset: 'month',
    };
    const scope = { branchId: 'branch', currency: 'USD', confirmedOnly: 'true' };
    expect(
      parseDesktopViewState('sales-desk', {
        version: 1,
        values: {
          'sales-desk.overview.filters': filters,
          'sales-desk.business-sales.overview-scope': scope,
          'sales-desk.overview.response': { outstanding: '123' },
          'sales-desk.overview.filters.private': { cardNumber: 'secret' },
          'sales-desk.business-sales.overview-scope.private': { amount: '123' },
        },
      }).values,
    ).toEqual({
      'sales-desk.overview.filters': filters,
      'sales-desk.business-sales.overview-scope': scope,
    });
  });
  it('persists customer performance view choices without retaining account responses', () => {
    const filters = {
      companyId: 'company',
      currency: 'USD',
      category: 'good',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-13',
      search: 'Acacia',
      sort: 'net-sales',
    };
    expect(
      parseDesktopViewState('sales-desk', {
        version: 1,
        values: {
          'sales-desk.customer-performance.filters': filters,
          'sales-desk.customer-performance.page': 2,
          'sales-desk.customer-performance.historyPage.customer-id': 3,
          'sales-desk.customer-performance.response': { netDue: '123' },
          'sales-desk.customer-performance.filters.private': { cardNumber: 'secret' },
        },
      }).values,
    ).toEqual({
      'sales-desk.customer-performance.filters': filters,
      'sales-desk.customer-performance.page': 2,
      'sales-desk.customer-performance.historyPage.customer-id': 3,
    });
  });
  it('keeps the server and browser allowlists identical', async () => {
    const front = readFileSync(resolve('src/lib/desktop-view-state.ts'), 'utf8');
    const back = readFileSync(
      resolve('../backend/src/modules/workspace/workspace-view-state.ts'),
      'utf8',
    );
    expect(await format(front, { parser: 'typescript' })).toBe(
      await format(back, { parser: 'typescript' }),
    );
  });
  it('drops unknown fields, other apps, nested form data and unsupported schema versions', () => {
    const state = {
      version: 1,
      values: {
        'invoice-desk.search': 'Fuel',
        'invoice-desk.scope': { companyId: 'a', cardNumber: 'secret' },
        'cash-desk.search': 'cash',
        'invoice-desk.new.amount': 5,
        'invoice-desk.page': -1,
      },
    };
    expect(parseDesktopViewState('invoice-desk', state).values).toEqual({
      'invoice-desk.search': 'Fuel',
    });
    expect(parseDesktopViewState('invoice-desk', { ...state, version: 2 }).values).toEqual({});
  });
});
