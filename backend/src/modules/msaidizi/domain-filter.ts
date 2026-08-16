/**
 * Narrows the capability set before it reaches the model.
 *
 * A broadly-granted user can hold several hundred permitted read capabilities.
 * Sending every schema on every turn would dominate the context window and the
 * bill, and a large undifferentiated tool list measurably degrades tool choice.
 *
 * The narrowing here is deterministic: score each capability against the request
 * text by module and path vocabulary, keep the best. Deterministic rather than
 * model-driven because it is cheap, testable, and produces the same tool set for
 * the same question — which matters when you are trying to reproduce a bad run.
 *
 * The plan's Haiku pre-filter is the natural next step for ambiguous requests;
 * this is the layer it would sit in front of.
 */

import { Capability } from '../../common/capabilities/capability-manifest';

/** Words that carry no signal about which part of the system is wanted. */
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'for',
  'to',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'my',
  'our',
  'me',
  'we',
  'you',
  'your',
  'what',
  'which',
  'who',
  'when',
  'where',
  'how',
  'show',
  'list',
  'get',
  'find',
  'tell',
  'give',
  'need',
  'want',
  'please',
  'can',
  'could',
  'would',
  'should',
  'all',
  'any',
  'some',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'about',
  'into',
  'over',
  'under',
  'than',
  'then',
  'there',
  'here',
  'now',
  'today',
  'last',
  'next',
  'per',
]);

/** Singularise crudely: `invoices` -> `invoice`. Good enough for token overlap. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map(stem);
  return new Set(words);
}

/** The vocabulary a capability answers to: its path, module codes and handler. */
export function capabilityTokens(capability: Capability): Set<string> {
  const parts = [
    capability.path.replace(/:[A-Za-z0-9_]+/g, ' '),
    capability.handler.replace(/([a-z0-9])([A-Z])/g, '$1 $2'),
    capability.summary ?? '',
    ...capability.permissions,
    ...capability.anyPermissions,
  ].join(' ');
  return tokenize(parts.replace(/[._-]+/g, ' '));
}

export interface NarrowOptions {
  /** Hard ceiling on how many capabilities reach the model. */
  limit: number;
  /**
   * Always keep at least this many even with no lexical overlap, so a request
   * whose words match nothing still gets a usable starting set rather than an
   * empty toolbox.
   */
  floor?: number;
}

/**
 * Scores and trims capabilities against the request text.
 *
 * Scoring is intentionally simple: count overlapping tokens, weight a match on
 * the permission module higher than one deep in a path segment, and prefer
 * shorter paths so `customers` outranks `customers/:id/statements/archive` when
 * both match equally.
 */
export function narrowCapabilities(
  capabilities: Capability[],
  requestText: string,
  options: NarrowOptions,
): Capability[] {
  const wanted = tokenize(requestText);
  const floor = options.floor ?? 0;

  const scored = capabilities.map((capability) => {
    const tokens = capabilityTokens(capability);
    let score = 0;
    for (const token of wanted) {
      if (tokens.has(token)) score += 1;
    }

    // A match on the module prefix of a permission code is a stronger signal
    // than an incidental match on a path segment.
    const modules = new Set(
      [...capability.permissions, ...capability.anyPermissions].map((c) => c.split('.')[0]),
    );
    for (const moduleName of modules) {
      for (const token of tokenize(moduleName.replace(/[._-]+/g, ' '))) {
        if (wanted.has(token)) score += 2;
      }
    }

    return { capability, score, depth: capability.path.split('/').length };
  });

  const matched = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.depth - b.depth)
    .slice(0, options.limit)
    .map((s) => s.capability);

  if (matched.length >= floor) return matched;

  // Nothing matched well enough. Fall back to the shallowest capabilities, which
  // are the collection-level list endpoints — the most useful place for an agent
  // to start orienting itself.
  const fallback = scored
    .filter((s) => !matched.includes(s.capability))
    .sort((a, b) => a.depth - b.depth || a.capability.path.localeCompare(b.capability.path))
    .slice(0, Math.min(floor, options.limit) - matched.length)
    .map((s) => s.capability);

  return [...matched, ...fallback];
}
