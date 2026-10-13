/** Customer account periods follow the East Africa business day. */
export const performanceDate = (value: string, includeYear = false) =>
  new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    timeZone: 'Africa/Nairobi',
  });
export const performanceToday = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
export function performanceDates(preset: string, today = performanceToday()) {
  const date = new Date(`${today}T00:00:00Z`);
  if (preset === 'today') return { dateFrom: today, dateTo: today };
  if (preset === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  else date.setUTCDate(1);
  return { dateFrom: date.toISOString().slice(0, 10), dateTo: today };
}
