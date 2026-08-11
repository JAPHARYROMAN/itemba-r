import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyTotals,
  formatNumber,
  sumByCurrency,
} from './format';

describe('format', () => {
  describe('formatMoney', () => {
    it('renders TZS as whole shillings with thousands separators', () => {
      expect(formatMoney(1234567)).toBe('TZS 1,234,567');
      expect(formatMoney(0)).toBe('TZS 0');
    });

    it('rounds TZS fractions to whole shillings', () => {
      expect(formatMoney(1234567.49)).toBe('TZS 1,234,567');
      expect(formatMoney(1234567.5)).toBe('TZS 1,234,568');
    });

    it('accepts numeric strings (as returned by the API for decimals)', () => {
      expect(formatMoney('2500.75')).toBe('TZS 2,501');
      expect(formatMoney('1234.5', 'USD')).toBe('USD 1,234.50');
    });

    it('keeps 2 decimals for non-TZS currencies', () => {
      expect(formatMoney(1234.56, 'USD')).toBe('USD 1,234.56');
      expect(formatMoney(2340, 'USD')).toBe('USD 2,340.00');
      expect(formatMoney('99.999', 'EUR')).toBe('EUR 100.00');
    });

    it('renders the zero form on null, undefined, and non-numeric input', () => {
      expect(formatMoney(null)).toBe('TZS 0');
      expect(formatMoney(undefined)).toBe('TZS 0');
      expect(formatMoney(Number.NaN)).toBe('TZS 0');
      expect(formatMoney('not-a-number')).toBe('TZS 0');
      expect(formatMoney(null, 'USD')).toBe('USD 0.00');
    });

    it('falls back to TZS for an empty or missing currency code', () => {
      expect(formatMoney(500, '')).toBe('TZS 500');
      expect(formatMoney(500, '  tzs ')).toBe('TZS 500');
    });
  });

  describe('formatNumber', () => {
    it('adds en-GB thousands separators', () => {
      expect(formatNumber(1234567.891)).toBe('1,234,567.891');
    });

    it('honours Intl options', () => {
      expect(formatNumber(1234567.891, { maximumFractionDigits: 0 })).toBe('1,234,568');
      expect(formatNumber('12.5', { minimumFractionDigits: 3 })).toBe('12.500');
    });

    it('renders 0 for null and non-numeric input', () => {
      expect(formatNumber(null)).toBe('0');
      expect(formatNumber('oops')).toBe('0');
    });
  });

  describe('formatDate', () => {
    it('formats as dd/MM/yyyy', () => {
      // Local timestamp (no Z) so the assertion holds in any machine timezone.
      expect(formatDate('2026-07-05T12:00:00')).toBe('05/07/2026');
      expect(formatDate(new Date(2026, 0, 31))).toBe('31/01/2026');
    });

    it('returns an em dash for empty and invalid input', () => {
      expect(formatDate(null)).toBe('—');
      expect(formatDate(undefined)).toBe('—');
      expect(formatDate('')).toBe('—');
      expect(formatDate('not-a-date')).toBe('—');
      expect(formatDate(new Date('invalid'))).toBe('—');
    });
  });

  describe('formatDateTime', () => {
    it('formats as dd/MM/yyyy HH:mm', () => {
      expect(formatDateTime('2026-07-05T14:30:00')).toBe('05/07/2026 14:30');
      expect(formatDateTime(new Date(2026, 11, 1, 9, 5))).toBe('01/12/2026 09:05');
    });

    it('returns an em dash for empty and invalid input', () => {
      expect(formatDateTime(null)).toBe('—');
      expect(formatDateTime('nonsense')).toBe('—');
    });
  });

  describe('sumByCurrency', () => {
    it('sums per currency and never mixes currencies', () => {
      const totals = sumByCurrency([
        { amount: 1000, currency: 'TZS' },
        { amount: '2500', currency: 'TZS' },
        { amount: 100, currency: 'USD' },
        { amount: '240.5', currency: 'USD' },
      ]);
      expect(totals.size).toBe(2);
      expect(totals.get('TZS')).toBe(3500);
      expect(totals.get('USD')).toBe(340.5);
    });

    it('defaults missing currency to TZS and treats bad amounts as 0', () => {
      const totals = sumByCurrency([
        { amount: 50 },
        { amount: 25, currency: null },
        { amount: null, currency: 'USD' },
        { amount: 'garbage', currency: 'USD' },
      ]);
      expect(totals.get('TZS')).toBe(75);
      expect(totals.get('USD')).toBe(0);
    });

    it('returns an empty map for no rows', () => {
      expect(sumByCurrency([]).size).toBe(0);
    });
  });

  describe('formatMoneyTotals', () => {
    it('renders a single-currency total', () => {
      expect(formatMoneyTotals(new Map([['TZS', 1234567]]))).toBe('TZS 1,234,567');
    });

    it('joins mixed currencies with TZS first', () => {
      const totals = new Map([
        ['USD', 2340],
        ['TZS', 1234567],
      ]);
      expect(formatMoneyTotals(totals)).toBe('TZS 1,234,567 + USD 2,340.00');
    });

    it('sorts non-TZS currencies alphabetically', () => {
      const totals = new Map([
        ['USD', 1],
        ['EUR', 2],
        ['TZS', 3],
      ]);
      expect(formatMoneyTotals(totals)).toBe('TZS 3 + EUR 2.00 + USD 1.00');
    });

    it('renders the TZS zero form for an empty map', () => {
      expect(formatMoneyTotals(new Map())).toBe('TZS 0');
    });
  });
});
