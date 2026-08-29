/**
 * THE BUSINESS TIMEZONE — the single authority on where a trading day begins
 * and ends. Hoisted verbatim out of mobile-pos-lite.service.ts so the
 * westsides daily close can aggregate over the SAME window a terminal's
 * MobilePosDayReport covers; the behavior is identical to what Mobile POS
 * Lite shipped with.
 *
 * REVIEW-BLOCKING: nothing that consumes this may decide a day boundary from
 * the PROCESS's zone (`new Date(v.getFullYear(), v.getMonth(), v.getDate())`,
 * `process.env.TZ`) or from an instant the client chose. Use
 * `businessDayKeyOf` and `businessDayWindow`, which read this constant and
 * nothing else.
 *
 * Why it is pinned in code rather than configured:
 *
 * - The server process's zone is INCIDENTAL. Nothing sets TZ — no `ENV TZ` in
 *   `backend/Dockerfile`, none on the backend service in
 *   `docker-compose.production.yml`, no `process.env.TZ` anywhere in
 *   `backend/src` — so node:20-alpine runs UTC while every rendered time in
 *   Mobile POS Lite is pinned to Africa/Nairobi. A boundary read from it cut
 *   the trading day at 03:00 EAT and refused outright every close made
 *   between midnight and 03:00. A duka that trades past eleven at night is
 *   the normal case here, not the edge case.
 * - The DEVICE's zone is a claim, not an authority. A phone's clock can be
 *   wrong, and the whole reason the server owns WHETHER a day is closable is
 *   that it must not inherit the phone's idea of what day it is.
 * - Setting TZ on the container would fix one module by silently moving every
 *   OTHER module's local-day arithmetic at the same time. That is a far
 *   larger blast radius than this boundary needs, and it is invisible in the
 *   source: one redeploy onto a host, base image or compose file that does
 *   not carry the variable re-breaks it exactly as before, with nothing in
 *   review to catch it. A constant cannot be lost in a deploy.
 * - There is no company or branch timezone column to read. The only
 *   `timezone` in the schema is `UserPreference.timezone`, a per-user DISPLAY
 *   preference the user edits herself; a trading day that moves when a rep
 *   changes her profile is worse than one pinned to the wrong zone.
 *
 * Africa/Nairobi is EAT, UTC+3, no DST and none since 1936;
 * Africa/Dar_es_Salaam is a link to the same zone, and naming one zone twice
 * is how two halves of a boundary drift apart.
 */
export const MOBILE_POS_BUSINESS_TIMEZONE = 'Africa/Nairobi';

/**
 * The business zone's wall clock for an instant, read through ICU rather than
 * through the process's own zone. `h23` so midnight is hour 0 and not hour 24.
 */
const businessZoneClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: MOBILE_POS_BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function businessZoneFields(value: Date) {
  const parts = businessZoneClock.formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** The `YYYY-MM-DD` business day an instant falls on. */
export function businessDayKeyOf(value: Date) {
  const at = businessZoneFields(value);
  return `${String(at.year).padStart(4, '0')}-${String(at.month).padStart(2, '0')}-${String(
    at.day,
  ).padStart(2, '0')}`;
}

/**
 * The business zone's offset from UTC at a given instant, in ms. Read from the
 * zone's own rules rather than hard-coded to +3, so the arithmetic below does
 * not quietly depend on EAT never gaining a DST rule.
 */
function businessZoneOffsetMs(value: Date) {
  const at = businessZoneFields(value);
  const wallClockReadAsUtc = Date.UTC(
    at.year,
    at.month - 1,
    at.day,
    at.hour,
    at.minute,
    at.second,
    value.getUTCMilliseconds(),
  );
  return wallClockReadAsUtc - value.getTime();
}

/** The instant midnight begins, in the business zone, on calendar day `dayKey`. */
export function businessDayStart(dayKey: string) {
  const wallClock = Date.parse(`${dayKey}T00:00:00.000Z`);
  // Two passes: the naive guess can land on the far side of an offset change,
  // and the second pass re-reads the offset where midnight actually is.
  const guess = new Date(wallClock - businessZoneOffsetMs(new Date(wallClock)));
  return new Date(wallClock - businessZoneOffsetMs(guess));
}

/** Calendar arithmetic on a `YYYY-MM-DD` key, done where no zone can bend it. */
export function shiftBusinessDayKey(dayKey: string, days: number) {
  const day = new Date(`${dayKey}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/**
 * The half-open instant window a business day covers: [midnight, next
 * midnight) in the business zone. Every `orderDate` filter in Mobile POS Lite
 * is built from this and from nothing else, and the westsides daily close
 * uses the same window when it compares a terminal's own day report against
 * expected receipts.
 */
export function businessDayWindow(dayKey: string) {
  return {
    dayStart: businessDayStart(dayKey),
    dayEnd: businessDayStart(shiftBusinessDayKey(dayKey, 1)),
  };
}
