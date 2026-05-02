import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatStatusLabel,
  formatUserName,
  formatCompanyName,
  truncate,
} from './formatters';

describe('formatMoney', () => {
  it('returns em-dash for null/undefined/empty', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney('')).toBe('—');
    expect(formatMoney('not a number')).toBe('—');
  });

  it('formats whole TZS amounts with thousands separators', () => {
    expect(formatMoney(1234567)).toBe('TZS 1,234,567');
  });

  it('uses compact notation when requested', () => {
    expect(formatMoney(1_500_000_000, 'TZS', { compact: true })).toBe('TZS 1.5B');
    expect(formatMoney(2_300_000, 'TZS', { compact: true })).toBe('TZS 2.3M');
    expect(formatMoney(4_500, 'TZS', { compact: true })).toBe('TZS 4.5K');
  });

  it('respects decimals option', () => {
    expect(formatMoney(1234.5, 'TZS', { decimals: 2 })).toBe('TZS 1,234.50');
  });

  it('accepts string inputs', () => {
    expect(formatMoney('100000')).toBe('TZS 100,000');
  });
});

describe('formatPercent', () => {
  it('returns "%" with one decimal by default', () => {
    expect(formatPercent(45.27)).toBe('45.3%');
  });

  it('handles invalid input', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent('xx')).toBe('—');
  });
});

describe('formatNumber', () => {
  it('uses thousands separator', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('handles missing values', () => {
    expect(formatNumber(undefined)).toBe('—');
  });
});

describe('formatStatusLabel', () => {
  it('converts SCREAMING_SNAKE to Title Case', () => {
    expect(formatStatusLabel('PARTIALLY_PAID')).toBe('Partially Paid');
    expect(formatStatusLabel('OPEN')).toBe('Open');
  });

  it('handles missing values', () => {
    expect(formatStatusLabel(null)).toBe('—');
    expect(formatStatusLabel('')).toBe('—');
  });
});

describe('formatUserName', () => {
  it('prefers firstName + lastName', () => {
    expect(formatUserName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
  });

  it('falls back to name', () => {
    expect(formatUserName({ name: 'Bob' })).toBe('Bob');
  });

  it('falls back to email local-part', () => {
    expect(formatUserName({ email: 'alice@example.com' })).toBe('alice');
  });

  it('returns em-dash when nothing available', () => {
    expect(formatUserName({})).toBe('—');
    expect(formatUserName(null)).toBe('—');
  });
});

describe('formatCompanyName', () => {
  it('prefixes the code when present', () => {
    expect(formatCompanyName({ name: 'Mwanjalisi Oil', code: 'MOC' })).toBe('MOC — Mwanjalisi Oil');
  });

  it('falls back to name only', () => {
    expect(formatCompanyName({ name: 'Westsides' })).toBe('Westsides');
  });
});

describe('truncate', () => {
  it('returns text untouched when under the limit', () => {
    expect(truncate('short', 20)).toBe('short');
  });

  it('appends ellipsis when over the limit', () => {
    expect(truncate('a very long sentence that exceeds the limit', 10)).toBe('a very lon…');
  });

  it('handles null/undefined', () => {
    expect(truncate(null)).toBe('—');
  });
});
