const CRON_SEARCH_YEARS = 5;

interface CronField {
  readonly wildcard: boolean;
  readonly values: readonly number[];
  readonly set: ReadonlySet<number>;
}

interface ParsedCron {
  readonly seconds: CronField;
  readonly minutes: CronField;
  readonly hours: CronField;
  readonly daysOfMonth: CronField;
  readonly months: CronField;
  readonly daysOfWeek: CronField;
}

export class UnsupportedMsaidiziCronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedMsaidiziCronError';
  }
}

/**
 * Validates the deliberately bounded cron grammar used by durable routines.
 *
 * Supported forms are numeric five-field (minute precision) and six-field
 * (leading seconds) expressions. Each field supports `*`, lists, ranges, and
 * positive steps. Named months/weekdays and Quartz extensions are rejected so
 * a routine cannot be activated with syntax the dispatcher interprets
 * differently from the operator.
 */
export function assertSupportedCronExpression(expression: string): void {
  parseCron(expression);
}

/** Returns the first represented instant strictly after `after`. */
export function nextCronOccurrence(expression: string, timezone: string, after: Date): Date {
  const cron = parseCron(expression);
  const formatter = formatterFor(timezone);
  const localAfter = localParts(after, formatter);
  const startDay = Date.UTC(localAfter.year, localAfter.month - 1, localAfter.day);
  const lastDay = Date.UTC(
    localAfter.year + CRON_SEARCH_YEARS,
    localAfter.month - 1,
    localAfter.day,
  );

  for (let dayCursor = startDay; dayCursor <= lastDay; dayCursor += 86_400_000) {
    const calendar = new Date(dayCursor);
    const year = calendar.getUTCFullYear();
    const month = calendar.getUTCMonth() + 1;
    const day = calendar.getUTCDate();
    if (!cron.months.set.has(month) || !matchesDay(cron, year, month, day)) continue;

    const sameLocalDay =
      year === localAfter.year && month === localAfter.month && day === localAfter.day;
    const currentSecond = localAfter.hour * 3_600 + localAfter.minute * 60 + localAfter.second;

    for (const hour of cron.hours.values) {
      for (const minute of cron.minutes.values) {
        for (const second of cron.seconds.values) {
          const wallSecond = hour * 3_600 + minute * 60 + second;
          // Include the current repeated wall-clock second: during a DST fall
          // back it can map to a second, still-future UTC instant.
          if (sameLocalDay && wallSecond < currentSecond) continue;
          const candidates = utcCandidatesForLocal(
            { year, month, day, hour, minute, second },
            formatter,
          );
          for (const candidate of candidates) {
            if (candidate.getTime() > after.getTime()) return candidate;
          }
        }
      }
    }
  }

  throw new UnsupportedMsaidiziCronError(
    `cronExpression has no occurrence within ${CRON_SEARCH_YEARS} years`,
  );
}

function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    throw new UnsupportedMsaidiziCronError(
      'cronExpression must contain five fields or six fields with leading seconds',
    );
  }
  const offset = fields.length === 6 ? 1 : 0;
  return {
    seconds: fields.length === 6 ? parseField(fields[0], 0, 59) : singletonField(0),
    minutes: parseField(fields[offset], 0, 59),
    hours: parseField(fields[offset + 1], 0, 23),
    daysOfMonth: parseField(fields[offset + 2], 1, 31),
    months: parseField(fields[offset + 3], 1, 12),
    daysOfWeek: parseField(fields[offset + 4], 0, 7, true),
  };
}

function parseField(raw: string, min: number, max: number, sundayAlias = false): CronField {
  if (!raw || !/^[\d*,\-/]+$/.test(raw)) {
    throw new UnsupportedMsaidiziCronError(`unsupported cron field: ${raw || '(empty)'}`);
  }
  const values = new Set<number>();
  for (const part of raw.split(',')) {
    if (!part) throw new UnsupportedMsaidiziCronError('cron lists cannot contain empty values');
    const [base, stepText, extra] = part.split('/');
    if (extra !== undefined) throw new UnsupportedMsaidiziCronError(`invalid cron step: ${part}`);
    const step = stepText === undefined ? 1 : parseInteger(stepText, 1, max - min + 1, part);

    let start: number;
    let end: number;
    if (base === '*') {
      start = min;
      end = max;
    } else if (base.includes('-')) {
      const range = base.split('-');
      if (range.length !== 2) throw new UnsupportedMsaidiziCronError(`invalid cron range: ${part}`);
      start = parseInteger(range[0], min, max, part);
      end = parseInteger(range[1], min, max, part);
      if (start > end) {
        throw new UnsupportedMsaidiziCronError(`wrapping cron ranges are not supported: ${part}`);
      }
    } else {
      start = parseInteger(base, min, max, part);
      end = start;
      if (stepText !== undefined) {
        throw new UnsupportedMsaidiziCronError(`a cron step requires '*' or a range: ${part}`);
      }
    }

    for (let value = start; value <= end; value += step) {
      values.add(sundayAlias && value === 7 ? 0 : value);
    }
  }
  if (values.size === 0) throw new UnsupportedMsaidiziCronError(`empty cron field: ${raw}`);
  const sorted = Array.from(values).sort((left, right) => left - right);
  return { wildcard: raw === '*', values: sorted, set: new Set(sorted) };
}

function parseInteger(raw: string, min: number, max: number, context: string): number {
  if (!/^\d+$/.test(raw)) throw new UnsupportedMsaidiziCronError(`invalid cron value: ${context}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new UnsupportedMsaidiziCronError(
      `cron value ${raw} is outside the supported ${min}-${max} range`,
    );
  }
  return value;
}

function singletonField(value: number): CronField {
  return { wildcard: false, values: [value], set: new Set([value]) };
}

function matchesDay(cron: ParsedCron, year: number, month: number, day: number): boolean {
  const dayOfMonthMatches = cron.daysOfMonth.set.has(day);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const dayOfWeekMatches = cron.daysOfWeek.set.has(dayOfWeek);
  if (cron.daysOfMonth.wildcard && cron.daysOfWeek.wildcard) return true;
  if (cron.daysOfMonth.wildcard) return dayOfWeekMatches;
  if (cron.daysOfWeek.wildcard) return dayOfMonthMatches;
  // Vixie cron semantics: when both fields are restricted, either may match.
  return dayOfMonthMatches || dayOfWeekMatches;
}

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function utcCandidatesForLocal(expected: LocalDateTime, formatter: Intl.DateTimeFormat): Date[] {
  const naiveUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
    expected.second,
  );
  const offsets = new Set<number>();
  for (const deltaHours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = new Date(naiveUtc + deltaHours * 3_600_000);
    offsets.add(timezoneOffsetMilliseconds(sample, formatter));
  }

  const candidates: Date[] = [];
  for (const offset of offsets) {
    const candidate = new Date(naiveUtc - offset);
    if (sameLocalDateTime(localParts(candidate, formatter), expected)) candidates.push(candidate);
  }
  return candidates.sort((left, right) => left.getTime() - right.getTime());
}

function timezoneOffsetMilliseconds(date: Date, formatter: Intl.DateTimeFormat): number {
  const parts = localParts(date, formatter);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    Math.floor(date.getTime() / 1_000) * 1_000
  );
}

function sameLocalDateTime(left: LocalDateTime, right: LocalDateTime): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function localParts(date: Date, formatter: Intl.DateTimeFormat): LocalDateTime {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timezone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new UnsupportedMsaidiziCronError('timezone must be a valid IANA time zone');
  }
  FORMATTERS.set(timezone, formatter);
  return formatter;
}
