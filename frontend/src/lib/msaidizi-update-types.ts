/**
 * Self-update candidates — the shapes the rollout surface exchanges with the API.
 *
 * Three properties are enforced server-side and have to be rendered honestly,
 * because a screen that implied otherwise would teach the wrong model of a
 * pipeline that replaces software on real workstations:
 *
 *   - Rings are a SEQUENCE, not a set of independent switches. 0 -> 5 -> 25 ->
 *     100 is the order deployment policy allows, so the UI presents it as a
 *     progression rather than four buttons.
 *   - Armed automatic progression REMOVES the manual choice. The API answers a
 *     manual rollout with a 409 while it is armed, so the UI must not offer one.
 *   - Rollback is only reachable from CANARY or ACTIVE. There is nothing to roll
 *     back from a candidate that never shipped, and the API says so with a 409.
 *
 * Registering a candidate is deliberately absent. It requires artifact-backed,
 * signed evidence produced by the release pipeline, not a browser form.
 */

export type MsaidiziUpdateCandidateStatus =
  | 'DRAFT'
  | 'EVALUATING'
  | 'REJECTED'
  | 'APPROVED'
  | 'CANARY'
  | 'ACTIVE'
  | 'ROLLED_BACK'
  | 'FAILED';

/** The only ring values deployment policy accepts, in progression order. */
export const MSAIDIZI_ROLLOUT_RINGS = [0, 5, 25, 100] as const;
export type MsaidiziRolloutRing = (typeof MSAIDIZI_ROLLOUT_RINGS)[number];

/**
 * A projection of the candidate, limited to what this surface renders.
 *
 * The API returns considerably more — proposal provenance, evaluation bundles,
 * reviewer decisions. Naming only what is displayed keeps the screen from
 * quietly depending on fields it never shows.
 */
export interface MsaidiziUpdateCandidate {
  id: string;
  name: string;
  version: string;
  /** Absent on older candidates, which are deliberately ineligible to deploy. */
  rollbackVersion: string | null;
  scope: string;
  status: MsaidiziUpdateCandidateStatus;
  rolloutRing: number;
  automaticProgressionEnabled: boolean;
  automaticProgressionArmedAt: string | null;
  sourceArtifactSha256: string | null;
  rollbackArtifactSha256: string | null;
  proposalRationale: string | null;
  evaluationDecidedAt: string | null;
  createdAt: string;
}

export interface RolloutMsaidiziUpdateRequest {
  ring: MsaidiziRolloutRing;
  /** Explicit membership. Omitted, the broker samples enrolled devices itself. */
  deviceIds?: string[];
}

/**
 * Statuses from which the API will accept a rollback. Mirrored rather than
 * guessed: `rollback()` throws a 409 from anything else.
 */
export const ROLLBACK_ELIGIBLE_STATUSES: ReadonlySet<MsaidiziUpdateCandidateStatus> = new Set([
  'CANARY',
  'ACTIVE',
]);

/**
 * Statuses from which a rollout is worth offering. A rejected, failed or
 * already-rolled-back candidate is a settled answer; the API would refuse and
 * the button would only teach the user to expect errors.
 */
export const ROLLOUT_ELIGIBLE_STATUSES: ReadonlySet<MsaidiziUpdateCandidateStatus> = new Set([
  'APPROVED',
  'CANARY',
  'ACTIVE',
]);

/** The next ring in the progression, or null at the end of it. */
export function nextRolloutRing(current: number): MsaidiziRolloutRing | null {
  return MSAIDIZI_ROLLOUT_RINGS.find((ring) => ring > current) ?? null;
}

/**
 * The merged health bag the supervisor and the rollback sweep both write into.
 *
 * Every field is optional because it is genuinely a bag: an apply result writes
 * the observation keys, a rollback wave writes the wave keys, and a candidate
 * that has done both carries a merge of the two. Rendering it means asking what
 * is present, never assuming a shape.
 */
export interface MsaidiziUpdateHealthSummary {
  healthy?: boolean;
  source?: string;
  rolloutRing?: number;
  reason?: string;
  observedAt?: string;
  /** A rollback wave is dispatched but not yet proven on every device. */
  rollbackInProgress?: boolean;
  rollbackDispatchPending?: boolean;
  requiredRollbackDevices?: number;
  queuedRollbackDeployments?: number;
  remainingRollbackDevices?: number;
  /** Devices the rollback could not reach — the reason recovery stays pending. */
  unavailableRollbackDevices?: number;
  recoveryDispatchedAt?: string;
}

/**
 * Everything `GET /msaidizi/update-candidates/:id` carries that the detail view
 * renders. The list endpoint returns the same row, but the detail view fetches
 * again on open so an operator deciding a rollout is not reading a cached page.
 *
 * Per-device deployment rows are NOT here — they are not exposed on this
 * permission. What IS exposed is the frozen cohort the rollout was armed
 * against, which answers the same question a device list would: who is affected.
 */
export interface MsaidiziUpdateCandidateDetail extends MsaidiziUpdateCandidate {
  proposedByTaskId: string | null;
  proposalDigest: string | null;
  evaluationBundleDigest: string | null;
  generationManifestSha256: string | null;

  automaticProgressionArmedById: string | null;
  automaticProgressionMinimumSoakSeconds: number | null;
  automaticProgressionHealthTimeoutSeconds: number | null;
  automaticProgressionRing0DwellSeconds: number | null;
  automaticProgressionRing5DwellSeconds: number | null;
  automaticProgressionRing25DwellSeconds: number | null;
  automaticProgressionRing100DwellSeconds: number | null;
  automaticProgressionRingHealthyAt: string | null;
  automaticProgressionCohortDeviceIds: string[] | null;
  automaticProgressionCohortSha256: string | null;
  automaticProgressionCohortCapturedAt: string | null;

  recoveryPending: boolean;
  recoveryRequestedAt: string | null;
  recoveryLastAttemptAt: string | null;
  recoveryLastErrorCode: string | null;

  healthSummary: MsaidiziUpdateHealthSummary | null;
  deployedAt: string | null;
  rolledBackAt: string | null;
  updatedAt: string | null;
}

/**
 * Recovery error codes the server retries on its own sweep. An operator seeing
 * one of these is waiting, not stuck, and the UI should say which it is rather
 * than presenting every pending recovery as a problem to escalate.
 */
export const RETRYABLE_RECOVERY_ERROR_CODES: ReadonlySet<string> = new Set([
  'RECOVERY_TARGET_UNAVAILABLE',
  'DEVICE_DISABLED_APPLY_PEER_RECOVERY_REQUIRED',
]);

/** Per-ring dwell, in the order the rings are entered. */
export function ringDwellSeconds(
  candidate: MsaidiziUpdateCandidateDetail,
): Array<{ ring: MsaidiziRolloutRing; seconds: number | null }> {
  return [
    { ring: 0, seconds: candidate.automaticProgressionRing0DwellSeconds },
    { ring: 5, seconds: candidate.automaticProgressionRing5DwellSeconds },
    { ring: 25, seconds: candidate.automaticProgressionRing25DwellSeconds },
    { ring: 100, seconds: candidate.automaticProgressionRing100DwellSeconds },
  ];
}

/** Seconds as an operator reads them: "45m", "2h 30m", "90s". */
export function formatDwell(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}
