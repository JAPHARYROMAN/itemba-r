import { describe, expect, it } from 'vitest';
import {
  DATE_DISPLAY_LOCALE,
  formatIsoDate,
  formatIsoDateTime,
  parseIsoDate,
  parseIsoDateTime,
} from './date-value';

describe('parseIsoDate', () => {
  it('reads the ISO date the forms and API exchange', () => {
    const date = parseIsoDate('2026-09-20');
    expect(date).not.toBeNull();
    expect([date!.year, date!.month, date!.day]).toEqual([2026, 9, 20]);
  });

  it('reads the date out of a full timestamp', () => {
    // Records such as `invoice.invoiceDate` arrive as timestamps, and callers
    // should not have to remember to slice before handing one over.
    expect(formatIsoDate(parseIsoDate('2026-09-20T08:30:00.000Z'))).toBe('2026-09-20');
  });

  it.each([
    ['an empty string', ''],
    ['whitespace', '   '],
    ['undefined', undefined],
    ['null', null],
    ['prose', 'not a date'],
    ['display order', '20/09/2026'],
    ['unpadded parts', '2026-9-20'],
  ])('renders an empty field for %s rather than throwing', (_label, input) => {
    expect(parseIsoDate(input)).toBeNull();
  });

  it.each(['2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00'])(
    'rejects %s, a date that does not exist',
    (input) => {
      expect(parseIsoDate(input)).toBeNull();
    },
  );

  it('accepts a leap day only in the year that has one', () => {
    expect(parseIsoDate('2024-02-29')).not.toBeNull();
    expect(parseIsoDate('2026-02-29')).toBeNull();
  });

  it('keeps an early year as written instead of shifting it into the 1900s', () => {
    expect(formatIsoDate(parseIsoDate('0026-09-20'))).toBe('0026-09-20');
  });
});

describe('formatIsoDate', () => {
  it('pads to the width the API expects', () => {
    expect(formatIsoDate({ year: 2026, month: 9, day: 5 })).toBe('2026-09-05');
  });

  it.each([
    ['cleared', null],
    ['absent', undefined],
  ])('returns an empty string when the field is %s', (_label, input) => {
    expect(formatIsoDate(input)).toBe('');
  });

  it.each(['2026-01-01', '2026-12-31', '2024-02-29', '1999-07-04'])(
    'round-trips %s unchanged',
    (iso) => {
      expect(formatIsoDate(parseIsoDate(iso))).toBe(iso);
    },
  );
});

describe('parseIsoDateTime', () => {
  it('reads a local datetime-local string', () => {
    const date = parseIsoDateTime('2026-09-17T22:00');
    expect(date).not.toBeNull();
    expect([date!.year, date!.month, date!.day, date!.hour, date!.minute]).toEqual([
      2026, 9, 17, 22, 0,
    ]);
  });

  it('drops seconds from a local timestamp', () => {
    expect(formatIsoDateTime(parseIsoDateTime('2026-09-17T22:00:12'))).toBe('2026-09-17T22:00');
  });

  it('treats a date-only value as midnight', () => {
    expect(formatIsoDateTime(parseIsoDateTime('2026-09-17'))).toBe('2026-09-17T00:00');
  });

  it('rejects an hour that does not exist', () => {
    expect(parseIsoDateTime('2026-09-17T24:00')).toBeNull();
  });
});

describe('DATE_DISPLAY_LOCALE', () => {
  it('puts the day before the month, as checklist item 7.6 requires', () => {
    const formatted = new Intl.DateTimeFormat(DATE_DISPLAY_LOCALE, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date('2026-09-20T00:00:00.000Z'));
    expect(formatted).toBe('20/09/2026');
  });
});
