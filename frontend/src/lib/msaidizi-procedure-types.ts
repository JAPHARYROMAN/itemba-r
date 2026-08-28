/**
 * Saved procedures — the shapes the procedures surface exchanges with the API.
 *
 * A procedure is a saved *instruction*, never a grant. Two properties the UI
 * has to render honestly, because both are enforced server-side and a screen
 * that implied otherwise would be teaching the wrong model of the feature:
 *
 *   - A run uses the INVOKER's permissions, not the author's. A clerk running a
 *     director's procedure does what the clerk may do and no more.
 *   - The approved capability list is a CEILING, not a snapshot that refreshes.
 *     A procedure approved last month cannot widen because new endpoints
 *     appeared since.
 */

import type { ReversibilityTier } from './msaidizi-types';

export type MsaidiziProcedureStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

/**
 * One capability a run would be allowed to call, as the compile step resolved
 * it. This is the review material: a reviewer approves this list, so it has to
 * carry enough to judge it — what it is, and how reversible.
 */
export interface MsaidiziProcedureCapabilityPreview {
  tool: string;
  description: string;
  tier: ReversibilityTier;
  path: string;
}

/**
 * The result of compiling an instruction. Saves nothing: the author reads it,
 * then creates the procedure with the capability list it produced.
 */
export interface MsaidiziCompiledProcedure {
  capabilities: string[];
  /** Highest tier among them — the blast radius, stated once. */
  highestTier: ReversibilityTier;
  preview: MsaidiziProcedureCapabilityPreview[];
}

export interface MsaidiziProcedure {
  id: string;
  companyId: string | null;
  name: string;
  /** The author's own words, stored verbatim. Rendered as text, never markup. */
  instruction: string;
  capabilities: string[];
  highestTier: ReversibilityTier;
  status: MsaidiziProcedureStatus;
  version: number;
  createdById: string;
  approvedById: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompileMsaidiziProcedureRequest {
  instruction: string;
}

export interface CreateMsaidiziProcedureRequest {
  name: string;
  instruction: string;
  companyId?: string;
  capabilities: string[];
}
