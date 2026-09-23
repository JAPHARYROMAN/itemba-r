import { describe, expect, it } from 'vitest';
import {
  reportChartPoints,
  reportRequest,
  safeReportLink,
  summarizeResult,
} from './report-viewer-utils';
import type { CatalogEntry, ReportFilters } from './report-viewer-types';
const entry: CatalogEntry = {
  id: 'sample',
  name: 'Sample',
  description: '',
  sector: 'OPERATIONS',
  category: 'Sales',
  scopes: ['COMPANY'],
  permission: 'reports.read',
  apiPath: '/reports/{companyId}?section=PURCHASES',
  frontendPath: '/reports',
};
const filters: ReportFilters = {
  companyId: 'company',
  divisionId: '',
  dateFrom: '',
  dateTo: '',
  asOf: '',
};
describe('Report viewer request and chart contracts', () => {
  it('preserves endpoint queries and encodes company path values', () => {
    expect(
      reportRequest(entry, { ...filters, companyId: 'company/a', dateFrom: '2026-09-01' }),
    ).toEqual({
      path: '/reports/company%2Fa',
      query: { section: 'PURCHASES', dateFrom: '2026-09-01' },
      sourceUrl: '/api/backend/reports/company%2Fa?section=PURCHASES&dateFrom=2026-09-01',
    });
  });
  it.each([
    '//outside.test/data',
    'https://outside.test/data',
    '/reports/{id}',
    '/reports/{divisionId}',
    '/reports#section',
  ])('rejects unsupported report path %s', (apiPath) =>
    expect(() => reportRequest({ ...entry, apiPath }, filters)).toThrow('business app'),
  );
  it('rejects missing company, invalid dates and division without a company', () => {
    expect(() => reportRequest(entry, { ...filters, companyId: '' })).toThrow('Choose a company');
    expect(() => reportRequest(entry, { ...filters, dateFrom: '2026-02-30' })).toThrow(
      'valid report dates',
    );
    expect(() =>
      reportRequest(entry, { ...filters, companyId: '', divisionId: 'division' }),
    ).toThrow('before a division');
  });
  it('limits chart work while preserving the first and last values', () => {
    const values = Array.from({ length: 10000 }, (_, i) => i);
    const sampled = reportChartPoints(values);
    expect(sampled).toHaveLength(200);
    expect(sampled[0]).toBe(0);
    expect(sampled.at(-1)).toBe(9999);
  });
  it('includes changed middle rows in the informational result checksum', () => {
    expect(summarizeResult([{ amount: 1 }, { amount: 2 }, { amount: 3 }]).dataHash).not.toBe(
      summarizeResult([{ amount: 1 }, { amount: 99 }, { amount: 3 }]).dataHash,
    );
  });
  it('allows local report links and rejects external or encoded separator links', () => {
    expect(safeReportLink('/operations/reports?section=SALES')).toBe(true);
    for (const link of [
      'https://outside.test',
      '//outside.test',
      '/%2foutside.test',
      '/%5coutside.test',
      'javascript:alert(1)',
    ])
      expect(safeReportLink(link)).toBe(false);
  });
});
