import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CrudCoverageReport } from '@/lib/msaidizi-coverage-types';
import { MsaidiziCoverageWorkspace } from './msaidizi-coverage';

const h = vi.hoisted(() => ({
  fetchReport: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: h.hasPermission, user: { id: 'user-1' } }),
}));

vi.mock('@/lib/msaidizi-coverage-client', () => ({
  fetchMsaidiziCrudCoverage: h.fetchReport,
}));

const report = (overrides: Partial<CrudCoverageReport> = {}): CrudCoverageReport => ({
  contract: 'msaidizi-crud-coverage/v1',
  generatedAt: '2026-08-28T09:00:00.000Z',
  summary: {
    total: 400,
    discoveryEligible: 300,
    discoveryIneligible: 100,
    included: 200,
    excluded: 200,
    strictSchemas: 180,
    withExecutionEvidence: 40,
    loopbackVerified: 30,
    registeredPositiveFixtures: 50,
    executedPositiveFixtures: 45,
    passedPositiveFixtures: 44,
    securityControlsPassed: 3,
    releaseQualified: false,
    byOperation: { read: 200, create: 80, update: 70, delete: 30, action: 20 },
    includedByOperation: { read: 120, create: 40, update: 25, delete: 10, action: 5 },
    loopbackVerifiedByOperation: { read: 30, create: 0, update: 0, delete: 0, action: 0 },
    unverifiedByReason: { no_fixture: 170 },
  },
  executionEvidence: {
    status: 'rejected',
    detail: 'No signed artifact is configured.',
    securityControls: {},
  },
  releaseGate: {
    status: 'failed',
    target: 'all_discovery_eligible_operations',
    blockers: [{ code: 'MISSING_EXECUTION_EVIDENCE', count: 170 }],
  },
  capabilities: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.hasPermission.mockReturnValue(true);
  h.fetchReport.mockResolvedValue(report());
});

describe('MsaidiziCoverageWorkspace', () => {
  it('requires audit-log access as well as Msaidizi access', async () => {
    h.hasPermission.mockImplementation((permission: string) => permission !== 'audit-logs.read');

    render(<MsaidiziCoverageWorkspace />);

    expect(await screen.findByText(/needs\s+audit-log access/i)).toBeInTheDocument();
    expect(h.fetchReport).not.toHaveBeenCalled();
  });

  it('leads with the release gate and its blockers', async () => {
    render(<MsaidiziCoverageWorkspace />);

    expect(await screen.findByText(/release gate not passed/i)).toBeInTheDocument();
    // Blocker codes are SCREAMING_SNAKE on the wire; a reader gets prose.
    expect(screen.getByText('Missing execution evidence')).toBeInTheDocument();
    expect(screen.getByText('170')).toBeInTheDocument();
  });

  it('states proof as a share of what is included, not of the whole router', async () => {
    // The report exists to stop a big manifest reading as proven CRUD. 30 of 200
    // included is 15%; 30 of 400 total would be a flattering 8% of a bigger
    // number, and neither is the honest headline unless it is labelled.
    render(<MsaidiziCoverageWorkspace />);

    expect(await screen.findByText('15%')).toBeInTheDocument();
    expect(screen.getByText(/of included capabilities/i)).toBeInTheDocument();
    expect(screen.getByText('200 included')).toBeInTheDocument();
  });

  it('says plainly when nothing is backed by a recorded run', async () => {
    render(<MsaidiziCoverageWorkspace />);

    expect(await screen.findByText('None accepted')).toBeInTheDocument();
    expect(screen.getByText(/no signed artifact is configured/i)).toBeInTheDocument();
  });

  it('shows the signing provenance when evidence was accepted', async () => {
    h.fetchReport.mockResolvedValue(
      report({
        executionEvidence: {
          status: 'accepted',
          artifact: {
            runId: 'run-7',
            generatedAt: '2026-08-27T09:00:00.000Z',
            expiresAt: '2026-08-29T09:00:00.000Z',
            manifestDigest: 'c'.repeat(64),
            payloadDigest: 'd'.repeat(64),
            keyId: 'evidence-key-1',
            harnessVersion: '2.1.0',
          },
          securityControls: { permission: { passed: true, cases: ['denies-unpermitted'] } },
        },
      }),
    );

    render(<MsaidiziCoverageWorkspace />);

    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('run-7')).toBeInTheDocument();
    expect(screen.getByText('evidence-key-1')).toBeInTheDocument();
  });

  it('breaks proof down per operation so an unproven one is visible', async () => {
    render(<MsaidiziCoverageWorkspace />);

    await screen.findByText(/executed against included, by operation/i);
    // Reads are proven 30/120; deletes are not proven at all, and the row says so
    // rather than being omitted.
    expect(screen.getByText('30 / 120')).toBeInTheDocument();
    expect(screen.getByText('0 / 10')).toBeInTheDocument();
  });

  it('surfaces a failed load instead of rendering an empty report', async () => {
    h.fetchReport.mockRejectedValue(new Error('Coverage is unavailable'));

    render(<MsaidiziCoverageWorkspace />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/coverage is unavailable/i);
  });
});
