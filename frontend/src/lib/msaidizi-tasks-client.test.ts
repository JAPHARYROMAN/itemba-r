import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./api-client', () => ({
  BACKEND_PROXY_URL: '/api/backend',
  MANAGED_401_HEADER: 'x-itemba-managed-401',
  SESSION_EXPIRED_EVENT: 'itemba:session-expired',
  backendGet: api.get,
  backendPost: api.post,
  backendPut: api.put,
  backendDelete: api.delete,
}));

import {
  activateMsaidiziMandate,
  activateMsaidiziSchedule,
  archiveMsaidiziSchedule,
  createMsaidiziPairingCode,
  createMsaidiziTask,
  createMsaidiziTaskDraft,
  createMsaidiziMemory,
  createMsaidiziSchedule,
  deleteMsaidiziMandate,
  deleteMsaidiziMemory,
  deleteMsaidiziSchedule,
  disableMsaidiziAutopilot,
  enableMsaidiziAutopilot,
  fetchMsaidiziRecoveryCommand,
  fetchMsaidiziMemory,
  fetchMsaidiziSchedule,
  fetchMsaidiziScheduleVersion,
  getMsaidiziSafetyStatus,
  killAllMsaidiziDevices,
  killMsaidiziDevice,
  listMsaidiziDevices,
  listMsaidiziMandates,
  listMsaidiziMemories,
  listMsaidiziRecoveryCommands,
  listMsaidiziSchedules,
  listMsaidiziScheduleVersions,
  msaidiziArtifactDownloadUrl,
  revokeMsaidiziDevice,
  proposeMsaidiziTask,
  requestMsaidiziRecoveryCommand,
  updateMsaidiziMemory,
  updateMsaidiziSchedule,
} from './msaidizi-tasks-client';

beforeEach(() => vi.clearAllMocks());

describe('Msaidizi control-plane client contracts', () => {
  it('sends exact one-shot step consent only in the explicit queue request', async () => {
    api.post.mockResolvedValue({});
    const stepIds = ['22222222-2222-4222-8222-222222222222'];

    await createMsaidiziTask('11111111-1111-4111-8111-111111111111', stepIds);

    expect(api.post).toHaveBeenCalledWith('/msaidizi/tasks', {
      taskId: '11111111-1111-4111-8111-111111111111',
      oneShotConsentStepIds: stepIds,
    });
  });

  it('uses exact human-only safety endpoints and confirmation bodies', async () => {
    api.get.mockResolvedValue({});
    api.post.mockResolvedValue({});

    await getMsaidiziSafetyStatus();
    await disableMsaidiziAutopilot();
    await enableMsaidiziAutopilot();

    expect(api.get).toHaveBeenCalledWith('/msaidizi/safety');
    expect(api.post).toHaveBeenNthCalledWith(1, '/msaidizi/safety/disable-autopilot', {
      confirmation: 'DISABLE AUTOPILOT',
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/msaidizi/safety/enable-autopilot', {
      confirmation: 'ENABLE AUTOPILOT',
    });
  });

  it('uses the proposal endpoint without inventing a save or queue call', async () => {
    api.post.mockResolvedValue({ status: 'PROPOSED' });
    const request = {
      taskId: '22222222-2222-4222-8222-222222222222',
      objective: 'Read a receipt',
      mode: 'COLLABORATIVE' as const,
      artifactIds: ['11111111-1111-4111-8111-111111111111'],
    };

    await proposeMsaidiziTask(request);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/msaidizi/tasks/proposals', request);
  });

  it('creates a non-executable durable draft before proposal or attachment calls', async () => {
    api.post.mockResolvedValue({ status: 'PLANNING', activePlanVersion: 0 });
    const request = {
      objective: 'Review the local dictation and screenshot',
      mode: 'COLLABORATIVE' as const,
    };

    await createMsaidiziTaskDraft(request);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/msaidizi/tasks/drafts', request);
  });

  it('uses the real mandate endpoints and sends the exact optimistic version', async () => {
    api.get.mockResolvedValue({ items: [], total: 0, page: 1, limit: 25 });
    api.post.mockResolvedValue({});
    api.delete.mockResolvedValue({});

    await listMsaidiziMandates({ status: 'DRAFT', limit: 25 });
    await activateMsaidiziMandate('mandate/one', 7);
    await deleteMsaidiziMandate('mandate/one', 8);

    expect(api.get).toHaveBeenCalledWith('/msaidizi/mandates', {
      query: { status: 'DRAFT', limit: 25 },
    });
    expect(api.post).toHaveBeenCalledWith('/msaidizi/mandates/mandate%2Fone/activate', {
      expectedVersion: 7,
    });
    expect(api.delete).toHaveBeenCalledWith('/msaidizi/mandates/mandate%2Fone', {
      body: { expectedVersion: 8 },
    });
  });

  it('uses the routines alias and never activates a routine as part of creation', async () => {
    api.get.mockResolvedValue({ items: [], total: 0, page: 1, limit: 25 });
    api.post.mockResolvedValue({});
    api.delete.mockResolvedValue({});
    const request = {
      mandateId: 'mandate-1',
      name: 'Morning close',
      cronExpression: '0 8 * * *',
      timezone: 'Africa/Nairobi',
      taskTemplate: { title: 'Close', objective: 'Close books', steps: [] },
      concurrencyMode: 'SKIP' as const,
    };

    await listMsaidiziSchedules({ mandateId: 'mandate-1' });
    await createMsaidiziSchedule(request);

    expect(api.get).toHaveBeenCalledWith('/msaidizi/routines', {
      query: { mandateId: 'mandate-1' },
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/msaidizi/routines', request);

    await activateMsaidiziSchedule('routine-1', 4);
    expect(api.post).toHaveBeenLastCalledWith('/msaidizi/routines/routine-1/activate', {
      expectedVersion: 4,
    });
    await deleteMsaidiziSchedule('routine-1', 5);
    expect(api.delete).toHaveBeenCalledWith('/msaidizi/routines/routine-1', {
      body: { expectedVersion: 5 },
    });
  });

  it('reads routine detail/history and updates with the exact optimistic version', async () => {
    api.get.mockResolvedValue({});
    api.put.mockResolvedValue({});
    api.post.mockResolvedValue({});
    const update = {
      expectedVersion: 7,
      name: 'Revised close',
      cronExpression: '30 8 * * *',
      timezone: 'Africa/Nairobi',
      taskTemplate: { title: 'Close', objective: 'Close books', steps: [] },
      concurrencyMode: 'QUEUE' as const,
      nextRunAt: null,
    };

    await fetchMsaidiziSchedule('routine/one');
    await listMsaidiziScheduleVersions('routine/one');
    await fetchMsaidiziScheduleVersion('routine/one', 7);
    await updateMsaidiziSchedule('routine/one', update);
    await archiveMsaidiziSchedule('routine/one', 8);

    expect(api.get).toHaveBeenNthCalledWith(1, '/msaidizi/routines/routine%2Fone');
    expect(api.get).toHaveBeenNthCalledWith(2, '/msaidizi/routines/routine%2Fone/versions');
    expect(api.get).toHaveBeenNthCalledWith(3, '/msaidizi/routines/routine%2Fone/versions/7');
    expect(api.put).toHaveBeenCalledWith('/msaidizi/routines/routine%2Fone', update);
    expect(api.post).toHaveBeenCalledWith('/msaidizi/routines/routine%2Fone/archive', {
      expectedVersion: 8,
    });
  });

  it('uses scoped memory create/list/delete endpoints without inventing lifecycle calls', async () => {
    api.get.mockResolvedValue({ items: [], total: 0, page: 1, limit: 25 });
    api.post.mockResolvedValue({});
    api.delete.mockResolvedValue({ id: 'memory-1', deleted: true });
    const request = {
      kind: 'SEMANTIC' as const,
      scopeKey: 'policy',
      content: 'Policy content',
      metadata: {},
    };

    await listMsaidiziMemories({ kind: 'SEMANTIC' });
    await createMsaidiziMemory(request);
    await deleteMsaidiziMemory('memory-1');

    expect(api.get).toHaveBeenCalledWith('/msaidizi/memory', {
      query: { kind: 'SEMANTIC' },
    });
    expect(api.post).toHaveBeenCalledWith('/msaidizi/memory', request);
    expect(api.delete).toHaveBeenCalledWith('/msaidizi/memory/memory-1');
  });

  it('decrypts one memory only through detail and updates through the scoped endpoint', async () => {
    api.get.mockResolvedValue({});
    api.put.mockResolvedValue({});
    const update = {
      kind: 'PROCEDURAL' as const,
      scopeKey: 'month-close',
      content: 'Use the approved close checklist.',
      metadata: { owner: 'finance' },
      expiresAt: null,
    };

    await listMsaidiziMemories({ trustLevel: 'UNTRUSTED' });
    await fetchMsaidiziMemory('memory/one');
    await updateMsaidiziMemory('memory/one', update);

    expect(api.get).toHaveBeenNthCalledWith(1, '/msaidizi/memory', {
      query: { trustLevel: 'UNTRUSTED' },
    });
    expect(api.get).toHaveBeenNthCalledWith(2, '/msaidizi/memory/memory%2Fone');
    expect(api.put).toHaveBeenCalledWith('/msaidizi/memory/memory%2Fone', update);
  });

  it('uses exact device enrollment and emergency control endpoints', async () => {
    api.get.mockResolvedValue({ items: [], total: 0 });
    api.post.mockResolvedValue({});

    await listMsaidiziDevices();
    await createMsaidiziPairingCode('Finance workstation');
    await revokeMsaidiziDevice('device/one');
    await killMsaidiziDevice('device/one');
    await killAllMsaidiziDevices();

    expect(api.get).toHaveBeenCalledWith('/msaidizi/devices');
    expect(api.post).toHaveBeenNthCalledWith(1, '/msaidizi/devices/pair-codes', {
      name: 'Finance workstation',
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/msaidizi/devices/device%2Fone/revoke');
    expect(api.post).toHaveBeenNthCalledWith(3, '/msaidizi/devices/device%2Fone/kill');
    expect(api.post).toHaveBeenNthCalledWith(4, '/msaidizi/devices/kill-all');
  });

  it('keeps recovery inspection read-only and posts only an explicit exact authorization', async () => {
    api.get.mockResolvedValue([]);
    api.post.mockResolvedValue({});
    const request = {
      hostActionId: '11111111-1111-4111-8111-111111111111',
      expectedCurrentStateSha256: 'a'.repeat(64),
      confirmationPhrase: `RESTORE action-7 AT ${'a'.repeat(64)}`,
    };

    await listMsaidiziRecoveryCommands();
    await listMsaidiziRecoveryCommands('NEEDS_ATTENTION');
    await fetchMsaidiziRecoveryCommand('recovery/one');

    expect(api.get).toHaveBeenNthCalledWith(1, '/msaidizi/recovery-commands');
    expect(api.get).toHaveBeenNthCalledWith(2, '/msaidizi/recovery-commands', {
      query: { status: 'NEEDS_ATTENTION' },
    });
    expect(api.get).toHaveBeenNthCalledWith(3, '/msaidizi/recovery-commands/recovery%2Fone');
    expect(api.post).not.toHaveBeenCalled();

    await requestMsaidiziRecoveryCommand(request);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/msaidizi/recovery-commands', request);
  });

  it('builds an encoded authenticated proxy URL for artifact downloads', () => {
    expect(msaidiziArtifactDownloadUrl('artifact/one')).toBe(
      '/api/backend/msaidizi/artifacts/artifact%2Fone/download',
    );
  });
});
