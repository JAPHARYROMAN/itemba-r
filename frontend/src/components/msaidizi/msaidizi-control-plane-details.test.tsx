import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/lib/api-client';
import type {
  MsaidiziMemoryDetail,
  MsaidiziSchedule,
  MsaidiziScheduleVersion,
} from '@/lib/msaidizi-task-types';
import { MsaidiziMemoryDetailPanel } from './msaidizi-memory-detail';
import { MsaidiziRoutineDetail } from './msaidizi-routine-detail';

const h = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  fetchSchedule: vi.fn(),
  listScheduleVersions: vi.fn(),
  fetchScheduleVersion: vi.fn(),
  updateSchedule: vi.fn(),
  activateSchedule: vi.fn(),
  pauseSchedule: vi.fn(),
  archiveSchedule: vi.fn(),
  fetchMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: h.hasPermission }),
}));

vi.mock('@/lib/msaidizi-tasks-client', () => ({
  fetchMsaidiziSchedule: h.fetchSchedule,
  listMsaidiziScheduleVersions: h.listScheduleVersions,
  fetchMsaidiziScheduleVersion: h.fetchScheduleVersion,
  updateMsaidiziSchedule: h.updateSchedule,
  activateMsaidiziSchedule: h.activateSchedule,
  pauseMsaidiziSchedule: h.pauseSchedule,
  archiveMsaidiziSchedule: h.archiveSchedule,
  fetchMsaidiziMemory: h.fetchMemory,
  updateMsaidiziMemory: h.updateMemory,
  deleteMsaidiziMemory: h.deleteMemory,
}));

const ROUTINE: MsaidiziSchedule = {
  id: 'routine-1',
  principalId: 'principal-1',
  mandateId: 'mandate-1',
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
    id: 'mandate-1',
    companyId: 'company-1',
    status: 'ACTIVE',
    version: 3,
    startsAt: null,
    expiresAt: null,
  },
};

const ROUTINE_VERSION: MsaidiziScheduleVersion = {
  id: 'routine-version-1',
  scheduleId: ROUTINE.id,
  version: 1,
  changeType: 'MSAIDIZI_SCHEDULE_CREATE',
  changedByUserId: 'user-1',
  principalId: ROUTINE.principalId,
  mandateId: ROUTINE.mandateId,
  companyId: 'company-1',
  createdByUserId: 'user-1',
  name: ROUTINE.name,
  status: ROUTINE.status,
  cronExpression: ROUTINE.cronExpression,
  timezone: ROUTINE.timezone,
  taskTemplate: ROUTINE.taskTemplate,
  concurrencyMode: ROUTINE.concurrencyMode,
  nextRunAt: null,
  lastRunAt: null,
  sourceCreatedAt: ROUTINE.createdAt,
  sourceUpdatedAt: ROUTINE.updatedAt,
  recordedAt: '2026-08-25T08:00:01.000Z',
};

const MEMORY: MsaidiziMemoryDetail = {
  id: 'memory-1',
  companyId: 'company-1',
  sourceTaskId: null,
  kind: 'SEMANTIC',
  scopeKey: 'supplier-preferences',
  content: 'Use the preferred regional supplier.',
  metadata: { owner: 'procurement' },
  trustLevel: 'UNTRUSTED',
  sourceProvenance: {
    sourceType: 'USER',
    capturedAt: '2026-08-25T08:00:00.000Z',
  },
  contentDigest: 'a'.repeat(64),
  expiresAt: null,
  createdAt: '2026-08-25T08:00:00.000Z',
  updatedAt: '2026-08-25T08:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.hasPermission.mockImplementation((permission: string) => permission === 'msaidizi.oversight');
  h.fetchSchedule.mockResolvedValue(ROUTINE);
  h.listScheduleVersions.mockResolvedValue([ROUTINE_VERSION]);
  h.fetchScheduleVersion.mockResolvedValue(ROUTINE_VERSION);
  h.updateSchedule.mockResolvedValue({ ...ROUTINE, name: 'Revised review', version: 2 });
  h.activateSchedule.mockResolvedValue({ ...ROUTINE, status: 'ACTIVE', version: 2 });
  h.pauseSchedule.mockResolvedValue({ ...ROUTINE, status: 'PAUSED', version: 2 });
  h.archiveSchedule.mockResolvedValue({ ...ROUTINE, status: 'ARCHIVED', version: 2 });
  h.fetchMemory.mockResolvedValue(MEMORY);
  h.updateMemory.mockResolvedValue({
    ...MEMORY,
    content: 'Use the revised approved supplier.',
    redactionsApplied: true,
  });
  h.deleteMemory.mockResolvedValue({ id: MEMORY.id, deleted: true });
});

describe('Msaidizi routine detail', () => {
  it('loads detail/history, opens a read-only snapshot, and sends the exact CAS update', async () => {
    const onChanged = vi.fn();
    render(<MsaidiziRoutineDetail routineId={ROUTINE.id} onChanged={onChanged} />);

    expect(await screen.findByRole('form', { name: 'Edit routine' })).toBeInTheDocument();
    expect(h.fetchSchedule).toHaveBeenCalledWith(ROUTINE.id);
    expect(h.listScheduleVersions).toHaveBeenCalledWith(ROUTINE.id);

    await userEvent.click(screen.getByRole('button', { name: /Version 1/i }));
    expect(
      await screen.findByRole('article', { name: 'Routine version 1 snapshot' }),
    ).toBeVisible();
    expect(h.fetchScheduleVersion).toHaveBeenCalledWith(ROUTINE.id, 1);

    const name = screen.getByLabelText('Routine name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Revised review');
    await userEvent.selectOptions(screen.getByLabelText('Routine concurrency'), 'QUEUE');
    await userEvent.click(screen.getByRole('button', { name: 'Save routine changes' }));

    await waitFor(() =>
      expect(h.updateSchedule).toHaveBeenCalledWith(ROUTINE.id, {
        expectedVersion: 1,
        name: 'Revised review',
        cronExpression: '0 8 * * *',
        timezone: 'Africa/Nairobi',
        taskTemplate: ROUTINE.taskTemplate,
        concurrencyMode: 'QUEUE',
        nextRunAt: null,
      }),
    );
    expect(onChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Revised review', version: 2 }),
    );
  });

  it('preserves a stale draft after 409 and never retries the mutation automatically', async () => {
    h.updateSchedule.mockRejectedValue(
      new ApiError('Schedule changed; refresh and retry', 409, { statusCode: 409 }),
    );
    render(<MsaidiziRoutineDetail routineId={ROUTINE.id} onChanged={vi.fn()} />);

    const name = await screen.findByLabelText('Routine name');
    await userEvent.clear(name);
    await userEvent.type(name, 'My unsaved revision');
    await userEvent.click(screen.getByRole('button', { name: 'Save routine changes' }));

    expect(await screen.findByText(/Your draft is preserved/i)).toBeVisible();
    expect(screen.getByLabelText('Routine name')).toHaveValue('My unsaved revision');
    expect(screen.getByRole('button', { name: 'Save routine changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh current routine' })).toBeEnabled();
    expect(h.updateSchedule).toHaveBeenCalledTimes(1);
  });

  it('gates activation by oversight permission and confirms semantic archive', async () => {
    h.hasPermission.mockReturnValue(false);
    render(<MsaidiziRoutineDetail routineId={ROUTINE.id} onChanged={vi.fn()} />);

    expect(await screen.findByText(/Activation requires Msaidizi oversight/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Activate routine' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Archive routine' }));
    expect(h.archiveSchedule).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));
    await waitFor(() => expect(h.archiveSchedule).toHaveBeenCalledWith(ROUTINE.id, 1));
  });
});

describe('Msaidizi memory detail', () => {
  it('edits decrypted content without exposing provenance authority and confirms soft delete', async () => {
    const onChanged = vi.fn();
    const onDeleted = vi.fn();
    render(
      <MsaidiziMemoryDetailPanel
        memoryId={MEMORY.id}
        onChanged={onChanged}
        onDeleted={onDeleted}
      />,
    );

    const content = await screen.findByLabelText('Memory content');
    expect(content).toHaveValue(MEMORY.content);
    expect(onChanged).toHaveBeenCalledWith(
      expect.not.objectContaining({ content: expect.anything() }),
    );
    expect(screen.queryByLabelText('Trust')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Provenance')).not.toBeInTheDocument();

    fireEvent.change(content, { target: { value: 'Use the revised approved supplier.' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save memory changes' }));
    await waitFor(() =>
      expect(h.updateMemory).toHaveBeenCalledWith(MEMORY.id, {
        kind: 'SEMANTIC',
        scopeKey: 'supplier-preferences',
        content: 'Use the revised approved supplier.',
        metadata: { owner: 'procurement' },
        expiresAt: null,
      }),
    );
    expect(await screen.findByText(/credentials were removed/i)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Delete memory' }));
    expect(h.deleteMemory).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete memory' }));
    await waitFor(() => expect(h.deleteMemory).toHaveBeenCalledWith(MEMORY.id));
    expect(onDeleted).toHaveBeenCalledWith(MEMORY.id);
  });

  it('keeps a memory draft intact after a conflict and exposes explicit refresh', async () => {
    h.updateMemory.mockRejectedValue(
      new ApiError('Memory changed; refresh and retry', 409, { statusCode: 409 }),
    );
    render(
      <MsaidiziMemoryDetailPanel memoryId={MEMORY.id} onChanged={vi.fn()} onDeleted={vi.fn()} />,
    );

    const content = await screen.findByLabelText('Memory content');
    fireEvent.change(content, { target: { value: 'Unsaved memory revision' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save memory changes' }));

    expect(await screen.findByText(/Your draft is preserved/i)).toBeVisible();
    expect(screen.getByLabelText('Memory content')).toHaveValue('Unsaved memory revision');
    expect(screen.getByRole('button', { name: 'Save memory changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh current memory' })).toBeEnabled();
    expect(h.updateMemory).toHaveBeenCalledTimes(1);
  });
});
