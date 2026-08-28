import { MsaidiziTaskMode } from '@prisma/client';
import { createHash } from 'node:crypto';

export const MSAIDIZI_PROPOSAL_IN_FLIGHT_PREFIX = 'MSAIDIZI_PROPOSAL_IN_FLIGHT_V1:';
const MSAIDIZI_DRAFT_REQUEST_BINDING_PREFIX = 'MSAIDIZI_DRAFT_REQUEST_V1:';

export interface MsaidiziDraftProposalAuthority {
  taskId: string;
  principalId: string;
  initiatedByUserId: string;
  companyId: string | null;
  mandateId: string | null;
  mode: MsaidiziTaskMode;
  stateVersion: number;
}

export interface MsaidiziDraftProposalLease {
  authority: MsaidiziDraftProposalAuthority;
  receiptId: string;
  marker: string;
  leasedStateVersion: number;
}

export function proposalInFlightMarker(receiptId: string): string {
  return `${MSAIDIZI_PROPOSAL_IN_FLIGHT_PREFIX}${receiptId}`;
}

export function proposalReceiptIdFromMarker(value: string | null | undefined): string | null {
  if (!value?.startsWith(MSAIDIZI_PROPOSAL_IN_FLIGHT_PREFIX)) return null;
  const receiptId = value.slice(MSAIDIZI_PROPOSAL_IN_FLIGHT_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    receiptId,
  )
    ? receiptId
    : null;
}

export function isProposalInFlightMarker(value: string | null | undefined): boolean {
  return proposalReceiptIdFromMarker(value) !== null;
}

/**
 * Keep recovery fail-closed without adding a task foreign key to the receipt.
 * Both values are one-way digests; no objective, artifact, prompt or model
 * content is introduced into the accounting row.
 */
export function bindProposalRequestDigest(
  requestDigest: string,
  authority: MsaidiziDraftProposalAuthority,
): string {
  return `${MSAIDIZI_DRAFT_REQUEST_BINDING_PREFIX}${draftAuthorityDigest(authority)}:${requestDigest}`;
}

export function proposalRequestDigestMatchesAuthority(
  requestDigest: string,
  authority: MsaidiziDraftProposalAuthority,
): boolean {
  const prefix = `${MSAIDIZI_DRAFT_REQUEST_BINDING_PREFIX}${draftAuthorityDigest(authority)}:`;
  const providerRequestDigest = requestDigest.startsWith(prefix)
    ? requestDigest.slice(prefix.length)
    : '';
  return /^[0-9a-f]{64}$/i.test(providerRequestDigest);
}

function draftAuthorityDigest(authority: MsaidiziDraftProposalAuthority): string {
  // The ordered tuple is the protocol shape; object key order cannot alter it.
  const canonical = JSON.stringify([
    authority.taskId,
    authority.principalId,
    authority.initiatedByUserId,
    authority.companyId,
    authority.mandateId,
    authority.mode,
    authority.stateVersion,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}
