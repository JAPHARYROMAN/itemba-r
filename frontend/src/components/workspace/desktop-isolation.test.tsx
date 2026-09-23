import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  WorkspaceInstanceProvider,
  WorkspaceSessionProvider,
  useWorkspaceState,
} from './workspace-session';
import {
  WorkspaceNavigationProvider,
  useWorkspaceRouter,
  useWorkspaceSearchParams,
} from './workspace-navigation';
import { UnsavedWorkProvider } from './unsaved-work-provider';
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'person', companyId: 'company', permissions: [] } }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => '/invoice-desk',
  useSearchParams: () => new URLSearchParams(),
}));
function InvoiceWindow({ name }: { name: string }) {
  const [filter, setFilter] = useWorkspaceState('invoice-desk.filter', 'All');
  const [input, setInput] = useWorkspaceState('invoice-desk.new.description', '');
  const params = useWorkspaceSearchParams(),
    router = useWorkspaceRouter();
  return (
    <section aria-label={name}>
      <label>
        Filter
        <input value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      <label>
        Draft input
        <input value={input} onChange={(e) => setInput(e.target.value)} />
      </label>
      <button onClick={() => router.push('/invoice-desk?record=first')}>Open record</button>
      <output>{params.get('record') || 'No record'}</output>
    </section>
  );
}
describe('independent desktop instances', () => {
  it('keeps filters, draft inputs and record navigation separate for duplicate apps', () => {
    render(
      <WorkspaceSessionProvider>
        <UnsavedWorkProvider>
          {['A', 'B'].map((id) => (
            <WorkspaceInstanceProvider key={id} id={id}>
              <WorkspaceNavigationProvider
                appId="invoice-desk"
                initialHref="/invoice-desk"
                ownsPath={(path) => path === '/invoice-desk'}
              >
                <InvoiceWindow name={id} />
              </WorkspaceNavigationProvider>
            </WorkspaceInstanceProvider>
          ))}
        </UnsavedWorkProvider>
      </WorkspaceSessionProvider>,
    );
    const first = within(screen.getByRole('region', { name: 'A' })),
      second = within(screen.getByRole('region', { name: 'B' }));
    fireEvent.change(first.getByLabelText('Filter'), { target: { value: 'Overdue' } });
    fireEvent.change(first.getByLabelText('Draft input'), { target: { value: 'Office supplies' } });
    fireEvent.change(second.getByLabelText('Draft input'), { target: { value: 'Fuel purchase' } });
    fireEvent.click(first.getByText('Open record'));
    expect(first.getByLabelText('Filter')).toHaveValue('Overdue');
    expect(second.getByLabelText('Filter')).toHaveValue('All');
    expect(first.getByLabelText('Draft input')).toHaveValue('Office supplies');
    expect(second.getByLabelText('Draft input')).toHaveValue('Fuel purchase');
    expect(first.getByText('first')).toBeInTheDocument();
    expect(second.getByText('No record')).toBeInTheDocument();
  });
});
