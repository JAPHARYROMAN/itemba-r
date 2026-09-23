import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AttendancePage from '@/app/(dashboard)/hr/attendance/page';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { setDateField } from '@/test/date-field';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  retry: vi.fn(),
  scopeError: '',
  router: { push: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator' },
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendPost: state.post,
  backendPut: state.put,
  backendPatch: state.patch,
}));
vi.mock('@/hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    companyOptions: [
      { value: 'company', label: 'Company' },
      { value: 'other', label: 'Other company' },
    ],
    employeeOptions: [{ value: 'employee', label: 'Alex Example' }],
    loading: false,
    error: state.scopeError,
    retry: state.retry,
  }),
}));
const record = {
  id: 'attendance',
  attendanceNumber: 'ATT-1',
  companyId: 'company',
  company: { name: 'Company' },
  employeeId: 'employee',
  employee: { fullName: 'Alex Example' },
  attendanceDate: '2026-09-17',
  clockInTime: '2026-09-17T08:00:12.123Z',
  clockOutTime: '2026-09-17T16:00:12.123Z',
  totalHours: 8,
  attendanceStatus: 'PRESENT',
  notes: 'Original note',
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'attendance.view',
    'attendance.create',
    'attendance.update',
    'attendance.approve',
  ]);
  state.scopeError = '';
  state.page.mockResolvedValue({ data: [record], total: 25 });
  state.post.mockResolvedValue({});
  state.put.mockResolvedValue({});
  state.patch.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
function mount() {
  render(
    <UnsavedWorkProvider>
      <AttendancePage />
    </UnsavedWorkProvider>,
  );
  return userEvent.setup();
}
async function edit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
  await user.click(screen.getByRole('button', { name: 'Edit attendance' }));
  await screen.findByRole('dialog', { name: 'Edit attendance' });
}
describe('Attendance workspace', () => {
  it('retains pagination and filters, resets search to page one and hides writes for readers', async () => {
    state.permissions = new Set(['attendance.view']);
    const user = mount();
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(state.page).toHaveBeenLastCalledWith(
        '/hr/attendance',
        expect.objectContaining({ query: expect.objectContaining({ page: 2, limit: 20 }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await setDateField('From date', '2026-09-01', user);
    await user.type(screen.getByRole('searchbox'), 'Alex');
    await waitFor(() =>
      expect(state.page).toHaveBeenLastCalledWith(
        '/hr/attendance',
        expect.objectContaining({
          query: expect.objectContaining({
            page: 1,
            search: 'Alex',
            companyId: 'company',
            dateFrom: '2026-09-01',
          }),
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Inspect Alex Example' }));
    expect(screen.queryByRole('button', { name: 'Log attendance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit attendance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve attendance' })).not.toBeInTheDocument();
  });
  it('preserves draft and exact existing timestamps on a notes-only failed/retried edit', async () => {
    state.put.mockRejectedValueOnce(new Error('Service unavailable'));
    const user = mount();
    await edit(user);
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    await user.clear(notes);
    await user.type(notes, 'Corrected note');
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(notes).toHaveValue('Corrected note');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(await screen.findByText('Service unavailable')).toBeInTheDocument();
    expect(state.put).toHaveBeenLastCalledWith('/hr/attendance/attendance', {
      notes: 'Corrected note',
    });
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(await screen.findByText('Attendance saved.')).toBeInTheDocument();
  });
  it('clears saved times with null when changing to absence', async () => {
    const user = mount();
    await edit(user);
    await user.selectOptions(screen.getByLabelText('Attendance status'), 'ABSENT');
    await setDateField('Clock-in', '');
    await setDateField('Clock-out', '');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() =>
      expect(state.put).toHaveBeenCalledWith('/hr/attendance/attendance', {
        attendanceStatus: 'ABSENT',
        clockInTime: null,
        clockOutTime: null,
      }),
    );
  });
  it('accepts overnight local times and submits explicit UTC instants', async () => {
    const user = mount();
    await user.click(screen.getByRole('button', { name: 'Log attendance' }));
    await screen.findByRole('dialog', { name: 'Log attendance' });
    await user.selectOptions(screen.getByLabelText(/Company\*/), 'company');
    await user.selectOptions(screen.getByLabelText(/Employee\*/), 'employee');
    await setDateField(/Attendance date/, '2026-09-17', user);
    await setDateField('Clock-in', '2026-09-17T22:00', user);
    await setDateField('Clock-out', '2026-09-18T06:00', user);
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/hr/attendance',
        expect.objectContaining({
          createdById: 'operator',
          attendanceDate: '2026-09-17',
          clockInTime: new Date('2026-09-17T22:00:00').toISOString(),
          clockOutTime: new Date('2026-09-18T06:00:00').toISOString(),
        }),
      ),
    );
  });
  it('rejects reverse intervals before submission', async () => {
    const user = mount();
    await edit(user);
    await setDateField('Clock-out', '2026-09-16T08:00', user);
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(await screen.findByText(/Clock-out must be after/)).toBeInTheDocument();
    expect(state.put).not.toHaveBeenCalled();
  });
  it('keeps approval failures in the named confirmation and permits retry', async () => {
    state.patch.mockRejectedValueOnce(new Error('Approval unavailable'));
    const user = mount();
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('button', { name: 'Approve attendance' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve attendance for Alex Example?' });
    await user.click(within(dialog).getByRole('button', { name: 'Approve attendance' }));
    expect(await within(dialog).findByText(/Approval unavailable/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Approve attendance' }));
    expect(state.patch).toHaveBeenLastCalledWith('/hr/attendance/attendance/approve', {});
    expect(await screen.findByText('Attendance approved.')).toBeInTheDocument();
  });
  it('shows lookup failure and blocks saving until choices recover', async () => {
    state.scopeError = 'Employee choices unavailable';
    const user = mount();
    await user.click(screen.getByRole('button', { name: 'Log attendance' }));
    await screen.findByRole('dialog', { name: 'Log attendance' });
    expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry choices' }));
    expect(state.retry).toHaveBeenCalled();
  });
});
