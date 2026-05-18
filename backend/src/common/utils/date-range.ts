const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dateRangeStart(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

export function dateRangeEnd(value: string | Date) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}
