/**
 * CRUD coverage — the shapes the proof surface reads.
 *
 * The report exists to keep a large capability manifest from being mistaken for
 * proven CRUD, and the UI has the same job. Four separate things are counted,
 * and conflating any two of them would be the whole failure this report was
 * built to prevent:
 *
 *   - `total` — endpoints that exist in the router.
 *   - `included` — those eligible for Msaidizi at all.
 *   - `strictSchemas` — those whose request shape is fully described.
 *   - `loopbackVerified` — those actually EXECUTED against a live instance and
 *     observed to do what they claim.
 *
 * Only the last is evidence. A screen that led with the first would be
 * flattering and wrong.
 */

export type CrudOperationKind = 'read' | 'create' | 'update' | 'delete' | 'action';

export interface CrudCoverageSummary {
  total: number;
  discoveryEligible: number;
  discoveryIneligible: number;
  included: number;
  excluded: number;
  strictSchemas: number;
  withExecutionEvidence: number;
  loopbackVerified: number;
  registeredPositiveFixtures: number;
  executedPositiveFixtures: number;
  passedPositiveFixtures: number;
  securityControlsPassed: number;
  releaseQualified: boolean;
  byOperation: Record<CrudOperationKind, number>;
  includedByOperation: Record<CrudOperationKind, number>;
  loopbackVerifiedByOperation: Record<CrudOperationKind, number>;
  unverifiedByReason: Partial<Record<string, number>>;
}

/**
 * Whether a signed evidence artifact was accepted. `rejected` is a normal
 * answer, not an error: no artifact is configured in most environments, and the
 * report is still meaningful without one — it simply proves less.
 */
export interface CrudExecutionEvidence {
  status: 'accepted' | 'rejected';
  reason?: string;
  detail?: string;
  artifact?: {
    runId: string;
    generatedAt: string;
    expiresAt: string;
    manifestDigest: string;
    payloadDigest: string;
    keyId: string;
    harnessVersion: string;
  };
  securityControls: Record<string, { passed: boolean; cases: string[] }>;
}

export interface CrudReleaseGate {
  status: 'passed' | 'failed';
  target: string;
  blockers: Array<{ code: string; count: number }>;
}

export interface CrudCoverageReport {
  contract: 'msaidizi-crud-coverage/v1';
  generatedAt: string;
  summary: CrudCoverageSummary;
  executionEvidence: CrudExecutionEvidence;
  releaseGate: CrudReleaseGate;
  /**
   * Per-capability rows. Deliberately untyped beyond what the summary view
   * needs: the entry shape is large, changes with the manifest, and this
   * surface renders counts rather than a table of several hundred rows.
   */
  capabilities: unknown[];
}

export const CRUD_OPERATION_ORDER: readonly CrudOperationKind[] = [
  'read',
  'create',
  'update',
  'delete',
  'action',
];

/** Blocker codes read as SCREAMING_SNAKE; render them as prose. */
export function humaniseBlockerCode(code: string): string {
  const spaced = code.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
