import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryScope } from './inventory-scope';
import {
  UnsavedWorkProvider,
  useFormGuard,
  useUnsavedWork,
} from '@/components/workspace/unsaved-work-provider';
import type { ScopeValue } from '@/components/ui';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  userCompany: '',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (p: string) => state.permissions.has(p),
    user: { companyId: state.userCompany },
  }),
}));
vi.mock('@/lib/api-client', () => ({ backendPage: state.page }));
const initial = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
function Harness({ start = initial }: { start?: ScopeValue }) {
  const [value, setValue] = useState(start),
    [form, setForm] = useState({ note: '' });
  const guard = useFormGuard(form, setForm),
    unsaved = useUnsavedWork();
  return (
    <>
      <InventoryScope value={value} onChange={(v) => unsaved.request(() => setValue(v))} />
      <output aria-label="Scope">{JSON.stringify(value)}</output>
      <form {...guard.capture}>
        <input
          aria-label="Draft note"
          value={form.note}
          onChange={(e) => setForm({ note: e.target.value })}
        />
      </form>
    </>
  );
}
const mount = (start?: ScopeValue) =>
  render(
    <UnsavedWorkProvider>
      <Harness start={start} />
    </UnsavedWorkProvider>,
  );
beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  state.userCompany = '';
  state.permissions = new Set(['companies.read', 'divisions.read', 'branches.read']);
  state.page.mockImplementation(async (path: string) => ({
    data:
      path === '/companies'
        ? [
            { id: 'company', name: 'First company' },
            { id: 'second', name: 'Second company' },
          ]
        : path === '/divisions'
          ? [{ id: 'division', name: 'Construction' }]
          : [{ id: 'branch', name: 'Warehouse', divisionId: 'division' }],
    total: path === '/companies' ? 2 : 1,
  }));
});
describe('Inventory scope controls', () => {
  it('loads all choice pages, resolves legacy branch parents and preserves chosen scope', async () => {
    state.page.mockImplementation(async (path: string, { query }: { query: { page: number } }) => ({
      data:
        path === '/branches'
          ? query.page === 1
            ? [{ id: 'other', name: 'Other branch' }]
            : [{ id: 'branch', name: 'Warehouse', divisionId: 'division' }]
          : path === '/companies'
            ? [
                { id: 'company', name: 'First company' },
                { id: 'second', name: 'Second company' },
              ]
            : [{ id: 'division', name: 'Construction' }],
      total: path === '/branches' || path === '/companies' ? 2 : 1,
    }));
    mount({ ...initial, divisionId: '' });
    await waitFor(() =>
      expect(screen.getByLabelText('Scope')).toHaveTextContent('"divisionId":"division"'),
    );
    expect(screen.getByLabelText('Branch')).toHaveValue('branch');
    expect(state.page).toHaveBeenCalledWith(
      '/branches',
      expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
    );
  });
  it('does not request forbidden directories and defaults to the existing user company', async () => {
    state.permissions.clear();
    state.userCompany = 'company';
    mount({ companyId: '', divisionId: '', branchId: '' });
    await waitFor(() =>
      expect(screen.getByLabelText('Scope')).toHaveTextContent('"companyId":"company"'),
    );
    expect(state.page).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Company')).toBeDisabled();
    expect(screen.getByRole('option', { name: 'company' })).toBeInTheDocument();
  });
  it('exposes failed later directory pages and retries without partial choices', async () => {
    let failed = true;
    state.page.mockImplementation(async (path: string, { query }: { query: { page: number } }) => {
      if (path === '/companies') {
        if (query.page === 2 && failed) throw new Error('Company page unavailable');
        return {
          data: [
            {
              id: query.page === 1 ? 'company' : 'second',
              name: query.page === 1 ? 'First company' : 'Second company',
            },
          ],
          total: 2,
        };
      }
      return { data: [], total: 0 };
    });
    mount({ companyId: '', divisionId: '', branchId: '' });
    await screen.findByText(/Company page unavailable/);
    expect(screen.queryByRole('option', { name: 'First company' })).not.toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: /Retry company choices/i }));
    await screen.findByRole('option', { name: 'Second company' });
    expect(screen.getByLabelText('Company')).toHaveValue('');
  });
  it('protects draft scope changes and clears descendants only after discard', async () => {
    mount();
    await screen.findByRole('option', { name: 'Second company' });
    fireEvent.change(screen.getByLabelText('Draft note'), { target: { value: 'Unsaved count' } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'second' } });
    await screen.findByRole('dialog');
    expect(screen.getByLabelText('Scope')).toHaveTextContent('"companyId":"company"');
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(screen.getByLabelText('Draft note')).toHaveValue('Unsaved count');
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Scope')).toHaveTextContent(
      '{"companyId":"second","divisionId":"","branchId":""}',
    );
    expect(screen.getByLabelText('Draft note')).toHaveValue('');
  });
  it('aborts stale branch choices and never repopulates them after switching company', async () => {
    let resolve!: (p: unknown) => void;
    let signal!: AbortSignal;
    state.page.mockImplementation(
      async (path: string, options: { query: { companyId?: string }; signal: AbortSignal }) => {
        if (path === '/branches' && options.query.companyId === 'company') {
          signal = options.signal;
          return new Promise((r) => {
            resolve = r;
          });
        }
        return {
          data:
            path === '/companies'
              ? [
                  { id: 'company', name: 'First company' },
                  { id: 'second', name: 'Second company' },
                ]
              : [],
          total: path === '/companies' ? 2 : 0,
        };
      },
    );
    mount();
    await screen.findByRole('option', { name: 'Second company' });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'second' } });
    await waitFor(() => expect(signal.aborted).toBe(true));
    await act(async () =>
      resolve({ data: [{ id: 'stale', name: 'Obsolete warehouse' }], total: 1 }),
    );
    expect(screen.queryByRole('option', { name: 'Obsolete warehouse' })).not.toBeInTheDocument();
  });
});
