/**
 * Kaunta Usiku tests — Phase 5 of the POS reform (the opt-in dark theme).
 * (docs/pos-reform/design-direction.md §2.1/§2.3, spec-sales.md §8,
 * spec-leo.md §5 item 5.)
 *
 * Same harness discipline as kaunta-shell/kaunta-stoo: everything drives the
 * real screens through the pilot (uiVersion=2) shell against an in-memory fake
 * of the IndexedDB store. The theme itself is CSS — jsdom does not apply the
 * `.pos-shell[data-pos-theme='usiku']` variable block — so what is asserted
 * here is the contract that block hangs off: which element carries the
 * attribute, what it says, and that it survives the phone being put down.
 *
 * USIKU-1 A fresh phone boots Mchana: the shell carries data-pos-theme=
 *         "mchana", nothing is written to storage, chrome is warm paper.
 * USIKU-2 Mipangilio's Mchana/Usiku row is reachable and operable: the switch
 *         flips the whole shell, persists `itemba-pos-theme`, repaints the
 *         browser chrome, and the choice outlives leaving the settings screen.
 * USIKU-3 A garbage stored value is the forced default Mchana (validated read).
 * USIKU-4 A stored 'usiku' boots straight into Usiku — the choice survives a
 *         cold start, which is the whole point of persisting it.
 * USIKU-5 The classic shell (uiVersion < 2) never carries the attribute, never
 *         carries .pos-shell, and never touches the page's chrome — even with
 *         'usiku' stored by a previous pilot phone.
 * USIKU-6 Token coverage, read off globals.css: no Mchana paper value survives
 *         into Usiku, and the three `-subtle` aliases are re-declared (they
 *         inherit already-substituted from `:root`, so a scoped `-bg` override
 *         alone does not move them).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MobilePosLiteProduct } from '@/lib/mobile-pos-lite-store';
import { MobilePosLite } from './mobile-pos-lite';

/* ------------------------------------------------------------------------ *
 * Hoisted fakes — the kaunta-shell doubles (identical module contract).
 * ------------------------------------------------------------------------ */
const h = vi.hoisted(() => {
  type Binding = { terminalCode: string; deviceSecret: string; activatedAt: string };
  type DaylogSent = { repId: string; count: number; totalAmount: number; fetchedAt: number };
  type DaylogEntry = { terminalCode: string; date: string; tallyCount: number; sent?: DaylogSent };

  const state = {
    binding: null as Binding | null,
    catalogs: new Map<string, unknown[]>(),
    sessions: new Map<string, unknown>(),
    frequents: new Map<string, Record<string, number>>(),
    outbox: [] as unknown[],
    daylog: new Map<string, DaylogEntry>(),
    stocks: new Map<string, unknown>(),
    drafts: new Map<string, unknown>(),
  };

  const posDaylogDate = (now: Date = new Date()) => {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  };

  const store = {
    readCachedStock: vi.fn(async (terminalCode: string) => state.stocks.get(terminalCode) ?? null),
    writeCachedStock: vi.fn(async (terminalCode: string, snapshot: unknown) => {
      state.stocks.set(terminalCode, snapshot);
    }),
    readCountDraft: vi.fn(
      async (terminalCode: string) => state.drafts.get(`${terminalCode}:count`) ?? null,
    ),
    writeCountDraft: vi.fn(async (terminalCode: string, draft: unknown) => {
      state.drafts.set(`${terminalCode}:count`, draft);
    }),
    clearCountDraft: vi.fn(async (terminalCode: string) => {
      state.drafts.delete(`${terminalCode}:count`);
    }),
    readPurchaseDraft: vi.fn(
      async (terminalCode: string) => state.drafts.get(`${terminalCode}:purchase`) ?? null,
    ),
    savePurchaseDraft: vi.fn(async (terminalCode: string, draft: unknown) => {
      state.drafts.set(`${terminalCode}:purchase`, draft);
    }),
    deletePurchaseDraft: vi.fn(async (terminalCode: string) => {
      state.drafts.delete(`${terminalCode}:purchase`);
    }),
    sweepOrphanDrafts: vi.fn(async (terminalCode: string) => {
      const orphans = [...state.drafts.keys()].filter((key) => !key.startsWith(`${terminalCode}:`));
      for (const key of orphans) state.drafts.delete(key);
      return orphans;
    }),
    posDaylogDate,
    getDaylogEntry: vi.fn(
      async (terminalCode: string, date: string) =>
        state.daylog.get(`${terminalCode}:${date}`) ?? null,
    ),
    bumpDaylogTally: vi.fn(async (terminalCode: string) => {
      const date = posDaylogDate();
      const key = `${terminalCode}:${date}`;
      const existing = state.daylog.get(key);
      const entry: DaylogEntry = existing
        ? { ...existing, tallyCount: existing.tallyCount + 1 }
        : { terminalCode, date, tallyCount: 1 };
      state.daylog.set(key, entry);
      return entry;
    }),
    writeDaylogSent: vi.fn(async (terminalCode: string, date: string, sent: DaylogSent) => {
      const key = `${terminalCode}:${date}`;
      const existing = state.daylog.get(key);
      const entry: DaylogEntry = existing
        ? { ...existing, sent }
        : { terminalCode, date, tallyCount: 0, sent };
      state.daylog.set(key, entry);
      return entry;
    }),
    getMobilePosLiteBinding: vi.fn(async () => state.binding),
    clearMobilePosLiteBinding: vi.fn(async () => {
      state.binding = null;
    }),
    getMobilePosLiteCatalog: vi.fn(async (terminalCode: string) => [
      ...(state.catalogs.get(terminalCode) ?? []),
    ]),
    saveMobilePosLiteCatalog: vi.fn(async (terminalCode: string, products: unknown[]) => {
      state.catalogs.set(terminalCode, products);
    }),
    getMobilePosLiteSession: vi.fn(
      async (terminalCode: string) => state.sessions.get(terminalCode) ?? null,
    ),
    saveMobilePosLiteSession: vi.fn(async (terminalCode: string, session: unknown) => {
      state.sessions.set(terminalCode, session);
    }),
    getMobilePosLiteFrequents: vi.fn(async (terminalCode: string) => ({
      ...(state.frequents.get(terminalCode) ?? {}),
    })),
    bumpMobilePosLiteFrequents: vi.fn(async (terminalCode: string, productIds: string[]) => {
      const counts = { ...(state.frequents.get(terminalCode) ?? {}) };
      for (const id of productIds) counts[id] = (counts[id] ?? 0) + 1;
      state.frequents.set(terminalCode, counts);
      return counts;
    }),
    enqueueMobilePosLiteSale: vi.fn(async () => undefined),
    getPendingMobilePosLiteSales: vi.fn(async () => []),
    removePendingMobilePosLiteSale: vi.fn(async () => undefined),
    updatePendingMobilePosLiteSaleError: vi.fn(async () => undefined),
  };

  return {
    state,
    store,
    backendGet: vi.fn(),
    backendPost: vi.fn(),
    showToast: vi.fn(),
    logout: vi.fn(),
    router: {
      replace: vi.fn(),
      push: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      refresh: vi.fn(),
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
}));
vi.mock('@/lib/api-client', () => ({ backendGet: h.backendGet, backendPost: h.backendPost }));
vi.mock('@/lib/mobile-pos-lite-store', () => ({ ...h.store }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ logout: h.logout }) }));
vi.mock('@/components/ui', () => ({ showToast: h.showToast }));

/* ------------------------------------------------------------------------ *
 * Test data + harness.
 * ------------------------------------------------------------------------ */
const TERMINAL = 'T-001';
const THEME_KEY = 'itemba-pos-theme';
const BINDING = {
  terminalCode: TERMINAL,
  deviceSecret: 'secret-1',
  activatedAt: '2026-08-01T00:00:00.000Z',
};

type PosSession = {
  terminal: {
    id: string;
    code: string;
    name: string;
    configVersion: number;
    offlineCashEnabled: boolean;
    uiVersion?: number;
  };
  company: { id: string; name: string; code: string };
  division: { id: string; name: string; code: string };
  branch: { id: string; name: string; code: string };
  rep: { id: string; name: string };
  paymentMethods: Array<{ code: string; label: string; requiresReference: boolean }>;
  purchasesEnabled?: boolean;
};

function makeProduct(overrides: Partial<MobilePosLiteProduct> = {}): MobilePosLiteProduct {
  return {
    id: 'p-generic',
    name: 'Bidhaa',
    code: 'GEN',
    barcode: null,
    unitId: 'u1',
    unitSymbol: 'pc',
    sellingPrice: 1000,
    availableStock: 25,
    trackInventory: true,
    imageUrl: null,
    ...overrides,
  };
}

const SODA = makeProduct({ id: 'p-soda', name: 'Soda Baridi', code: 'SODA', sellingPrice: 1200 });

function makeSession(overrides: Partial<PosSession> = {}): PosSession {
  const base: PosSession = {
    terminal: {
      id: 't1',
      code: TERMINAL,
      name: 'Kaunta 1',
      configVersion: 1,
      offlineCashEnabled: true,
    },
    company: { id: 'c1', name: 'Duka Ltd', code: 'DL' },
    division: { id: 'd1', name: 'Rejareja', code: 'RJ' },
    branch: { id: 'b1', name: 'Tawi la Kariakoo', code: 'KRK' },
    rep: { id: 'r1', name: 'Asha Rep' },
    paymentMethods: [{ code: 'CASH', label: 'Taslimu', requiresReference: false }],
    purchasesEnabled: false,
  };
  return {
    ...base,
    ...overrides,
    terminal: { ...base.terminal, ...(overrides.terminal ?? {}) },
  };
}

/** A pilot-terminal session: uiVersion 2 flips the Kaunta shell on. */
function kauntaSession(overrides: Partial<PosSession> = {}): PosSession {
  return makeSession({ ...overrides, terminal: { ...(overrides.terminal ?? {}), uiVersion: 2 } });
}

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

function buildHarness(options: { session?: PosSession } = {}) {
  const session = options.session ?? kauntaSession();

  h.state.binding = { ...BINDING };
  h.state.catalogs = new Map([[TERMINAL, [SODA]]]);
  h.state.sessions = new Map();
  h.state.frequents = new Map();
  h.state.outbox = [];
  h.state.daylog = new Map();
  h.state.stocks = new Map();
  h.state.drafts = new Map();

  setNavigatorOnLine(true);

  h.backendGet.mockImplementation(async (path: string) => {
    if (path === '/mobile-pos-lite/session') return session;
    if (path === '/mobile-pos-lite/catalog') return [...(h.state.catalogs.get(TERMINAL) ?? [])];
    if (path === '/mobile-pos-lite/products') return [];
    if (path === '/mobile-pos-lite/customers') return [];
    if (path === '/mobile-pos-lite/suppliers') return [];
    if (path === '/mobile-pos-lite/my-sales-today') return { count: 0, totalAmount: 0, sales: [] };
    if (path === '/mobile-pos-lite/stock')
      return { asOf: new Date().toISOString(), branch: { id: 'b1', name: 'Tawi' }, items: [] };
    throw new Error(`Unexpected GET ${path} in kaunta usiku test`);
  });

  return { session };
}

/** The wrapper that carries `.pos-shell` — the one element the theme rides. */
function posShell(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.pos-shell');
}

function chromeColor(): string | null {
  return document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;
}

/** Render and wait until the Kaunta shell boots into Mauzo (SaleScreen). */
async function mountKaunta() {
  render(<MobilePosLite />);
  await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
}

/** Rail gear → Mipangilio, returning the Mchana/Usiku switch. */
async function openThemeRow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Mipangilio' }));
  await screen.findByRole('heading', { name: 'Mipangilio' });
  return screen.getByRole('switch', { name: 'Mandhari' });
}

beforeAll(() => {
  const cryptoObj = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof cryptoObj?.randomUUID !== 'function') {
    let counter = 0;
    Object.defineProperty(cryptoObj, 'randomUUID', {
      configurable: true,
      value: () => {
        counter += 1;
        return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
      },
    });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
});

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'onLine');
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
});

/* ------------------------------------------------------------------------ *
 * USIKU-1
 * ------------------------------------------------------------------------ */
describe('USIKU-1: a fresh phone is Mchana', () => {
  it('boots with data-pos-theme="mchana" on the .pos-shell wrapper and warm-paper chrome', async () => {
    buildHarness();
    await mountKaunta();

    const shell = posShell();
    expect(shell).not.toBeNull();
    expect(shell).toHaveAttribute('data-pos-theme', 'mchana');
    // Forced default, not a stored one: nothing was written by merely booting.
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
    await waitFor(() => expect(chromeColor()).toBe('#faf7f0'));
  });
});

/* ------------------------------------------------------------------------ *
 * USIKU-2
 * ------------------------------------------------------------------------ */
describe('USIKU-2: the Mipangilio Mchana/Usiku row', () => {
  it('is reachable and operable, re-themes the whole shell, persists, and repaints the chrome', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();

    const themeSwitch = await openThemeRow(user);
    // Both modes are named in Swahili, either side of the track.
    expect(screen.getByText('Mchana')).toBeInTheDocument();
    expect(screen.getByText('Usiku')).toBeInTheDocument();
    expect(themeSwitch).toHaveAttribute('aria-checked', 'false');

    await user.click(themeSwitch);
    await waitFor(() => expect(posShell()).toHaveAttribute('data-pos-theme', 'usiku'));
    expect(themeSwitch).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('usiku');
    expect(chromeColor()).toBe('#0b1b2b');

    // The shell owns the theme, not the settings screen: leaving Mipangilio
    // for the counter keeps Usiku on.
    await user.click(screen.getByRole('button', { name: 'Mauzo Mapya' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(posShell()).toHaveAttribute('data-pos-theme', 'usiku');
    expect(chromeColor()).toBe('#0b1b2b');

    // And back again — the row is a two-way door.
    const backOn = await openThemeRow(user);
    await user.click(backOn);
    await waitFor(() => expect(posShell()).toHaveAttribute('data-pos-theme', 'mchana'));
    expect(window.localStorage.getItem(THEME_KEY)).toBe('mchana');
    expect(chromeColor()).toBe('#faf7f0');
  });
});

/* ------------------------------------------------------------------------ *
 * USIKU-3
 * ------------------------------------------------------------------------ */
describe('USIKU-3: a garbage stored value falls back to Mchana', () => {
  it('boots Mchana with the switch off when the stored theme is not a theme', async () => {
    window.localStorage.setItem(THEME_KEY, 'jua-kali');
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();

    expect(posShell()).toHaveAttribute('data-pos-theme', 'mchana');
    const themeSwitch = await openThemeRow(user);
    expect(themeSwitch).toHaveAttribute('aria-checked', 'false');
  });
});

/* ------------------------------------------------------------------------ *
 * USIKU-4
 * ------------------------------------------------------------------------ */
describe('USIKU-4: the choice survives a cold start', () => {
  it('boots straight into Usiku when the phone remembers it', async () => {
    window.localStorage.setItem(THEME_KEY, 'usiku');
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();

    expect(posShell()).toHaveAttribute('data-pos-theme', 'usiku');
    await waitFor(() => expect(chromeColor()).toBe('#0b1b2b'));
    const themeSwitch = await openThemeRow(user);
    expect(themeSwitch).toHaveAttribute('aria-checked', 'true');
  });
});

/* ------------------------------------------------------------------------ *
 * USIKU-5
 * ------------------------------------------------------------------------ */
describe('USIKU-5: the classic shell is untouched', () => {
  it('never carries .pos-shell or data-pos-theme, and leaves the page chrome alone', async () => {
    // Even with a pilot phone's leftover choice in storage.
    window.localStorage.setItem(THEME_KEY, 'usiku');
    buildHarness({ session: makeSession() }); // no uiVersion at all
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#faf7f0');
    document.head.appendChild(meta);

    render(<MobilePosLite />);
    await screen.findByRole('button', { name: 'Mauzo Mapya' });

    expect(posShell()).toBeNull();
    expect(document.querySelector('[data-pos-theme]')).toBeNull();
    // No Kaunta chrome, and no theme row to reach it from.
    expect(screen.queryByRole('button', { name: 'Mipangilio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Mandhari' })).not.toBeInTheDocument();
    expect(chromeColor()).toBe('#faf7f0');
  });
});

/* ------------------------------------------------------------------------ *
 * USIKU-6 — the token block itself (jsdom applies no CSS, so this reads the
 * source: the guard is "no paper value can survive into Usiku").
 * ------------------------------------------------------------------------ */
describe('USIKU-6: the Usiku block covers every Mchana token', () => {
  // vitest runs from the frontend package root (vitest.config.ts lives there).
  const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');
  const blockAfter = (marker: string) => {
    const start = css.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('\n}', start));
  };
  const declared = (block: string) =>
    new Set([...block.matchAll(/^\s*(--aurora-[a-z-]+):/gm)].map((match) => match[1]));

  const mchana = declared(blockAfter('.pos-shell,\n.dark .pos-shell {'));
  const usiku = declared(blockAfter(".pos-shell[data-pos-theme='usiku'],"));

  it('overrides every token Mchana pins', () => {
    expect(mchana.size).toBeGreaterThan(20);
    expect([...mchana].filter((token) => !usiku.has(token))).toEqual([]);
  });

  it('re-declares the three -subtle aliases that would otherwise inherit light', () => {
    // `:root` declares these as var(--aurora-*-bg); custom-property var() is
    // substituted where DECLARED, so the light result inherits into any
    // descendant that re-points -bg. Usiku has to say them again itself.
    for (const alias of ['success', 'warning', 'danger']) {
      expect(usiku.has(`--aurora-${alias}-subtle`)).toBe(true);
    }
  });

  it('keeps the Usiku block after Mchana so it wins at equal specificity', () => {
    expect(css.indexOf(".pos-shell[data-pos-theme='usiku'],")).toBeGreaterThan(
      css.indexOf('.pos-shell,\n.dark .pos-shell {'),
    );
  });
});
