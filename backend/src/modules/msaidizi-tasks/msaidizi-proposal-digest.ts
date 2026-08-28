import { createHash } from 'node:crypto';

/**
 * Authority-bearing proposal projection. A draft taskId is included because
 * its persisted authority/artifact envelope is part of what the model saw;
 * one draft's receipt must never fund an identical-looking second draft.
 * Receipt and retry transport fields remain intentionally absent.
 */
export function msaidiziProposalDigest(plan: Record<string, unknown>): string {
  const projection: Record<string, unknown> = {
    title: plan.title,
    objective: plan.objective,
    summary: plan.summary,
    mode: plan.mode,
    inputs: plan.inputs ?? {},
    stopConditions: plan.stopConditions ?? {},
    budgets: plan.budgets,
    steps: plan.steps,
  };
  for (const key of ['taskId', 'companyId', 'mandateId', 'scheduleId'] as const) {
    if (plan[key] !== undefined) projection[key] = plan[key];
  }
  return createHash('sha256').update(canonicalJson(projection)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
