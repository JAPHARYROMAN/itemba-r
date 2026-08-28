import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import MsaidiziPage from './page';

const h = vi.hoisted(() => ({
  params: { current: new URLSearchParams() },
  replace: vi.fn(),
  chat: vi.fn(),
  taskCenter: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: h.replace }),
  useSearchParams: () => h.params.current,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ loading: false, hasPermission: () => true }),
}));

vi.mock('@/components/msaidizi/msaidizi-chat', () => ({
  MsaidiziChat: (props: { initialQuestion: string | null }) => {
    h.chat(props);
    return <div data-testid="chat">{props.initialQuestion ?? 'empty chat'}</div>;
  },
}));

vi.mock('@/components/msaidizi/msaidizi-task-center', () => ({
  MSAIDIZI_WORKSPACES: [
    { id: 'conversations', label: 'Conversations' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'routines', label: 'Routines' },
    { id: 'devices', label: 'Devices' },
    { id: 'memory', label: 'Memory' },
    { id: 'rollout', label: 'Rollout' },
  ],
  MsaidiziTaskCenter: (props: { initialTaskId?: string | null }) => {
    h.taskCenter(props);
    return <div data-testid="task-center">{props.initialTaskId ?? 'no target'}</div>;
  },
  MsaidiziWorkspacePanel: (props: {
    workspace: string;
    focusedDeviceId?: string | null;
    focusedRecoveryId?: string | null;
    focusedCandidateId?: string | null;
  }) => {
    h.workspace(props);
    return (
      <div data-testid="workspace">
        {props.workspace}:{props.focusedDeviceId ?? 'no device'}:
        {props.focusedRecoveryId ?? 'no recovery'}:{props.focusedCandidateId ?? 'no candidate'}
      </div>
    );
  },
}));

beforeEach(() => {
  h.params.current = new URLSearchParams();
  h.replace.mockReset();
  h.chat.mockClear();
  h.taskCenter.mockClear();
  h.workspace.mockClear();
});

describe('/msaidizi governed deep links', () => {
  it('opens an exact task outside chat and strips ask while preserving safe query state', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    h.params.current = new URLSearchParams([
      ['workspace', 'tasks'],
      ['taskId', taskId],
      ['ask', 'run this prose'],
      ['source', 'notification'],
    ]);

    render(<MsaidiziPage />);

    expect(await screen.findByTestId('task-center')).toHaveTextContent(taskId);
    expect(h.taskCenter).toHaveBeenCalledWith({ initialTaskId: taskId });
    expect(h.chat).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith(
        `/msaidizi?workspace=tasks&taskId=${taskId}&source=notification`,
        { scroll: false },
      ),
    );
  });

  it('passes an exact device target for visible focus without mounting prose execution', () => {
    const deviceId = '22222222-2222-4222-8222-222222222222';
    h.params.current = new URLSearchParams([
      ['workspace', 'devices'],
      ['deviceId', deviceId],
    ]);

    render(<MsaidiziPage />);

    expect(screen.getByTestId('workspace')).toHaveTextContent(
      `devices:${deviceId}:no recovery:no candidate`,
    );
    expect(h.workspace).toHaveBeenCalledWith({
      workspace: 'devices',
      focusedDeviceId: deviceId,
      focusedRecoveryId: null,
      focusedCandidateId: null,
      onOpenTask: expect.any(Function),
    });
    expect(h.chat).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it('allowlists and passes an exact recovery record without turning appended prose into work', async () => {
    const deviceId = '22222222-2222-4222-8222-222222222222';
    const recoveryId = '33333333-3333-4333-8333-333333333333';
    h.params.current = new URLSearchParams([
      ['workspace', 'devices'],
      ['deviceId', deviceId],
      ['recoveryId', recoveryId],
      ['ask', 'restore everything'],
      ['source', 'notification'],
    ]);

    render(<MsaidiziPage />);

    expect(screen.getByTestId('workspace')).toHaveTextContent(
      `devices:${deviceId}:${recoveryId}:no candidate`,
    );
    expect(h.workspace).toHaveBeenCalledWith({
      workspace: 'devices',
      focusedDeviceId: deviceId,
      focusedRecoveryId: recoveryId,
      focusedCandidateId: null,
      onOpenTask: expect.any(Function),
    });
    expect(h.chat).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith(
        `/msaidizi?workspace=devices&deviceId=${deviceId}&recoveryId=${recoveryId}&source=notification`,
        { scroll: false },
      ),
    );
  });

  it('passes an exact rollout candidate, and refuses one addressed to another workspace', () => {
    const candidateId = '33333333-3333-4333-8333-333333333333';
    h.params.current = new URLSearchParams([
      ['workspace', 'rollout'],
      ['candidateId', candidateId],
    ]);

    render(<MsaidiziPage />);

    expect(h.workspace).toHaveBeenCalledWith({
      workspace: 'rollout',
      focusedDeviceId: null,
      focusedRecoveryId: null,
      focusedCandidateId: candidateId,
      onOpenTask: expect.any(Function),
    });
  });

  it('ignores a malformed rollout candidate rather than opening on it', () => {
    h.params.current = new URLSearchParams([
      ['workspace', 'rollout'],
      ['candidateId', 'not-a-uuid; drop table'],
    ]);

    render(<MsaidiziPage />);

    expect(screen.getByTestId('workspace')).toHaveTextContent(
      'rollout:no device:no recovery:no candidate',
    );
  });

  it('drops a malformed recovery target before preserving a device inspection URL', async () => {
    const deviceId = '22222222-2222-4222-8222-222222222222';
    h.params.current = new URLSearchParams([
      ['workspace', 'devices'],
      ['deviceId', deviceId],
      ['recoveryId', '../../supervisor'],
      ['ask', 'run this'],
    ]);

    render(<MsaidiziPage />);

    expect(h.workspace).toHaveBeenCalledWith({
      workspace: 'devices',
      focusedDeviceId: deviceId,
      focusedRecoveryId: null,
      focusedCandidateId: null,
      onOpenTask: expect.any(Function),
    });
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith(`/msaidizi?workspace=devices&deviceId=${deviceId}`, {
        scroll: false,
      }),
    );
  });

  it('rejects non-UUID targets instead of issuing an arbitrary detail request', async () => {
    h.params.current = new URLSearchParams([
      ['workspace', 'tasks'],
      ['taskId', '../../admin'],
      ['ask', 'mutate something'],
    ]);

    render(<MsaidiziPage />);

    expect(await screen.findByTestId('task-center')).toHaveTextContent('no target');
    expect(h.taskCenter).toHaveBeenCalledWith({ initialTaskId: null });
    expect(h.chat).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith('/msaidizi?workspace=tasks', { scroll: false }),
    );
  });

  it('allowlists workspaces and treats an unknown workspace as an inert conversation view', () => {
    h.params.current = new URLSearchParams([
      ['workspace', 'admin'],
      ['taskId', '11111111-1111-4111-8111-111111111111'],
      ['ask', 'run untrusted prose'],
    ]);

    render(<MsaidiziPage />);

    expect(screen.getByTestId('chat')).toHaveTextContent('empty chat');
    expect(h.chat).toHaveBeenCalledWith({ initialQuestion: null });
    expect(h.taskCenter).not.toHaveBeenCalled();
    expect(h.workspace).not.toHaveBeenCalled();
  });
});
