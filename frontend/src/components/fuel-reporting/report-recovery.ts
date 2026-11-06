import { editablePayload, type Payload } from './types';

const sections: { label: string; fields: (keyof Payload)[] }[] = [
  { label: 'pump readings', fields: ['readings'] },
  { label: 'tank dips', fields: ['dips'] },
  { label: 'fuel received', fields: ['deliveries', 'receiptsConfirmed'] },
  { label: 'expenses', fields: ['expenses', 'expensesConfirmed'] },
  { label: 'credit sales', fields: ['creditSales'] },
  { label: 'collections and cash handover', fields: ['collections'] },
  { label: 'shift notes', fields: ['notes'] },
  { label: 'discrepancy explanation', fields: ['discrepancyReason'] },
  { label: 'paper records', fields: ['documentIds'] },
];

// PostgreSQL can return object properties in a different order from the browser.
function comparable(value: unknown) {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
}

export function recoverDraft(original: Payload, local: Payload, latest: Payload) {
  const base = editablePayload(latest);
  const payload = { ...base };
  const overlaps: string[] = [];
  let changed = false;
  function keepLocal<K extends keyof Payload>(field: K) {
    payload[field] = local[field];
  }

  for (const { label, fields } of sections) {
    const before = comparable(fields.map((field) => original[field]));
    const mine = comparable(fields.map((field) => local[field]));
    const theirs = comparable(fields.map((field) => base[field]));
    if (mine === before || mine === theirs) continue;
    // Rows do not all have stable IDs. Preserve a changed section as a unit.
    fields.forEach(keepLocal);
    changed = true;
    if (theirs !== before) overlaps.push(label);
  }
  return { base, payload, overlaps, changed };
}
