import { describe, expect, it } from 'vitest';
import {
  legacyFuelReportingHref,
  petrodollarHref,
  petrodollarDate,
  preservesPetroDollarEditor,
} from './petrodollar-navigation';

describe('PetroDollar navigation', () => {
  it('rejects malformed dates before they reach the calendar', () => {
    expect(petrodollarDate('2026-10-01', '2026-10-02')).toBe('2026-10-01');
    for (const value of [null, '2026-99-99', '2026-02-31', 'tomorrow'])
      expect(petrodollarDate(value, '2026-10-02')).toBe('2026-10-02');
  });
  it('preserves station, date, shift and window identity in legacy bookmarks', () => {
    const href = legacyFuelReportingHref(
      '/fuel-reporting/history',
      new URLSearchParams('branchId=station&businessDate=2026-10-01&shift=NIGHT&_osw=window'),
    );
    const params = new URL(href, 'https://itemba.invalid').searchParams;
    expect(params.get('view')).toBe('history');
    expect(params.get('date')).toBe('2026-10-01');
    expect(params.get('branchId')).toBe('station');
    expect(params.get('shift')).toBe('NIGHT');
    expect(params.get('_osw')).toBe('window');
  });
  it('moves legacy station administration and login into the same app', () => {
    expect(legacyFuelReportingHref('/fuel-reporting', new URLSearchParams('tab=setup'))).toBe(
      '/petrodollar?view=setup',
    );
    const login = legacyFuelReportingHref(
      '/fuel-reporting/login',
      new URLSearchParams({ from: '/fuel-reporting?view=stations' }),
    );
    expect(new URL(login, 'https://itemba.invalid').searchParams.get('from')).toBe(
      '/petrodollar?view=stations',
    );
    for (const from of [
      'https://evil.invalid',
      '//evil.invalid',
      '/\\evil.invalid',
      '/fuel-reporting/login?from=/fuel-reporting/login',
    ]) {
      expect(legacyFuelReportingHref('/fuel-reporting/login', new URLSearchParams({ from }))).toBe(
        '/login?from=%2Fpetrodollar',
      );
    }
  });
  it('keeps the current scope when opening another panel', () => {
    const params = new URLSearchParams('branchId=station&date=2026-10-01&shift=NIGHT&view=history');
    expect(petrodollarHref(params, { view: 'report' })).toBe(
      '/petrodollar?branchId=station&date=2026-10-01&shift=NIGHT',
    );
    expect(params.get('view')).toBe('history');
  });
  it('preserves dirty editor inputs only for panel changes on the same shift', () => {
    const report = '/petrodollar?branchId=a&date=2026-10-01&shift=DAY';
    expect(preservesPetroDollarEditor(report, `${report}&view=receive`)).toBe(true);
    expect(preservesPetroDollarEditor(`${report}&view=receive`, report)).toBe(true);
    for (const target of [
      `${report}&view=setup`,
      report.replace('DAY', 'NIGHT'),
      report.replace('branchId=a', 'branchId=b'),
      report.replace('10-01', '10-02'),
      '/sales-desk',
    ]) {
      expect(preservesPetroDollarEditor(report, target)).toBe(false);
    }
  });
});
