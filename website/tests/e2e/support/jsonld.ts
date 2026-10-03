/** JSON-LD helpers shared by the route inventory and the JSON-LD suite. */

export type LdNode = Record<string, unknown>;

export type ParsedBlock = { index: number; data?: unknown; error?: string };

export function parseBlocks(raw: string[]): ParsedBlock[] {
  return raw.map((text, index) => {
    try {
      return { index, data: JSON.parse(text) as unknown };
    } catch (error) {
      return { index, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

const isNode = (v: unknown): v is LdNode => !!v && typeof v === 'object' && !Array.isArray(v);

/** Top-level entities: arrays and `@graph` are unwrapped, as in the snapshot. */
export function topLevelEntities(data: unknown): LdNode[] {
  if (Array.isArray(data)) return data.flatMap(topLevelEntities);
  if (isNode(data) && Array.isArray(data['@graph'])) {
    const graph = data['@graph'] as unknown[];
    // Entities inside a graph inherit the graph's @context.
    return graph.flatMap(topLevelEntities).map((e) => ('@context' in e || !('@context' in data) ? e : { '@context': data['@context'], ...e }));
  }
  return isNode(data) ? [data] : [];
}

export function typesOf(entity: LdNode): string[] {
  const t = entity['@type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}

/** Every object node in the tree (entities, nested values, references). */
export function allNodes(data: unknown): LdNode[] {
  const out: LdNode[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isNode(v)) {
      out.push(v);
      Object.values(v).forEach(walk);
    }
  };
  walk(data);
  return out;
}

/** Every `telephone` value anywhere in the tree. */
export function telephonesIn(data: unknown): string[] {
  return allNodes(data).flatMap((n) => {
    const t = n.telephone;
    if (typeof t === 'string') return [t];
    if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
    return [];
  });
}

/** A node that only points at another entity: `{ "@id": "…" }`. */
export function isReference(n: LdNode): boolean {
  const keys = Object.keys(n);
  return keys.length === 1 && keys[0] === '@id' && typeof n['@id'] === 'string';
}

/** E.164 once visual separators (spaces, hyphens, dots, brackets) are removed. */
export function e164Digits(phone: string): string {
  return phone.replace(/[\s\-.()]/g, '');
}

export const E164 = /^\+[1-9]\d{7,14}$/;
