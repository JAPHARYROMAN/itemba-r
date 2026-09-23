import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MedicalExamWorkspace } from './medical-exam-workspace';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { setDateField } from '@/test/date-field';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  failEmployees: false,
  failList: false,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendPost: state.post,
  backendPatch: state.patch,
  backendDelete: state.remove,
}));
const record = {
  id: 'exam',
  companyId: 'company',
  company: { name: 'Example Company' },
  employeeId: 'employee',
  employee: {
    fullName: 'Alex Example',
    employeeCode: 'EXAMPLE-01',
    department: { name: 'Operations' },
    position: { title: 'Coordinator' },
  },
  examType: 'ANNUAL',
  fitnessStatus: 'FIT_WITH_RESTRICTIONS',
  examDate: '2026-09-01T06:30:00Z',
  expiresAt: '2027-09-01T06:30:00Z',
  hazardSector: true,
  doctorName: 'Example Practitioner',
  facilityName: 'Example Clinic',
  restrictions: 'Synthetic assessment note for layout review.',
  notes: 'Synthetic record; no live medical information.',
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set(['employees.view', 'employees.update']);
  state.failEmployees = false;
  state.failList = false;
  state.page.mockImplementation(async (path) => {
    if (path === '/companies')
      return {
        data: [
          { id: 'company', name: 'Example Company' },
          { id: 'other', name: 'Other Company' },
        ],
        total: 2,
      };
    if (path === '/hr/employees') {
      if (state.failEmployees) throw new Error('Employees unavailable');
      return {
        data: [{ id: 'employee', fullName: 'Alex Example', employeeCode: 'EXAMPLE-01' }],
        total: 1,
      };
    }
    if (state.failList) throw new Error('Examinations unavailable');
    return { data: [record], total: 21 };
  });
  state.post.mockResolvedValue({});
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
const mount = () =>
  render(
    <UnsavedWorkProvider>
      <MedicalExamWorkspace />
    </UnsavedWorkProvider>,
  );
async function inspect() {
  await userEvent.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
}
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name + '.html'), document.body.innerHTML);
  }
}
describe('Medical examination workspace', () => {
  it('gates reads and management actions by their actual permissions', async () => {
    state.permissions.clear();
    const view = mount();
    expect(screen.getByText('Your role cannot view medical examinations.')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    view.unmount();
    state.permissions.add('employees.view');
    mount();
    await inspect();
    expect(screen.queryByRole('button', { name: 'New examination' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit examination' })).not.toBeInTheDocument();
    expect(screen.getByText(record.restrictions)).toBeInTheDocument();
  });
  it('combines search, filters and pagination without treating the current page as a total', async () => {
    mount();
    await inspect();
    capture('medical-exam');
    await userEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/medical-exam-records',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    await userEvent.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await userEvent.selectOptions(screen.getByLabelText('Fitness filter'), 'FIT_WITH_RESTRICTIONS');
    await userEvent.selectOptions(screen.getByLabelText('Renewal filter'), '30');
    await userEvent.click(screen.getByLabelText('Hazard-sector only'));
    await userEvent.type(
      screen.getByPlaceholderText('Search employee, doctor or facility…'),
      ' Alex ',
    );
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/medical-exam-records',
        expect.objectContaining({
          query: {
            page: 1,
            limit: 20,
            search: 'Alex',
            companyId: 'company',
            fitnessStatus: 'FIT_WITH_RESTRICTIONS',
            expiringDays: '30',
            hazardOnly: 'true',
          },
        }),
      ),
    );
  });
  it('exposes read failures and retries', async () => {
    state.failList = true;
    mount();
    expect(await screen.findByText('Examinations unavailable')).toBeInTheDocument();
    state.failList = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await inspect();
  });
  it('keeps identity fixed, clears optional fields and preserves timestamps on failed edits and retry', async () => {
    mount();
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Edit examination' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit examination' });
    expect(within(dialog).queryByLabelText(/Company/)).not.toBeInTheDocument();
    for (const label of ['Doctor name', 'Facility', 'Restrictions', 'Notes'])
      await userEvent.clear(within(dialog).getByLabelText(label));
    state.patch.mockRejectedValueOnce(new Error('Save unavailable'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save examination' }));
    expect(await screen.findByText('Save unavailable')).toBeInTheDocument();
    expect(state.patch).toHaveBeenCalledWith('/hr/medical-exam-records/exam', {
      doctorName: null,
      facilityName: null,
      restrictions: null,
      notes: null,
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(within(dialog).getByLabelText('Doctor name')).toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save examination' }));
    expect(await screen.findByText('Examination saved.')).toBeInTheDocument();
  });
  it('rejects reversed dates before requesting a mutation', async () => {
    mount();
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Edit examination' }));
    await setDateField(/Expiry date/, '2025-01-01');
    await userEvent.click(screen.getByRole('button', { name: 'Save examination' }));
    expect(
      await screen.findByText('Choose an exam date and an expiry on or after it.'),
    ).toBeInTheDocument();
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('retries employee choices, resets company-dependent identity and sends a typed creation payload', async () => {
    state.failEmployees = true;
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'New examination' }));
    const dialog = screen.getByRole('dialog', { name: 'New examination' });
    await waitFor(() =>
      expect(
        within(dialog)
          .getByLabelText(/Company/)
          .querySelector('option[value="company"]'),
      ).toBeTruthy(),
    );
    await userEvent.selectOptions(within(dialog).getByLabelText(/Company/), 'company');
    expect(await screen.findByText('Employees unavailable')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save examination' })).toBeDisabled();
    state.failEmployees = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry employees' }));
    await waitFor(() => expect(within(dialog).getByLabelText(/Employee/)).toBeEnabled());
    await userEvent.selectOptions(within(dialog).getByLabelText(/Employee/), 'employee');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Company/), 'other');
    expect(within(dialog).getByLabelText(/Employee/)).toHaveValue('');
    await waitFor(() => expect(within(dialog).getByLabelText(/Employee/)).toBeEnabled());
    await userEvent.selectOptions(within(dialog).getByLabelText(/Employee/), 'employee');
    await setDateField(/Exam date/, '2026-09-01', userEvent, dialog);
    await setDateField(/Expiry date/, '2027-09-01', userEvent, dialog);
    await userEvent.click(within(dialog).getByLabelText('Hazard-sector employee'));
    capture('medical-exam-form');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save examination' }));
    expect(await screen.findByText('Examination saved.')).toBeInTheDocument();
    expect(state.post).toHaveBeenCalledWith('/hr/medical-exam-records', {
      companyId: 'other',
      employeeId: 'employee',
      examType: 'ANNUAL',
      fitnessStatus: 'FIT',
      examDate: '2026-09-01',
      expiresAt: '2027-09-01',
      hazardSector: true,
    });
  });
  it('names the record in deletion confirmation and retains failures for retry', async () => {
    mount();
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete examination?' });
    expect(within(dialog).getByText('Alex Example')).toBeInTheDocument();
    state.remove.mockRejectedValueOnce(new Error('Delete unavailable'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete examination' }));
    expect(await screen.findByText('Delete unavailable')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete examination' }));
    expect(await screen.findByText('Examination deleted.')).toBeInTheDocument();
  });
});
