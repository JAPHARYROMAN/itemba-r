export const PETRODOLLAR_VIEWS = [
  'report',
  'receive',
  'daily',
  'history',
  'stations',
  'setup',
] as const;
export type PetroDollarView = (typeof PETRODOLLAR_VIEWS)[number];

export const petrodollarView = (value: string | null): PetroDollarView =>
  (PETRODOLLAR_VIEWS as readonly string[]).includes(value ?? '')
    ? (value as PetroDollarView)
    : 'report';

export function petrodollarDate(value: string | null, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : fallback;
}

export function petrodollarHref(params: URLSearchParams, updates: Record<string, string> = {}) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(updates)) next.set(key, value);
  if (petrodollarView(next.get('view')) === 'report') next.delete('view');
  return `/petrodollar${next.size ? `?${next}` : ''}`;
}

/** Compatibility URLs enter the OS app; internal API routes remain unchanged. */
export function legacyFuelReportingHref(path: string, params: URLSearchParams): string {
  if (path === '/fuel-reporting/login') {
    const from = params.get('from');
    const target =
      from && from.startsWith('/') && !from.startsWith('//') && !/[\\\x00-\x1f]/.test(from)
        ? new URL(from, 'https://itemba.invalid')
        : null;
    const href =
      target?.pathname === '/petrodollar'
        ? petrodollarHref(target.searchParams)
        : target &&
            (target.pathname === '/fuel-reporting' ||
              target.pathname.startsWith('/fuel-reporting/')) &&
            target.pathname !== '/fuel-reporting/login'
          ? legacyFuelReportingHref(target.pathname, target.searchParams)
          : '/petrodollar';
    return `/login?${new URLSearchParams({ from: href })}`;
  }
  const next = new URLSearchParams();
  for (const key of ['branchId', 'date', 'shift', '_osw']) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  if (!next.has('date') && params.has('businessDate'))
    next.set('date', params.get('businessDate')!);
  next.set(
    'view',
    petrodollarView(params.get('view') ?? params.get('tab') ?? path.split('/')[2] ?? null),
  );
  return petrodollarHref(next);
}

/** Switching editor panels retains the same report and its unsaved inputs. */
export function preservesPetroDollarEditor(from: string, to: string) {
  const a = new URL(from, 'https://itemba.invalid');
  const b = new URL(to, 'https://itemba.invalid');
  const editor = (params: URLSearchParams) =>
    ['report', 'receive'].includes(petrodollarView(params.get('view')));
  return (
    a.pathname === '/petrodollar' &&
    b.pathname === '/petrodollar' &&
    editor(a.searchParams) &&
    editor(b.searchParams) &&
    ['branchId', 'date', 'shift'].every(
      (key) => a.searchParams.get(key) === b.searchParams.get(key),
    )
  );
}
