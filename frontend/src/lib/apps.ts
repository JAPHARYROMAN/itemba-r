import type { AppIconName } from '@/components/ui/icon-set';
import { PAYROLL_APP_PERMISSIONS, PAYROLL_ROUTE_PREFIXES } from './payroll-app';

export type AppLaunch =
  | { kind: 'workspace' }
  | { kind: 'settings' }
  | { kind: 'route' }
  | { kind: 'external'; urlVariable: string; healthVariable: string; authentication: string };

export interface WorkspaceApp {
  id: string;
  href: string;
  label: string;
  description: string;
  category: string;
  icon: AppIconName;
  iconKey: 'grid' | 'fuelGrid';
  appearance: 'erp' | 'fuel' | 'settings' | 'default';
  permission?: string;
  permissionsAny?: string[];
  routePrefixes?: readonly string[];
  keywords: readonly string[];
  launch: AppLaunch;
  hosting: {
    kind: 'independent' | 'singleton' | 'external';
    minWidth: number;
    minHeight: number;
    defaultWidth: number;
    defaultHeight: number;
  };
}

/** These routes replace the OS shell, so mounted companion apps cannot survive them. */
export function usesStandalonePosShell(pathname: string) {
  return pathname.startsWith('/mobile-pos') || pathname.startsWith('/westsides/mobile-pos');
}

export const INVENTORY_APP_PERMISSIONS = [
  'inventory.view',
  'inventory.movements.view',
  'inventory.adjustments.create',
  'inventory.adjustments.approve',
  'inventory.adjustments.post',
  'products.view',
  'product_categories.view',
  'units.view',
  'product_batches.view',
  'product_batches.manage',
  'stock_damage.view',
  'stock_damage.create',
  'stock_damage.approve',
  'stock_damage.post',
  'operations.reports.view',
  'westsides.reports.view',
];

/** App identity and launch policy live here. ERP module navigation stays in NAV. */
const APP_DEFINITIONS: readonly Omit<WorkspaceApp, 'hosting'>[] = [
  {
    id: 'itemba-r',
    href: '/dashboard',
    label: 'ITEMBA-R',
    description: 'Your business workspace',
    category: 'Business',
    icon: 'company',
    iconKey: 'grid',
    appearance: 'erp',
    keywords: ['erp', 'finance', 'operations', 'people'],
    launch: { kind: 'workspace' },
  },
  {
    id: 'fuel-grid',
    href: '/fuel-grid',
    label: 'Fuel Grid',
    description: 'Your dedicated workspace for station operations.',
    category: 'Operations',
    icon: 'fuel',
    iconKey: 'fuelGrid',
    appearance: 'fuel',
    permission: 'fuel_grid.access',
    keywords: ['fuel', 'stations', 'petroleum'],
    launch: {
      kind: 'external',
      urlVariable: 'FUELGRID_APP_URL',
      healthVariable: 'FUELGRID_HEALTH_URL',
      authentication: 'Fuel Grid account',
    },
  },
  {
    id: 'settings',
    href: '/apps?settings=1',
    label: 'Settings',
    description: 'Make yourself at home',
    category: 'System',
    icon: 'settings',
    iconKey: 'grid',
    appearance: 'settings',
    keywords: ['appearance', 'theme', 'preferences'],
    launch: { kind: 'settings' },
  },
  {
    id: 'invoice-desk',
    href: '/invoice-desk',
    label: 'Invoice Desk',
    description: 'Every purchase. Every payment. All in view.',
    category: 'Finance',
    icon: 'order',
    iconKey: 'grid',
    appearance: 'default',
    permission: 'invoice_desk.view',
    keywords: ['invoices', 'purchases', 'suppliers', 'credit', 'payments'],
    launch: { kind: 'route' },
  },
  {
    id: 'inventory',
    href: '/inventory',
    label: 'Inventory',
    description: 'Stock, products and movements. All in one place.',
    category: 'Operations',
    icon: 'inventory',
    iconKey: 'grid',
    appearance: 'default',
    permissionsAny: INVENTORY_APP_PERMISSIONS,
    keywords: ['stock', 'products', 'warehouses', 'adjustments', 'batches', 'expiry'],
    launch: { kind: 'route' },
  },
  {
    id: 'cash-desk',
    href: '/cash-desk',
    label: 'Cash Desk',
    description: 'Daily sales, expenses, money movements and supplier balances.',
    category: 'Finance',
    icon: 'finance',
    iconKey: 'grid',
    appearance: 'default',
    permission: 'cash_desk.view',
    keywords: [
      'cash',
      'sales',
      'expenses',
      'spending',
      'loans',
      'transfers',
      'suppliers',
      'payments',
    ],
    launch: { kind: 'route' },
  },
  {
    id: 'sales-desk',
    href: '/sales-desk',
    label: 'Sales Desk',
    description: 'Customers, sales and payments. Clearly connected.',
    category: 'Business',
    icon: 'sale',
    iconKey: 'grid',
    appearance: 'default',
    permissionsAny: ['sales.view', 'customers.view', 'sales_desk.view'],
    routePrefixes: ['/operations/customers', '/operations/sales-orders'],
    keywords: ['sales', 'customers', 'receipts', 'credit', 'payments'],
    launch: { kind: 'route' },
  },
  {
    id: 'pos',
    href: '/pos',
    label: 'Point of Sale',
    description: 'Your terminal, counter sales and daily operations.',
    category: 'Operations',
    icon: 'sale',
    iconKey: 'grid',
    appearance: 'default',
    permission: 'mobile_pos_lite.use',
    keywords: ['pos', 'terminal', 'counter', 'kaunta', 'sales'],
    launch: { kind: 'route' },
  },
  {
    id: 'records',
    href: '/records',
    label: 'Records',
    description: 'Daily records, debts, purchases, expenses and notes. Together.',
    category: 'Business',
    icon: 'document',
    iconKey: 'grid',
    appearance: 'default',
    permissionsAny: ['record_book.view', 'records.view'],
    routePrefixes: ['/record-book'],
    keywords: [
      'records',
      'registers',
      'debtors',
      'creditors',
      'sales',
      'purchases',
      'expenses',
      'notes',
    ],
    launch: { kind: 'route' },
  },
  {
    id: 'payroll',
    href: '/payroll',
    label: 'Payroll',
    description: 'Employees, attendance, leave and pay. One complete workspace.',
    category: 'People',
    icon: 'payment',
    iconKey: 'grid',
    appearance: 'default',
    permissionsAny: PAYROLL_APP_PERMISSIONS,
    routePrefixes: PAYROLL_ROUTE_PREFIXES,
    keywords: ['payroll', 'salaries', 'employees', 'payslips', 'allowances', 'deductions'],
    launch: { kind: 'route' },
  },
  {
    id: 'documents',
    href: '/documents',
    label: 'Documents',
    description: 'Company letterheads, correspondence and your document library.',
    category: 'Business',
    icon: 'document',
    iconKey: 'grid',
    appearance: 'default',
    permission: 'documents.view',
    routePrefixes: ['/group-control/documents'],
    keywords: ['documents', 'letterhead', 'word', 'excel', 'pdf', 'files', 'letters'],
    launch: { kind: 'route' },
  },
  {
    id: 'reports',
    href: '/reports',
    label: 'Reports',
    description: 'Customers, suppliers, sales and spending. Clearly explained.',
    category: 'Business',
    icon: 'report',
    iconKey: 'grid',
    appearance: 'default',
    keywords: [
      'reports',
      'customers',
      'suppliers',
      'sales',
      'expenses',
      'cash',
      'purchases',
      'analytics',
    ],
    launch: { kind: 'route' },
  },
];

export const APP_REGISTRY: readonly WorkspaceApp[] = APP_DEFINITIONS.map((app) => ({
  ...app,
  hosting: {
    kind:
      app.launch.kind === 'external'
        ? 'external'
        : ['itemba-r', 'settings', 'pos'].includes(app.id)
          ? 'singleton'
          : 'independent',
    minWidth: 480,
    minHeight: 360,
    defaultWidth: 1080,
    defaultHeight: 740,
  },
}));

/** Compatibility for navigation/search entries for standalone apps. */
export const APPS = APP_REGISTRY.filter(
  (app) => app.launch.kind === 'external' || app.launch.kind === 'route',
);
export const getApp = (id: string) => APP_REGISTRY.find((app) => app.id === id);
export const canOpenApp = (app: WorkspaceApp, hasPermission: (permission: string) => boolean) =>
  (!app.permission || hasPermission(app.permission)) &&
  (!app.permissionsAny?.length ||
    app.permissionsAny.some((permission) => hasPermission(permission)));
export const appForPath = (pathname: string) =>
  APPS.find(
    (app) =>
      pathname === app.href ||
      pathname.startsWith(`${app.href}/`) ||
      app.routePrefixes?.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      ) ||
      (app.launch.kind === 'external' && pathname === `/apps/${app.id}`),
  );
export const isAppPath = (pathname: string) => !!appForPath(pathname);
export const statusPath = (app: WorkspaceApp) => `/api/apps/${encodeURIComponent(app.id)}/status`;

export function validateAppRegistry(apps: readonly WorkspaceApp[]): string[] {
  const ids = new Set<string>();
  const routes = new Set<string>();
  const errors: string[] = [];
  for (const app of apps) {
    if (!/^[a-z][a-z0-9-]*$/.test(app.id) || ids.has(app.id))
      errors.push(`Invalid or duplicate app id: ${app.id}`);
    if (!app.href.startsWith('/') || app.href.startsWith('//') || routes.has(app.href))
      errors.push(`Invalid or duplicate app route: ${app.href}`);
    if (!app.label.trim() || !app.description.trim()) errors.push(`Missing identity: ${app.id}`);
    if (
      app.launch.kind === 'external' &&
      (!app.permission ||
        !app.launch.urlVariable ||
        !app.launch.healthVariable ||
        !app.launch.authentication)
    )
      errors.push(`Incomplete external app contract: ${app.id}`);
    ids.add(app.id);
    routes.add(app.href);
  }
  return errors;
}
