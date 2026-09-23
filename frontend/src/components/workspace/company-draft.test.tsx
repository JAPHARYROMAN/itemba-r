import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import NewCompanyPage from '@/app/(dashboard)/companies/new/page';
import { UnsavedWorkProvider } from './unsaved-work-provider';
const state = vi.hoisted(() => ({ router: { push: vi.fn() }, post: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('@/hooks/use-auth', () => {
  const hasPermission = () => true;
  return { useAuth: () => ({ hasPermission }) };
});
vi.mock('@/lib/api-client', () => ({
  backendGet: vi.fn().mockResolvedValue([{ id: 'group-1', name: 'Test Group', code: 'TEST' }]),
  backendPost: state.post,
}));
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
it('keeps an actual Company draft after a failed save and navigates after successful persistence', async () => {
  const user = userEvent.setup();
  state.post
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce({ id: 'saved-company' });
  render(
    <UnsavedWorkProvider>
      <NewCompanyPage />
    </UnsavedWorkProvider>,
  );
  await waitFor(() => expect(screen.getByLabelText(/Group/)).not.toBeDisabled());
  await user.type(screen.getByRole('textbox', { name: 'Company Name' }), 'Test Company');
  await user.type(screen.getByRole('textbox', { name: 'Company Code' }), 'TESTCO');
  await user.click(screen.getByRole('button', { name: 'Create Company' }));
  expect(await screen.findByText('Connection lost')).toBeVisible();
  await user.click(screen.getByRole('link', { name: 'Back to Companies' }));
  expect(screen.getByRole('dialog', { name: 'Keep your changes?' })).toBeVisible();
  await user.click(screen.getByText('Stay here'));
  expect(screen.getByRole('textbox', { name: 'Company Name' })).toHaveValue('Test Company');
  await user.click(screen.getByRole('button', { name: 'Create Company' }));
  await waitFor(() => expect(state.router.push).toHaveBeenCalledWith('/companies/saved-company'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
