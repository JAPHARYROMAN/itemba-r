/**
 * Turns the capability manifest into Anthropic tool definitions.
 *
 * Two filters run before a capability becomes a tool, and both are structural
 * rather than advisory:
 *
 *   1. The user's permissions, via capabilitiesFor(). An unpermitted capability
 *      never becomes a tool, so the model cannot see it, name it, or argue about
 *      it. This is the envelope.
 *   2. The deployment's write mode. Read-only deployments emit no write tools at
 *      all, so "the agent must not write" is enforced by the absence of the
 *      capability rather than by asking the model nicely.
 *
 * Definitions are emitted as plain JSON rather than SDK types so this module —
 * and its tests — stay independent of the Anthropic client.
 */

import { Capability, capabilitiesFor } from '../../common/capabilities/capability-manifest';
import { ReversibilityTier } from '../../common/capabilities/reversibility';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  /** Tool-search loads the schema on demand rather than keeping it resident. */
  defer_loading?: boolean;
}

export interface RegistryEntry {
  tool: ToolDefinition;
  capability: Capability;
}

/** Anthropic tool names: letters, digits, underscore and hyphen, max 64. */
const MAX_TOOL_NAME = 64;

/**
 * Derives a stable, readable, unique tool name from a capability id.
 *
 * `ProfitController.productLedger` becomes `profit_productLedger`. Stability
 * matters more than beauty: the name appears in prompt-cached tool definitions
 * and in the audit trail, so it should not churn when unrelated routes change.
 */
export function toolNameFor(capability: Capability, taken: Set<string>): string {
  const base = capability.controller.replace(/Controller$/, '');
  let name = `${base}_${capability.handler}`
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, MAX_TOOL_NAME);

  if (!taken.has(name)) return name;

  // Collisions are only possible after truncation, since capability ids are
  // unique. Suffix deterministically rather than by insertion order.
  for (let i = 2; ; i += 1) {
    const suffix = `_${i}`;
    name = `${name.slice(0, MAX_TOOL_NAME - suffix.length)}${suffix}`;
    if (!taken.has(name)) return name;
  }
}

/** Human-readable action phrase for a capability, for the tool description. */
function describeAction(capability: Capability): string {
  if (capability.summary) return capability.summary;
  // Split the handler name into words: `productLedger` -> `product ledger`.
  const words = capability.handler
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return `${words} (${capability.verb} /${capability.path})`;
}

export interface BuildOptions {
  /**
   * Mark tools for on-demand loading. Only set this when a tool-search tool is
   * also declared: a deferred tool with nothing to surface it is invisible to
   * the model, which looks exactly like the capability not existing.
   */
  defer?: boolean;
}

export function buildToolDefinition(
  capability: Capability,
  name: string,
  options: BuildOptions = {},
): ToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of capability.params.path) {
    properties[param] = {
      type: 'string',
      description: `Identifier for the ${param.replace(/Id$/, '')} in the route path.`,
    };
    required.push(param);
  }

  for (const param of capability.params.query) {
    if (properties[param]) continue; // a path param of the same name wins
    properties[param] = { type: 'string', description: `Optional \`${param}\` filter.` };
  }

  if (capability.params.hasBody) {
    properties.body = {
      type: 'object',
      description: 'Request body fields. Only send fields you were asked to set.',
      additionalProperties: true,
    };
  }

  const notes: string[] = [];
  if (capability.tier !== 'green') {
    notes.push(
      capability.tier === 'red'
        ? 'This action is irreversible or financially significant and requires explicit confirmation before it runs.'
        : 'This action changes data. It can be undone, but say what you changed.',
    );
  }
  if (capability.params.freeFormQuery) {
    notes.push(
      'Accepts additional filter parameters that are not enumerated here; prefer the ones listed, and do not invent parameter names.',
    );
  }

  return {
    name,
    description: [describeAction(capability), ...notes].join(' '),
    input_schema: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      // Free-form-query handlers genuinely accept unenumerated keys; everything
      // else is closed so a hallucinated parameter fails fast and locally
      // instead of being rejected downstream by the global ValidationPipe.
      additionalProperties: capability.params.freeFormQuery || capability.params.hasBody,
    },
    ...(options.defer ? { defer_loading: true } : {}),
  };
}

/**
 * Builds the tool set for one request.
 *
 * @param manifest      The full capability manifest.
 * @param permissions   The caller's granted permission codes.
 * @param allowedTiers  Tiers the deployment permits (see MsaidiziConfig.writeMode).
 */
export function buildRegistry(
  manifest: Capability[],
  permissions: readonly string[],
  allowedTiers: readonly ReversibilityTier[],
  options: BuildOptions = {},
): RegistryEntry[] {
  const tierSet = new Set(allowedTiers);
  const permitted = capabilitiesFor(manifest, permissions).filter((c) => tierSet.has(c.tier));

  const taken = new Set<string>();
  return permitted.map((capability) => {
    const name = toolNameFor(capability, taken);
    taken.add(name);
    return { tool: buildToolDefinition(capability, name, options), capability };
  });
}

/** Index a registry by tool name, for dispatching a model tool call. */
export function indexByToolName(entries: RegistryEntry[]): Map<string, RegistryEntry> {
  return new Map(entries.map((e) => [e.tool.name, e]));
}
