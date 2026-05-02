import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RolesModal, RoleSummary, RolesModalUser } from './RolesModal';

/**
 * P0-07 frontend regression — RolesModal contract.
 *
 * The modal is the only client-facing path for role assignment. Tests pin:
 *   - Roles render grouped by scope.
 *   - Pre-selected roles are checkboxes-checked on open.
 *   - Toggling a checkbox changes selection state.
 *   - Save sends `PUT /api/backend/users/:id/roles` with `{ roleIds }`.
 *   - Backend errors surface as an alert, modal stays open, onSaved is NOT called.
 *   - Successful save calls onSaved and onClose in that order.
 */

const ROLES: RoleSummary[] = [
  { id: 'r-group-admin', name: 'GROUP_ADMIN', displayName: 'Group Admin', scope: 'GROUP' },
  { id: 'r-co-mgr', name: 'COMPANY_MANAGER', displayName: 'Company Manager', scope: 'COMPANY' },
  { id: 'r-co-user', name: 'COMPANY_USER', displayName: 'Company User', scope: 'COMPANY' },
  { id: 'r-branch', name: 'BRANCH_OPERATOR', displayName: 'Branch Operator', scope: 'BRANCH' },
];

const USER: RolesModalUser = {
  id: 'u-1',
  email: 'a@itemba.local',
  fullName: 'Alice',
  userRoles: [
    {
      role: {
        id: 'r-co-user',
        name: 'COMPANY_USER',
        displayName: 'Company User',
        scope: 'COMPANY',
      },
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as any;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RolesModal', () => {
  it('renders all roles grouped by scope', () => {
    render(
      <RolesModal user={USER} allRoles={ROLES} onClose={() => {}} onSaved={() => {}} />,
    );

    expect(screen.getByText(/GROUP scope/)).toBeInTheDocument();
    expect(screen.getByText(/COMPANY scope/)).toBeInTheDocument();
    expect(screen.getByText(/BRANCH scope/)).toBeInTheDocument();
    expect(screen.getByText('Group Admin')).toBeInTheDocument();
    expect(screen.getByText('Company Manager')).toBeInTheDocument();
    expect(screen.getByText('Company User')).toBeInTheDocument();
    expect(screen.getByText('Branch Operator')).toBeInTheDocument();
  });

  it('checks the boxes for already-assigned roles on open', () => {
    render(
      <RolesModal user={USER} allRoles={ROLES} onClose={() => {}} onSaved={() => {}} />,
    );

    const userBox = screen.getByLabelText('Company User') as HTMLInputElement;
    const mgrBox = screen.getByLabelText('Company Manager') as HTMLInputElement;
    expect(userBox.checked).toBe(true);
    expect(mgrBox.checked).toBe(false);
  });

  it('toggles selection when a checkbox is clicked', () => {
    render(
      <RolesModal user={USER} allRoles={ROLES} onClose={() => {}} onSaved={() => {}} />,
    );

    const mgrBox = screen.getByLabelText('Company Manager') as HTMLInputElement;
    fireEvent.click(mgrBox);
    expect(mgrBox.checked).toBe(true);

    fireEvent.click(mgrBox);
    expect(mgrBox.checked).toBe(false);
  });

  it('PUTs the canonical { roleIds } payload to /api/backend/users/:id/roles', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <RolesModal user={USER} allRoles={ROLES} onClose={onClose} onSaved={onSaved} />,
    );

    // Add Company Manager, keep Company User selected.
    fireEvent.click(screen.getByLabelText('Company Manager'));
    fireEvent.click(screen.getByText('Save Roles'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/backend/users/u-1/roles');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      roleIds: expect.arrayContaining(['r-co-user', 'r-co-mgr']),
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces backend error messages and keeps the modal open', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        message: 'Group-scoped roles can only be assigned by users holding a GROUP-scoped role',
      }),
    });
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <RolesModal user={USER} allRoles={ROLES} onClose={onClose} onSaved={onSaved} />,
    );

    fireEvent.click(screen.getByLabelText('Group Admin'));
    fireEvent.click(screen.getByText('Save Roles'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Group-scoped/);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends an empty array when all roles are deselected', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    render(
      <RolesModal user={USER} allRoles={ROLES} onClose={() => {}} onSaved={() => {}} />,
    );

    fireEvent.click(screen.getByLabelText('Company User'));
    fireEvent.click(screen.getByText('Save Roles'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ roleIds: [] });
  });

  it('shows a friendly message when the role catalog is empty', () => {
    render(
      <RolesModal user={USER} allRoles={[]} onClose={() => {}} onSaved={() => {}} />,
    );
    expect(screen.getByText(/No roles available/)).toBeInTheDocument();
  });
});
