import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MsaidiziProcedure } from '@/lib/msaidizi-procedure-types';
import { MsaidiziProceduresWorkspace } from './msaidizi-procedures';

const h = vi.hoisted(() => ({
  list: vi.fn(),
  compile: vi.fn(),
  create: vi.fn(),
  activate: vi.fn(),
  archive: vi.fn(),
  hasPermission: vi.fn(),
  user: { id: 'user-1' } as { id: string } | null,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: h.hasPermission, user: h.user }),
}));

vi.mock('@/lib/msaidizi-procedures-client', () => ({
  listMsaidiziProcedures: h.list,
  compileMsaidiziProcedure: h.compile,
  createMsaidiziProcedure: h.create,
  activateMsaidiziProcedure: h.activate,
  archiveMsaidiziProcedure: h.archive,
}));

const procedure = (overrides: Partial<MsaidiziProcedure> = {}): MsaidiziProcedure => ({
  id: 'proc-1',
  companyId: null,
  name: 'Month-end supplier chase',
  instruction: 'List every unpaid supplier invoice older than 30 days.',
  capabilities: ['Suppliers_findAll', 'Invoices_findAll'],
  highestTier: 'green',
  status: 'DRAFT',
  version: 1,
  createdById: 'author-9',
  approvedById: null,
  approvedAt: null,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
  ...overrides,
});

describe('MsaidiziProceduresWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.user = { id: 'user-1' };
    h.hasPermission.mockReturnValue(true);
    h.list.mockResolvedValue([]);
  });

  it('shows a saved procedure with its status and blast radius', async () => {
    h.list.mockResolvedValue([procedure({ highestTier: 'red', status: 'ACTIVE' })]);

    render(<MsaidiziProceduresWorkspace />);

    expect(await screen.findByText('Month-end supplier chase')).toBeInTheDocument();
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(
      screen.getByText('List every unpaid supplier invoice older than 30 days.'),
    ).toBeInTheDocument();
  });

  /**
   * Maker-checker is the only review a procedure gets, so the author must not
   * be offered the button that would bypass it.
   */
  it('does not offer approval to the author of a draft', async () => {
    h.list.mockResolvedValue([procedure({ createdById: 'user-1' })]);

    render(<MsaidiziProceduresWorkspace />);

    expect(await screen.findByText('Month-end supplier chase')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByText(/somebody else has to approve it/i)).toBeInTheDocument();
  });

  it('offers approval on a draft somebody else wrote, and applies the result', async () => {
    h.list.mockResolvedValue([procedure()]);
    h.activate.mockResolvedValue(
      procedure({
        status: 'ACTIVE',
        approvedById: 'user-1',
        approvedAt: '2026-08-02T10:00:00.000Z',
      }),
    );

    render(<MsaidiziProceduresWorkspace />);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(h.activate).toHaveBeenCalledWith('proc-1'));
    expect(await screen.findByText(/Approved /)).toBeInTheDocument();
  });

  it('withholds the approve button from a reader without the permission', async () => {
    h.hasPermission.mockImplementation((perm: string) => perm !== 'msaidizi.procedures.approve');
    h.list.mockResolvedValue([procedure()]);

    render(<MsaidiziProceduresWorkspace />);

    expect(await screen.findByText('Month-end supplier chase')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('renders the server refusal rather than a generic failure', async () => {
    h.list.mockResolvedValue([procedure()]);
    h.activate.mockRejectedValue(
      new Error('A procedure must be approved by someone other than its author.'),
    );

    render(<MsaidiziProceduresWorkspace />);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(
      await screen.findByText('A procedure must be approved by someone other than its author.'),
    ).toBeInTheDocument();
  });

  /**
   * The compiled list belongs to the exact words that produced it. Editing the
   * instruction after compiling must retract it, or an author reviews one
   * capability set and saves another.
   */
  it('retracts a compiled capability list when the instruction changes', async () => {
    h.compile.mockResolvedValue({
      capabilities: ['Suppliers_findAll'],
      highestTier: 'green',
      preview: [
        {
          tool: 'Suppliers_findAll',
          description: 'List suppliers.',
          tier: 'green',
          path: '/suppliers',
        },
      ],
    });

    render(<MsaidiziProceduresWorkspace />);
    await userEvent.type(screen.getByLabelText('Instruction'), 'List suppliers we have not paid.');
    await userEvent.click(screen.getByRole('button', { name: 'Compile' }));

    expect(await screen.findByText('Suppliers_findAll')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Instruction'), ' Also include credit notes.');

    await waitFor(() => expect(screen.queryByText('Suppliers_findAll')).not.toBeInTheDocument());
  });

  it('saves the capability list that was compiled, not a recomputed one', async () => {
    h.compile.mockResolvedValue({
      capabilities: ['Suppliers_findAll', 'Invoices_findAll'],
      highestTier: 'amber',
      preview: [],
    });
    h.create.mockResolvedValue(procedure());

    render(<MsaidiziProceduresWorkspace />);
    await userEvent.type(screen.getByLabelText('Name'), 'Supplier chase');
    await userEvent.type(screen.getByLabelText('Instruction'), 'Chase unpaid suppliers.');
    await userEvent.click(screen.getByRole('button', { name: 'Compile' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save as draft' }));

    await waitFor(() =>
      expect(h.create).toHaveBeenCalledWith({
        name: 'Supplier chase',
        instruction: 'Chase unpaid suppliers.',
        capabilities: ['Suppliers_findAll', 'Invoices_findAll'],
      }),
    );
  });

  it('hides the author form from a reader who may only view', async () => {
    h.hasPermission.mockImplementation((perm: string) => perm !== 'msaidizi.procedures.manage');
    h.list.mockResolvedValue([procedure()]);

    render(<MsaidiziProceduresWorkspace />);

    expect(await screen.findByText('Month-end supplier chase')).toBeInTheDocument();
    expect(screen.queryByLabelText('Instruction')).not.toBeInTheDocument();
  });

  it('reports a listing failure instead of showing an empty library', async () => {
    h.list.mockRejectedValue(new Error('Service unavailable.'));

    render(<MsaidiziProceduresWorkspace />);

    expect(await screen.findByText('Service unavailable.')).toBeInTheDocument();
    expect(screen.queryByText(/No procedures yet/)).not.toBeInTheDocument();
  });
});
