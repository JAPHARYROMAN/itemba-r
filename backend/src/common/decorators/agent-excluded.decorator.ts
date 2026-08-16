import { SetMetadata } from '@nestjs/common';

export const AGENT_EXCLUDED_KEY = 'agentExcluded';

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
 *
 * Not a security boundary on its own — it removes a capability from the tool
 * registry, it does not add an authorisation check. Routes that need protecting
 * still need their own permission.
 */
export const AgentExcluded = () => SetMetadata(AGENT_EXCLUDED_KEY, true);
