import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalPortalProvider } from '@/components/ui/modal';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
} from '@/components/workspace/unsaved-work-provider';
import {
  WorkspaceLink,
  WorkspaceNavigationProvider,
  useWorkspacePathname,
} from '@/components/workspace/workspace-navigation';
import ScheduledReportsPage from './page';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  post: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  push: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (...codes: string[]) => codes.some((code) => state.permissions.has(code)),
    loading: false,
    user: {
      id: 'operator',
      companyId: 'company',
      permissions: ['scheduled_reports.manage', 'scheduled_reports.view'],
    },
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  usePathname: () => '/cash-desk',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  backendPage: state.page,
  backendPost: state.post,
  backendGet: state.get,
  backendPatch: state.patch,
}));

function View() {
  const path = useWorkspacePathname();
  return (
    <>
      <WorkspaceLink href="/reports">Reports home</WorkspaceLink>
      <WorkspaceLink href="/reports/scheduled">Open schedules</WorkspaceLink>
      {path === '/reports/scheduled' ? <ScheduledReportsPage /> : <h1>Reports home</h1>}
    </>
  );
}
function Harness() {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          <UnsavedWorkScope id="companion">
            <ModalPortalProvider>
              <WorkspaceNavigationProvider
                appId="reports"
                initialHref="/reports/scheduled"
                ownsPath={(path) => path.startsWith('/reports')}
              >
                <div data-testid="app-pane">
                  <View />
                </div>
              </WorkspaceNavigationProvider>
            </ModalPortalProvider>
          </UnsavedWorkScope>
        </WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.permissions = new Set(['scheduled_reports.view', 'scheduled_reports.manage']);
  state.page.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
  state.get.mockResolvedValue({
    companies: [{ id: 'company', name: 'Westsides' }],
    reports: [
      { id: 'report', name: 'Supplier aging', snapshotSupported: true },
      { id: 'unsupported', name: 'Custom analysis', snapshotSupported: false },
    ],
    canUseGroupScope: false,
    canUseSavedViews: true,
  });
  state.post.mockResolvedValue({ id: 'schedule' });
  state.patch.mockResolvedValue({ id: 'schedule' });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
describe('Scheduled reports in a companion app', () => {
  it('keeps a new named schedule across navigation and resumes without posting or running it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText('No scheduled reports yet');
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    await screen.findByRole('option', { name: 'Supplier aging' });
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Weekly supplier balances');
    await user.type(screen.getByRole('textbox', { name: 'Schedule code' }), 'SUPPLIERS-WEEKLY');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Report' }), 'report');
    await user.type(screen.getByRole('textbox', { name: 'Recipients' }), 'finance@example.com');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Frequency' }), 'WEEKLY');
    expect(
      screen.getByRole('option', { name: 'Custom analysis · manual export only' }),
    ).toBeDisabled();
    expect(screen.queryByLabelText('Report definition ID')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Reports home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and continue' }));
    await user.click(screen.getByRole('link', { name: 'Open schedules' }));
    await user.click(await screen.findByRole('button', { name: 'Resume New report schedule' }));
    await screen.findByRole('option', { name: 'Supplier aging' });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Weekly supplier balances');
    expect(screen.getByRole('combobox', { name: 'Company' })).toHaveValue('company');
    expect(screen.getByRole('combobox', { name: 'Frequency' })).toHaveValue('WEEKLY');
    expect(state.post).not.toHaveBeenCalled();
    state.post.mockRejectedValueOnce(new Error('Schedule service unavailable'));
    await user.click(screen.getByRole('button', { name: 'Create schedule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Schedule service unavailable');
    await user.click(screen.getByRole('button', { name: 'Create schedule' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New schedule' })).not.toBeInTheDocument(),
    );
    expect(state.post).toHaveBeenLastCalledWith(
      '/bi/scheduled-reports',
      expect.objectContaining({
        companyId: 'company',
        reportDefinitionId: 'report',
        frequency: 'WEEKLY',
        recipients: { emails: ['finance@example.com'] },
      }),
    );
    expect(screen.queryByLabelText('Unfinished drafts')).not.toBeInTheDocument();
  });
  it('reloads an edited schedule on resume and requires review when it changed', async () => {
    const record = {
      id: 'schedule',
      scheduleCode: 'BALANCES',
      name: 'Existing schedule',
      description: 'Old notes',
      reportDefinitionId: 'report',
      savedReportViewId: 'saved-view',
      companyId: 'company',
      frequency: 'WEEKLY',
      exportFormat: 'CSV',
      recipients: { emails: ['finance@example.com'] },
      isActive: true,
      updatedAt: 'version-one',
      lastRunAt: null,
    };
    const options = state.get.getMockImplementation()!;
    state.get.mockImplementation((path) =>
      path === '/bi/scheduled-reports/schedule'
        ? Promise.resolve({ ...record, updatedAt: 'version-two' })
        : options(path),
    );
    state.page.mockImplementation(async (path) => ({
      data:
        path === '/bi/scheduled-reports'
          ? [record]
          : [
              {
                id: 'saved-view',
                name: 'Supplier view',
                companyId: 'company',
                reportDefinitionId: 'report',
              },
            ],
      total: 1,
      page: 1,
      limit: 20,
    }));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Edit', exact: true }));
    await screen.findByRole('option', { name: 'Supplier view' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: '' },
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Linked saved view' }), '');
    await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Resume Edit report schedule' }));
    await screen.findByRole('checkbox');
    await screen.findByRole('option', { name: 'Supplier aging' });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(state.patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(state.patch).toHaveBeenCalledOnce());
    expect(state.patch).toHaveBeenCalledWith(
      '/bi/scheduled-reports/schedule',
      expect.objectContaining({ description: '', savedReportViewId: null }),
    );
    expect(state.get).toHaveBeenCalledWith(
      '/bi/scheduled-reports/schedule',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
  it('retains input when source choices fail and validates recipients and available company scope', async () => {
    const options = state.get.getMockImplementation()!;
    state.get.mockRejectedValueOnce(new Error('Choices offline'));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    await screen.findByRole('button', { name: 'Retry schedule choices' });
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Retain my schedule');
    state.get.mockImplementation(options);
    await user.click(screen.getByRole('button', { name: 'Retry schedule choices' }));
    await screen.findByRole('option', { name: 'Supplier aging' });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Retain my schedule');
    await user.type(screen.getByRole('textbox', { name: 'Schedule code' }), 'TEST');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Report' }), 'report');
    await user.type(screen.getByRole('textbox', { name: 'Recipients' }), 'not-an-email');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company' }), '');
    await user.click(screen.getByRole('button', { name: 'Create schedule' }));
    expect(screen.getByText('Choose an available company.')).toBeVisible();
    expect(screen.getByText(/Enter valid email addresses/)).toBeVisible();
    expect(state.post).not.toHaveBeenCalled();
  });
  it('places the editor outside the app pane and protects entered values on close and local navigation', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText('No scheduled reports yet');
    const opener = screen.getByRole('button', { name: 'New schedule' });
    await user.click(opener);
    const editor = screen.getByRole('dialog', { name: 'New schedule' });
    expect(screen.getByTestId('app-pane')).not.toContainElement(editor);
    await user.type(within(editor).getByRole('textbox', { name: 'Name' }), 'Weekly group report');
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(within(editor).getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Weekly group report',
    );
    await user.click(screen.getByRole('link', { name: 'Reports home' }));
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByRole('heading', { name: 'Reports home' })).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New schedule' })).not.toBeInTheDocument(),
    );
    expect(state.push).not.toHaveBeenCalled();
    expect(state.post).not.toHaveBeenCalled();
  });
  it('does not fetch schedules when the user lacks permission', () => {
    state.permissions = new Set(['cash_desk.view']);
    render(<Harness />);
    expect(screen.getByText('Access Restricted')).toBeVisible();
    expect(state.page).not.toHaveBeenCalled();
  });
});
