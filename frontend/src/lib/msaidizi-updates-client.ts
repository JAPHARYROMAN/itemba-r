/**
 * The self-update candidate API, as the browser reaches it.
 *
 * Every call goes through the same proxy the rest of the app uses, so this
 * surface is subject to exactly the guards a direct API caller is. Nothing here
 * decides authority: ring progression is re-evaluated server-side against the
 * active mandate and immutable deployment policy on every request, and a client
 * that asks for a ring it may not have is refused rather than obeyed.
 *
 * `evaluate` is absent on purpose. The endpoint exists but answers 503 until
 * signed, verifier-bound evaluator attestations are implemented, and shipping a
 * button whose only outcome is an error teaches users to ignore errors.
 */

import { backendGet, backendList, backendPost } from './api-client';
import type {
  MsaidiziUpdateCandidate,
  MsaidiziUpdateCandidateStatus,
  RolloutMsaidiziUpdateRequest,
} from './msaidizi-update-types';

const candidatePath = (id: string) => `/msaidizi/update-candidates/${encodeURIComponent(id)}`;

export function listMsaidiziUpdateCandidates(
  status?: MsaidiziUpdateCandidateStatus,
): Promise<MsaidiziUpdateCandidate[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return backendList<MsaidiziUpdateCandidate>(`/msaidizi/update-candidates${query}`);
}

export function fetchMsaidiziUpdateCandidate(id: string): Promise<MsaidiziUpdateCandidate> {
  return backendGet<MsaidiziUpdateCandidate>(candidatePath(id));
}

/**
 * Advances a candidate to a ring.
 *
 * The ring is a request, not an instruction: the broker re-derives what policy
 * permits and answers 409 when manual progression is unavailable because
 * automatic progression is armed.
 */
export function rolloutMsaidiziUpdateCandidate(
  id: string,
  request: RolloutMsaidiziUpdateRequest,
): Promise<MsaidiziUpdateCandidate> {
  return backendPost<MsaidiziUpdateCandidate>(`${candidatePath(id)}/rollout`, request);
}

/**
 * Returns devices to the previously deployed version.
 *
 * Accepted only from CANARY or ACTIVE; anything else is a 409. This is the one
 * destructive control on the surface, so callers are expected to confirm first.
 */
export function rollbackMsaidiziUpdateCandidate(id: string): Promise<MsaidiziUpdateCandidate> {
  return backendPost<MsaidiziUpdateCandidate>(`${candidatePath(id)}/rollback`);
}
