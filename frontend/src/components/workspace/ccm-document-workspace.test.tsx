import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CcmDocumentWorkspace } from './ccm-document-workspace';
import type { CmaForm } from './cma-referral-document';
import type { Form1Payload } from './termination-document';
const state = vi.hoisted(() => ({ permissions: new Set<string>(), get: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get }));
const common = {
  formCode: 'Form 1',
  formName: 'Notice of Termination of Employment',
  formNameSwahili: 'Notisi ya Kusitisha Ajira',
  jurisdiction: 'Tanzania — Employment & Labour Relations Act, 2004',
  generatedAt: '2026-09-17T08:00:00Z',
  employer: {
    name: 'Example Company',
    tin: null,
    brelaRegNumber: null,
    registeredAddress: 'Example address for interface review',
    postalAddress: null,
  },
  employee: {
    employeeCode: 'EXAMPLE-01',
    fullName: 'Alex Example',
    nida: null,
    address: 'Synthetic address',
    phone: null,
    email: null,
  },
  disciplinaryHistoryIncluded: true,
  disciplinaryHistory: [
    {
      actionNumber: 'DA-EXAMPLE',
      type: 'WRITTEN_WARNING',
      issuedAt: '2026-09-01T00:00:00Z',
      reason: 'Synthetic disciplinary history for layout review. No live employment information.',
      status: 'ACTIVE',
    },
  ],
};
const termination: Form1Payload = {
  ...common,
  employee: {
    ...common.employee,
    passport: null,
    nationality: null,
    gender: 'UNSPECIFIED',
    dateOfBirth: null,
  },
  employment: {
    position: 'Example Coordinator',
    department: 'Operations',
    branch: 'Example Branch',
    location: null,
    hireDate: '2024-09-01T00:00:00Z',
    tenureMonths: 24,
    contractType: 'PERMANENT',
    baseSalary: 0,
    salaryCurrency: 'TZS',
  },
  operatorFields: [
    'Effective date of termination',
    'Reason for termination',
    'Notice period',
    'Final pay computation',
    'Severance pay',
    'Date employee notified',
    'Witness signature(s)',
  ],
};
const referral: CmaForm = {
  ...common,
  formCode: 'Form CMA-F1',
  formName: 'Referral of Dispute to CMA',
  formNameSwahili: 'Marejeo ya Mgogoro CMA',
  employee: {
    ...common.employee,
    position: 'Coordinator',
    department: 'Operations',
    hireDate: null,
    baseSalary: 0,
    salaryCurrency: 'TZS',
  },
  dispute: {
    disputeNumber: 'DIS-EXAMPLE',
    type: 'GRIEVANCE',
    status: 'CMA_REFERRED',
    raisedAt: '2026-09-01T00:00:00Z',
    summary: 'Synthetic case for interface review.\nSecond paragraph retained.',
    initialPosition: 'Synthetic initial position.',
    mediationOutcome: 'Synthetic mediation outcome.',
    cmaReferenceNumber: 'CMA-EXAMPLE',
    cmaArbitrator: 'Example Arbitrator',
    cmaHearingDate: '2026-10-01T00:00:00Z',
  },
  raisedBy: { fullName: 'Example Operator' },
  mediatedBy: { fullName: 'Example Mediator' },
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set(['employees.view', 'disciplinary_actions.view']);
  state.get.mockImplementation(async (path: string) =>
    path.includes('cma-referral') ? referral : termination,
  );
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
const mount = (kind: 'termination' | 'cma-referral' = 'termination', id = 'example') =>
  render(<CcmDocumentWorkspace id={id} kind={kind} />);
function capture(name: string) {
  const directory = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (directory) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, name + '.html'), document.body.innerHTML);
  }
}
describe('CCM document workspaces', () => {
  it.each(['termination', 'cma-referral'] as const)(
    'gates %s reads and printing by employee read permission',
    (kind) => {
      state.permissions.clear();
      mount(kind);
      expect(screen.getByText('Your role cannot view employment documents.')).toBeInTheDocument();
      expect(state.get).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Print / Save as PDF' })).not.toBeInTheDocument();
    },
  );
  it.each(['termination', 'cma-referral'] as const)(
    'retains retryable %s failures without rendering a broken document',
    async (kind) => {
      state.get.mockRejectedValueOnce(new Error('Document unavailable'));
      mount(kind);
      expect(await screen.findByRole('alert')).toHaveTextContent('Document unavailable');
      expect(screen.queryByRole('button', { name: 'Print / Save as PDF' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('button', { name: 'Print / Save as PDF' })).toBeEnabled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(state.get).toHaveBeenLastCalledWith(
        `/hr/ccm-notices/${kind}/example`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    },
  );
  it('renders bilingual termination details, blanks, history and signatures without changing employment', async () => {
    mount();
    await screen.findByRole('button', { name: 'Print / Save as PDF' });
    expect(screen.getByText('Notisi ya Kusitisha Ajira')).toBeInTheDocument();
    expect(screen.getByText('24 months')).toBeInTheDocument();
    expect(screen.getByText('TZS 0')).toBeInTheDocument();
    expect(screen.getByText('DA-EXAMPLE')).toBeInTheDocument();
    for (const field of termination.operatorFields)
      expect(screen.getByText(field + ':')).toBeInTheDocument();
    expect(
      screen.getByText('Employee acknowledgement / Uthibitisho wa mfanyakazi:'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to employee' })).toHaveAttribute(
      'href',
      '/hr/employees/example',
    );
    expect(screen.getByText(/does not terminate employment/)).toBeInTheDocument();
    capture('ccm-termination');
    fireEvent.click(screen.getByRole('button', { name: 'Print / Save as PDF' }));
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(state.get).toHaveBeenCalledTimes(1);
  });
  it('keeps signatures with the notice when disciplinary history overflows', async () => {
    state.get.mockResolvedValue({
      ...termination,
      disciplinaryHistory: Array.from({ length: 12 }, (_, index) => ({
        actionNumber: `DA-${index + 1}`,
        type: 'WRITTEN_WARNING',
        issuedAt: '2026-09-01T00:00:00Z',
        reason: 'Synthetic history for pagination review.',
        status: 'ACTIVE',
      })),
    });
    mount();
    await screen.findByRole('button', { name: 'Print / Save as PDF' });
    const first = document.querySelector('[data-ccm-sheet="1"]');
    const second = document.querySelector('[data-ccm-sheet="2"]');
    expect(second).toHaveTextContent('Employee acknowledgement');
    expect(second).toHaveTextContent('DA-12');
    expect(first).not.toHaveTextContent('Employee acknowledgement');
    for (let index = 1; index <= 12; index += 1) {
      expect(document.body.textContent).toContain(`DA-${index}`);
    }
  });
  it('retains referral content and operators while making the unfiled draft state clear', async () => {
    mount('cma-referral');
    await screen.findByRole('button', { name: 'Print / Save as PDF' });
    for (const text of [
      'Marejeo ya Mgogoro CMA',
      'CMA-EXAMPLE',
      'Synthetic initial position.',
      'Synthetic mediation outcome.',
      'Example Arbitrator',
    ])
      expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(/Recorded by Example Operator/)).toHaveTextContent('Example Mediator');
    expect(screen.getByText(/does not file a referral/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dispute' })).toHaveAttribute(
      'href',
      '/hr/disputes/example',
    );
    capture('ccm-referral');
    fireEvent.click(screen.getByRole('button', { name: 'Print / Save as PDF' }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });
  it('does not expose history from older responses when the viewer lacks disciplinary permission', async () => {
    state.permissions.delete('disciplinary_actions.view');
    mount();
    expect(
      await screen.findByText('Disciplinary history is not included for your access permissions.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('DA-EXAMPLE')).not.toBeInTheDocument();
  });
  it('cancels old requests and never displays one employee under another route', async () => {
    let finish!: (data: Form1Payload) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise<Form1Payload>((resolve) => {
          finish = resolve;
        }),
    );
    const view = mount();
    const signal = state.get.mock.calls[0][1].signal;
    view.rerender(<CcmDocumentWorkspace id="second" kind="termination" />);
    await screen.findByRole('button', { name: 'Print / Save as PDF' });
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish({ ...termination, employee: { ...termination.employee, fullName: 'Stale Person' } }),
    );
    await waitFor(() => expect(screen.queryByText(/Stale Person/)).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Back to employee' })).toHaveAttribute(
      'href',
      '/hr/employees/second',
    );
  });
});
