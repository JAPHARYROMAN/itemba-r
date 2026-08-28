import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  MsaidiziDevice,
  MsaidiziMandate,
  MsaidiziMemory,
  MsaidiziPairingCode,
  MsaidiziRecoveryCommand,
  MsaidiziSchedule,
  MsaidiziTask,
  MsaidiziTaskEvent,
} from '@/lib/msaidizi-task-types';
import { MsaidiziTaskCenter, MsaidiziWorkspacePlaceholder } from './msaidizi-task-center';

const h = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  events: vi.fn(),
  watchEvents: vi.fn(),
  plan: vi.fn(),
  propose: vi.fn(),
  createDraft: vi.fn(),
  create: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  replan: vi.fn(),
  listMandates: vi.fn(),
  createMandate: vi.fn(),
  activateMandate: vi.fn(),
  suspendMandate: vi.fn(),
  revokeMandate: vi.fn(),
  listSchedules: vi.fn(),
  fetchSchedule: vi.fn(),
  listScheduleVersions: vi.fn(),
  fetchScheduleVersion: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  activateSchedule: vi.fn(),
  pauseSchedule: vi.fn(),
  archiveSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  listMemories: vi.fn(),
  fetchMemory: vi.fn(),
  createMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  listDevices: vi.fn(),
  createPairing: vi.fn(),
  revokeDevice: vi.fn(),
  killDevice: vi.fn(),
  killAllDevices: vi.fn(),
  listRecoveries: vi.fn(),
  recoveryDetail: vi.fn(),
  requestRecovery: vi.fn(),
  uploadArtifact: vi.fn(),
  safetyStatus: vi.fn(),
  disableAutopilot: vi.fn(),
  enableAutopilot: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: h.hasPermission }),
}));

vi.mock('@/lib/msaidizi-tasks-client', () => ({
  listMsaidiziTasks: h.list,
  fetchMsaidiziTask: h.detail,
  fetchMsaidiziTaskEvents: h.events,
  watchMsaidiziTaskEvents: h.watchEvents,
  planMsaidiziTask: h.plan,
  proposeMsaidiziTask: h.propose,
  createMsaidiziTaskDraft: h.createDraft,
  createMsaidiziTask: h.create,
  pauseMsaidiziTask: h.pause,
  resumeMsaidiziTask: h.resume,
  cancelMsaidiziTask: h.cancel,
  replanMsaidiziTask: h.replan,
  listMsaidiziMandates: h.listMandates,
  createMsaidiziMandate: h.createMandate,
  activateMsaidiziMandate: h.activateMandate,
  suspendMsaidiziMandate: h.suspendMandate,
  revokeMsaidiziMandate: h.revokeMandate,
  listMsaidiziSchedules: h.listSchedules,
  fetchMsaidiziSchedule: h.fetchSchedule,
  listMsaidiziScheduleVersions: h.listScheduleVersions,
  fetchMsaidiziScheduleVersion: h.fetchScheduleVersion,
  createMsaidiziSchedule: h.createSchedule,
  updateMsaidiziSchedule: h.updateSchedule,
  activateMsaidiziSchedule: h.activateSchedule,
  pauseMsaidiziSchedule: h.pauseSchedule,
  archiveMsaidiziSchedule: h.archiveSchedule,
  deleteMsaidiziSchedule: h.deleteSchedule,
  listMsaidiziMemories: h.listMemories,
  fetchMsaidiziMemory: h.fetchMemory,
  createMsaidiziMemory: h.createMemory,
  updateMsaidiziMemory: h.updateMemory,
  deleteMsaidiziMemory: h.deleteMemory,
  listMsaidiziDevices: h.listDevices,
  createMsaidiziPairingCode: h.createPairing,
  revokeMsaidiziDevice: h.revokeDevice,
  killMsaidiziDevice: h.killDevice,
  killAllMsaidiziDevices: h.killAllDevices,
  listMsaidiziRecoveryCommands: h.listRecoveries,
  fetchMsaidiziRecoveryCommand: h.recoveryDetail,
  requestMsaidiziRecoveryCommand: h.requestRecovery,
  uploadMsaidiziArtifact: h.uploadArtifact,
  getMsaidiziSafetyStatus: h.safetyStatus,
  disableMsaidiziAutopilot: h.disableAutopilot,
  enableMsaidiziAutopilot: h.enableAutopilot,
  msaidiziArtifactDownloadUrl: (id: string) =>
    `/api/backend/msaidizi/artifacts/${encodeURIComponent(id)}/download`,
}));

const TASK: MsaidiziTask = {
  id: 'task-1',
  principalId: 'principal-1',
  initiatedByUserId: 'user-1',
  companyId: null,
  mandateId: null,
  scheduleId: null,
  mode: 'COLLABORATIVE',
  title: 'Close daily spending report',
  objective: 'Prepare and review the spending report.',
  status: 'READY',
  activePlanVersion: 1,
  stateVersion: 1,
  hostExecutionAllowed: false,
  maxWallTimeSeconds: 7200,
  maxModelTurns: 200,
  maxAttemptedToolCalls: 500,
  maxMutations: 100,
  maxLocalBytes: '5368709120',
  maxExternalEgressBytes: '262144000',
  maxModelCostUsd: '20.0000',
  modelTurns: 0,
  attemptedToolCalls: 0,
  executedToolCalls: 0,
  mutations: 0,
  inputTokens: '0',
  outputTokens: '0',
  modelCostUsd: '0.0000',
  bytesRead: '0',
  bytesWritten: '0',
  externalEgressBytes: '0',
  consumedWallTimeMs: '0',
  wallTimeCheckpointAt: null,
  statusDetail: null,
  failureCode: null,
  queuedAt: null,
  startedAt: null,
  lastCheckpointAt: null,
  pauseRequestedAt: null,
  cancelRequestedAt: null,
  endedAt: null,
  createdAt: '2026-08-25T08:00:00.000Z',
  updatedAt: '2026-08-25T08:00:00.000Z',
  planVersions: [
    {
      id: 'plan-1',
      taskId: 'task-1',
      version: 1,
      summary: 'Read expenses and prepare a report.',
      objective: 'Prepare and review the spending report.',
      inputs: {},
      stopConditions: {},
      budgetSnapshot: {},
      planDigest: 'digest',
      createdAt: '2026-08-25T08:00:00.000Z',
      steps: [
        {
          id: 'step-1',
          taskId: 'task-1',
          planVersionId: 'plan-1',
          sequence: 1,
          stepKey: 'read-expenses',
          name: 'Read expenses',
          target: 'ERP',
          capability: 'Expenses_findAll',
          capabilityVersion: '1',
          arguments: {},
          dependsOn: [],
          inputBindings: [],
          expectedEffect: 'READ',
          dataClass: 'internal',
          preconditions: {},
          recovery: null,
          budgets: {},
          stopConditions: {},
          idempotent: true,
          mutation: false,
          status: 'PENDING',
          attemptCount: 0,
          startedAt: null,
          checkpointedAt: null,
          endedAt: null,
          createdAt: '2026-08-25T08:00:00.000Z',
          updatedAt: '2026-08-25T08:00:00.000Z',
        },
      ],
    },
  ],
};

const DRAFT_TASK: MsaidiziTask = {
  ...TASK,
  id: '33333333-3333-4333-8333-333333333333',
  companyId: 'company-1',
  title: 'Review the ledger',
  objective: 'Review the ledger',
  status: 'PLANNING',
  activePlanVersion: 0,
  stateVersion: 0,
  planVersions: [],
  artifacts: [],
};

const MANDATE: MsaidiziMandate = {
  id: 'mandate-1',
  principalId: 'principal-1',
  companyId: 'company-1',
  createdByUserId: 'user-1',
  name: 'Daily finance review',
  description: 'Review finance records.',
  status: 'DRAFT',
  version: 3,
  capabilities: [
    { capability: 'ExpensesController.findAll', effects: ['READ'], dataClasses: ['internal'] },
  ],
  deviceIds: [],
  budgets: {},
  startsAt: null,
  expiresAt: null,
  activatedAt: null,
  revokedAt: null,
  createdAt: '2026-08-25T08:00:00.000Z',
  updatedAt: '2026-08-25T08:00:00.000Z',
};

const SCHEDULE: MsaidiziSchedule = {
  id: 'schedule-1',
  principalId: 'principal-1',
  mandateId: MANDATE.id,
  createdByUserId: 'user-1',
  name: 'Morning review',
  status: 'DRAFT',
  version: 1,
  cronExpression: '0 8 * * *',
  timezone: 'Africa/Nairobi',
  taskTemplate: { title: 'Morning review', objective: 'Review expenses', steps: [] },
  concurrencyMode: 'SKIP',
  nextRunAt: null,
  lastRunAt: null,
  createdAt: '2026-08-25T08:00:00.000Z',
  updatedAt: '2026-08-25T08:00:00.000Z',
  mandate: {
    id: MANDATE.id,
    companyId: MANDATE.companyId,
    status: MANDATE.status,
    version: MANDATE.version,
    startsAt: null,
    expiresAt: null,
  },
};

const MEMORY: MsaidiziMemory = {
  id: 'memory-1',
  companyId: 'company-1',
  sourceTaskId: null,
  kind: 'SEMANTIC',
  scopeKey: 'supplier-preferences',
  metadata: {},
  trustLevel: 'UNTRUSTED',
  sourceProvenance: {
    sourceType: 'USER',
    capturedAt: '2026-08-25T08:00:00.000Z',
  },
  contentDigest: 'digest',
  expiresAt: null,
  createdAt: '2026-08-25T08:00:00.000Z',
  updatedAt: '2026-08-25T08:00:00.000Z',
};

const DEVICE: MsaidiziDevice = {
  id: 'device-1',
  name: 'Finance workstation',
  status: 'ACTIVE',
  platform: 'WINDOWS',
  osVersion: '11.0.26100',
  architecture: 'x64',
  certificateThumbprint: '0123456789abcdef0123456789abcdef',
  capabilityManifest: {
    protocolVersion: 1,
    capabilities: [{ id: 'filesystem.read', version: '2.1.0' }],
    runtime: {
      component: 'Itemba.Companion.Service',
      componentVersion: '0.4.0',
      executionEnabled: true,
      killSwitchEngaged: false,
      centralLedgerConnected: true,
      runningActionCount: 0,
      journalSequence: 42,
      manifestMatches: true,
      receivedAt: '2026-08-25T08:04:00.000Z',
    },
  },
  pairedAt: '2026-08-24T08:00:00.000Z',
  lastSeenAt: '2026-08-25T08:04:00.000Z',
  revokedAt: null,
  killedAt: null,
  createdAt: '2026-08-24T08:00:00.000Z',
  updatedAt: '2026-08-25T08:04:00.000Z',
};

const PAIRING: MsaidiziPairingCode = {
  id: 'device-pending',
  name: 'Warehouse tablet',
  status: 'PENDING',
  createdAt: '2026-08-25T08:00:00.000Z',
  pairingCode: 'PAIR-SECRET-1234',
  expiresAt: '2099-08-25T08:05:00.000Z',
};

const RECOVERY: MsaidiziRecoveryCommand = {
  id: '33333333-3333-4333-8333-333333333333',
  hostActionId: '44444444-4444-4444-8444-444444444444',
  deviceId: DEVICE.id,
  requestedByUserId: 'user-operator-1',
  originalActionId: 'action-restore-1',
  recoveryRecordSha256: 'a'.repeat(64),
  expectedCurrentStateSha256: 'b'.repeat(64),
  status: 'SUCCEEDED',
  manifestSha256: 'c'.repeat(64),
  signingKeyId: 'recovery-signing-key-1',
  dispatchCount: 1,
  resultSummary: {
    outcome: 'SUCCEEDED',
    manifestSha256: 'c'.repeat(64),
    journalHeadSha256: 'd'.repeat(64),
    restoredStateSha256: 'e'.repeat(64),
    deviceId: DEVICE.id,
    receivedAt: '2026-08-25T08:05:00.000Z',
  },
  supervisorJournalHead: 'd'.repeat(64),
  queuedAt: '2026-08-25T08:01:00.000Z',
  dispatchedAt: '2026-08-25T08:02:00.000Z',
  startedAt: '2026-08-25T08:03:00.000Z',
  completedAt: '2026-08-25T08:05:00.000Z',
  createdAt: '2026-08-25T08:01:00.000Z',
  updatedAt: '2026-08-25T08:05:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.hasPermission.mockReturnValue(true);
  h.list.mockResolvedValue({ data: [TASK], meta: { page: 1, limit: 30, total: 1 } });
  h.detail.mockResolvedValue(TASK);
  h.events.mockResolvedValue({ data: [], nextCursor: '0', hasMore: false });
  h.watchEvents.mockResolvedValue(undefined);
  h.createDraft.mockResolvedValue(DRAFT_TASK);
  h.listMandates.mockResolvedValue({ items: [MANDATE], total: 1, page: 1, limit: 100 });
  h.listSchedules.mockResolvedValue({ items: [SCHEDULE], total: 1, page: 1, limit: 100 });
  h.fetchSchedule.mockResolvedValue(SCHEDULE);
  h.listScheduleVersions.mockResolvedValue([]);
  h.fetchScheduleVersion.mockResolvedValue({});
  h.listMemories.mockResolvedValue({ items: [MEMORY], total: 1, page: 1, limit: 100 });
  h.fetchMemory.mockResolvedValue({
    ...MEMORY,
    content: 'Use the saved supplier preference.',
  });
  h.listDevices.mockResolvedValue({ items: [DEVICE], total: 1 });
  h.listRecoveries.mockResolvedValue([]);
  h.recoveryDetail.mockResolvedValue(RECOVERY);
  h.uploadArtifact.mockResolvedValue({
    id: 'artifact-uploaded',
    stepId: null,
    kind: 'DOCUMENT',
    name: 'context.txt',
    mimeType: 'text/plain',
    sha256: 'a'.repeat(64),
    byteSize: '7',
    encrypted: true,
    dataClass: 'internal',
    trustLevel: 'UNTRUSTED',
    provenance: { sourceType: 'USER' },
    createdAt: '2026-08-25T08:00:00.000Z',
  });
  h.safetyStatus.mockResolvedValue({
    operatorLatch: 'ACTIVE',
    effectiveAutopilotEnabled: true,
    deploymentAutonomyEnabled: true,
    deploymentAutopilotEnabled: true,
    externalKillSwitchActive: false,
    lastChangedAt: '2026-08-25T08:00:00.000Z',
    activeSchedules: 1,
    readyTasks: 1,
    queuedTasks: 0,
    runningTasks: 0,
    pausingTasks: 0,
    pausedTasks: 0,
  });
});

describe('Msaidizi autonomy control-plane workspaces', () => {
  it('creates drafts without escalation and activates a mandate only after an explicit click', async () => {
    h.createMandate.mockResolvedValue({ ...MANDATE, id: 'mandate-2', name: 'Sales review' });
    h.activateMandate.mockResolvedValue({ ...MANDATE, status: 'ACTIVE', version: 4 });
    render(<MsaidiziWorkspacePlaceholder workspace="routines" />);

    expect(await screen.findByText('Daily finance review')).toBeInTheDocument();
    expect(h.activateMandate).not.toHaveBeenCalled();

    const form = screen.getByRole('form', { name: 'Create mandate draft' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Sales review');
    await userEvent.type(within(form).getByLabelText('Purpose'), 'Review sales each day.');
    await userEvent.type(within(form).getByLabelText('Capability'), 'SalesController.findAll');
    await userEvent.click(within(form).getByRole('button', { name: 'Save mandate draft' }));

    await waitFor(() =>
      expect(h.createMandate).toHaveBeenCalledWith({
        name: 'Sales review',
        description: 'Review sales each day.',
        capabilities: [
          {
            capability: 'SalesController.findAll',
            effects: ['READ'],
            dataClasses: ['internal'],
          },
        ],
        deviceIds: [],
        budgets: {},
      }),
    );
    expect(await screen.findByText(/has not been activated/i)).toBeInTheDocument();

    const originalMandate = screen.getByText('Daily finance review').closest('li');
    expect(originalMandate).not.toBeNull();
    await userEvent.click(
      within(originalMandate as HTMLLIElement).getByRole('button', {
        name: 'Activate mandate',
      }),
    );
    await waitFor(() => expect(h.activateMandate).toHaveBeenCalledWith('mandate-1', 3));
  });

  it('adds emergency-operator consent only through the explicit irreversible mandate control', async () => {
    h.createMandate.mockResolvedValue({ ...MANDATE, id: 'mandate-3', name: 'Permanent cleanup' });
    render(<MsaidiziWorkspacePlaceholder workspace="routines" />);
    await screen.findByText('Daily finance review');

    const form = screen.getByRole('form', { name: 'Create mandate draft' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Permanent cleanup');
    await userEvent.type(within(form).getByLabelText('Purpose'), 'Remove an approved quarantine.');
    await userEvent.type(within(form).getByLabelText('Capability'), 'filesystem.delete.permanent');
    await userEvent.selectOptions(within(form).getByLabelText('Allowed effect'), 'IRREVERSIBLE');
    await userEvent.click(
      within(form).getByRole('checkbox', { name: 'Authorize emergency operator consent' }),
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Save mandate draft' }));

    await waitFor(() =>
      expect(h.createMandate).toHaveBeenCalledWith(
        expect.objectContaining({
          capabilities: [
            expect.objectContaining({
              capability: 'filesystem.delete.permanent',
              effects: ['IRREVERSIBLE'],
              consentGrants: ['emergency_operator'],
            }),
          ],
        }),
      ),
    );
  });

  it('creates a routine draft but does not activate it implicitly', async () => {
    h.createSchedule.mockResolvedValue({ ...SCHEDULE, id: 'schedule-2', name: 'Close books' });
    h.archiveSchedule.mockResolvedValue({ ...SCHEDULE, status: 'ARCHIVED', version: 2 });
    render(<MsaidiziWorkspacePlaceholder workspace="routines" />);
    await screen.findByText('Daily finance review');

    const form = screen.getByRole('form', { name: 'Create routine draft' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Close books');
    await userEvent.click(within(form).getByRole('button', { name: 'Save routine draft' }));

    await waitFor(() =>
      expect(h.createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          mandateId: 'mandate-1',
          name: 'Close books',
          cronExpression: '0 8 * * *',
          timezone: 'Africa/Nairobi',
          concurrencyMode: 'SKIP',
          taskTemplate: { title: '', objective: '', steps: [] },
        }),
      ),
    );
    expect(h.activateSchedule).not.toHaveBeenCalled();
    expect(await screen.findByText(/No scheduled work has been activated/i)).toBeInTheDocument();

    const originalRoutine = screen.getByText('Morning review').closest('li');
    expect(originalRoutine).not.toBeNull();
    await userEvent.click(
      within(originalRoutine as HTMLLIElement).getByRole('button', {
        name: 'Open routine',
      }),
    );
    expect(await screen.findByRole('form', { name: 'Edit routine' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Archive routine' }));
    expect(h.archiveSchedule).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));
    await waitFor(() => expect(h.archiveSchedule).toHaveBeenCalledWith('schedule-1', 1));
  });

  it('lets the server own memory provenance and exposes only a deliberate soft delete', async () => {
    h.listMemories.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 });
    h.createMemory.mockResolvedValue({
      ...MEMORY,
      scopeKey: 'finance-policy',
      content: 'Password removed.',
      redactionsApplied: true,
    });
    h.fetchMemory.mockResolvedValue({
      ...MEMORY,
      scopeKey: 'finance-policy',
      content: 'Password removed.',
    });
    h.deleteMemory.mockResolvedValue({ id: MEMORY.id, deleted: true });
    render(<MsaidiziWorkspacePlaceholder workspace="memory" />);

    const form = screen.getByRole('form', { name: 'Create governed memory' });
    await userEvent.type(within(form).getByLabelText('Scope key'), 'finance-policy');
    await userEvent.type(
      within(form).getByLabelText('Content'),
      'Password appears here and must be handled by the server.',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Encrypt and store memory' }));

    await waitFor(() =>
      expect(h.createMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'SEMANTIC',
          scopeKey: 'finance-policy',
          metadata: {},
        }),
      ),
    );
    expect(within(form).queryByLabelText('Source')).not.toBeInTheDocument();
    expect(within(form).queryByLabelText('Trust')).not.toBeInTheDocument();
    expect(await screen.findByText(/credentials were removed/i)).toBeInTheDocument();

    expect(h.fetchMemory).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Open memory' }));
    expect(await screen.findByRole('form', { name: 'Edit governed memory' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Delete memory' }));
    expect(h.deleteMemory).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete memory' }));
    await waitFor(() => expect(h.deleteMemory).toHaveBeenCalledWith('memory-1'));
  });

  it('lists and refreshes companion health without causing a device mutation', async () => {
    render(<MsaidiziWorkspacePlaceholder workspace="devices" />);

    expect(await screen.findByText('Finance workstation')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('Itemba.Companion.Service 0.4.0')).toBeInTheDocument();
    expect(screen.getByText('filesystem.read@2.1.0')).toBeInTheDocument();
    expect(h.createPairing).not.toHaveBeenCalled();
    expect(h.revokeDevice).not.toHaveBeenCalled();
    expect(h.killDevice).not.toHaveBeenCalled();
    expect(h.killAllDevices).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Refresh devices' }));
    await waitFor(() => expect(h.listDevices).toHaveBeenCalledTimes(2));
  });

  it('visibly focuses the exact incident device without issuing a control action', async () => {
    const focusedDevice = {
      ...DEVICE,
      id: '22222222-2222-4222-8222-222222222222',
    };
    h.listDevices.mockResolvedValue({ items: [DEVICE, focusedDevice], total: 2 });

    render(<MsaidiziWorkspacePlaceholder workspace="devices" focusedDeviceId={focusedDevice.id} />);

    const focusedCard = await screen.findByText('Opened incident');
    const listItem = focusedCard.closest('li');
    expect(listItem).toHaveAttribute('aria-current', 'true');
    expect(listItem).toHaveAttribute('data-focused-device', 'true');
    await waitFor(() => expect(listItem).toHaveFocus());
    expect(h.createPairing).not.toHaveBeenCalled();
    expect(h.revokeDevice).not.toHaveBeenCalled();
    expect(h.killDevice).not.toHaveBeenCalled();
    expect(h.killAllDevices).not.toHaveBeenCalled();
  });

  it('opens an exact trusted recovery record with GET-only ledger evidence', async () => {
    h.listRecoveries.mockResolvedValue([]);
    h.recoveryDetail.mockResolvedValue(RECOVERY);

    render(
      <MsaidiziWorkspacePlaceholder
        workspace="devices"
        focusedDeviceId={DEVICE.id}
        focusedRecoveryId={RECOVERY.id}
      />,
    );

    const focusedLabel = await screen.findByText('Opened recovery record');
    const record = focusedLabel.closest('li');
    expect(record).toHaveAttribute('aria-current', 'true');
    expect(record).toHaveAttribute('data-focused-recovery', 'true');
    await waitFor(() => expect(record).toHaveFocus());
    expect(
      within(record as HTMLLIElement).getByText(new RegExp(RECOVERY.originalActionId)),
    ).toBeInTheDocument();
    expect(
      within(record as HTMLLIElement).getByText(RECOVERY.recoveryRecordSha256),
    ).toBeInTheDocument();
    expect(
      within(record as HTMLLIElement).getAllByText(RECOVERY.manifestSha256).length,
    ).toBeGreaterThan(0);
    expect(
      within(record as HTMLLIElement).getAllByText(RECOVERY.supervisorJournalHead as string).length,
    ).toBeGreaterThan(0);
    expect(within(record as HTMLLIElement).getByText(/TRUSTED_SUPERVISOR/)).toBeInTheDocument();
    expect(h.listRecoveries).toHaveBeenCalledTimes(1);
    expect(h.recoveryDetail).toHaveBeenCalledWith(RECOVERY.id);
    expect(h.requestRecovery).not.toHaveBeenCalled();
    expect(h.createPairing).not.toHaveBeenCalled();
    expect(h.revokeDevice).not.toHaveBeenCalled();
    expect(h.killDevice).not.toHaveBeenCalled();
    expect(h.killAllDevices).not.toHaveBeenCalled();
  });

  it('requires the exact administrative digest-bound phrase before recovery authorization', async () => {
    const digest = 'f'.repeat(64);
    const hostActionId = '55555555-5555-4555-8555-555555555555';
    const originalActionId = 'action-admin-7';
    const phrase = `RESTORE ${originalActionId} AT ${digest}`;
    h.requestRecovery.mockResolvedValue({
      ...RECOVERY,
      id: '66666666-6666-4666-8666-666666666666',
      hostActionId,
      originalActionId,
      expectedCurrentStateSha256: digest,
      status: 'QUEUED',
      dispatchCount: 0,
      resultSummary: null,
      supervisorJournalHead: null,
      dispatchedAt: null,
      startedAt: null,
      completedAt: null,
    });

    render(<MsaidiziWorkspacePlaceholder workspace="devices" />);
    const form = screen.getByRole('form', { name: 'Authorize trusted recovery' });
    fireEvent.change(within(form).getByLabelText('Recovery kind'), {
      target: { value: 'ADMINISTRATIVE' },
    });
    fireEvent.change(within(form).getByLabelText(/Host action record ID/), {
      target: { value: hostActionId },
    });
    fireEvent.change(within(form).getByLabelText(/Original action ID/), {
      target: { value: originalActionId },
    });
    fireEvent.change(within(form).getByLabelText(/Expected current-state SHA-256/), {
      target: { value: digest },
    });

    const authorize = within(form).getByRole('button', { name: 'Authorize exact recovery' });
    expect(authorize).toBeDisabled();
    expect(h.requestRecovery).not.toHaveBeenCalled();
    const phraseInput = within(form).getByLabelText('Exact confirmation phrase');
    // Cryptographic identifiers are commonly pasted. A single change event also
    // keeps this regression deterministic under the full parallel Vitest suite.
    fireEvent.change(phraseInput, { target: { value: phrase.slice(0, -1) } });
    expect(authorize).toBeDisabled();
    expect(h.requestRecovery).not.toHaveBeenCalled();
    fireEvent.change(phraseInput, { target: { value: phrase } });
    expect(authorize).toBeEnabled();

    await userEvent.click(authorize);
    await waitFor(() =>
      expect(h.requestRecovery).toHaveBeenCalledWith({
        hostActionId,
        expectedCurrentStateSha256: digest,
        confirmationPhrase: phrase,
      }),
    );
    expect(h.requestRecovery).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/was authorized and queued/i)).toBeInTheDocument();
  });

  it('keeps a one-time pairing code in the mounted view only and lets the operator dismiss it', async () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
    h.createPairing.mockResolvedValue(PAIRING);
    render(<MsaidiziWorkspacePlaceholder workspace="devices" />);
    await screen.findByText('Finance workstation');

    const form = screen.getByRole('form', { name: 'Create device pairing code' });
    await userEvent.type(within(form).getByLabelText('Device name'), 'Warehouse tablet');
    await userEvent.click(within(form).getByRole('button', { name: 'Create pairing code' }));

    await waitFor(() => expect(h.createPairing).toHaveBeenCalledWith('Warehouse tablet'));
    expect(await screen.findByLabelText('One-time pairing code')).toHaveTextContent(
      'PAIR-SECRET-1234',
    );
    expect(storageSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss pairing code' }));
    expect(screen.queryByText('PAIR-SECRET-1234')).not.toBeInTheDocument();
    storageSpy.mockRestore();
  });

  it('requires explicit confirmation before revoking or killing a device', async () => {
    h.revokeDevice.mockResolvedValue({ id: DEVICE.id, status: 'REVOKED' });
    h.killDevice.mockResolvedValue({ id: DEVICE.id, status: 'KILLED' });
    render(<MsaidiziWorkspacePlaceholder workspace="devices" />);
    await screen.findByText('Finance workstation');

    await userEvent.click(screen.getByRole('button', { name: 'Revoke enrollment' }));
    expect(h.revokeDevice).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Confirm enrollment revocation for Finance workstation',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(h.revokeDevice).toHaveBeenCalledWith('device-1'));

    await userEvent.click(screen.getByRole('button', { name: 'Emergency kill' }));
    expect(h.killDevice).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Confirm emergency kill for Finance workstation',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm emergency kill' }));
    await waitFor(() => expect(h.killDevice).toHaveBeenCalledWith('device-1'));
  });

  it('requires the global emergency phrase before issuing kill-all', async () => {
    h.killAllDevices.mockResolvedValue({ killed: 1 });
    render(<MsaidiziWorkspacePlaceholder workspace="devices" />);
    await screen.findByText('Finance workstation');

    await userEvent.click(screen.getByRole('button', { name: 'Emergency stop all devices' }));
    const dialog = screen.getByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm emergency kill' });
    expect(confirm).toBeDisabled();
    expect(h.killAllDevices).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText('Type KILL ALL to continue'), 'KILL ALL');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(h.killAllDevices).toHaveBeenCalledTimes(1));
  });
});

describe('MsaidiziTaskCenter', () => {
  it('fetches and selects an exact deep-linked task even when it is outside the list page', async () => {
    const exactTask = {
      ...TASK,
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Incident task outside page one',
    };
    h.list.mockResolvedValue({ data: [TASK], meta: { page: 1, limit: 30, total: 31 } });
    h.detail.mockImplementation(async (id: string) => (id === exactTask.id ? exactTask : TASK));

    render(<MsaidiziTaskCenter initialTaskId={exactTask.id} />);

    expect(await screen.findByRole('heading', { name: exactTask.title })).toBeInTheDocument();
    expect(h.detail).toHaveBeenCalledWith(exactTask.id);
    expect(h.events).toHaveBeenCalledWith(exactTask.id);
    const selectedTask = screen.getByRole('button', { name: new RegExp(exactTask.title) });
    expect(selectedTask).toHaveAttribute('aria-current', 'true');
    expect(h.create).not.toHaveBeenCalled();
    expect(h.pause).not.toHaveBeenCalled();
    expect(h.resume).not.toHaveBeenCalled();
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it('starts SSE after the initial page cursor, deduplicates races, and aborts on unmount', async () => {
    const initialEvent: MsaidiziTaskEvent = {
      cursor: '5',
      taskId: TASK.id,
      type: 'task.created',
      actorType: 'USER',
      actorId: 'user-1',
      payload: {},
      createdAt: '2026-08-25T08:00:00.000Z',
      integrityVersion: 1,
      previousHash: '0'.repeat(64),
      eventHash: '1'.repeat(64),
    };
    const liveEvent: MsaidiziTaskEvent = {
      ...initialEvent,
      cursor: '6',
      type: 'task.queued',
      actorType: 'MSAIDIZI',
      createdAt: '2026-08-25T08:01:00.000Z',
    };
    h.events.mockResolvedValue({ data: [initialEvent], nextCursor: '5', hasMore: false });
    let watched:
      | {
          signal: AbortSignal;
          after?: string;
          onCursor: (cursor: string) => void;
          onTransportChange: (transport: 'stream' | 'polling') => void;
          onEvents: (events: MsaidiziTaskEvent[], cursor: string) => void;
        }
      | undefined;
    h.watchEvents.mockImplementation(
      async (
        _taskId: string,
        options: {
          signal: AbortSignal;
          after?: string;
          onCursor: (cursor: string) => void;
          onTransportChange: (transport: 'stream' | 'polling') => void;
          onEvents: (events: MsaidiziTaskEvent[], cursor: string) => void;
        },
      ) => {
        watched = options;
        await new Promise<void>((resolve) =>
          options.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      },
    );

    const view = render(<MsaidiziTaskCenter />);
    await waitFor(() => expect(h.watchEvents).toHaveBeenCalledTimes(1));
    expect(h.watchEvents).toHaveBeenCalledWith(
      TASK.id,
      expect.objectContaining({ after: '5', signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByRole('status', { name: 'Task timeline connection' })).toHaveTextContent(
      'Connecting · resume after cursor 5',
    );

    act(() => {
      watched?.onTransportChange('polling');
      watched?.onEvents([initialEvent, liveEvent, liveEvent], '6');
      watched?.onCursor('6');
    });

    const timeline = await screen.findByRole('list', { name: 'Task timeline' });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(2);
    expect(within(timeline).getByText('task · created')).toBeInTheDocument();
    expect(within(timeline).getByText('task · queued')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Task timeline connection' })).toHaveTextContent(
      'Polling fallback · cursor 6',
    );

    act(() => watched?.onTransportChange('stream'));
    expect(screen.getByRole('status', { name: 'Task timeline connection' })).toHaveTextContent(
      'Live stream · cursor 6',
    );

    view.unmount();
    expect(watched?.signal.aborted).toBe(true);
  });

  it('names the active step and last durable checkpoint', async () => {
    const checkpoint = '2026-08-25T08:01:30.000Z';
    const runningTask: MsaidiziTask = {
      ...TASK,
      status: 'RUNNING',
      startedAt: '2026-08-25T08:01:00.000Z',
      lastCheckpointAt: checkpoint,
      planVersions: TASK.planVersions?.map((plan) => ({
        ...plan,
        steps: plan.steps.map((step) => ({ ...step, status: 'RUNNING' as const })),
      })),
    };
    h.list.mockResolvedValue({ data: [runningTask], meta: { page: 1, limit: 30, total: 1 } });
    h.detail.mockResolvedValue(runningTask);

    render(<MsaidiziTaskCenter />);

    const detail = await screen.findByRole('region', { name: 'Task detail' });
    expect(within(detail).getByText('1. Read expenses · Running')).toBeInTheDocument();
    expect(within(detail).getByText(new Date(checkpoint).toLocaleString())).toBeInTheDocument();
  });

  it('renders persisted elapsed wall time and its immutable ceiling quantitatively', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-25T08:01:05.000Z'));
    const pausedTask: MsaidiziTask = {
      ...TASK,
      status: 'PAUSED',
      startedAt: '2026-08-25T08:00:00.000Z',
      consumedWallTimeMs: '60000',
      wallTimeCheckpointAt: '2026-08-25T08:01:00.000Z',
    };
    h.list.mockResolvedValue({ data: [pausedTask], meta: { page: 1, limit: 30, total: 1 } });
    h.detail.mockResolvedValue(pausedTask);

    try {
      render(<MsaidiziTaskCenter />);
      const detail = await screen.findByRole('region', { name: 'Task detail' });
      expect(within(detail).getByText('1m 5s of 2h 0m 0s')).toBeInTheDocument();
      expect(within(detail).getByText('1m 5s / 2h 0m 0s')).toBeInTheDocument();
      expect(within(detail).queryByText('running / 7200s')).not.toBeInTheDocument();
    } finally {
      now.mockRestore();
    }
  });

  it('refreshes the durable task snapshot after live events and closes a terminal stream', async () => {
    const completedTask: MsaidiziTask = {
      ...TASK,
      status: 'COMPLETED',
      stateVersion: 2,
      executedToolCalls: 1,
      endedAt: '2026-08-25T08:02:00.000Z',
      updatedAt: '2026-08-25T08:02:00.000Z',
    };
    const terminalEvent: MsaidiziTaskEvent = {
      cursor: '7',
      taskId: TASK.id,
      type: 'task.status_changed',
      actorType: 'MSAIDIZI',
      actorId: 'principal-1',
      payload: { from: 'RUNNING', to: 'COMPLETED' },
      createdAt: '2026-08-25T08:02:00.000Z',
      integrityVersion: 1,
      previousHash: '1'.repeat(64),
      eventHash: '2'.repeat(64),
    };
    h.detail.mockResolvedValueOnce(TASK).mockResolvedValueOnce(completedTask);
    let watched:
      | {
          signal: AbortSignal;
          onEvents: (events: MsaidiziTaskEvent[], cursor: string) => void;
        }
      | undefined;
    h.watchEvents.mockImplementation(
      async (
        _taskId: string,
        options: {
          signal: AbortSignal;
          onEvents: (events: MsaidiziTaskEvent[], cursor: string) => void;
        },
      ) => {
        watched = options;
        await new Promise<void>((resolve) =>
          options.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      },
    );

    render(<MsaidiziTaskCenter />);
    await waitFor(() => expect(watched).toBeDefined());

    act(() => watched?.onEvents([terminalEvent], terminalEvent.cursor));

    await waitFor(() => expect(h.detail).toHaveBeenCalledTimes(2));
    expect(
      within(screen.getByRole('region', { name: 'Task detail' })).getByText('Completed'),
    ).toBeInTheDocument();
    expect(watched?.signal.aborted).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'Pause after current step' }),
    ).not.toBeInTheDocument();
  });

  it('does not open an endless event stream for an already terminal task', async () => {
    const failedTask: MsaidiziTask = {
      ...TASK,
      status: 'FAILED',
      endedAt: '2026-08-25T08:02:00.000Z',
    };
    h.list.mockResolvedValue({ data: [failedTask], meta: { page: 1, limit: 30, total: 1 } });
    h.detail.mockResolvedValue(failedTask);

    render(<MsaidiziTaskCenter />);

    expect(await screen.findByRole('heading', { name: failedTask.title })).toBeInTheDocument();
    await waitFor(() => expect(h.events).toHaveBeenCalledWith(failedTask.id));
    expect(h.watchEvents).not.toHaveBeenCalled();
  });

  it('aborts the previous task stream before watching a newly selected task', async () => {
    const secondTask: MsaidiziTask = {
      ...TASK,
      id: 'task-2',
      title: 'Second durable task',
    };
    h.list.mockResolvedValue({
      data: [TASK, secondTask],
      meta: { page: 1, limit: 30, total: 2 },
    });
    h.detail.mockImplementation(async (id: string) => (id === secondTask.id ? secondTask : TASK));
    const signals = new Map<string, AbortSignal>();
    h.watchEvents.mockImplementation(async (taskId: string, options: { signal: AbortSignal }) => {
      signals.set(taskId, options.signal);
      await new Promise<void>((resolve) =>
        options.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
    });

    const view = render(<MsaidiziTaskCenter />);
    await waitFor(() => expect(signals.has(TASK.id)).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: new RegExp(secondTask.title) }));
    await waitFor(() => expect(signals.has(secondTask.id)).toBe(true));

    expect(signals.get(TASK.id)?.aborted).toBe(true);
    expect(signals.get(secondTask.id)?.aborted).toBe(false);
    view.unmount();
    expect(signals.get(secondTask.id)?.aborted).toBe(true);
  });

  it('uses one durable draft ID for typed text, local dictation, a document, and its proposal', async () => {
    let currentDraft = DRAFT_TASK;
    h.createDraft.mockImplementation(async (request: { objective: string }) => {
      currentDraft = { ...DRAFT_TASK, objective: request.objective, title: request.objective };
      return currentDraft;
    });
    h.detail.mockImplementation(async (id: string) =>
      id === currentDraft.id ? currentDraft : TASK,
    );
    window.SpeechRecognition = PlannerLocalRecognition as never;
    h.propose.mockImplementation(async (request: { taskId: string; objective: string }) => ({
      status: 'PROPOSED',
      draftTaskId: request.taskId,
      proposalDigest: 'c'.repeat(64),
      proposalUsageReceipt: {
        id: '22222222-2222-4222-8222-222222222222',
        expiresAt: '2026-08-29T08:00:00.000Z',
        modelTurns: 1,
        inputTokens: '10',
        outputTokens: '10',
        estimatedCostUsd: '0.001000',
        oneUse: true,
      },
      persisted: false,
      queued: false,
      executed: false,
      plan: {
        taskId: request.taskId,
        title: 'Review governed context',
        objective: request.objective,
        summary: 'Read only the governed context.',
        mode: 'COLLABORATIVE',
        companyId: 'company-1',
        inputs: {},
        stopConditions: {},
        budgets: {
          maxWallTimeSeconds: 60,
          maxModelTurns: 5,
          maxAttemptedToolCalls: 5,
          maxMutations: 0,
          maxLocalBytes: 1024,
          maxExternalEgressBytes: 0,
          maxModelCostUsd: 1,
        },
        steps: [
          {
            key: 'read-context',
            name: 'Read governed context',
            target: 'ERP',
            capability: 'ExpensesController.findAll',
            capabilityVersion: '1',
            arguments: { path: {}, query: {} },
            dependsOn: [],
            inputBindings: [],
            expectedEffect: 'READ',
            dataClass: 'internal',
            preconditions: {},
            recovery: null,
            budgets: {},
            stopConditions: {},
            idempotent: true,
            mutation: false,
          },
        ],
      },
      provenance: {
        callerPermissionFiltered: true,
        mandateId: null,
        deviceIds: [],
        memories: [],
        artifacts: [],
        untrustedEnrichmentUsed: true,
        redactionsAppliedBeforeReasoning: false,
      },
      policy: { allowed: true, violations: [], checks: [] },
      critique: { acceptable: true, issues: [] },
      outcome: {
        proposedOnly: true,
        stepCount: 1,
        readCount: 1,
        mutationCount: 0,
        externalActionCount: 0,
        irreversibleActionCount: 0,
        recoveryCoverage: 1,
        highestRisk: 'READ',
        stopConditionsDeclared: false,
      },
      reasoningUsage: {},
    }));

    render(<MsaidiziTaskCenter />);
    await screen.findByText(TASK.title);
    await userEvent.type(screen.getByLabelText('Objective'), 'Typed request. ');
    await userEvent.click(screen.getByRole('button', { name: 'Dictate objective on this device' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Objective')).toHaveValue('Typed request. Review the ledger'),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Start governed draft for attachments' }),
    );

    await waitFor(() =>
      expect(h.createDraft).toHaveBeenCalledWith({
        objective: 'Typed request. Review the ledger',
        mode: 'COLLABORATIVE',
      }),
    );
    expect(await screen.findByText(/Draft 33333333 is the durable owner/)).toBeInTheDocument();

    const file = new File(['context'], 'context.txt', { type: 'text/plain' });
    await userEvent.upload(screen.getByLabelText('Attach file or document'), file);
    await waitFor(() =>
      expect(h.uploadArtifact).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: currentDraft.id, file, kind: 'DOCUMENT' }),
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Generate governed proposal' }));
    await waitFor(() =>
      expect(h.propose).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: currentDraft.id,
          objective: currentDraft.objective,
          artifactIds: ['artifact-uploaded'],
        }),
      ),
    );
    expect(await screen.findByText(/generated for draft 33333333/i)).toBeInTheDocument();
    delete window.SpeechRecognition;
  });

  it('keeps an AI-generated multimodal proposal review-only until explicit save', async () => {
    const sourceTask: MsaidiziTask = {
      ...DRAFT_TASK,
      title: 'Review receipt',
      objective: 'Review receipt',
      mandateId: 'mandate-1',
      artifacts: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          stepId: null,
          kind: 'SCREENSHOT',
          name: 'receipt.png',
          mimeType: 'image/png',
          sha256: 'a'.repeat(64),
          byteSize: '128',
          encrypted: true,
          dataClass: 'confidential',
          trustLevel: 'UNTRUSTED',
          provenance: { sourceType: 'SCREEN' },
          createdAt: '2026-08-25T08:00:00.000Z',
        },
      ],
    };
    h.list.mockResolvedValue({ data: [sourceTask], meta: { page: 1, limit: 30, total: 1 } });
    h.detail.mockResolvedValue(sourceTask);
    h.propose.mockResolvedValue({
      status: 'PROPOSED',
      draftTaskId: sourceTask.id,
      proposalDigest: 'b'.repeat(64),
      proposalUsageReceipt: {
        id: '22222222-2222-4222-8222-222222222222',
        expiresAt: '2026-08-27T08:00:00.000Z',
        modelTurns: 1,
        inputTokens: '100',
        outputTokens: '50',
        estimatedCostUsd: '0.010500',
        oneUse: true,
      },
      persisted: false,
      queued: false,
      executed: false,
      plan: {
        taskId: sourceTask.id,
        title: 'Review receipt',
        objective: 'Review receipt',
        summary: 'Review the receipt and send the approved exception summary.',
        mode: 'COLLABORATIVE',
        companyId: 'company-1',
        mandateId: 'mandate-1',
        inputs: { reportingPeriod: '2026-08' },
        stopConditions: { onFailure: 'stop' },
        budgets: {
          maxWallTimeSeconds: 900,
          maxModelTurns: 12,
          maxAttemptedToolCalls: 20,
          maxMutations: 1,
          maxLocalBytes: 1048576,
          maxExternalEgressBytes: 2048,
          maxModelCostUsd: 2,
        },
        steps: [
          {
            key: 'read-expenses',
            name: 'Read expenses',
            target: 'ERP',
            capability: 'ExpensesController.findAll',
            capabilityVersion: '1',
            arguments: { path: {}, query: { reportingPeriod: null } },
            dependsOn: [],
            inputBindings: [
              {
                targetPath: '/query/reportingPeriod',
                source: { kind: 'PLAN_INPUT', path: '/reportingPeriod' },
                dataClass: 'internal',
                expectedType: 'string',
                expectedSchema: { type: 'string', minLength: 7, maxLength: 7 },
                transform: { name: 'IDENTITY', version: '1' },
              },
            ],
            expectedEffect: 'READ',
            dataClass: 'internal',
            preconditions: {},
            recovery: null,
            budgets: {},
            stopConditions: { after: 1 },
            idempotent: true,
            mutation: false,
          },
          {
            key: 'send-summary',
            name: 'Send approved exception summary',
            target: 'HOST',
            capability: 'email.send',
            capabilityVersion: '1',
            arguments: { recipientRef: 'finance-reviewers' },
            dependsOn: ['read-expenses'],
            inputBindings: [],
            expectedEffect: 'EXTERNAL',
            dataClass: 'confidential',
            preconditions: { deviceId: 'device-1' },
            recovery: { strategy: 'recall-message' },
            budgets: { maxExternalEgressBytes: 2048 },
            stopConditions: { onFailure: 'stop' },
            idempotent: false,
            mutation: true,
          },
        ],
      },
      provenance: {
        callerPermissionFiltered: true,
        mandateId: 'mandate-1',
        deviceIds: ['device-1'],
        memories: [],
        artifacts: [],
        untrustedEnrichmentUsed: true,
        redactionsAppliedBeforeReasoning: false,
      },
      policy: {
        allowed: true,
        violations: [],
        checks: ['caller permissions', 'mandate scope', 'budget ceilings'],
      },
      critique: {
        acceptable: true,
        issues: [
          {
            code: 'EXTERNAL_DESTINATION_REVIEW',
            severity: 'WARNING',
            message: 'Confirm the configured reviewer group.',
            stepKey: 'send-summary',
          },
        ],
      },
      outcome: {
        proposedOnly: true,
        stepCount: 2,
        readCount: 1,
        mutationCount: 1,
        externalActionCount: 1,
        irreversibleActionCount: 0,
        recoveryCoverage: 1,
        highestRisk: 'EXTERNAL',
        stopConditionsDeclared: true,
      },
      reasoningUsage: {},
    });
    h.plan.mockResolvedValue({
      ...sourceTask,
      title: 'Review receipt',
      status: 'READY',
      activePlanVersion: 1,
    });
    render(<MsaidiziTaskCenter />);
    await screen.findByText('receipt.png · Screenshot · forced untrusted for reasoning');

    await userEvent.click(screen.getByRole('button', { name: 'Generate governed proposal' }));

    await waitFor(() =>
      expect(h.propose).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: sourceTask.id,
          objective: 'Review receipt',
          mode: 'COLLABORATIVE',
          artifactIds: ['11111111-1111-4111-8111-111111111111'],
        }),
      ),
    );
    expect(h.plan).not.toHaveBeenCalled();
    expect(await screen.findByText(/not attached, queued, or executed/i)).toBeInTheDocument();

    const review = screen.getByRole('region', { name: 'Generated proposal review' });
    expect(within(review).getByText('Scope and devices')).toBeInTheDocument();
    expect(within(review).getByText('Company company-1')).toBeInTheDocument();
    expect(within(review).getByText('device-1')).toBeInTheDocument();
    expect(within(review).getByText('Proposed hard budgets')).toBeInTheDocument();
    expect(within(review).getByText('2 KB')).toBeInTheDocument();
    expect(within(review).getByText(/Highest risk: External/)).toBeInTheDocument();
    expect(
      within(review).getByText(/Send approved exception summary · External/),
    ).toBeInTheDocument();
    expect(within(review).getByText(/recall-message/)).toBeInTheDocument();
    expect(within(review).getByText('Immutable dataflow bindings')).toBeInTheDocument();
    expect(
      within(review).getByText(/\/query\/reportingPeriod ← plan input \/reportingPeriod/),
    ).toBeInTheDocument();
    expect(within(review).getByText('Recovery coverage: 100%')).toBeInTheDocument();
    expect(within(review).getByText(/Policy allowed · Critic accepted/)).toBeInTheDocument();
    expect(within(review).getByText(/EXTERNAL_DESTINATION_REVIEW/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save reviewed plan' }));
    await waitFor(() =>
      expect(h.plan).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: sourceTask.id,
          proposalUsageId: '22222222-2222-4222-8222-222222222222',
          proposalDigest: 'b'.repeat(64),
          summary: 'Review the receipt and send the approved exception summary.',
          companyId: 'company-1',
          mandateId: 'mandate-1',
          inputs: { reportingPeriod: '2026-08' },
          stopConditions: { onFailure: 'stop' },
          budgets: expect.objectContaining({
            maxExternalEgressBytes: 2048,
            maxModelCostUsd: 2,
          }),
          steps: expect.arrayContaining([
            expect.objectContaining({
              key: 'read-expenses',
              inputBindings: [
                expect.objectContaining({
                  targetPath: '/query/reportingPeriod',
                  source: expect.objectContaining({ kind: 'PLAN_INPUT' }),
                }),
              ],
            }),
          ]),
        }),
      ),
    );
  });

  it('requires an exact phrase before disabling global Autopilot', async () => {
    h.disableAutopilot.mockResolvedValue({
      operatorLatch: 'DISABLED',
      effectiveAutopilotEnabled: false,
      pausedQueuedTasks: 1,
      pausingRunningTasks: 1,
      pausedSchedules: 1,
      message: 'No task or routine was resumed or cancelled.',
    });
    render(<MsaidiziTaskCenter />);

    await userEvent.click(await screen.findByRole('button', { name: 'Disable Autopilot' }));
    const dialog = screen.getByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm disable' });
    expect(confirm).toBeDisabled();
    expect(h.disableAutopilot).not.toHaveBeenCalled();

    await userEvent.type(
      within(dialog).getByLabelText('Type DISABLE AUTOPILOT to continue'),
      'DISABLE AUTOPILOT',
    );
    await userEvent.click(confirm);

    await waitFor(() => expect(h.disableAutopilot).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/No task or routine was resumed/i)).toBeInTheDocument();
  });

  it('shows the reviewed plan, budget ledger, and queues only after an explicit click', async () => {
    h.create.mockResolvedValue({ ...TASK, status: 'QUEUED' });
    render(<MsaidiziTaskCenter />);

    expect(await screen.findByText('Close daily spending report')).toBeInTheDocument();
    expect(await screen.findByText('Hard budget ledger')).toBeInTheDocument();
    expect(
      screen.getByText(/No device action is implied by opening this task/i),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Queue reviewed plan' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith('task-1', []));
  });

  it('keeps local speech queueing disabled until every exact step receives one-use consent', async () => {
    const speechStep = {
      ...TASK.planVersions![0].steps[0],
      id: '22222222-2222-4222-8222-222222222222',
      planVersionId: 'plan-1',
      stepKey: 'capture-dictation',
      name: 'Capture review note',
      target: 'HOST' as const,
      capability: 'speech.audio.transcribe',
      capabilityVersion: '1.0.0',
      arguments: {
        recognizerId: 'offline-en-US',
        durationMilliseconds: 1_000,
        maxCharacters: 2_048,
      },
      dataClass: 'Biometric',
    };
    const speechTask = {
      ...TASK,
      hostExecutionAllowed: true,
      planVersions: [
        {
          ...TASK.planVersions![0],
          steps: [speechStep],
        },
      ],
    };
    h.list.mockResolvedValue({ data: [speechTask], meta: { page: 1, limit: 25, total: 1 } });
    h.detail.mockResolvedValue(speechTask);
    h.create.mockResolvedValue({ ...speechTask, status: 'QUEUED' });

    render(<MsaidiziTaskCenter />);

    const queue = await screen.findByRole('button', { name: 'Queue reviewed plan' });
    expect(queue).toBeDisabled();
    expect(screen.getByText(/Audio stays on this device/i)).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('checkbox', {
        name: 'Allow one local microphone capture for “Capture review note”',
      }),
    );
    expect(queue).toBeEnabled();
    await userEvent.click(queue);

    await waitFor(() => expect(h.create).toHaveBeenCalledWith('task-1', [speechStep.id]));
  });

  it('creates a new immutable plan version for an eligible task without changing mode or queueing', async () => {
    const currentPlan = TASK.planVersions![0];
    const replacementPlan = {
      ...currentPlan,
      id: 'plan-2',
      version: 2,
      summary: 'Use the corrected expense filter.',
      planDigest: 'replacement-digest',
      steps: currentPlan.steps.map((step) => ({ ...step, planVersionId: 'plan-2' })),
    };
    h.replan.mockResolvedValue({
      ...TASK,
      activePlanVersion: 2,
      stateVersion: 2,
      planVersions: [currentPlan, replacementPlan],
    });

    render(<MsaidiziTaskCenter />);
    await screen.findByRole('heading', { name: TASK.title });
    await userEvent.click(screen.getByRole('button', { name: 'Replan reviewed task' }));

    const form = screen.getByRole('form', { name: 'Replan durable task' });
    expect(within(form).getByText(/keeps the explicit Work with me mode/i)).toBeInTheDocument();
    expect(within(form).queryByRole('radio')).not.toBeInTheDocument();
    await userEvent.clear(within(form).getByLabelText('Replan summary'));
    await userEvent.type(
      within(form).getByLabelText('Replan summary'),
      'Use the corrected expense filter.',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Save new plan version' }));

    await waitFor(() =>
      expect(h.replan).toHaveBeenCalledWith(
        TASK.id,
        expect.objectContaining({
          summary: 'Use the corrected expense filter.',
          objective: TASK.objective,
          inputs: {},
          stopConditions: {},
          steps: [
            expect.objectContaining({
              key: 'read-expenses',
              capability: 'Expenses_findAll',
              expectedEffect: 'READ',
            }),
          ],
        }),
      ),
    );
    expect(h.replan.mock.calls[0]?.[1]).not.toHaveProperty('mode');
    expect(h.create).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Version 2 · Use the corrected expense filter/),
    ).toBeInTheDocument();
  });

  it('does not offer replan after a mutation has already been recorded', async () => {
    const mutatedTask: MsaidiziTask = {
      ...TASK,
      status: 'FAILED',
      mutations: 1,
      failureCode: 'HOST_WRITE_FAILED',
    };
    h.list.mockResolvedValue({ data: [mutatedTask], meta: { page: 1, limit: 30, total: 1 } });
    h.detail.mockResolvedValue(mutatedTask);

    render(<MsaidiziTaskCenter />);
    await screen.findByRole('heading', { name: mutatedTask.title });

    expect(screen.queryByRole('button', { name: 'Replan reviewed task' })).not.toBeInTheDocument();
    expect(h.replan).not.toHaveBeenCalled();
  });

  it('makes Autopilot an explicit choice and requires its mandate field', async () => {
    render(<MsaidiziTaskCenter />);
    await screen.findByText('Close daily spending report');

    await userEvent.click(screen.getByText('Autopilot'));
    expect(screen.getByLabelText('Active mandate ID')).toBeRequired();
    expect(screen.getByText(/never inferred from your words/i)).toBeInTheDocument();
  });

  it('encrypts user-selected context as an untrusted task artifact without queuing work', async () => {
    render(<MsaidiziTaskCenter />);
    await screen.findByText('Voice, screen and document context');
    const file = new File(['context'], 'context.txt', { type: 'text/plain' });

    await userEvent.upload(screen.getByLabelText('Attach file or document'), file);

    await waitFor(() =>
      expect(h.uploadArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-1',
          file,
          kind: 'DOCUMENT',
          dataClass: 'internal',
          provenance: expect.objectContaining({
            sourceType: 'USER',
            trustLevel: 'UNTRUSTED',
          }),
        }),
      ),
    );
    expect(
      await screen.findByText(/encrypted and attached as untrusted task data/i),
    ).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('renders task artifacts, retry evidence, leases, host journal status, and audit links', async () => {
    const operationalTask: MsaidiziTask = {
      ...TASK,
      toolAttempts: [
        {
          id: 'attempt-1',
          stepId: 'step-1',
          attemptNumber: 2,
          toolName: 'ExpensesController.findAll',
          status: 'SUCCEEDED',
          rejectionReason: null,
          resultSummary: { rows: 3 },
          errorCode: null,
          errorMessage: null,
          uncertainOutcome: false,
          startedAt: '2026-08-25T08:01:00.000Z',
          endedAt: '2026-08-25T08:01:01.000Z',
          createdAt: '2026-08-25T08:01:00.000Z',
        },
      ],
      artifacts: [
        {
          id: 'artifact/1',
          stepId: 'step-1',
          kind: 'REPORT',
          name: 'spending-report.pdf',
          mimeType: 'application/pdf',
          sha256: 'abcdef0123456789',
          byteSize: '2048',
          encrypted: true,
          dataClass: 'internal',
          trustLevel: 'TRUSTED',
          provenance: { source: 'expense-ledger' },
          createdAt: '2026-08-25T08:02:00.000Z',
        },
      ],
      deviceLeases: [
        {
          id: 'lease-1',
          stepId: 'step-1',
          deviceId: 'device-1',
          status: 'ACTIVE',
          fencingToken: '4',
          acquiredAt: '2026-08-25T08:02:00.000Z',
          heartbeatAt: '2026-08-25T08:03:00.000Z',
          expiresAt: '2026-08-25T08:04:00.000Z',
          releasedAt: null,
          device: { name: DEVICE.name, status: DEVICE.status, lastSeenAt: DEVICE.lastSeenAt },
        },
      ],
      hostActions: [
        {
          id: 'host-action-1',
          stepId: 'step-1',
          deviceId: 'device-1',
          actionId: 'action-1',
          capability: 'filesystem.read',
          capabilityVersion: '2.1.0',
          argsDigest: 'args-digest',
          idempotencyKey: 'idempotency-key',
          dataClass: 'internal',
          effect: 'READ',
          consent: 'TASK',
          recovery: 'NONE',
          status: 'SUCCEEDED',
          uncertainOutcome: false,
          journalPrepareSequence: 41,
          journalPreparePreviousHash: 'prior-device-head',
          journalPrepareHash: 'prepared-journal-hash',
          journalSequence: 42,
          journalPreviousHash: 'prepared-journal-hash',
          journalHash: 'journal-hash',
          resultSummary: { files: 1 },
          errorCode: null,
          queuedAt: '2026-08-25T08:02:00.000Z',
          dispatchedAt: '2026-08-25T08:02:01.000Z',
          startedAt: '2026-08-25T08:02:02.000Z',
          endedAt: '2026-08-25T08:02:03.000Z',
          createdAt: '2026-08-25T08:02:00.000Z',
          updatedAt: '2026-08-25T08:02:03.000Z',
        },
      ],
    };
    h.list.mockResolvedValue({ data: [operationalTask], meta: { page: 1, limit: 30, total: 1 } });
    h.detail.mockResolvedValue(operationalTask);

    render(<MsaidiziTaskCenter />);

    expect(await screen.findByText('Tool attempts and retries')).toBeInTheDocument();
    expect(screen.getByText(/Attempt 2.*retry/i)).toBeInTheDocument();
    const download = screen.getByRole('link', { name: 'Download artifact' });
    expect(download).toHaveAttribute(
      'href',
      '/api/backend/msaidizi/artifacts/artifact%2F1/download',
    );
    expect(screen.getByText(/prepared.*terminal.*earlier device head/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /audit/i }).length).toBeGreaterThan(0);
  });
});

class PlannerLocalRecognition {
  continuous = true;
  interimResults = true;
  lang = '';
  processLocally = false;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;

  start() {
    queueMicrotask(() => {
      this.onresult?.({ results: [{ 0: { transcript: ' Review the ledger ' } }] });
      this.onend?.();
    });
  }

  stop() {
    this.onend?.();
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}
