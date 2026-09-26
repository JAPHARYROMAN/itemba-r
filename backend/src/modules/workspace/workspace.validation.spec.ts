import { validateAppearance, validateLayout } from './workspace.validation';
describe('workspace storage validation', () => {
  const window = {
    id: 'one',
    appId: 'invoice-desk',
    href: '/invoice-desk',
    mode: 'floating',
    bounds: { x: 0, y: 0, width: 900, height: 600 },
  };
  it('rejects cross-origin and wrong-host recovery URLs', () => {
    for (const href of ['//other.test', 'javascript:alert(1)', '/payroll'])
      expect(() =>
        validateLayout({ version: 1, activeId: 'one', windows: [{ ...window, href }] }),
      ).toThrow();
  });
  it('permits independent copies but not duplicate identifiers', () => {
    expect(
      validateLayout({ version: 1, activeId: 'one', windows: [window, { ...window, id: 'two' }] }),
    ).toBeTruthy();
    expect(() =>
      validateLayout({ version: 1, activeId: 'one', windows: [window, window] }),
    ).toThrow();
  });
  it('recovers migrated customer and sales windows with safe filters only', () => {
    for (const href of [
      '/operations/customers/customer',
      '/operations/sales-orders/sale',
      '/sales-desk/sales/sale',
    ]) {
      const input = {
        ...window,
        appId: 'sales-desk',
        href,
        viewState: {
          version: 1,
          values: {
            'sales-desk.business-sales.search': 'reference',
            'sales-desk.customers.filters': {
              companyId: 'company',
              branchId: 'branch',
              status: 'ACTIVE',
            },
          },
        },
      };
      expect(validateLayout({ version: 1, activeId: 'one', windows: [input] })).toBeTruthy();
    }
    for (const href of ['/operations/suppliers', '/operations/customers-elsewhere'])
      expect(() =>
        validateLayout({ version: 1, windows: [{ ...window, appId: 'sales-desk', href }] }),
      ).toThrow();
    expect(() =>
      validateLayout({
        version: 1,
        windows: [
          {
            ...window,
            appId: 'sales-desk',
            href: '/sales-desk',
            viewState: {
              version: 1,
              values: {
                'sales-desk.customers.filters': { bankAccount: 'not-a-view-setting' },
              },
            },
          },
        ],
      }),
    ).toThrow('Unsupported window view settings');
  });
  it('rejects unsupported appearance schema and unsafe accents', () => {
    expect(() => validateAppearance({ version: 2 })).toThrow();
    expect(() =>
      validateAppearance({
        version: 1,
        theme: 'aurora',
        mode: 'light',
        accent: 'url(javascript:1)',
      }),
    ).toThrow();
  });
  it('accepts view recovery but refuses form contents or another app in the layout', () => {
    const layout = (values: Record<string, unknown>) => ({
      version: 1,
      activeId: 'one',
      windows: [{ ...window, viewState: { version: 1, values } }],
    });
    expect(
      validateLayout(
        layout({
          'invoice-desk.search': 'fuel',
          'invoice-desk.scope': { companyId: 'a', divisionId: '', branchId: '' },
        }),
      ),
    ).toBeTruthy();
    for (const values of [
      { 'invoice-desk.new.amount': 500 },
      { 'cash-desk.search': 'cash' },
      { 'invoice-desk.scope': { bankAccount: 'secret' } },
    ])
      expect(() => validateLayout(layout(values))).toThrow('Unsupported window view settings');
  });
  it('allows one activated or unactivated POS host and rejects a second terminal editor', () => {
    const pos = { ...window, appId: 'pos', href: '/pos/activate' };
    expect(validateLayout({ version: 1, activeId: 'one', windows: [pos] })).toBeTruthy();
    expect(() =>
      validateLayout({ version: 1, activeId: 'one', windows: [pos, { ...pos, id: 'two' }] }),
    ).toThrow('This app supports one window');
  });
});
