import { CalendarDate, CalendarDateTime } from '@internationalized/date';

/**
 * Dates are shown as DD/MM/YYYY, the Tanzanian format required by checklist
 * item 7.6 in `docs/qa/ui-ux-review-checklist.md`. Pinning the locale instead of
 * inheriting the browser's keeps the segment order the same for every operator,
 * on every machine, and in every test run.
 */
export const DATE_DISPLAY_LOCALE = 'en-GB';

/** Leading anchor only: `2026-09-20T08:30:00Z` carries a usable date too. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
/** Local `datetime-local` strings: date, hours and minutes. Seconds are dropped. */
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/**
 * A year below this is always a half-typed one. The segments complete a date as
 * soon as the first year digit lands, so an operator typing 2026 passes through
 * years 2, 20 and 202 on the way. None of those are dates anyone means, and a
 * form that stored one would hold a record dated in antiquity.
 */
export const MIN_PLAUSIBLE_YEAR = 1000;

type DateParts = { year: number; month: number; day: number };

/**
 * Read the `YYYY-MM-DD` strings that forms and the API exchange.
 *
 * Anything unusable — empty, malformed, or a day that does not exist such as
 * 2026-02-30 — comes back as null so the field renders empty. A stored value
 * gone bad must not be able to throw inside the control; that is the failure
 * mode this whole component exists to remove.
 */
export function parseIsoDate(value: string | null | undefined): CalendarDate | null {
  if (!value) return null;
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Round-tripping through a UTC Date rejects impossible days without hardcoding
  // month lengths or leap-year rules. setUTCFullYear rather than the Date.UTC
  // shorthand, because that shorthand quietly reads year 0026 as 1926.
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return new CalendarDate(year, month, day);
}

/** Back to the `YYYY-MM-DD` the forms and API expect; '' once cleared. */
export function formatIsoDate(date: DateParts | null | undefined): string {
  if (!date) return '';
  return [
    String(date.year).padStart(4, '0'),
    String(date.month).padStart(2, '0'),
    String(date.day).padStart(2, '0'),
  ].join('-');
}

type DateTimeParts = DateParts & { hour: number; minute: number };

/**
 * Read the local `YYYY-MM-DDTHH:mm` strings `datetime-local` used to store.
 *
 * Seconds and a trailing `Z` are ignored: the field is minute-granularity and
 * the string is a wall-clock time, not an instant. A date-only value becomes
 * midnight so a sibling date can still bound a datetime field.
 */
export function parseIsoDateTime(value: string | null | undefined): CalendarDateTime | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = ISO_DATE_TIME.exec(trimmed);
  if (!match) {
    const date = parseIsoDate(trimmed);
    return date ? new CalendarDateTime(date.year, date.month, date.day, 0, 0) : null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) return null;
  if (!parseIsoDate(`${match[1]}-${match[2]}-${match[3]}`)) return null;

  return new CalendarDateTime(year, month, day, hour, minute);
}

/** Back to the `YYYY-MM-DDTHH:mm` the native control used to submit. */
export function formatIsoDateTime(date: DateTimeParts | DateParts | null | undefined): string {
  if (!date) return '';
  const hour = 'hour' in date ? date.hour : 0;
  const minute = 'minute' in date ? date.minute : 0;
  return `${formatIsoDate(date)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
