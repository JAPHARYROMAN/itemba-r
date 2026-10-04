import { describe, expect, it, vi } from 'vitest';
import { businessDate } from './types';

describe('captured East Africa business date', () => {
  it('keeps a pre-midnight capture on its original day when submitted after midnight', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-04T21:05:00Z'));
      expect(businessDate('2026-10-04T20:59:59Z')).toBe('2026-10-04');
      expect(businessDate()).toBe('2026-10-05');
    } finally {
      vi.useRealTimers();
    }
  });
  it('uses the same date for equivalent UTC and local capture instants', () => {
    expect(businessDate('2026-10-04T21:00:00Z')).toBe('2026-10-05');
    expect(businessDate('2026-10-05T00:00:00+03:00')).toBe('2026-10-05');
  });
});
