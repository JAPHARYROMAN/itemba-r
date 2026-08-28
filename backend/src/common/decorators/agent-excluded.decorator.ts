import { applyDecorators, SetMetadata } from '@nestjs/common';

export const AGENT_EXCLUDED_KEY = 'agentExcluded';
export const AGENT_EXCLUSION_REASON_KEY = 'agentExclusionReason';

export type AgentExclusionReason =
  | 'agent_excluded'
  | 'read_writes_audit_ledger'
  | 'device_headers_not_represented'
  | 'binary_result_not_represented'
  | 'multipart_transport_not_represented'
  | 'external_egress_not_represented'
  | 'filesystem_materialization_not_represented'
  | 'asynchronous_effect_not_represented'
  | 'recent_human_auth_required'
  | 'company_scope_not_enforced'
  | 'query_schema_not_strict';

/**
 * Marks a route as never available to the agent, regardless of permissions.
 *
 * The permission envelope answers "may this user do it". This answers a
 * different question: "does it make sense for an agent to do it at all". The two
 * are independent — a user may legitimately hold a permission for something an
 * agent should never touch.
 *
 * Use it for:
 *   - Msaidizi's own endpoints, so a run cannot invoke itself recursively.
 *   - Anything whose effect is on the conversation rather than on business data.
 *   - A transport, egress, filesystem, asynchronous, or human-auth ceremony
 *     that the current governed agent envelope cannot yet represent and
 *     reconcile. The reason must describe that missing contract exactly.
 *
 * Not a security boundary on its own — it removes a capability from the tool
 * registry, it does not add an authorisation check. Routes that need protecting
 * still need their own permission.
 */
export const AgentExcluded = (reason: AgentExclusionReason = 'agent_excluded') =>
  applyDecorators(
    SetMetadata(AGENT_EXCLUDED_KEY, true),
    SetMetadata(AGENT_EXCLUSION_REASON_KEY, reason),
  );
