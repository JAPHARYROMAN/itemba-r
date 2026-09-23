import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompaniesWorkspace } from './companies-workspace';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  archive: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ loading: false, hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({ backendPage: state.page, backendDelete: state.archive }));
const company = {
  id: 'co-1',
  name: 'Example Company',
  code: 'EXAMPLE',
  status: 'ACTIVE',
  _count: { divisions: 2 },
};
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  state.permissions = new Set(['companies.read']);
  state.page.mockReset().mockResolvedValue({ data: [company], total: 1 });
  state.archive.mockReset().mockResolvedValue({});
});
describe('Companies workspace permissions and archive', () => {
  it('uses the backend read permission and keeps destructive actions out of a read-only workspace', async () => {
    const user = userEvent.setup();
    render(<CompaniesWorkspace />);
    await user.click(await screen.findByRole('button', { name: 'Inspect Example Company' }));
    expect(screen.getByRole('link', { name: 'Open company' })).toHaveAttribute(
      'href',
      '/companies/co-1',
    );
    expect(screen.queryByText('Archive company')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add company' })).not.toBeInTheDocument();
  });
  it('does not request company data without read access', () => {
    state.permissions.clear();
    render(<CompaniesWorkspace />);
    expect(state.page).not.toHaveBeenCalled();
    expect(screen.getByText('Permission required')).toBeInTheDocument();
  });
  it('requires the exact company code before archiving and refreshes afterward', async () => {
    state.permissions.add('companies.delete');
    const user = userEvent.setup();
    render(<CompaniesWorkspace />);
    await user.click(await screen.findByRole('button', { name: 'Inspect Example Company' }));
    await user.click(screen.getByRole('button', { name: 'Archive company' }));
    const dialog = screen.getByRole('dialog');
    const archive = within(dialog).getByRole('button', { name: 'Archive company' });
    expect(archive).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 'EXAMPLE');
    await user.click(archive);
    await waitFor(() => expect(state.archive).toHaveBeenCalledWith('/companies/co-1'));
    await waitFor(() => expect(state.page).toHaveBeenCalledTimes(2));
  });
});
