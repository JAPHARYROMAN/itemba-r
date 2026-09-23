import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageHeader } from '@/components/ui/page-header';
import { WorkspaceSessionProvider } from './workspace-session';
import { UnsavedWorkProvider, UnsavedWorkScope, useFormGuard } from './unsaved-work-provider';
import {
  WorkspaceNavigationProvider,
  WorkspaceLink,
  useWorkspacePathname,
  useWorkspaceSearchParams,
  useWorkspaceRouter,
  useWorkspaceHistory,
  useWorkspaceSearchReader,
} from './workspace-navigation';

const native = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  account: 'one',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => native,
  usePathname: () => '/reports',
  useSearchParams: () => new URLSearchParams('view=health&companyId=main-company'),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: native.account, permissions: ['inventory.view'] } }),
}));

function Form({ name }: { name: string }) {
  const [value, setValue] = useState('');
  const guard = useFormGuard(value, setValue);
  return (
    <label {...guard.capture}>
      {name}
      <input value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}
const owns = (path: string) => path === '/inventory' || path.startsWith('/inventory/products/');
function LocalApp() {
  const path = useWorkspacePathname(),
    params = useWorkspaceSearchParams(),
    router = useWorkspaceRouter(),
    history = useWorkspaceHistory()!,
    readSearch = useWorkspaceSearchReader();
  return (
    <>
      <output aria-label="Local address">
        {path}?{params.toString()}
      </output>
      <PageHeader
        title="Inventory"
        breadcrumbs={[{ label: 'Stock', href: '/inventory?tab=stock' }]}
      />
      <WorkspaceLink href="/inventory?tab=catalog&companyId=local-company">Catalog</WorkspaceLink>
      <WorkspaceLink href="/inventory/products/product?branchId=local-branch">
        Product
      </WorkspaceLink>
      <WorkspaceLink href="/companies">Companies</WorkspaceLink>
      <WorkspaceLink href="https://outside.example/inventory">External inventory</WorkspaceLink>
      <button
        onClick={() => router.replace('/inventory?tab=catalog&companyId=local-company&q=cement')}
      >
        Search cement
      </button>
      <button
        onClick={() => {
          router.replace('/inventory?branchId=new-branch');
          expect(readSearch().get('branchId')).toBe('new-branch');
        }}
      >
        Read just-applied scope
      </button>
      <button disabled={!history.canBack} onClick={router.back}>
        Back locally
      </button>
      <button disabled={!history.canForward} onClick={router.forward}>
        Forward locally
      </button>
      <Form name="Companion form" />
    </>
  );
}
function Harness() {
  const [visible, setVisible] = useState(true);
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <UnsavedWorkScope id="main">
          <Form name="Main form" />
        </UnsavedWorkScope>
        <button onClick={() => setVisible((value) => !value)}>Toggle companion</button>
        {visible && (
          <UnsavedWorkScope
            id="companion"
            survivesNavigation={(href) =>
              !new URL(href, location.href).pathname.startsWith('/inventory')
            }
          >
            <WorkspaceNavigationProvider appId="inventory" initialHref="/inventory" ownsPath={owns}>
              <LocalApp />
            </WorkspaceNavigationProvider>
          </UnsavedWorkScope>
        )}
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  native.account = 'one';
  history.replaceState({}, '', '/reports?view=health&companyId=main-company');
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

describe('Independent app navigation', () => {
  it('keeps query, breadcrumbs and local history separate from the browser route', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByLabelText('Local address')).toHaveTextContent('/inventory?');
    expect(screen.getByLabelText('Local address')).not.toHaveTextContent('main-company');
    await user.click(screen.getByRole('link', { name: 'Catalog' }));
    await user.click(screen.getByText('Search cement'));
    expect(screen.getByLabelText('Local address')).toHaveTextContent('q=cement');
    await user.click(screen.getByRole('link', { name: 'Product' }));
    expect(screen.getByLabelText('Local address')).toHaveTextContent(
      '/inventory/products/product?branchId=local-branch',
    );
    await user.click(screen.getByText('Back locally'));
    expect(screen.getByLabelText('Local address')).toHaveTextContent('q=cement');
    await user.click(screen.getByText('Forward locally'));
    expect(screen.getByLabelText('Local address')).toHaveTextContent('/inventory/products/product');
    await user.click(screen.getByRole('link', { name: 'Stock', exact: true }));
    expect(screen.getByLabelText('Local address')).toHaveTextContent('/inventory?tab=stock');
    expect(native.push).not.toHaveBeenCalled();
    expect(native.replace).not.toHaveBeenCalled();
    expect(native.back).not.toHaveBeenCalled();
    expect(native.forward).not.toHaveBeenCalled();
    expect(location.pathname + location.search).toBe('/reports?view=health&companyId=main-company');
  });
  it('protects only the companion form when changing its view, including back navigation', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Main form'), 'Keep invoice');
    await user.type(screen.getByLabelText('Companion form'), 'Stock adjustment');
    await user.click(screen.getByRole('link', { name: 'Catalog' }));
    await user.click(screen.getByText('Stay here'));
    expect(screen.getByLabelText('Companion form')).toHaveValue('Stock adjustment');
    await user.click(screen.getByRole('link', { name: 'Catalog' }));
    await user.click(screen.getByText('Discard changes'));
    expect(screen.getByLabelText('Companion form')).toHaveValue('');
    expect(screen.getByLabelText('Main form')).toHaveValue('Keep invoice');
    await user.type(screen.getByLabelText('Companion form'), 'New adjustment');
    await user.click(screen.getByText('Back locally'));
    await user.click(screen.getByText('Stay here'));
    expect(screen.getByLabelText('Local address')).toHaveTextContent('tab=catalog');
  });
  it('uses the main router for another app and leaves the companion input intact', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Main form'), 'Invoice');
    await user.type(screen.getByLabelText('Companion form'), 'Adjustment');
    await user.click(screen.getByRole('link', { name: 'Companies' }));
    await user.click(screen.getByText('Discard changes'));
    expect(native.push).toHaveBeenCalledWith('/companies');
    expect(screen.getByLabelText('Companion form')).toHaveValue('Adjustment');
    expect(screen.getByLabelText('Local address')).toHaveTextContent('/inventory?');
  });
  it('does not mistake an external URL with the same path for a local app view', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Companion form'), 'Adjustment');
    await user.click(screen.getByRole('link', { name: 'External inventory' }));
    await user.click(screen.getByText('Stay here'));
    expect(screen.getByLabelText('Local address')).toHaveTextContent('/inventory?');
    expect(screen.getByLabelText('Companion form')).toHaveValue('Adjustment');
  });
  it('remembers view history in this session and clears it when the account changes', async () => {
    const user = userEvent.setup();
    const view = render(<Harness />);
    await user.click(screen.getByRole('link', { name: 'Catalog' }));
    await user.click(screen.getByText('Toggle companion'));
    await user.click(screen.getByText('Toggle companion'));
    expect(screen.getByLabelText('Local address')).toHaveTextContent('companyId=local-company');
    expect(screen.getByText('Back locally')).toBeEnabled();
    native.account = 'two';
    view.rerender(<Harness />);
    expect(screen.getByLabelText('Local address')).toHaveTextContent('/inventory?');
    expect(screen.getByText('Back locally')).toBeDisabled();
  });
  it('exposes the latest committed scope to a debounced search without borrowing the main URL', async () => {
    render(<Harness />);
    act(() => fireEvent.click(screen.getByText('Read just-applied scope')));
    expect(screen.getByLabelText('Local address')).toHaveTextContent('branchId=new-branch');
    expect(native.replace).not.toHaveBeenCalled();
  });
});
