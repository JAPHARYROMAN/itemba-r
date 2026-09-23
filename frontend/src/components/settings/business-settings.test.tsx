import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NumberSequencesPage from '@/app/(dashboard)/settings/number-sequences/page';
import CompanyProfilePage from '@/app/(dashboard)/settings/company-profile/page';
import { UnsavedWorkProvider } from '@/components/workspace/unsaved-work-provider';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  fetch: vi.fn(),
  get: vi.fn(),
  page: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  router: { push: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => state.permissions.has(permission) }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: state.get,
  backendPage: state.page,
  backendPatch: state.patch,
  backendPut: state.put,
  backendUpload: vi.fn(),
}));
const companies = [
  { id: 'a', name: 'Alpha', code: 'A' },
  { id: 'b', name: 'Beta', code: 'B' },
];
const sequence = {
  id: 'seq-1',
  sequenceCode: 'INV',
  entityType: 'Invoice',
  companyId: 'a',
  currentNumber: 7,
  prefix: 'INV-',
  suffix: '',
  padding: 5,
  resetFrequency: 'NEVER',
  isActive: true,
  updatedAt: '2026-09-17T00:00:00Z',
};
const profile = {
  registeredName: 'Alpha Limited',
  brelaRegNumber: 'TEST-BRELA',
  tin: 'TEST-TIN',
  registeredAddress: 'Test address',
};
beforeEach(() => {
  vi.clearAllMocks();
  state.permissions = new Set([
    'companies.read',
    'companies.update',
    'company-profiles.update',
    'branches.update',
    'doc_sequences.list',
    'doc_sequences.create',
    'doc_sequences.update',
  ]);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal('fetch', state.fetch);
  state.fetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => ({
      data: url.includes('/companies?') ? companies : { items: [sequence], total: 40 },
    }),
  }));
  state.page.mockResolvedValue({ data: companies, total: 2 });
  state.get.mockImplementation(async (url: string) => ({
    ...companies.find((company) => url.endsWith(company.id)),
    profile,
    divisions: [
      {
        id: 'division',
        branches: [
          { id: 'branch-a', name: 'Main', address: 'Main address' },
          { id: 'branch-b', name: 'Office', address: 'Office address' },
        ],
      },
    ],
  }));
  state.patch.mockResolvedValue({});
  state.put.mockResolvedValue({});
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
function numbers() {
  render(
    <UnsavedWorkProvider>
      <NumberSequencesPage />
    </UnsavedWorkProvider>,
  );
}
function identity() {
  render(
    <UnsavedWorkProvider>
      <CompanyProfilePage />
    </UnsavedWorkProvider>,
  );
}

describe('Business settings workspaces', () => {
  it('pages numbering rules and keeps advancing behind confirmation', async () => {
    const user = userEvent.setup();
    numbers();
    await user.click(await screen.findByRole('button', { name: 'Inspect INV' }));
    expect(screen.getByRole('complementary', { name: 'Record details' })).toHaveTextContent(
      'INV-00008',
    );
    await user.click(screen.getByRole('button', { name: 'Advance number' }));
    expect(screen.getByRole('dialog', { name: 'Advance Sequence' })).toHaveTextContent(
      'consumes the number',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.fetch.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(
        state.fetch.mock.calls.some(
          (call) => call[0].includes('page=2') && call[0].includes('limit=20'),
        ),
      ).toBe(true),
    );
  });
  it('hides numbering mutations without permissions', async () => {
    state.permissions = new Set(['doc_sequences.list']);
    const user = userEvent.setup();
    numbers();
    await user.click(await screen.findByRole('button', { name: 'Inspect INV' }));
    expect(screen.queryByRole('button', { name: 'New sequence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit sequence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Advance number' })).not.toBeInTheDocument();
  });
  it('protects numbering drafts and sends only mutable fields when editing', async () => {
    const user = userEvent.setup();
    numbers();
    await user.click(await screen.findByRole('button', { name: 'Inspect INV' }));
    await user.click(screen.getByRole('button', { name: 'Edit sequence' }));
    const editor = within(screen.getByRole('dialog', { name: 'Edit Sequence' }));
    expect(editor.getByLabelText(/Entity Type/)).toBeDisabled();
    expect(editor.getByLabelText('Company')).toBeDisabled();
    await user.clear(editor.getByLabelText('Prefix'));
    await user.type(editor.getByLabelText('Prefix'), 'NEW-');
    await user.click(editor.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(editor.getByLabelText('Prefix')).toHaveValue('NEW-');
    await user.click(editor.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(state.fetch.mock.calls.some((call) => call[1]?.method === 'PUT')).toBe(true),
    );
    const sent = state.fetch.mock.calls.find((call) => call[1]?.method === 'PUT');
    expect(JSON.parse(sent![1].body)).toEqual({
      prefix: 'NEW-',
      suffix: null,
      padding: 5,
      resetFrequency: 'NEVER',
      isActive: true,
    });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  it('protects company switching and preserves identity edits when a branch draft is discarded', async () => {
    const user = userEvent.setup();
    identity();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Alpha (A)' })).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: /^Company/ }), 'a');
    const name = await screen.findByLabelText(/Company Display Name/);
    await user.clear(name);
    await user.type(name, 'Alpha draft');
    await user.type(screen.getByLabelText('Branch Address'), ' edited');
    await user.selectOptions(screen.getByLabelText('Branch', { exact: true }), 'branch-b');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(name).toHaveValue('Alpha draft');
    expect(screen.getByLabelText('Branch Address')).toHaveValue('Office address');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Company/ }), 'b');
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(name).toHaveValue('Alpha draft');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Company/ }), 'b');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByLabelText(/Company Display Name/)).toHaveValue('Beta');
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('keeps identity inputs intact after a failed legal-profile save', async () => {
    const user = userEvent.setup();
    identity();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Alpha (A)' })).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: /^Company/ }), 'a');
    await user.type(await screen.findByLabelText(/Company Display Name/), ' draft');
    state.put.mockRejectedValueOnce(new Error('Profile save failed'));
    await user.click(screen.getByRole('button', { name: 'Save letterhead' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Profile save failed');
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(screen.getByLabelText(/Company Display Name/)).toHaveValue('Alpha draft');
  });
  it('shows saved feedback and clears protection only after all identity writes succeed', async () => {
    const user = userEvent.setup();
    identity();
    await screen.findByRole('option', { name: 'Alpha (A)' });
    await user.selectOptions(screen.getByRole('combobox', { name: /^Company/ }), 'a');
    await user.type(await screen.findByLabelText(/Company Display Name/), ' draft');
    await user.click(screen.getByRole('button', { name: 'Save letterhead' }));
    expect(await screen.findByText('Letterhead settings saved.')).toBeInTheDocument();
    expect(state.patch).toHaveBeenCalledWith(
      '/branches/branch-a',
      expect.objectContaining({ name: 'Main' }),
    );
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
