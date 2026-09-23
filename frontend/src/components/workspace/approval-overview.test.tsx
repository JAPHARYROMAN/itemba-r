import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalOverview } from './approval-overview';
import {
  approvalDestinations,
  controlIndicators,
  type ApprovalReadiness,
} from './approval-overview-types';
const state = vi.hoisted(() => ({ permissions: new Set<string>(), get: vi.fn(), page: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get, backendPage: state.page }));
const fixture: ApprovalReadiness = {
  score: 82,
  target: 90,
  status: 'WARNING',
  maturity: 'Workflow controls need owner review.',
  updatedAt: '2026-09-17T10:00:00Z',
  indicators: {
    activeWorkflows: 8,
    pendingRequests: 12,
    openDataQualityIssues: 3,
    ...Object.fromEntries(controlIndicators.map(([key], i) => [key, i + 1])),
  },
  checks: [
    {
      key: 'coverage',
      title: 'Workflow coverage',
      score: 75,
      status: 'WARNING',
      message: 'Two active workflows have no steps.',
      details: {
        activeWorkflows: 8,
        workflowsWithoutSteps: 2,
        activeSteps: 14,
        inactiveWorkflows: 1,
        extraEvidence: 'Full detail retained',
      },
    },
    {
      key: 'sla',
      title: 'Approval timeliness',
      score: 50,
      status: 'CRITICAL',
      message: 'Overdue requests need review.',
      details: { overdueRequests: 2 },
    },
    {
      key: 'trail',
      title: 'Action trail',
      score: 100,
      status: 'READY',
      message: 'Actions have recorded history.',
      details: {},
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  state.permissions = new Set([
    'approvals.dashboard.view',
    'approval_requests.view',
    'companies.read',
    ...approvalDestinations.map((d) => d.permission),
  ]);
  state.get.mockResolvedValue(fixture);
  state.page.mockResolvedValue({
    data: [
      { id: 'company', name: 'Example Company' },
      { id: 'other', name: 'Other Company' },
    ],
    total: 2,
  });
});
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const clone = document.body.cloneNode(true) as HTMLElement;
  document.querySelectorAll('select').forEach((s, i) =>
    Array.from(clone.querySelectorAll('select')[i].options).forEach((o) => {
      if (o.value === s.value) o.setAttribute('selected', '');
      else o.removeAttribute('selected');
    }),
  );
  writeFileSync(join(dir, name + '.html'), clone.innerHTML);
}
describe('Approval overview', () => {
  it.each(['approvals.dashboard.view', 'approval_requests.view'])(
    'requires %s without making reads',
    (permission) => {
      state.permissions.delete(permission);
      render(<ApprovalOverview />);
      expect(screen.getByText(/Your role needs approval overview/)).toBeInTheDocument();
      expect(state.get).not.toHaveBeenCalled();
      expect(state.page).not.toHaveBeenCalled();
    },
  );
  it('shows original diagnostics, every detail, accurate states and permitted destinations', async () => {
    const user = userEvent.setup();
    render(<ApprovalOverview />);
    const summary = await screen.findByRole('region', { name: 'Workflow readiness' });
    expect(within(summary).getByText('82%')).toBeInTheDocument();
    expect(within(summary).getByText('12')).toBeInTheDocument();
    expect(within(summary).getByText('Target 90%')).toBeInTheDocument();
    const controls = screen.getByRole('region', { name: 'Control indicators' });
    for (const [, label] of controlIndicators)
      expect(within(controls).getByText(label)).toBeInTheDocument();
    for (const d of approvalDestinations)
      expect(screen.getByRole('link', { name: new RegExp(d.label) })).toHaveAttribute(
        'href',
        d.href,
      );
    await user.click(screen.getByRole('button', { name: 'Inspect Workflow coverage' }));
    const inspector = screen.getByRole('complementary', { name: 'Record details' });
    expect(within(inspector).getByText('Full detail retained')).toBeInTheDocument();
    expect(within(inspector).getByText('Workflows without steps')).toBeInTheDocument();
    expect(within(inspector).getByText('Two active workflows have no steps.')).toBeInTheDocument();
    capture('approval-overview');
    await user.click(screen.getByRole('button', { name: 'Inspect Approval timeliness' }));
    expect(within(inspector).getByText('Action required')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Inspect Action trail' }));
    expect(within(inspector).getByText('Ready')).toBeInTheDocument();
    expect(within(inspector).getByText('No additional details.')).toBeInTheDocument();
  });
  it('does not read company choices or show destinations without their permission', async () => {
    state.permissions = new Set(['approvals.dashboard.view', 'approval_requests.view']);
    render(<ApprovalOverview />);
    await screen.findByRole('region', { name: 'Workflow readiness' });
    expect(screen.queryByRole('combobox', { name: 'Company' })).not.toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(state.get).toHaveBeenCalledWith(
      '/approvals/requests/readiness',
      expect.objectContaining({ query: { companyId: '' } }),
    );
  });

  it('moves focus into the phone inspector and returns it to the selected check', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const user = userEvent.setup();
    render(<ApprovalOverview />);
    const inspect = await screen.findByRole('button', { name: 'Inspect Workflow coverage' });
    inspect.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('complementary', { name: 'Record details' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Back to list' }));
    await vi.waitFor(() => expect(inspect).toHaveFocus());
  });
  it('clears old scope, aborts obsolete reads and refreshes the selected company', async () => {
    const user = userEvent.setup();
    render(<ApprovalOverview />);
    await screen.findByRole('region', { name: 'Workflow readiness' });
    let finish!: (data: ApprovalReadiness) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company' }), 'company');
    expect(screen.queryByRole('region', { name: 'Workflow readiness' })).not.toBeInTheDocument();
    const signal = state.get.mock.calls.at(-1)![1].signal;
    state.get.mockResolvedValue({ ...fixture, score: 95 });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company' }), 'other');
    expect(signal.aborted).toBe(true);
    await screen.findByText('95%');
    await act(async () => finish({ ...fixture, score: 1 }));
    expect(screen.queryByText('1%')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('95%');
    expect(state.get).toHaveBeenLastCalledWith(
      '/approvals/requests/readiness',
      expect.objectContaining({ query: { companyId: 'other' } }),
    );
  });
  it('shows failed requests without zero metrics and recovers through retry', async () => {
    const user = userEvent.setup();
    state.get.mockRejectedValueOnce(new Error('Service unavailable'));
    render(<ApprovalOverview />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    expect(screen.queryByRole('region', { name: 'Workflow readiness' })).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('82%');
    state.get.mockRejectedValueOnce(new Error('Refresh failed'));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh failed');
    expect(screen.queryByText('82%')).not.toBeInTheDocument();
  });
  it('retries choices, loads all pages and distinguishes empty checks from errors', async () => {
    const user = userEvent.setup();
    state.page.mockRejectedValueOnce(new Error('Choices offline'));
    state.get.mockResolvedValue({ ...fixture, checks: [], indicators: {}, updatedAt: 'invalid' });
    render(<ApprovalOverview />);
    await screen.findByText('No readiness checks were returned for this scope.');
    expect(screen.getByText('Last checked Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Company' })).toBeDisabled();
    state.page
      .mockResolvedValueOnce({ data: [{ id: 'one', name: 'First company' }], total: 2 })
      .mockResolvedValueOnce({ data: [{ id: 'two', name: 'Last company' }], total: 2 });
    await user.click(screen.getByRole('button', { name: 'Retry companies' }));
    await screen.findByRole('option', { name: 'Last company' });
    expect(state.page.mock.calls.at(-1)![1].query.page).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
