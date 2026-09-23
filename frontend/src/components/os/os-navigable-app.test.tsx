import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkspaceLink,
  useWorkspaceSearchParams,
} from '@/components/workspace/workspace-navigation';
import { OsNavigableApp } from './os-navigable-app';

const native = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => native,
  usePathname: () => '/cash-desk',
  useSearchParams: () => new URLSearchParams('companyId=main-company'),
}));
vi.mock('next/dynamic', async () => {
  const React = await import('react');
  return {
    default: (loader: () => Promise<{ default: React.ComponentType } | React.ComponentType>) => {
      const Loaded = React.lazy(async () => {
        const value = await loader();
        return { default: typeof value === 'function' ? value : value.default };
      });
      return function Dynamic(props: Record<string, unknown>) {
        return (
          <React.Suspense fallback={<p>Opening app</p>}>
            <Loaded {...props} />
          </React.Suspense>
        );
      };
    },
  };
});
vi.mock('@/features/inventory/inventory-workspace', () => ({
  default: () => (
    <>
      <h1>Inventory home</h1>
      <WorkspaceLink href="/inventory/products/p-1?companyId=side-company&branchId=side-branch&q=cement">
        Open product
      </WorkspaceLink>
    </>
  ),
}));
vi.mock('@/components/workspace/product-profile', () => ({
  ProductProfile: ({ productId, backHref }: { productId: string; backHref: string }) => (
    <>
      <h1>Product {productId}</h1>
      <WorkspaceLink href={backHref}>Back to catalog</WorkspaceLink>
    </>
  ),
}));
vi.mock('@/features/reports/reports-app', () => ({
  ReportsApp: () => (
    <>
      <h1>Reports home</h1>
      <WorkspaceLink href="/reports/library">Open library</WorkspaceLink>
      <WorkspaceLink href="/reports/scheduled">Open schedules</WorkspaceLink>
      <WorkspaceLink href="/accounting-engine/posting-runs">Posting controls</WorkspaceLink>
      <WorkspaceLink href="/accounting-engine/bank-reconciliations">
        Reconcile statements
      </WorkspaceLink>
    </>
  ),
}));
vi.mock('@/app/(dashboard)/reports/library/page', () => ({
  default: () => (
    <>
      <h1>Report library</h1>
      <WorkspaceLink href="/reports/run?reportId=trial-balance&companyId=side-company">
        Run report
      </WorkspaceLink>
    </>
  ),
}));
vi.mock('@/app/(dashboard)/reports/run/page', () => ({
  default: function ReportRunner() {
    const params = useWorkspaceSearchParams();
    return (
      <h1>
        Report {params.get('reportId')} for {params.get('companyId')}
      </h1>
    );
  },
}));
vi.mock('@/app/(dashboard)/reports/scheduled/page', () => ({
  default: () => <h1>Report schedules</h1>,
}));
vi.mock('@/features/reports/reconciliation-workspace', () => ({
  ReconciliationWorkspace: () => <h1>Bank reconciliation workspace</h1>,
}));

vi.mock('@/features/reports/accounting-controls-workspace', () => ({
  AccountingControlsWorkspace: ({ kind }: { kind: string }) => (
    <>
      <h1>Control {kind}</h1>
      {['period-close', 'accounting-locks', 'audit-adjustments', 'depreciation'].map((next) => (
        <WorkspaceLink key={next} href={`/accounting-engine/${next}`}>
          {next}
        </WorkspaceLink>
      ))}
    </>
  ),
}));
beforeEach(() => vi.clearAllMocks());
describe('Inventory and Reports app adapters', () => {
  it('keeps all five accounting controls inside Reports with local history', async () => {
    const user = userEvent.setup();
    render(<OsNavigableApp appId="reports" />);
    await user.click(await screen.findByRole('link', { name: 'Posting controls' }));
    expect(await screen.findByRole('heading', { name: 'Control posting-runs' })).toBeVisible();
    for (const kind of ['period-close', 'accounting-locks', 'audit-adjustments', 'depreciation']) {
      await user.click(await screen.findByRole('link', { name: kind }));
      expect(await screen.findByRole('heading', { name: `Control ${kind}` })).toBeVisible();
    }
    await user.click(screen.getByRole('button', { name: 'Back in Reports' }));
    expect(await screen.findByRole('heading', { name: 'Control audit-adjustments' })).toBeVisible();
    expect(native.push).not.toHaveBeenCalled();
    expect(native.replace).not.toHaveBeenCalled();
  });
  it('keeps statement reconciliation inside the Reports window and its history', async () => {
    const user = userEvent.setup();
    render(<OsNavigableApp appId="reports" />);
    await user.click(await screen.findByRole('link', { name: 'Reconcile statements' }));
    expect(
      await screen.findByRole('heading', { name: 'Bank reconciliation workspace' }),
    ).toBeVisible();
    expect(native.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Back in Reports' }));
    expect(await screen.findByRole('heading', { name: 'Reports home' })).toBeVisible();
  });
  it('opens the correct product and keeps its scoped return link within Inventory', async () => {
    const user = userEvent.setup();
    render(<OsNavigableApp appId="inventory" />);
    await user.click(await screen.findByRole('link', { name: 'Open product' }));
    expect(await screen.findByRole('heading', { name: 'Product p-1' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Inventory content' })).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Back to catalog' })).toHaveAttribute(
      'href',
      '/inventory?tab=catalog&view=products&companyId=side-company&branchId=side-branch&q=cement',
    );
    await user.click(screen.getByRole('button', { name: 'Back in Inventory' }));
    expect(await screen.findByRole('heading', { name: 'Inventory home' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back in Inventory' })).toHaveFocus();
    expect(native.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Forward in Inventory' }));
    expect(await screen.findByRole('heading', { name: 'Product p-1' })).toBeVisible();
  });
  it('keeps the report library, runner and schedules in the same app with independent queries', async () => {
    const user = userEvent.setup();
    render(<OsNavigableApp appId="reports" />);
    await user.click(await screen.findByRole('link', { name: 'Open library' }));
    await user.click(await screen.findByRole('link', { name: 'Run report' }));
    expect(
      await screen.findByRole('heading', { name: 'Report trial-balance for side-company' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Back in Reports' }));
    expect(await screen.findByRole('heading', { name: 'Report library' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Reports home' }));
    await user.click(await screen.findByRole('link', { name: 'Open schedules' }));
    expect(await screen.findByRole('heading', { name: 'Report schedules' })).toBeVisible();
    await waitFor(() => expect(native.push).not.toHaveBeenCalled());
    expect(native.replace).not.toHaveBeenCalled();
  });
});
