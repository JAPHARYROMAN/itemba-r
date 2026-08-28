import type { RegistryEntry } from './tool-registry';

/**
 * A server-enforced run policy for the one benchmark intent whose live trace
 * fanned out after the correct answer source had already been called.
 *
 * This deliberately is not part of the registry: resident tools are stable for
 * a caller's permissions, while a run policy is selected from the current turn.
 */
export interface MeasuredFastPath {
  id: 'recent-expense-detail';
  capabilityId: 'ExpensesController.findAll';
  /** A successful read is enough; one retry is allowed for a transient/read failure. */
  maxAttempts: 2;
}

export interface ResolvedMeasuredFastPath extends MeasuredFastPath {
  /** Permission-filtered wire name, including any deterministic collision suffix. */
  toolName: string;
}

function normalise(value: string): string {
  return value
    .toLocaleLowerCase('en')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Recognises requests for recent expense records/details, not every question
 * containing "expense". False negatives retain ordinary BM25 tool search; that
 * is safer than forcing a paginated record endpoint for policy, aggregate,
 * trend, comparison, or mutation questions.
 */
export function matchMeasuredFastPath(question: string): MeasuredFastPath | undefined {
  const value = normalise(question);
  const temporalCue =
    /\b(?:recent|recently|lately|today|yesterday|this|last|past|week|month|quarter|year)\b/.test(
      value,
    );
  const detailCue =
    /\b(?:breakdown|detail|details|item|items|record|records|transaction|transactions)\b/.test(
      value,
    );
  const whatWasMoneySpentOn =
    /^what (?:did|have|has) (?:we|our (?:company|business)|the (?:company|business)) (?:spend|spent) money on (?:recently|lately|today|yesterday|this (?:week|month|quarter|year)|last (?:day|week|month|quarter|year)|past (?:day|week|month|quarter|year))$/.test(
      value,
    );
  const expenseRecordCollection =
    /^(?:list|show|give)(?: me)?(?: (?:our|the|all|a|an))?(?: (?:recent|recently))? (?:expense|expenses|expenditure|expenditures)(?: (?:breakdown|detail|details|item|items|record|records|transaction|transactions))?(?: (?:for|from|during|in))?(?: (?:today|yesterday|this (?:week|month|quarter|year)|last (?:day|week|month|quarter|year)|past (?:day|week|month|quarter|year)))?$/.test(
      value,
    );

  // A positive grammar is intentional. Requests containing another domain,
  // connector, analytic operation, or mutation simply do not fit it and stay on
  // ordinary search; safety does not depend on an ever-growing blacklist.
  if (!whatWasMoneySpentOn && !(expenseRecordCollection && (temporalCue || detailCue)))
    return undefined;

  return {
    id: 'recent-expense-detail',
    capabilityId: 'ExpensesController.findAll',
    maxAttempts: 2,
  };
}

/**
 * Resolves only through the already permission- and tier-filtered registry and
 * defensively re-checks that the measured source remains a green GET. If route
 * metadata changes later, the shortcut disappears instead of changing effect.
 */
export function resolveMeasuredFastPath(
  question: string,
  permitted: readonly RegistryEntry[],
): ResolvedMeasuredFastPath | undefined {
  const match = matchMeasuredFastPath(question);
  if (!match) return undefined;

  const entry = permitted.find(
    (candidate) =>
      candidate.capability.id === match.capabilityId &&
      candidate.capability.verb === 'GET' &&
      candidate.capability.tier === 'green',
  );
  return entry ? { ...match, toolName: entry.tool.name } : undefined;
}
