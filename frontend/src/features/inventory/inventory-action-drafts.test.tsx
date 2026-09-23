import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryAdjustments from './inventory-adjustments';
import InventoryDamage from './inventory-damage';
import InventoryBatches from './inventory-batches';
import {
  adjustmentActions,
  type AdjustmentAction,
  type StockAdjustment,
} from './inventory-adjustment-types';
import { DAMAGE_ACTIONS, type DamageAction, type StockDamage } from './inventory-damage-types';
import { InventoryDraftWorkspace } from './inventory-drafts';
import { InventoryWorkspaceProvider } from './inventory-workspace-context';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
} from '@/components/workspace/unsaved-work-provider';
import {
  WorkspaceNavigationProvider,
  WorkspaceLink,
  useWorkspacePathname,
} from '@/components/workspace/workspace-navigation';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  saved: vi.fn(),
  adjustment: {} as StockAdjustment,
  damage: {} as StockDamage,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/inventory',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator', companyId: 'company' },
    loading: false,
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  backendGet: state.get,
  backendPage: state.page,
  backendPatch: state.patch,
  backendDelete: state.remove,
}));
const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
type Kind = 'adjustment' | 'damage';
type Case = { kind: Kind; action: AdjustmentAction | DamageAction; label: string; status: string };
const cases: Case[] = [
  ...Object.entries(adjustmentActions).map(([action, spec]) => ({
    kind: 'adjustment' as const,
    action: action as AdjustmentAction,
    label: spec.label,
    status: spec.statuses[0],
  })),
  ...Object.entries(DAMAGE_ACTIONS).map(([action, spec]) => ({
    kind: 'damage' as const,
    action: action as DamageAction,
    label: spec.label,
    status: spec.status,
  })),
];
const route = (kind: Kind) =>
  kind === 'adjustment' ? '/operations/stock-adjustments' : '/westsides/stock-damage';
const endpoint = (kind: Kind) =>
  kind === 'adjustment' ? '/stock-adjustments/adjustment' : '/westsides/stock-damage/damage';
const specFor = (kind: Kind, action: AdjustmentAction | DamageAction) =>
  cases.find((c) => c.kind === kind && c.action === action)!;
function Pages() {
  const path = useWorkspacePathname();
  return (
    <>
      <nav aria-label="Destinations">
        <WorkspaceLink href="/inventory">Open home</WorkspaceLink>
        <WorkspaceLink href="/operations/stock-adjustments">Open adjustments</WorkspaceLink>
        <WorkspaceLink href="/westsides/stock-damage">Open damage</WorkspaceLink>
      </nav>
      <InventoryDraftWorkspace key={path} onSaved={state.saved}>
        <InventoryWorkspaceProvider scope={scope} searchQuery="">
          {path === '/operations/stock-adjustments' ? (
            <InventoryAdjustments />
          ) : path === '/westsides/stock-damage' ? (
            <InventoryDamage />
          ) : (
            <h1>Inventory home</h1>
          )}
        </InventoryWorkspaceProvider>
      </InventoryDraftWorkspace>
    </>
  );
}
function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>{children}</WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
function App({ kind = 'adjustment' }: { kind?: Kind }) {
  return (
    <Providers>
      <UnsavedWorkScope id="primary">
        <WorkspaceNavigationProvider
          appId="inventory"
          initialHref={route(kind)}
          ownsPath={(p) =>
            p === '/inventory' || p.startsWith('/operations/') || p.startsWith('/westsides/')
          }
        >
          <Pages />
        </WorkspaceNavigationProvider>
      </UnsavedWorkScope>
    </Providers>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'inventory.view',
    'inventory.adjustments.create',
    'inventory.adjustments.approve',
    'inventory.adjustments.post',
    'stock_damage.view',
    'stock_damage.create',
    'stock_damage.approve',
    'stock_damage.post',
    'product_batches.view',
    'product_batches.manage',
  ]);
  state.adjustment = {
    id: 'adjustment',
    adjustmentNumber: 'ADJ-1',
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    company: { name: 'Company A' },
    branch: { name: 'Central' },
    status: 'PENDING_APPROVAL',
    reason: 'Weekly stock count',
    notes: 'Cold room',
    updatedAt: 'v1',
    lines: [
      {
        id: 'line',
        productId: 'milk',
        product: { name: 'Milk' },
        systemQuantity: '10.0001',
        countedQuantity: '8.0001',
        varianceQuantity: '-2',
        unitCost: '100',
        unit: { name: 'Litre', symbol: 'L' },
      },
    ],
  };
  state.damage = {
    id: 'damage',
    damageNumber: 'DMG-1',
    companyId: 'company',
    branchId: 'branch',
    productId: 'milk',
    unitId: 'unit',
    quantity: '2.0001',
    estimatedValue: '200',
    damageType: 'SPOILED',
    status: 'SUBMITTED',
    notes: 'Storage temperature',
    updatedAt: 'v1',
    company: { id: 'company', name: 'Company A' },
    branch: { id: 'branch', name: 'Central', divisionId: 'division' },
    product: { id: 'milk', name: 'Milk' },
    unit: { id: 'unit', name: 'Litre', symbol: 'L' },
  };
  state.get.mockImplementation(async (path: string) => {
    if (path === '/stock-adjustments') return { data: [state.adjustment], total: 1 };
    if (path === endpoint('adjustment')) return { ...state.adjustment };
    if (path === '/westsides/stock-damage') return { data: [state.damage], total: 1 };
    if (path === endpoint('damage')) return { ...state.damage };
    if (path === '/westsides/product-batches') return { data: [], total: 0 };
    throw new Error('Unexpected read: ' + path);
  });
  state.page.mockResolvedValue({ data: [], total: 0 });
  state.patch.mockResolvedValue({});
  state.remove.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
type User = ReturnType<typeof userEvent.setup>;
async function open(user: User, spec: Case) {
  await user.click(
    await screen.findByRole('button', {
      name: `Inspect ${spec.kind === 'adjustment' ? 'ADJ-1' : 'DMG-1'}`,
    }),
  );
  if (spec.kind === 'adjustment')
    await user.click(screen.getByRole('button', { name: 'Review lines & actions' }));
  await user.click(await screen.findByRole('button', { name: spec.label, exact: true }));
  const form = within(await screen.findByRole('dialog', { name: spec.label }));
  await waitFor(() =>
    expect(form.getByRole('button', { name: spec.label, exact: true })).toBeEnabled(),
  );
  return form;
}
async function keep(user: User) {
  await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}
async function resume(user: User, spec: Case) {
  await user.click(screen.getByRole('button', { name: `Resume ${spec.label}` }));
  const form = within(await screen.findByRole('dialog', { name: spec.label }));
  await waitFor(() => expect(screen.queryByText(/Loading current/)).not.toBeInTheDocument());
  return form;
}
function reason(value = 'Please recount the cold room.') {
  fireEvent.change(screen.getByLabelText(/Rejection reason/), { target: { value } });
}
const review = () =>
  fireEvent.click(screen.getByLabelText('I have reviewed the latest record and my draft values.'));
function changed(kind: Kind) {
  if (kind === 'adjustment')
    state.adjustment = {
      ...state.adjustment,
      updatedAt: 'v2',
      lines: [{ ...state.adjustment.lines![0], countedQuantity: '7.0001', varianceQuantity: '-3' }],
    };
  else
    state.damage = { ...state.damage, updatedAt: 'v2', quantity: '3.0001', estimatedValue: '300' };
}

describe('Inventory action drafts', () => {
  it.each(cases)(
    'retains $kind $action for explicit confirmation against the latest record',
    async (spec) => {
      state[spec.kind].status = spec.status;
      const user = userEvent.setup();
      render(<App kind={spec.kind} />);
      await open(user, spec);
      if (spec.kind === 'adjustment' && spec.action === 'reject') reason();
      await keep(user);
      await user.click(screen.getByRole('link', { name: 'Open home' }));
      changed(spec.kind);
      const form = await resume(user, spec);
      expect(form.getByRole('button', { name: spec.label, exact: true })).toBeDisabled();
      expect(state.patch).not.toHaveBeenCalled();
      expect(state.remove).not.toHaveBeenCalled();
      expect(form.getByText(spec.kind === 'adjustment' ? '7.0001' : '3.0001 L')).toBeVisible();
      if (spec.kind === 'adjustment' && spec.action === 'reject')
        expect(form.getByLabelText(/Rejection reason/)).toHaveValue(
          'Please recount the cold room.',
        );
      review();
      await user.click(form.getByRole('button', { name: spec.label, exact: true }));
      await waitFor(() => expect(state.saved).toHaveBeenCalledOnce());
      if (spec.action === 'delete') expect(state.remove).toHaveBeenCalledWith(endpoint(spec.kind));
      else if (spec.kind === 'adjustment')
        expect(state.patch).toHaveBeenCalledWith(
          `${endpoint(spec.kind)}/${spec.action}`,
          spec.action === 'reject' ? { reason: 'Please recount the cold room.' } : undefined,
        );
      else expect(state.patch).toHaveBeenCalledWith(`${endpoint(spec.kind)}/${spec.action}`);
      expect(
        screen.queryByRole('button', { name: `Resume ${spec.label}` }),
      ).not.toBeInTheDocument();
    },
  );
  it('retains the rejection reason through guarded navigation, a failed action and a deliberate retry', async () => {
    const spec = specFor('adjustment', 'reject'),
      user = userEvent.setup();
    render(<App />);
    await open(user, spec);
    reason('  Recount before approval.  ');
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and continue' }));
    await resume(user, spec);
    expect(screen.getByLabelText(/Rejection reason/)).toHaveValue('  Recount before approval.  ');
    state.patch.mockRejectedValueOnce(new Error('Decision unavailable'));
    await user.click(
      within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
        name: spec.label,
        exact: true,
      }),
    );
    await screen.findByText('Decision unavailable');
    await keep(user);
    await resume(user, spec);
    expect(state.patch).toHaveBeenCalledTimes(1);
    await user.click(
      within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
        name: spec.label,
        exact: true,
      }),
    );
    await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
    expect(state.patch).toHaveBeenLastCalledWith('/stock-adjustments/adjustment/reject', {
      reason: 'Recount before approval.',
    });
  });
  it.each(['adjustment', 'damage'] as const)(
    'stops a %s action when a fresh check finds changed quantities, then requires review again for later changes',
    async (kind) => {
      const spec = specFor(kind, 'approve'),
        user = userEvent.setup();
      render(<App kind={kind} />);
      await open(user, spec);
      changed(kind);
      await user.click(
        within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
          name: spec.label,
          exact: true,
        }),
      );
      await screen.findByText('The source record has changed.');
      expect(state.patch).not.toHaveBeenCalled();
      review();
      state[kind].updatedAt = 'v3';
      await user.click(
        within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
          name: spec.label,
          exact: true,
        }),
      );
      await waitFor(() =>
        expect(
          screen.getByLabelText('I have reviewed the latest record and my draft values.'),
        ).not.toBeChecked(),
      );
      expect(state.patch).not.toHaveBeenCalled();
      review();
      await user.click(
        within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
          name: spec.label,
          exact: true,
        }),
      );
      await waitFor(() => expect(state.patch).toHaveBeenCalledOnce());
    },
  );
  it.each(['adjustment', 'damage'] as const)(
    'blocks a kept %s action after its status is no longer eligible',
    async (kind) => {
      const spec = specFor(kind, 'approve'),
        user = userEvent.setup();
      render(<App kind={kind} />);
      await open(user, spec);
      await keep(user);
      state[kind].status = 'POSTED';
      state[kind].updatedAt = 'v2';
      await resume(user, spec);
      expect(screen.getByRole('alert')).toHaveTextContent('now Posted');
      expect(
        within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
          name: spec.label,
          exact: true,
        }),
      ).toBeDisabled();
      review();
      expect(
        within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
          name: spec.label,
          exact: true,
        }),
      ).toBeDisabled();
      await keep(user);
      expect(state.patch).not.toHaveBeenCalled();
    },
  );
  it.each(['adjustment', 'damage'] as const)(
    'keeps an inaccessible %s action and rechecks permissions before another read',
    async (kind) => {
      const spec = specFor(kind, 'approve'),
        user = userEvent.setup();
      const app = render(<App kind={kind} />);
      await open(user, spec);
      await keep(user);
      const normal = state.get.getMockImplementation()!;
      state.get.mockImplementation((path, options) =>
        path === endpoint(kind)
          ? Promise.reject(new Error('Record not accessible'))
          : normal(path, options),
      );
      await resume(user, spec);
      await screen.findByText('Record not accessible');
      expect(
        within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
          name: spec.label,
          exact: true,
        }),
      ).toBeDisabled();
      await keep(user);
      state.permissions.delete(
        kind === 'adjustment' ? 'inventory.adjustments.approve' : 'stock_damage.approve',
      );
      app.rerender(<App kind={kind} />);
      const before = state.get.mock.calls.length;
      await user.click(screen.getByRole('button', { name: `Resume ${spec.label}` }));
      await screen.findByText('Your current role cannot open this Inventory draft.');
      expect(state.get).toHaveBeenCalledTimes(before);
      expect(state.patch).not.toHaveBeenCalled();
    },
  );
  it.each(['adjustment', 'damage'] as const)(
    'does not execute %s after permission is revoked during the fresh-record check',
    async (kind) => {
      const spec = specFor(kind, 'approve'),
        user = userEvent.setup();
      const app = render(<App kind={kind} />);
      await open(user, spec);
      let finish!: (row: StockAdjustment | StockDamage) => void;
      state.get.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      await user.click(
        within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
          name: spec.label,
          exact: true,
        }),
      );
      state.permissions.delete(
        kind === 'adjustment' ? 'inventory.adjustments.approve' : 'stock_damage.approve',
      );
      app.rerender(<App kind={kind} />);
      await act(async () => finish(state[kind]));
      expect(state.patch).not.toHaveBeenCalled();
      expect(
        within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
          name: spec.label,
          exact: true,
        }),
      ).toBeDisabled();
      await keep(user);
    },
  );
  it.each(['adjustment', 'damage'] as const)(
    'checks current status before retrying a failed %s post',
    async (kind) => {
      state[kind].status = 'APPROVED';
      const spec = specFor(kind, 'post'),
        user = userEvent.setup();
      render(<App kind={kind} />);
      await open(user, spec);
      state.patch.mockRejectedValueOnce(new Error('Response unavailable'));
      await user.click(
        within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
          name: spec.label,
          exact: true,
        }),
      );
      await screen.findByText('Response unavailable');
      state[kind].status = 'POSTED';
      state[kind].updatedAt = 'v2';
      await user.click(
        within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
          name: spec.label,
          exact: true,
        }),
      );
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('now Posted'));
      expect(state.patch).toHaveBeenCalledTimes(1);
      expect(state.saved).not.toHaveBeenCalled();
    },
  );
  it('requires review for an unversioned retained action and validates rejection length before reading or writing', async () => {
    state.adjustment.updatedAt = null;
    const spec = specFor('adjustment', 'reject'),
      user = userEvent.setup();
    render(<App />);
    await open(user, spec);
    reason();
    await keep(user);
    await resume(user, spec);
    expect(
      within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
        name: spec.label,
        exact: true,
      }),
    ).toBeDisabled();
    review();
    reason('x'.repeat(1001));
    const before = state.get.mock.calls.length;
    await user.click(
      within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
        name: spec.label,
        exact: true,
      }),
    );
    await screen.findByText('Keep the rejection reason within 1,000 characters.');
    expect(state.get).toHaveBeenCalledTimes(before);
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('does not duplicate an action on rapid confirmation and disables draft dismissal while it runs', async () => {
    const spec = specFor('damage', 'approve'),
      user = userEvent.setup();
    render(<App kind="damage" />);
    await open(user, spec);
    let finish!: (row: StockDamage) => void;
    state.get.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const before = state.get.mock.calls.length;
    const button = within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
      name: spec.label,
      exact: true,
    });
    // The verification read is issued after the draft saves, so the clicks must
    // be flushed before it is observable. The guard against the second one is
    // synchronous, so exactly one read is expected.
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(state.get).toHaveBeenCalledTimes(before + 1);
    expect(screen.getByRole('button', { name: 'Keep draft', exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back to register' })).toBeDisabled();
    await act(async () => finish(state.damage));
    await waitFor(() => expect(state.patch).toHaveBeenCalledOnce());
  });
  it('cancels a pending verification read when the workspace unmounts and never starts its mutation', async () => {
    const spec = specFor('damage', 'approve'),
      user = userEvent.setup();
    const app = render(<App kind="damage" />);
    await open(user, spec);
    let finish!: (row: StockDamage) => void;
    state.get.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await user.click(
      within(screen.getByRole('dialog', { name: spec.label })).getByRole('button', {
        name: spec.label,
        exact: true,
      }),
    );
    const signal = state.get.mock.lastCall?.[1].signal as AbortSignal;
    app.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish(state.damage));
    expect(state.patch).not.toHaveBeenCalled();
  });
});

function Window({ id, kind }: { id: string; kind: Kind | 'batch' }) {
  const [revision, setRevision] = useState(0);
  return (
    <section aria-label={id}>
      <UnsavedWorkScope id={id}>
        <WorkspaceNavigationProvider
          appId="inventory"
          initialHref={kind === 'batch' ? '/westsides/product-batches' : route(kind)}
          ownsPath={() => true}
        >
          <InventoryDraftWorkspace
            onSaved={() => {
              state.saved(id);
              setRevision((v) => v + 1);
            }}
          >
            <InventoryWorkspaceProvider scope={scope} searchQuery="">
              <div key={revision}>
                {kind === 'adjustment' ? (
                  <InventoryAdjustments />
                ) : kind === 'damage' ? (
                  <InventoryDamage />
                ) : (
                  <InventoryBatches />
                )}
                <input aria-label="Unfinished work" defaultValue="" />
              </div>
            </InventoryWorkspaceProvider>
          </InventoryDraftWorkspace>
        </WorkspaceNavigationProvider>
      </UnsavedWorkScope>
    </section>
  );
}
describe('Inventory windows', () => {
  it.each(['adjustment', 'damage', 'batch'] as const)(
    'keeps %s filters independent between paired windows',
    async (kind) => {
      const user = userEvent.setup();
      render(
        <Providers>
          <Window id="Left" kind={kind} />
          <Window id="Right" kind={kind} />
        </Providers>,
      );
      const left = within(screen.getByRole('region', { name: 'Left' })),
        right = within(screen.getByRole('region', { name: 'Right' }));
      await user.type(left.getByRole('searchbox'), 'milk');
      expect(right.getByRole('searchbox')).toHaveValue('');
      await user.type(right.getByRole('searchbox'), 'water');
      expect(left.getByRole('searchbox')).toHaveValue('milk');
    },
  );
  it('refreshes the other window after an action without remounting its unfinished work', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <Window id="Left" kind="damage" />
        <Window id="Right" kind="damage" />
      </Providers>,
    );
    const left = within(screen.getByRole('region', { name: 'Left' })),
      right = within(screen.getByRole('region', { name: 'Right' }));
    await user.type(right.getByLabelText('Unfinished work'), 'Keep this text');
    await user.click(await left.findByRole('button', { name: 'Inspect DMG-1' }));
    await user.click(left.getByRole('button', { name: 'Approve report' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Approve report' }));
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: 'Approve report' })).toBeEnabled(),
    );
    const before = state.get.mock.calls.filter(
      ([path]) => path === '/westsides/stock-damage',
    ).length;
    await user.click(dialog.getByRole('button', { name: 'Approve report' }));
    await waitFor(() => expect(state.saved).toHaveBeenCalledExactlyOnceWith('Left'));
    await waitFor(() =>
      expect(
        state.get.mock.calls.filter(([path]) => path === '/westsides/stock-damage').length,
      ).toBeGreaterThanOrEqual(before + 2),
    );
    expect(right.getByLabelText('Unfinished work')).toHaveValue('Keep this text');
  });
});
