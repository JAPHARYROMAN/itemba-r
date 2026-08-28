import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MsaidiziUpdateCandidateDetail } from '@/lib/msaidizi-update-types';
import { MsaidiziUpdateDetail } from './msaidizi-update-detail';

const h = vi.hoisted(() => ({ fetchOne: vi.fn() }));

vi.mock('@/lib/msaidizi-updates-client', () => ({
  fetchMsaidiziUpdateCandidate: h.fetchOne,
}));

const detail = (
  overrides: Partial<MsaidiziUpdateCandidateDetail> = {},
): MsaidiziUpdateCandidateDetail => ({
  id: 'cand-1',
  name: 'Companion service',
  version: '1.4.2',
  rollbackVersion: '1.4.1',
  scope: 'companion-service',
  status: 'ACTIVE',
  rolloutRing: 25,
  automaticProgressionEnabled: false,
  automaticProgressionArmedAt: null,
  sourceArtifactSha256: 'a'.repeat(64),
  rollbackArtifactSha256: 'b'.repeat(64),
  proposalRationale: 'Fixes the settlement latch.',
  evaluationDecidedAt: '2026-08-20T09:00:00.000Z',
  createdAt: '2026-08-19T09:00:00.000Z',
  proposedByTaskId: '11111111-2222-3333-4444-555555555555',
  proposalDigest: null,
  evaluationBundleDigest: null,
  generationManifestSha256: null,
  automaticProgressionArmedById: null,
  automaticProgressionMinimumSoakSeconds: null,
  automaticProgressionHealthTimeoutSeconds: null,
  automaticProgressionRing0DwellSeconds: null,
  automaticProgressionRing5DwellSeconds: null,
  automaticProgressionRing25DwellSeconds: null,
  automaticProgressionRing100DwellSeconds: null,
  automaticProgressionRingHealthyAt: null,
  automaticProgressionCohortDeviceIds: null,
  automaticProgressionCohortSha256: null,
  automaticProgressionCohortCapturedAt: null,
  recoveryPending: false,
  recoveryRequestedAt: null,
  recoveryLastAttemptAt: null,
  recoveryLastErrorCode: null,
  healthSummary: null,
  deployedAt: '2026-08-21T09:00:00.000Z',
  rolledBackAt: null,
  updatedAt: '2026-08-21T09:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.fetchOne.mockResolvedValue(detail());
});

describe('MsaidiziUpdateDetail', () => {
  it('re-reads the candidate on open rather than trusting the list row', async () => {
    render(<MsaidiziUpdateDetail candidateId="cand-1" />);

    expect(await screen.findByText(/companion service 1\.4\.2/i)).toBeInTheDocument();
    expect(h.fetchOne).toHaveBeenCalledWith('cand-1');
  });

  it('leads with an unfinished rollback, which no status pill would show', async () => {
    // The state that gets someone hurt: the candidate reads as rolled back, but
    // some devices never got the rollback.
    h.fetchOne.mockResolvedValue(
      detail({
        status: 'FAILED',
        recoveryPending: true,
        recoveryLastErrorCode: 'RECOVERY_TARGET_UNAVAILABLE',
        recoveryRequestedAt: '2026-08-22T09:00:00.000Z',
        healthSummary: {
          rollbackInProgress: true,
          requiredRollbackDevices: 10,
          remainingRollbackDevices: 3,
          unavailableRollbackDevices: 3,
          queuedRollbackDeployments: 7,
        },
      }),
    );

    render(<MsaidiziUpdateDetail candidateId="cand-1" />);

    expect(await screen.findByText(/rollback has not finished/i)).toBeInTheDocument();
    expect(
      screen.getByText(/7 of 10 devices are back on the previous version/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 could not be reached/i)).toBeInTheDocument();
  });

  it('separates waiting from stuck for a pending recovery', async () => {
    h.fetchOne.mockResolvedValue(
      detail({
        recoveryPending: true,
        recoveryLastErrorCode: 'RECOVERY_TARGET_UNAVAILABLE',
        healthSummary: { rollbackInProgress: true, requiredRollbackDevices: 2 },
      }),
    );

    render(<MsaidiziUpdateDetail candidateId="cand-1" />);

    expect(await screen.findByText(/waiting, not stuck/i)).toBeInTheDocument();
  });

  it('says so when a recovery error is not retried automatically', async () => {
    h.fetchOne.mockResolvedValue(
      detail({
        recoveryPending: true,
        recoveryLastErrorCode: 'SIGNER_REFUSED',
        healthSummary: { rollbackInProgress: true },
      }),
    );

    render(<MsaidiziUpdateDetail candidateId="cand-1" />);

    expect(await screen.findByText(/needs someone to look at it/i)).toBeInTheDocument();
  });

  it('stays quiet about rollback when none is in flight', async () => {
    render(<MsaidiziUpdateDetail candidateId="cand-1" />);
    await screen.findByText(/where this came from/i);

    expect(screen.queryByText(/rollback has not finished/i)).not.toBeInTheDocument();
  });

  it('shows dwell policy only while automatic progression is armed', async () => {
    render(<MsaidiziUpdateDetail candidateId="cand-1" />);
    await screen.findByText(/where this came from/i);
    // Unarmed: every dwell is null, and a grid of dashes would imply an empty
    // policy rather than no policy.
    expect(screen.queryByText(/automatic progression/i)).not.toBeInTheDocument();

    h.fetchOne.mockResolvedValue(
      detail({
        automaticProgressionEnabled: true,
        automaticProgressionArmedAt: '2026-08-21T10:00:00.000Z',
        automaticProgressionRing0DwellSeconds: 3600,
        automaticProgressionRing5DwellSeconds: 5400,
        automaticProgressionMinimumSoakSeconds: 90,
      }),
    );
    render(<MsaidiziUpdateDetail candidateId="cand-2" />);

    expect(await screen.findByText(/rings advance on their own/i)).toBeInTheDocument();
    expect(screen.getByText('0% · 1h')).toBeInTheDocument();
    expect(screen.getByText('5% · 1h 30m')).toBeInTheDocument();
  });

  it('states that the device cohort is frozen', async () => {
    h.fetchOne.mockResolvedValue(
      detail({
        automaticProgressionCohortDeviceIds: ['d1', 'd2', 'd3'],
        automaticProgressionCohortCapturedAt: '2026-08-21T10:00:00.000Z',
        automaticProgressionCohortSha256: 'c'.repeat(64),
      }),
    );

    render(<MsaidiziUpdateDetail candidateId="cand-1" />);

    expect(
      await screen.findByText(/3 devices, fixed when progression was armed/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/not part of this rollout/i)).toBeInTheDocument();
  });

  it('hands the proposing task back to the caller to open', async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();

    render(<MsaidiziUpdateDetail candidateId="cand-1" onOpenTask={onOpenTask} />);
    await user.click(await screen.findByRole('button', { name: /^11111111…$/ }));

    expect(onOpenTask).toHaveBeenCalledWith('11111111-2222-3333-4444-555555555555');
  });

  it('surfaces a failed load rather than an empty panel', async () => {
    h.fetchOne.mockRejectedValue(new Error('Candidate not found'));

    render(<MsaidiziUpdateDetail candidateId="cand-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/candidate not found/i);
  });
});
