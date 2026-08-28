import { tokenize } from '../msaidizi/domain-filter';

/**
 * A small, deterministic ontology for the ERP and workstation domains Msaidizi
 * currently governs. This is deliberately not presented as a general-purpose
 * language embedding: it adds real synonym/concept similarity to lexical
 * matching without a network model or a mutable external index.
 */
export const MSAIDIZI_MEMORY_RETRIEVAL_PROFILE = 'deterministic-governed-concepts-v1' as const;

const CONCEPT_ALIASES = Object.freeze({
  'finance.expense': [
    'expense',
    'spend',
    'spending',
    'cost',
    'purchase',
    'procurement',
    'bill',
    'payable',
  ],
  'finance.revenue': ['sale', 'revenue', 'income', 'invoice', 'receivable', 'turnover'],
  'finance.cash': ['cash', 'bank', 'treasury', 'payment', 'refund', 'disbursement'],
  'party.supplier': ['supplier', 'vendor', 'merchant', 'provider'],
  'party.customer': ['customer', 'client', 'buyer', 'account'],
  'workflow.reconcile': [
    'review',
    'reconcile',
    'reconciliation',
    'balance',
    'close',
    'closing',
    'settlement',
    'verify',
  ],
  'operations.inventory': [
    'inventory',
    'stock',
    'warehouse',
    'product',
    'item',
    'sku',
    'replenishment',
  ],
  'operations.fulfillment': [
    'order',
    'shipment',
    'delivery',
    'dispatch',
    'logistics',
    'fulfillment',
  ],
  'people.payroll': ['payroll', 'salary', 'wage', 'employee', 'staff'],
  'communication.email': ['email', 'mail', 'attachment', 'notify', 'notification', 'message'],
  'document.file': ['file', 'document', 'report', 'spreadsheet', 'pdf', 'archive'],
  'browser.web': ['browser', 'web', 'webpage', 'website', 'upload', 'download', 'form'],
  'automation.schedule': ['schedule', 'routine', 'recurring', 'cron', 'automation'],
  'security.access': ['permission', 'authorization', 'access', 'credential', 'identity'],
  'system.device': ['device', 'workstation', 'computer', 'windows', 'host'],
} satisfies Record<string, readonly string[]>);

const ALIAS_TO_CONCEPT = buildAliasIndex();

export interface MemoryRelevanceScore {
  score: number;
  semanticCosine: number;
  lexicalJaccard: number;
  sharedConcepts: string[];
}

/**
 * Hybrid relevance with a concept-space cosine as the dominant signal and a
 * lexical Jaccard tie-breaker. Synonyms such as vendor/supplier and
 * expense/spending share semantic dimensions even when their words differ.
 */
export function scoreMemoryRelevance(query: string, candidate: string): MemoryRelevanceScore {
  const queryFeatures = featureVector(query);
  const candidateFeatures = featureVector(candidate);
  const semanticCosine = cosine(queryFeatures, candidateFeatures);
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidate);
  const lexicalJaccard = jaccard(queryTokens, candidateTokens);
  const sharedConcepts = conceptsForText(query).filter((concept) =>
    conceptsForText(candidate).includes(concept),
  );
  return {
    score: semanticCosine * 0.8 + lexicalJaccard * 0.2,
    semanticCosine,
    lexicalJaccard,
    sharedConcepts,
  };
}

export function conceptsForText(text: string): string[] {
  const concepts = new Set<string>();
  for (const token of tokenize(text)) {
    const concept = ALIAS_TO_CONCEPT.get(token);
    if (concept) concepts.add(concept);
  }
  return [...concepts].sort();
}

function featureVector(text: string): Map<string, number> {
  const vector = new Map<string, number>();
  for (const token of tokenize(text)) vector.set(`lex:${token}`, 0.35);
  for (const concept of conceptsForText(text)) vector.set(`concept:${concept}`, 2);
  return vector;
}

function cosine(left: Map<string, number>, right: Map<string, number>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (const value of left.values()) leftMagnitude += value * value;
  for (const value of right.values()) rightMagnitude += value * value;
  for (const [feature, value] of left) dot += value * (right.get(feature) ?? 0);
  if (dot === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function buildAliasIndex(): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  for (const [concept, values] of Object.entries(CONCEPT_ALIASES)) {
    for (const value of values) {
      for (const token of tokenize(value)) aliases.set(token, concept);
    }
  }
  return aliases;
}
