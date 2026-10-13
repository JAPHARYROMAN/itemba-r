import { describe, expect, it } from 'vitest';
import { performanceMoney } from './customer-performance-types';

describe('exact customer account money display', () => {
  it('preserves Decimal(18,2) cents above the JavaScript safe integer range', () => {
    expect(performanceMoney('9999999999999999.99', 'TZS')).toBe('TZS 9,999,999,999,999,999.99');
    expect(performanceMoney('9007199254740991.01', 'USD')).toBe('USD 9,007,199,254,740,991.01');
  });
  it('preserves negative customer credits and reversal cents', () => {
    expect(performanceMoney('-9007199254740991.27', 'USD')).toBe('USD -9,007,199,254,740,991.27');
    expect(performanceMoney('-0.01', 'TZS')).toBe('TZS -0.01');
    expect(performanceMoney('-0.00', 'TZS')).toBe('TZS 0.00');
  });
  it('formats numeric aging values, pads fractions, and keeps restricted values unavailable', () => {
    expect(performanceMoney(50, 'UGX')).toBe('UGX 50.00');
    expect(performanceMoney('1.2', 'KES')).toBe('KES 1.20');
    expect(performanceMoney(null, 'TZS')).toBe('Unavailable');
    expect(performanceMoney(Number.NaN, 'TZS')).toBe('Unavailable');
  });
});
