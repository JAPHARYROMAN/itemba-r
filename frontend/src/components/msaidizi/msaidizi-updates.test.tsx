import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MsaidiziUpdateCandidate } from '@/lib/msaidizi-update-types';
import { MsaidiziUpdatesWorkspace } from './msaidizi-updates';

const h = vi.hoisted(() => ({
  list: vi.fn(),
  rollout: vi.fn(),
  rollback: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: h.hasPermission, user: { id: 'user-1' } }),
}));

vi.mock('@/lib/msaidizi-updates-client', () => ({
  listMsaidiziUpdateCandidates: h.list,
  rolloutMsaidiziUpdateCandidate: h.rollout,
  rollbackMsaidiziUpdateCandidate: h.rollback,
}));

const candidate = (overrides: Partial<MsaidiziUpdateCandidate> = {}): MsaidiziUpdateCandidate => ({
  id: 'cand-1',
  name: 'Companion service',
  version: '1.4.2',
  rollbackVersion: '1.4.1',
  scope: 'companion-service',
  status: 'APPROVED',
  rolloutRing: 0,
  automaticProgressionEnabled: false,
  automaticProgressionArmedAt: null,
  sourceArtifactSha256: 'a'.repeat(64),
  rollbackArtifactSha256: 'b'.repeat(64),
  proposalRationale: 'Fixes the settlement latch.',
  evaluationDecidedAt: '2026-08-20T09:00:00.000Z',
  createdAt: '2026-08-19T09:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.hasPermission.mockReturnValue(true);
  h.list.mockResolvedValue([candidate()]);
});

describe('MsaidiziUpdatesWorkspace', () => {
  it('explains the default rather than looking broken when oversight is not held', async () => {
    // msaidizi.oversight is seeded to nobody, so this is the state almost every
    // account is in. It must read as a deliberate default, not a failure.
    h.hasPermission.mockImplementation((permission: string) => permission !== 'msaidizi.oversight');

    render(<MsaidiziUpdatesWorkspace />);

    expect(await screen.findByText(/granted to nobody by default/i)).toBeInTheDocument();
    expect(h.list).not.toHaveBeenCalled();
  });

  it('offers only the next ring in the progression', async () => {
    render(<MsaidiziUpdatesWorkspace />);

    // Ring 0 -> the only advance offered is 5%, never 25 or 100.
    expect(await screen.findByRole('button', { name: /advance to 5%/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /advance to 25%/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /advance to 100%/i })).not.toBeInTheDocument();
  });

  it('advances to the next ring and keeps the returned candidate', async () => {
    const user = userEvent.setup();
    h.rollout.mockResolvedValue(candidate({ rolloutRing: 5, status: 'CANARY' }));

    render(<MsaidiziUpdatesWorkspace />);
    await user.click(await screen.findByRole('button', { name: /advance to 5%/i }));

    await waitFor(() => expect(h.rollout).toHaveBeenCalledWith('cand-1', { ring: 5 }));
    // Now on 5%, the next offer is 25% — the progression advanced with the
    // candidate the server returned, not with local optimism.
    expect(await screen.findByRole('button', { name: /advance to 25%/i })).toBeInTheDocument();
    // CANARY also unlocks rollback, which APPROVED did not offer.
    expect(screen.getByRole('button', { name: /^roll back$/i })).toBeInTheDocument();
  });

  it('withholds manual rollout while automatic progression is armed', async () => {
    // The API answers a manual rollout with 409 while armed. Mirrored here so a
    // user is told why rather than shown a button that always fails.
    h.list.mockResolvedValue([
      candidate({ status: 'CANARY', rolloutRing: 5, automaticProgressionEnabled: true }),
    ]);

    render(<MsaidiziUpdatesWorkspace />);

    expect(await screen.findByText(/automatic progression is armed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /advance to/i })).not.toBeInTheDocument();
    // Rollback survives: it is the control that must never be taken away.
    expect(screen.getByRole('button', { name: /^roll back$/i })).toBeInTheDocument();
  });

  it('does not offer rollback from a status the API would refuse', async () => {
    h.list.mockResolvedValue([candidate({ status: 'APPROVED' })]);

    render(<MsaidiziUpdatesWorkspace />);
    await screen.findByText('Companion service');

    expect(screen.queryByRole('button', { name: /roll back/i })).not.toBeInTheDocument();
  });

  it('confirms before rolling back, and only calls the API after confirmation', async () => {
    const user = userEvent.setup();
    h.list.mockResolvedValue([candidate({ status: 'ACTIVE', rolloutRing: 100 })]);
    h.rollback.mockResolvedValue(candidate({ status: 'ROLLED_BACK', rolloutRing: 100 }));

    render(<MsaidiziUpdatesWorkspace />);
    await user.click(await screen.findByRole('button', { name: /^roll back$/i }));

    expect(h.rollback).not.toHaveBeenCalled();
    expect(screen.getByText(/return every device on 100%/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /roll back now/i }));
    await waitFor(() => expect(h.rollback).toHaveBeenCalledWith('cand-1'));
  });

  it('surfaces a refused rollout instead of silently leaving the old state', async () => {
    const user = userEvent.setup();
    h.rollout.mockRejectedValue(new Error('Manual rollout is unavailable'));

    render(<MsaidiziUpdatesWorkspace />);
    await user.click(await screen.findByRole('button', { name: /advance to 5%/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/manual rollout is unavailable/i);
  });

  it('says candidates come from the pipeline when there are none', async () => {
    h.list.mockResolvedValue([]);

    render(<MsaidiziUpdatesWorkspace />);

    expect(await screen.findByText(/signed artifact evidence/i)).toBeInTheDocument();
  });
});
