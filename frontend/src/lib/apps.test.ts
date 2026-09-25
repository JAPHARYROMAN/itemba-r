import { describe, expect, it } from 'vitest';
import {
  APP_REGISTRY,
  canOpenApp,
  getApp,
  appForPath,
  validateAppRegistry,
  usesStandalonePosShell,
  type WorkspaceApp,
} from './apps';
import { getAppConnection } from './app-connections';

const future: WorkspaceApp = {
  id: 'field-notes',
  href: '/apps/field-notes',
  label: 'Field Notes',
  description: 'Site notebooks',
  category: 'Productivity',
  icon: 'document',
  iconKey: 'grid',
  appearance: 'default',
  permission: 'field_notes.access',
  keywords: ['notes'],
  launch: {
    kind: 'external',
    urlVariable: 'FIELD_NOTES_APP_URL',
    healthVariable: 'FIELD_NOTES_HEALTH_URL',
    authentication: 'Field Notes account',
  },
};

describe('App registration contract', () => {
  it('hosts one POS terminal with its existing permission and preserves standalone routes', () => {
    const pos = getApp('pos')!;
    expect(appForPath('/pos/activate')).toBe(pos);
    expect(pos.hosting.kind).toBe('singleton');
    expect(canOpenApp(pos, (permission) => permission === 'mobile_pos_lite.use')).toBe(true);
    expect(canOpenApp(pos, (permission) => permission === 'sales_desk.view')).toBe(false);
    expect(usesStandalonePosShell('/pos')).toBe(false);
    expect(usesStandalonePosShell('/mobile-pos')).toBe(true);
  });
  it('keeps the employee-to-pay lifecycle inside Payroll', () => {
    const payroll = getApp('payroll')!;
    for (const path of [
      '/payroll',
      '/payroll/inputs',
      '/hr/payroll-runs',
      '/hr/payroll-runs/id/payslips',
      '/hr/payslips/id',
      '/hr/employee-deductions',
      '/hr/employees',
      '/hr/employees/employee',
      '/hr/employment-contracts',
      '/hr/attendance',
      '/hr/leave-balances',
      '/hr/reports/statutory',
      '/hr/employee-assignments',
    ])
      expect(appForPath(path)).toBe(payroll);
    expect(appForPath('/hr/disputes')).toBeUndefined();
    expect(appForPath('/hr/payroll-runs-other')).toBeUndefined();
    expect(canOpenApp(payroll, (p) => p === 'salary_payments.view')).toBe(true);
    expect(canOpenApp(payroll, (p) => p === 'payroll.view')).toBe(true);
    expect(canOpenApp(payroll, (p) => p === 'employees.view')).toBe(true);
  });
  it('launches Sales Desk in its own workspace with its own permission', () => {
    const sales = getApp('sales-desk')!;
    expect(sales.launch.kind).toBe('route');
    expect(appForPath('/sales-desk')).toBe(sales);
    expect(canOpenApp(sales, (p) => p === 'sales_desk.view')).toBe(true);
    expect(canOpenApp(sales, (p) => p === 'cash_desk.view')).toBe(false);
  });
  it('opens Inventory for existing scoped capabilities without granting new access', () => {
    const inventory = getApp('inventory')!;
    expect(canOpenApp(inventory, (p) => p === 'inventory.adjustments.approve')).toBe(true);
    expect(canOpenApp(inventory, (p) => p === 'products.view')).toBe(true);
    const granted = ['inventory.view'];
    expect(
      canOpenApp(inventory, (...permissions: string[]) =>
        permissions.every((p) => granted.includes(p)),
      ),
    ).toBe(true);
    expect(canOpenApp(inventory, (p) => p === 'finance.view')).toBe(false);
    expect(appForPath('/inventory')).toBe(inventory);
    expect(appForPath('/inventory/products/example')).toBe(inventory);
  });
  it('validates the shipping registry and a future tool without changing the shell', () => {
    expect(validateAppRegistry(APP_REGISTRY)).toEqual([]);
    expect(validateAppRegistry([...APP_REGISTRY, future])).toEqual([]);
    expect(canOpenApp(future, (p) => p === 'field_notes.access')).toBe(true);
    expect(canOpenApp(future, () => false)).toBe(false);
    expect(
      getAppConnection(future, { FIELD_NOTES_APP_URL: 'https://notes.example.test/' }),
    ).toEqual({ appUrl: 'https://notes.example.test', healthUrl: 'https://notes.example.test' });
  });
  it('rejects duplicate identities, unsafe routes and incomplete external contracts', () => {
    expect(validateAppRegistry([future, future])).toHaveLength(2);
    expect(validateAppRegistry([{ ...future, href: '//other.example' }])).not.toEqual([]);
    expect(validateAppRegistry([{ ...future, permission: undefined }])).not.toEqual([]);
    expect(
      getAppConnection(future, { FIELD_NOTES_APP_URL: 'https://user:password@notes.example.test' })
        .appUrl,
    ).toBeNull();
  });
});
