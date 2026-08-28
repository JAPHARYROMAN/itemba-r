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

/**
 * A tool Anthropic runs on its own side, declared by type and name only.
 *
 * It carries no `input_schema` because we do not define its arguments — the
 * shape belongs to the API, not to this codebase, and inventing one here would
 * be a guess that silently diverges when the API version moves.
 */
export interface ServerToolDefinition {
  type: string;
  name: string;
}

/** Anything that may appear in a request's `tools` array. */
export type DeclaredTool = ToolDefinition | ServerToolDefinition;

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

/**
 * Human-readable action phrase for a capability, for the tool description.
 *
 * Exported because `GET /msaidizi/capabilities` hands it to the UI: a step row
 * must read "Looking at supplier invoices", not `SupplierInvoices_findAll`.
 */
export function describeAction(capability: Capability): string {
  if (capability.summary) return capability.summary;
  // Split the handler name into words: `productLedger` -> `product ledger`.
  const words = capability.handler
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return `${words} (${capability.verb} /${capability.path})`;
}

/**
 * Hand-written notes for capabilities whose machine-derived description is
 * indistinguishable from a neighbour's.
 *
 * The system prompt's DOMAIN_PRIMER states the same distinctions once, far from
 * the point of use. This map states them ON the tool, which matters for two
 * reasons the primer cannot cover: a note travels with whichever tool survived
 * narrowing, and a saved procedure sealed to a handful of tools (`restrictTo`
 * bypasses re-narrowing entirely) may never carry the neighbour it should have
 * been compared against. The motivating failure was exactly that shape — a
 * credit-profile-only tool set, one plausible tool, and "0 customers on file"
 * read off an orphan table.
 *
 * KEYS are either a capability id (`Controller.handler`, exact) or a controller
 * name (applies to every route on it). Exact wins. Controller-level is the
 * usual granularity because these are concept collisions, not route ones: the
 * distinction is true of every route on `CustomerCreditProfilesController`.
 *
 * KEEP THEM SHORT. A note is appended to the description of every matching tool
 * and up to 60 tools are sent per turn (`TOOL_BUDGET` in `msaidizi.service.ts`),
 * so this is prompt budget spent on every call. One or two sentences: what it
 * is, what it is NOT, and where to go instead, naming the tool by the name the
 * model will actually see. `DISAMBIGUATION_MAX_NOTE_CHARS` is the ceiling.
 *
 * KEEP THEM FEW. Past roughly thirty entries the hand-maintained approach has
 * lost to a generated glossary, so `DISAMBIGUATION_MAX_ENTRIES` makes that a
 * decision somebody takes rather than a line the map drifts across.
 *
 * WHAT CI ACTUALLY CHECKS — `prompts.domain.spec.ts`, and only this much: every
 * KEY resolves to at least one capability in the live manifest; every
 * capability it resolves to is permission-gated; at least one of them is
 * agent-reachable (`capabilitiesFor` admits it); every tool name quoted inside
 * a note is derivable from the live manifest; every SCREAMING_SNAKE token in a
 * note — one carrying an underscore, since bare capitals here are prose
 * emphasis like NOT — is a real Prisma enum value; every `Model.field` in a
 * note is a real field; both caps hold; an exact-id key beats the
 * controller-level one; and the note lands directly after the action phrase.
 * So a renamed controller fails CI instead of silently orphaning its note, and
 * a note cannot point the model at a tool that no longer exists. What CI cannot
 * check is whether the SENTENCE is true — the English between the identifiers
 * is maintained by hand, and a note can be wrong while every identifier in it
 * resolves.
 */

/**
 * Cap on the number of entries, enforced by `prompts.domain.spec.ts`.
 *
 * Not a style preference: past roughly this many, curating notes by hand has
 * lost to generating a glossary from the manifest, and the integration plan
 * names crossing it as the trigger for that rewrite. Failing here forces the
 * decision instead of letting the map grow past the point where it was the
 * right shape.
 */
export const DISAMBIGUATION_MAX_ENTRIES = 30;

/**
 * Cap on one note, in characters, enforced by `prompts.domain.spec.ts`.
 *
 * A note rides on the description of every matching tool, and up to 60 tools go
 * out per turn, so a note is paid many times over. Roughly two sentences.
 */
export const DISAMBIGUATION_MAX_NOTE_CHARS = 340;
export const DISAMBIGUATION: Record<string, string> = {
  // ── Customer master versus credit review ────────────────────────────────
  // The terminal-scoped mobile lookup is deliberately absent: its two device
  // credential headers are not representable in the agent action envelope, so
  // that capability is excluded before this description could ever be shown.
  CustomersController:
    'This is the customer master — who the company sells to. Not credit review records (CustomerCreditProfiles_findAll) and not a POS terminal lookup.',
  CustomerCreditProfilesController:
    'Credit-limit review records only. NOT the customer master — use Customers_findAll for that. Keyed by customerId with no link to Customer, often empty, and the sales credit check reads Customer.creditLimit instead, so nothing recorded here is enforced.',
  SupplierPerformanceController:
    'Supplier review records — ratings and scores. NOT the supplier master; use Suppliers_findAll for that. Keyed by supplierId with no link to Supplier, and nothing recorded here is enforced.',

  // ── The sign of the money ───────────────────────────────────────────────
  DebtsController:
    'Money THIS COMPANY OWES to a named creditor (free-text creditorName, no customer or supplier link). Not what customers owe us — that is Receivables_findAll.',
  ReceivablesController:
    'Money owed TO this company by a customer, raised from credit sales. Use this for "how much are we owed". Not Debts_findAll, which is what we owe.',
  PayablesController:
    'Money this company owes its suppliers, raised from supplier invoices. Not Debts_findAll (an unlinked named creditor) and not Receivables_findAll.',

  // ── Stock now versus stock history ──────────────────────────────────────
  InventoryBalancesController:
    'What is on hand right now, per product per branch. Use this for "how much do we have". The history of how it got there is InventoryMovements_findAll.',
  InventoryMovementsController:
    'The typed history of every stock change (SALE_ISSUE, PURCHASE_RECEIPT, TRANSFER_IN, ADJUSTMENT_OUT and others). Use this for "why did stock change". Current quantity is InventoryBalances_findAll.',
  'OperationsReportsController.getInventoryMovements':
    'An aggregated report over stock movements, not the movement rows themselves. For individual movements use InventoryMovements_findAll.',

  // ── Four things that all sound like "reports" ───────────────────────────
  FinancialReportsController:
    'Computed accounting reports — trial balance, profit and loss, balance sheet, cash flow, aging — per company or consolidated. Stored statement documents are FinancialStatements_findAll; sales, purchase and stock reporting is OperationsReports_getSalesSummary and its siblings.',
  FinancialStatementsController:
    'Statement documents that were generated and saved. Not the computation — to produce one now use FinancialReports_getTrialBalance, FinancialReports_getProfitAndLoss or FinancialReports_getBalanceSheet.',
  OperationsReportsController:
    'Operational reporting over sales, purchases and stock. Accounting reports are FinancialReports_getProfitAndLoss and its siblings; per-product margin is Profit_productSummary.',
  ProfitController:
    'Margin and cost analysis per product and per customer. This is not the accounting profit and loss — that is FinancialReports_getProfitAndLoss.',

  // ── Documents whose stock effect is the thing people get wrong ──────────
  DeliveryNotesController:
    'A dispatch or collection document against a sales order. IT MOVES NO STOCK: the stock was issued when the sale was confirmed. The westsides/ path prefix is only where the single implementation lives — it serves every company.',
  GoodsReceivedNotesController:
    'Records what physically arrived against a purchase order. Posting one is what puts stock on hand; the purchase order alone moves nothing. The supplier bill for it is SupplierInvoices_findAll.',
  SupplierInvoicesController:
    "The supplier's bill to this company, matched against a purchase order and a goods received note, which becomes a payable. Not an invoice we issued to a customer.",
};

/**
 * The disambiguation note for a capability, if one is written for it.
 *
 * Exact capability id first, then the controller-level note, so a single route
 * can override the note its siblings share.
 */
export function disambiguationFor(capability: Capability): string | undefined {
  return DISAMBIGUATION[capability.id] ?? DISAMBIGUATION[capability.controller];
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

  if (capability.params.path.length > 0) {
    const pathProperties = Object.fromEntries(
      capability.params.path.map((param) => [
        param,
        {
          type: 'string',
          description: `Identifier for the ${param.replace(/Id$/, '')} in the route path.`,
        },
      ]),
    );
    properties.path = {
      type: 'object',
      description: 'Values substituted into the route path.',
      properties: pathProperties,
      required: capability.params.path,
      additionalProperties: false,
    };
    required.push('path');
  }

  const derivedQuery = capability.params.querySchema?.schema;
  const namedQueryProperties = Object.fromEntries(
    capability.params.query.map((param) => [
      param,
      { type: 'string', description: `Optional \`${param}\` filter.` },
    ]),
  );
  if (
    capability.params.query.length > 0 ||
    capability.params.freeFormQuery ||
    derivedQuery !== undefined
  ) {
    const querySchema = {
      type: 'object' as const,
      description: 'URL query filters. Do not put these fields in path or body.',
      properties: { ...(derivedQuery?.properties ?? {}), ...namedQueryProperties },
      ...(derivedQuery?.required?.length ? { required: derivedQuery.required } : {}),
      // A typed DTO is closed by the production ValidationPipe. Only a truly
      // opaque whole-query parameter remains open.
      additionalProperties: derivedQuery
        ? derivedQuery.additionalProperties
        : capability.params.freeFormQuery,
    };
    properties.query = querySchema;
    if (querySchema.required) required.push('query');
  }

  if (capability.params.hasBody) {
    properties.body = capability.params.bodySchema
      ? {
          ...capability.params.bodySchema.schema,
          description: 'JSON request body. Only send fields required for the requested operation.',
        }
      : {
          type: 'object',
          description:
            'JSON request body. Its DTO metadata is opaque; only send fields required for the requested operation.',
          additionalProperties: true,
        };
    required.push('body');
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
    if (!capability.params.querySchema) {
      notes.push(
        'Its query DTO is opaque, so additional filters are accepted; prefer documented names and do not invent parameters.',
      );
    }
  }
  if (Object.keys(properties).length > 0) {
    notes.push(
      'Use the explicit argument envelope: route identifiers in `path`, URL filters in `query`, and JSON payload fields in `body`.',
    );
  }

  return {
    name,
    // The disambiguation note sits directly after the action phrase, ahead of
    // the tier and free-form-query notes: it is the part that decides whether
    // this is the right tool at all, and the rest only matters once it is.
    description: [describeAction(capability), disambiguationFor(capability), ...notes]
      .filter(Boolean)
      .join(' '),
    input_schema: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      // The namespaces are always closed. Opaque query/body objects may be open
      // internally, but a top-level field is necessarily ambiguous and belongs
      // only to the legacy invoker compatibility path.
      additionalProperties: false,
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

// ─── Tool search ──────────────────────────────────────────────────────────────

/**
 * The BM25 search tool. BM25 rather than the regex variant because a user types
 * language, not name patterns: "who owes us money" has to reach `receivables`,
 * and no amount of literal matching gets there from those words.
 */
export const TOOL_SEARCH_DEFINITION = {
  type: 'tool_search_tool_bm25_20251119',
  name: 'tool_search_tool_bm25',
} as const;

/**
 * How many capabilities stay resident when search is on.
 *
 * Small on purpose. These are the floor the model always has without spending a
 * search round-trip, not a second narrowing pass — every other capability is one
 * search away, so a generous resident set buys latency on the common ask at the
 * cost of the byte-stability this whole design depends on.
 */
export const ENTRY_POINT_BUDGET = 15;

/**
 * The no-search fast path, in measured priority order.
 *
 * The 2026-08-20 tool-search benchmark showed that the old "shortest route"
 * heuristic helped none of its seven representative finance and operations
 * questions. These six collection reads are the endpoints those questions
 * actually needed (two prompts intentionally converge on payables).
 *
 * Capability ids are used instead of tool names so this stays attached to the
 * permission-filtered manifest entry. A missing permission therefore removes a
 * fast-path candidate altogether; this list never widens the registry.
 */
export const BENCHMARK_FAST_PATH_CAPABILITY_IDS = [
  'CustomersController.findAll',
  'SuppliersController.findAll',
  'ReceivablesController.findAll',
  'PayablesController.findAll',
  'ExpensesController.findAll',
  'InventoryBalancesController.findAll',
] as const;

const FAST_PATH_PRIORITY = new Map<string, number>(
  BENCHMARK_FAST_PATH_CAPABILITY_IDS.map((id, index) => [id, index]),
);

/**
 * Chooses the capabilities that stay resident, deterministically.
 *
 * Deterministic, and derived only from the caller's permitted set — NOT from the
 * request. That distinction is the point. The API renders `tools` before
 * `system`, and the cache breakpoint sits on the system block, so anything that
 * varies per request changes the bytes ahead of the breakpoint and the cache
 * never hits. A per-request resident set would preserve today's behaviour, where
 * every turn pays full price for the system prompt and every resident schema.
 * Keyed to the user's permissions, the block is identical across that user's
 * turns and the prefix can finally cache.
 *
 * The measured finance/operations reads come first. Any remaining budget is
 * filled with the previous shallow-green-read heuristic, which preserves a
 * useful generic floor without displacing the endpoints the benchmark proved.
 * Both groups are sorted without request text, so the tool prefix remains
 * stable across requests for the same permission set.
 */
export function selectEntryPoints(
  entries: RegistryEntry[],
  limit = ENTRY_POINT_BUDGET,
): RegistryEntry[] {
  return entries
    .filter((e) => e.capability.tier === 'green')
    .filter((e) => !e.capability.path.includes(':'))
    .sort((a, b) => {
      const aPriority = FAST_PATH_PRIORITY.get(a.capability.id);
      const bPriority = FAST_PATH_PRIORITY.get(b.capability.id);
      if (aPriority !== undefined || bPriority !== undefined) {
        if (aPriority === undefined) return 1;
        if (bPriority === undefined) return -1;
        return aPriority - bPriority;
      }

      const depth = a.capability.path.split('/').length - b.capability.path.split('/').length;
      return depth !== 0 ? depth : a.tool.name.localeCompare(b.tool.name);
    })
    .slice(0, limit);
}

export interface SearchToolSet {
  /** Everything declared this turn, resident and deferred, in wire order. */
  tools: DeclaredTool[];
  /** Resident capability tools — the floor available without searching. */
  entryPoints: RegistryEntry[];
}

/**
 * Builds the declared tool set for a search-enabled turn.
 *
 * Every permitted capability is declared. The ones outside the entry set carry
 * `defer_loading`, so their schemas are fetched on demand rather than sitting in
 * context — the model can still reach them, it just cannot see them all at once.
 *
 * The search tool is always resident, which also satisfies the API's requirement
 * that at least one tool not be deferred; a request with everything deferred is
 * rejected outright.
 */
export function buildSearchToolSet(
  permitted: RegistryEntry[],
  limit = ENTRY_POINT_BUDGET,
): SearchToolSet {
  const entryPoints = selectEntryPoints(permitted, limit);
  const resident = new Set(entryPoints.map((e) => e.tool.name));

  return {
    entryPoints,
    tools: [
      TOOL_SEARCH_DEFINITION,
      ...permitted.map((entry) =>
        resident.has(entry.tool.name) ? entry.tool : { ...entry.tool, defer_loading: true },
      ),
    ],
  };
}
