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
