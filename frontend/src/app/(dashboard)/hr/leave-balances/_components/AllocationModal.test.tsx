import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AllocationModal, LeaveBalanceRecord } from './AllocationModal';

/**
 * Wave C3 frontend regression — AllocationModal contract.
 *
 * The modal is the only client-facing path for leave balance allocation.
 * Tests pin:
 *   - Required identity fields (company/employee/leave type/year) block submit
 *     with an inline error and no network call.
 *   - Save sends `POST /api/backend/hr/leave-balances` with the canonical
 *     upsert payload (numbers coerced, blank optionals omitted).
 *   - Adjust mode locks the identity from `initial` and posts it verbatim.
 *   - Backend errors surface as an alert, onSaved is NOT called.
 */

const COMPANIES = [
  { id: 'c-1', name: 'Itemba Holdings' },
  { id: 'c-2', name: 'Westsides' },
];

const EMPLOYEES = [
  { id: 'e-1', fullName: 'Alice Mkapa', employeeCode: 'EMP-001' },
  { id: 'e-2', fullName: 'Bob Nyerere', employeeCode: 'EMP-002' },
];

const LEAVE_TYPES = [
  { id: 'lt-1', name: 'Annual Leave', code: 'ANNUAL' },
  { id: 'lt-2', name: 'Sick Leave', code: 'SICK' },
];

const ADJUST_RECORD: LeaveBalanceRecord = {
  id: 'lb-1',
  companyId: 'c-9',
  employeeId: 'e-9',
  leaveTypeId: 'lt-9',
  year: 2025,
  allocatedDays: '21',
  carriedForwardDays: '2',
  usedDays: '4',
  notes: 'Carry over',
  company: { id: 'c-9', name: 'Itemba Holdings' },
  employee: { id: 'e-9', fullName: 'Alice Mkapa', employeeCode: 'EMP-001' },
  leaveType: { id: 'lt-9', name: 'Annual Leave', code: 'ANNUAL' },
};

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

let fetchMock: ReturnType<typeof vi.fn>;
let postResponse: ReturnType<typeof jsonResponse>;

function postCalls() {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
  );
}

beforeEach(() => {
  postResponse = jsonResponse({ success: true, data: { id: 'lb-1' } });
  fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === 'POST' && u.startsWith('/api/backend/hr/leave-balances')) {
      return postResponse;
    }
    if (u.startsWith('/api/backend/hr/employees')) {
      return jsonResponse({ success: true, data: { data: EMPLOYEES } });
    }
    if (u.startsWith('/api/backend/hr/leave-types')) {
      return jsonResponse({ success: true, data: { data: LEAVE_TYPES } });
    }
    return jsonResponse({ success: true, data: { data: [] } });
  });
  globalThis.fetch = fetchMock as any;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function fillCreateForm() {
  fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'c-1' } });
  await waitFor(() =>
    expect((screen.getByLabelText('Employee') as HTMLSelectElement).options.length).toBeGreaterThan(
      1,
    ),
  );
  fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'e-1' } });
  fireEvent.change(screen.getByLabelText('Leave Type'), { target: { value: 'lt-1' } });
  fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } });
}

describe('AllocationModal', () => {
  it('blocks submit with an inline error when required fields are missing', async () => {
    const onSaved = vi.fn();
    render(<AllocationModal companies={COMPANIES} onClose={() => {}} onSaved={onSaved} />);

    fireEvent.click(screen.getByText('Save'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Company, employee, leave type and year are required/);
    expect(postCalls()).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('POSTs the canonical upsert payload to /api/backend/hr/leave-balances', async () => {
    const onSaved = vi.fn();
    render(<AllocationModal companies={COMPANIES} onClose={() => {}} onSaved={onSaved} />);

    await fillCreateForm();
    fireEvent.change(screen.getByLabelText('Allocated Days'), { target: { value: '21' } });
    fireEvent.change(screen.getByLabelText('Carried Forward Days'), { target: { value: '3.5' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Initial allocation' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const [url, init] = postCalls()[0];
    expect(url).toBe('/api/backend/hr/leave-balances');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      companyId: 'c-1',
      employeeId: 'e-1',
      leaveTypeId: 'lt-1',
      year: 2026,
      allocatedDays: 21,
      carriedForwardDays: 3.5,
      notes: 'Initial allocation',
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('omits blank optional fields from the payload', async () => {
    render(<AllocationModal companies={COMPANIES} onClose={() => {}} onSaved={() => {}} />);

    await fillCreateForm();
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const [, init] = postCalls()[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      companyId: 'c-1',
      employeeId: 'e-1',
      leaveTypeId: 'lt-1',
      year: 2026,
    });
  });

  it('locks the identity in adjust mode and posts it from the initial record', async () => {
    const onSaved = vi.fn();
    render(
      <AllocationModal
        initial={ADJUST_RECORD}
        companies={COMPANIES}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );

    // Identity selectors are replaced by a read-only summary.
    expect(screen.queryByLabelText('Company')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Employee')).not.toBeInTheDocument();
    expect(screen.getByText('Alice Mkapa')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Allocated Days'), { target: { value: '25' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const [url, init] = postCalls()[0];
    expect(url).toBe('/api/backend/hr/leave-balances');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      companyId: 'c-9',
      employeeId: 'e-9',
      leaveTypeId: 'lt-9',
      year: 2025,
      allocatedDays: 25,
      carriedForwardDays: 2,
      notes: 'Carry over',
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('surfaces backend error messages inline and does not call onSaved', async () => {
    postResponse = jsonResponse(
      { message: 'Employee does not belong to this company' },
      false,
      400,
    );
    const onSaved = vi.fn();
    render(<AllocationModal companies={COMPANIES} onClose={() => {}} onSaved={onSaved} />);

    await fillCreateForm();
    fireEvent.click(screen.getByText('Save'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Employee does not belong to this company/);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
