import { describe, expect, it } from 'vitest';
import { desktopWindowLabel } from './desktop-window-label';
import type { DesktopWindow } from './desktop';

describe('unified Records window titles', () => {
  const window: DesktopWindow = {
    id: 'records',
    appId: 'records',
    href: '/records',
    mode: 'floating',
    minimized: false,
    bounds: { x: 0, y: 0, width: 900, height: 600 },
    viewState: {
      version: 1,
      values: {
        'records.section': 'debtors',
        'records.search': 'notebook filter',
        'records.book.filters': { search: 'daily filter' },
        'records.book-report.filters': { search: 'report filter' },
      },
    },
  };
  it.each([
    ['/records', 'Overview'],
    ['/record-book', 'Daily overview · “daily filter”'],
    ['/records/daily-sales', 'Daily sales · “daily filter”'],
    ['/records/reports?report=net-movement', 'Reports · “report filter”'],
    ['/records/notebook?view=overview', 'Notebook overview · “notebook filter”'],
    ['/records?view=creditors', 'creditors · “notebook filter”'],
  ])('describes %s using its current route and relevant filters', (href, expected) => {
    expect(desktopWindowLabel({ ...window, href })).toBe(expected);
  });
});
