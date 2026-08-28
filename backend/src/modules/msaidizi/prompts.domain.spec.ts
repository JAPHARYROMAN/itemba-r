/**
 * Drift guard for the model's domain grounding.
 *
 * Two hand-written artifacts tell the model what this business is:
 * `DOMAIN_PRIMER` in `prompts.ts`, which goes into every system prompt, and the
 * `DISAMBIGUATION` map in `tool-registry.ts`, which is appended to the
 * description of every tool it names. Both are prose. Prose drifts, and prose
 * about a ledger that has drifted is worse than no prose at all —
 * `docs/codebase-master-study.md` is the standing proof, three months old and
 * describing eleven modules that do not exist.
 *
 * So this suite is the mechanism behind the rule those two files state. It
 * builds the REAL capability manifest (the same routing table the agent is
 * handed), parses the REAL `schema.prisma`, and reads the REAL seed and service
 * sources. Nothing here is checked against a hand-copied inventory, because a
 * hand-copied inventory would be the next thing to drift.
 *
 * WHAT IS ENFORCED, EXACTLY — this list is the contract the two doc comments
 * point at, and it is deliberately a list of mechanisms rather than a claim that
 * "everything is checked":
 *
 *   1. Every backticked identifier in DOMAIN_PRIMER resolves to a live route
 *      path, a Prisma model, a model field, an enum value or a seeded company
 *      code. An unresolvable one fails, by name.
 *   2. The STRUCTURAL CLAIMS — the load-bearing sentences, the ones that would
 *      make the model wrong about money or stock — are asserted one test each
 *      against the manifest, the schema or the source. No count is quoted here
 *      on purpose: a hand-maintained number in a comment is the exact failure
 *      this suite exists to stop.
 *   3. Every DISAMBIGUATION key names something in the live manifest, that
 *      thing is permission-gated, and at least one capability it matches is
 *      actually agent-reachable. A renamed controller fails here.
 *   4. Every tool name quoted inside a note is derivable from the live
 *      manifest; every SCREAMING_SNAKE token in a note — one carrying an
 *      underscore, since bare capitals in these notes are prose emphasis — is a
 *      real enum value; every `Model.field` is a real field.
 *   5. The two budgets — DOMAIN_PRIMER_MAX_CHARS and
 *      DISAMBIGUATION_MAX_ENTRIES — plus a per-note length cap, and the numbers
 *      the doc comments quote for those budgets.
 *   6. The claims prompts.ts makes about how the prompt is assembled: the
 *      primer rides inside the cache-controlled block, that block is
 *      byte-identical across users and dates, and a read-only deployment is
 *      never handed the write or irreversible-action clauses.
 *   7. The two behavioural claims tool-registry.ts makes about the map: an
 *      exact capability-id key beats the controller-level one, and the note
 *      lands directly after the action phrase, ahead of the tier warning.
 *   8. The pointer itself — both doc comments name THIS file by its real
 *      basename, and the block title prompts.ts sends the reader to is a block
 *      that exists here. The defect this suite was written for was two comments
 *      citing a CI gate that had never been committed on any branch.
 *   9. The two facts about the live manifest that prompts.ts offers as the
 *      primer's REASON for existing: that most capabilities carry no summary
 *      beyond a path and a handler name, and that the two customer-ish
 *      endpoints still describe identically apart from their path. If those
 *      stop being true the primer should shrink, and nothing else would say so.
 *
 * WHAT IS NOT ENFORCED, said plainly so nobody trusts more than exists: the
 * connective prose between the identifiers, and the "current as of" date in the
 * primer, are maintained by hand. A sentence can be false while every
 * identifier in it resolves. The defence against that is (2) — so a claim worth
 * relying on belongs in the STRUCTURAL CLAIMS block, not only in the prose.
 * Deleting this file also deletes its own guard; nothing outside it can notice
 * that, which is why (8) checks the reference rather than assuming it.
 *
 * MEMORY COST: loadAllControllers() requires every controller, pulling the
 * application's whole dependency graph into the Jest process — the same cost
 * capability-manifest.spec.ts documents, and the reason the test scripts pass
 * --max-old-space-size=8192. Loading the real routing table is the entire
 * point; a stubbed manifest would make this suite the fiction it exists to
 * prevent.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Capability,
  capabilitiesFor,
  extractCapabilities,
} from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildSystemPrompt, DOMAIN_PRIMER, DOMAIN_PRIMER_MAX_CHARS } from './prompts';
import {
  buildToolDefinition,
  describeAction,
  disambiguationFor,
  DISAMBIGUATION,
  DISAMBIGUATION_MAX_ENTRIES,
  DISAMBIGUATION_MAX_NOTE_CHARS,
  toolNameFor,
} from './tool-registry';

/** `backend/src`. */
const BACKEND_SRC = path.resolve(__dirname, '..', '..');
/** Repository root — `database/` lives beside `backend/`. */
const REPO_ROOT = path.resolve(BACKEND_SRC, '..', '..');

function readBackendSource(relative: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, relative), 'utf8');
}

/**
 * The source of one class-level method, from its declaration to the next one.
 *
 * Crude by design: several primer claims are about WHERE in a service a write
 * happens — "posting the GRN is what puts stock on hand", "raising the purchase
 * order moves nothing" — and a whole-file grep cannot tell those apart. Throws
 * rather than returning empty, because a silently empty body would turn every
 * `not.toMatch` below into a test that passes for the wrong reason.
 */
function bodyOf(source: string, method: string): string {
  const declaration = new RegExp(`\\n {2}(?:private |protected |public )?(?:async )?${method}\\(`);
  const start = declaration.exec(source);
  if (!start) throw new Error(`${method}() is no longer declared at class level`);

  const from = start.index + 1; // past the newline the declaration matched on
  const after = from + start[0].length - 1;
  const next = /\n {2}(?:private |protected |public )?(?:async )?[A-Za-z_]\w*\(/.exec(
    source.slice(after),
  );
  return next ? source.slice(from, after + next.index) : source.slice(from);
}

// ───────────────────────────── schema.prisma ─────────────────────────────

interface PrismaModel {
  /** Scalar and relation field names, in declaration order. */
  fields: string[];
  /** Field name -> declared type with `?`/`[]` stripped, so relations resolve. */
  typeOf: Map<string, string>;
  /** The raw block, for assertions about `@@unique` and friends. */
  block: string;
}

/**
 * A deliberately small Prisma parser: block headers, then the first two tokens
 * of each field line. It does not need to understand the language, only to be
 * unable to invent a model or a field that is not written down.
 */
function parseSchema(schema: string): {
  models: Map<string, PrismaModel>;
  enums: Map<string, string[]>;
} {
  const models = new Map<string, PrismaModel>();
  const enums = new Map<string, string[]>();

  const lines = schema.split(/\r?\n/);
  let kind: 'model' | 'enum' | null = null;
  let name = '';
  let fields: string[] = [];
  let typeOf = new Map<string, string>();
  let values: string[] = [];
  let block: string[] = [];

  for (const line of lines) {
    const open = /^(model|enum)\s+(\w+)\s*\{/.exec(line);
    if (open) {
      kind = open[1] as 'model' | 'enum';
      name = open[2];
      fields = [];
      typeOf = new Map();
      values = [];
      block = [];
      continue;
    }
    if (kind && /^\}/.test(line)) {
      if (kind === 'model') models.set(name, { fields, typeOf, block: block.join('\n') });
      else enums.set(name, values);
      kind = null;
      continue;
    }
    if (!kind) continue;

    block.push(line);
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;

    if (kind === 'enum') {
      const value = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(trimmed);
      if (value) values.push(value[1]);
      continue;
    }

    const field = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(trimmed);
    if (field) {
      fields.push(field[1]);
      typeOf.set(field[1], field[2]);
    }
  }

  return { models, enums };
}

// ─────────────────────────────── seed codes ──────────────────────────────

/**
 * The company codes the seed actually creates.
 *
 * Read out of the `COMPANIES` literal rather than imported: importing the seed
 * executes it. Division codes sit two levels deeper in the same literal, so the
 * indent is what separates a company code from a division code.
 */
function parseSeededCompanyCodes(seed: string): string[] {
  const start = seed.indexOf('const COMPANIES: CompanySeed[] = [');
  if (start === -1) throw new Error('seed.ts no longer declares a COMPANIES literal');
  const end = seed.indexOf('\n];', start);
  const literal = seed.slice(start, end === -1 ? undefined : end);
  return [...literal.matchAll(/^ {4}code: '([A-Z_]+)',$/gm)].map((m) => m[1]);
}

// ──────────────────────────────── fixtures ───────────────────────────────

let manifest: Capability[];
let routePaths: string[];
let reachableIds: Set<string>;
let toolNames: Set<string>;
let models: Map<string, PrismaModel>;
let enums: Map<string, string[]>;
let allModelFields: Set<string>;
let allEnumValues: Set<string>;
let seededCompanyCodes: string[];

beforeAll(() => {
  manifest = extractCapabilities(loadAllControllers());
  routePaths = manifest.map((c) => c.path);

  // "Agent-reachable" as the registry itself computes it: hold every permission
  // code the manifest mentions, and see what capabilitiesFor() still admits.
  // Agent-excluded and permissionless routes drop out here, which is the point.
  const everyCode = [...new Set(manifest.flatMap((c) => [...c.permissions, ...c.anyPermissions]))];
  reachableIds = new Set(capabilitiesFor(manifest, everyCode).map((c) => c.id));

  // The name each capability would be given. A fresh `taken` set per capability
  // yields the un-suffixed name, which is what a note can legitimately quote:
  // collision suffixes only appear after 64-character truncation.
  toolNames = new Set(manifest.map((c) => toolNameFor(c, new Set())));

  const parsed = parseSchema(
    fs.readFileSync(path.join(REPO_ROOT, 'database', 'prisma', 'schema.prisma'), 'utf8'),
  );
  models = parsed.models;
  enums = parsed.enums;
  allModelFields = new Set([...models.values()].flatMap((m) => m.fields));
  allEnumValues = new Set([...enums.values()].flat());

  seededCompanyCodes = parseSeededCompanyCodes(
    fs.readFileSync(path.join(REPO_ROOT, 'database', 'seeds', 'seed.ts'), 'utf8'),
  );
  // Requiring every controller is seconds of synchronous work, well past the
  // 5s default. It cannot be made faster without stubbing the manifest, which
  // is the one thing this suite must not do.
}, 120_000);

/**
 * The fixtures are the whole test. If loading quietly produced an empty
 * manifest or an empty schema, every "does this identifier resolve" assertion
 * below would still pass or fail for the wrong reason, and this suite would
 * become exactly the kind of decorative gate it exists to replace.
 */
/**
 * The exact describe title `prompts.ts` sends the reader to. Pinned below, so
 * renaming the block breaks the pointer rather than stranding it.
 */
const LOAD_BEARING_BLOCK = 'the load-bearing claims in DOMAIN_PRIMER are still true';

/**
 * The first thing to check is that the two comments still point HERE.
 *
 * This suite exists because `prompts.ts` and `tool-registry.ts` spent a whole
 * branch telling their reader that a CI gate by this name enforced the primer,
 * while no such file had ever been committed. A pointer to a gate is worth
 * nothing unless the pointer itself is checked.
 */
describe('the doc comments that promise this gate point at something real', () => {
  const spec = path.basename(__filename);
  const thisFile = fs.readFileSync(__filename, 'utf8');

  it('is named, by its real filename, in both files whose claims it enforces', () => {
    expect(readBackendSource('modules/msaidizi/prompts.ts')).toContain(spec);
    expect(readBackendSource('modules/msaidizi/tool-registry.ts')).toContain(spec);
  });

  it('still contains the block prompts.ts sends the reader to by name', () => {
    expect(readBackendSource('modules/msaidizi/prompts.ts')).toContain(LOAD_BEARING_BLOCK);
    expect(thisFile).toContain(`describe('${LOAD_BEARING_BLOCK}'`);
  });
});

describe('the sources this guard checks against are real', () => {
  it('loaded the live routing table, the live schema and the live seed', () => {
    expect(manifest.length).toBeGreaterThan(400);
    expect(reachableIds.size).toBeGreaterThan(300);
    expect(toolNames.size).toBeGreaterThan(400);
    expect(models.size).toBeGreaterThan(300);
    expect(enums.size).toBeGreaterThan(300);
    expect(seededCompanyCodes).toEqual(['MWANJALISI', 'ITEMBA_ENT', 'WESTSIDES']);
  });

  it('isolates one method at a time, so the where-does-it-happen claims mean something', () => {
    // If bodyOf ever returned the whole file, "every stock write in this module
    // is inside receive()" would compare a number with itself and pass while
    // proving nothing. Both halves of that comparison have to be real slices.
    const po = readBackendSource('modules/purchase-orders/purchase-orders.service.ts');
    const salesOrders = readBackendSource('modules/sales-orders/sales-orders.service.ts');
    const DECLARATION = /\n {2}(?:private |protected |public )?(?:async )?[A-Za-z_]\w*\(/g;

    for (const [source, method] of [
      [po, 'receive'],
      [salesOrders, 'confirm'],
      [salesOrders, 'createAndConfirm'],
      [salesOrders, 'mobilePosLiteQuickSale'],
    ] as const) {
      const body = bodyOf(source, method);
      expect(body.length).toBeGreaterThan(0);
      expect(body.length).toBeLessThan(source.length);
      expect(body).toMatch(new RegExp(`^ {2}(?:private )?(?:async )?${method}\\(`));
      // Its own declaration and no other: the slice stops at the next method.
      expect(body.match(DECLARATION)).toBeNull();
    }

    expect(() => bodyOf(salesOrders, 'noSuchMethodHasEverExisted')).toThrow(
      /no longer declared at class level/,
    );
  });
});

// ─────────────────────── 1. every backticked identifier ──────────────────

type Resolution =
  | 'route path'
  | 'Prisma model'
  | 'model field'
  | 'enum value'
  | 'seeded company code';

function resolveIdentifier(raw: string): Resolution | undefined {
  const token = raw.replace(/\/+$/, '');

  if (routePaths.some((p) => p === token || p.startsWith(`${token}/`))) return 'route path';
  if (models.has(token)) return 'Prisma model';

  if (token.includes('.')) {
    const [modelName, fieldName] = token.split('.');
    if (models.get(modelName)?.fields.includes(fieldName)) return 'model field';
  }
  if (allModelFields.has(token)) return 'model field';
  if (allEnumValues.has(token)) return 'enum value';
  if (seededCompanyCodes.includes(token)) return 'seeded company code';

  return undefined;
}

describe('every backticked identifier in DOMAIN_PRIMER exists', () => {
  const identifiers = [...new Set([...DOMAIN_PRIMER.matchAll(/`([^`]+)`/g)].map((m) => m[1]))];

  it('found the identifiers to check', () => {
    // A primer that stops naming things would silently pass every assertion
    // below. It is grounding text; if it names nothing, it grounds nothing.
    expect(identifiers.length).toBeGreaterThan(30);
  });

  it('resolves each one against the live manifest, schema or seed', () => {
    const unresolved = identifiers.filter((id) => resolveIdentifier(id) === undefined);
    expect(unresolved).toEqual([]);
  });

  it('resolves identifiers of every kind the rule names, so no resolver is dead', () => {
    const kinds = new Set(identifiers.map(resolveIdentifier));
    expect([...kinds].sort()).toEqual([
      'Prisma model',
      'enum value',
      'model field',
      'route path',
      'seeded company code',
    ]);
  });
});

// ───────────────────────── 2. the structural claims ──────────────────────

/**
 * The sentences worth relying on, one assertion each.
 *
 * Each `it` title is the primer's own claim, as close to verbatim as a test
 * name allows, so a failure reads as "this sentence in the system prompt is now
 * false" rather than as a broken test.
 */
describe('the load-bearing claims in DOMAIN_PRIMER are still true', () => {
  it('a Group owns companies, a Company owns divisions, and a Division owns branches', () => {
    expect(models.get('Company')?.fields).toContain('groupId');
    expect(models.get('Division')?.fields).toContain('companyId');
    expect(models.get('Branch')?.fields).toContain('divisionId');
  });

  it('every business record belongs to exactly one company and may name a division and a branch', () => {
    for (const model of ['Customer', 'SalesOrder', 'InventoryBalance', 'Receivable']) {
      expect(models.get(model)?.typeOf.get('companyId')).toBe('String');
      expect(models.get(model)?.fields).toContain('divisionId');
    }
  });

  it('group-level governance is gated by role, so it is never offered to the agent', () => {
    const group = manifest.filter((c) => c.controller === 'GroupsController');
    expect(group.length).toBeGreaterThan(0);
    expect(group.every((c) => c.guard === 'role')).toBe(true);
    expect(group.some((c) => reachableIds.has(c.id))).toBe(false);
  });

  it('delivery notes, quotations, proformas, price lists and stock damage live only under westsides/', () => {
    for (const noun of [
      'delivery-notes',
      'quotations',
      'proforma-invoices',
      'price-lists',
      'stock-damage',
    ]) {
      const serving = routePaths.filter(
        (p) => p === noun || p.includes(`/${noun}`) || p.startsWith(`${noun}/`),
      );
      expect(serving.length).toBeGreaterThan(0);
      expect(serving.every((p) => p.startsWith('westsides/'))).toBe(true);
    }
  });

  it('customers is the customer master, and the agent can be handed it', () => {
    // The plan's first named claim (§4.5). "Which module owns which concept" is
    // worth nothing to the model if the module it names is one the permission
    // envelope never admits.
    const findAll = manifest.find((c) => c.id === 'CustomersController.findAll');
    expect(findAll?.path).toBe('customers');
    expect(findAll?.permissions).toContain('customers.view');
    expect(reachableIds.has('CustomersController.findAll')).toBe(true);
    expect(models.has('Customer')).toBe(true);
  });

  it('customer-credit-profiles carries a customerId but no relation to Customer', () => {
    const profile = models.get('CustomerCreditProfile');
    expect(profile?.fields).toContain('customerId');
    expect([...(profile?.typeOf.values() ?? [])]).not.toContain('Customer');
  });

  it('supplier-performance stands in exactly the same relation to suppliers', () => {
    const profile = models.get('SupplierPerformanceProfile');
    expect(profile?.fields).toContain('supplierId');
    expect([...(profile?.typeOf.values() ?? [])]).not.toContain('Supplier');
  });

  it('the sales credit check reads Customer.creditLimit and ignores the credit profile', () => {
    expect(models.get('Customer')?.fields).toContain('creditLimit');
    const salesOrders = readBackendSource('modules/sales-orders/sales-orders.service.ts');
    expect(salesOrders).toMatch(/customer\.creditLimit/);
    expect(salesOrders).not.toMatch(/customerCreditProfile/);
  });

  it('debts name a free-text creditor with no customer or supplier link', () => {
    const debt = models.get('Debt');
    expect(debt?.typeOf.get('creditorName')).toBe('String');
    expect(debt?.fields).not.toContain('customerId');
    expect(debt?.fields).not.toContain('supplierId');
    expect([...(debt?.typeOf.values() ?? [])]).not.toContain('Customer');
    expect([...(debt?.typeOf.values() ?? [])]).not.toContain('Supplier');
  });

  it('receivables are owed by a customer and payables are owed to a supplier', () => {
    expect(models.get('Receivable')?.fields).toContain('customerId');
    expect(models.get('Payable')?.fields).toContain('supplierId');
  });

  it('inventory balances hold quantityOnHand and averageCost per product per branch', () => {
    const balance = models.get('InventoryBalance');
    expect(balance?.fields).toEqual(expect.arrayContaining(['quantityOnHand', 'averageCost']));
    // The branch in the uniqueness key is why a company-wide figure is a sum.
    expect(balance?.block).toMatch(/@@unique\(\[companyId, productId, branchId\]\)/);
  });

  it('the movement types the primer names are real InventoryMovementType members', () => {
    expect(enums.get('InventoryMovementType')).toEqual(
      expect.arrayContaining([
        'PURCHASE_RECEIPT',
        'SALE_ISSUE',
        'TRANSFER_IN',
        'ADJUSTMENT_OUT',
        'DAMAGE',
      ]),
    );
  });

  it('a DeliveryNote moves no stock, ever', () => {
    const deliveryNotes = readBackendSource('modules/delivery-notes/delivery-notes.service.ts');
    expect(deliveryNotes).not.toMatch(
      /inventoryMovement|inventoryBalance|InventoryMovementsService/,
    );
  });

  it('posting a goods received note is what puts stock on hand, as PURCHASE_RECEIPT movements', () => {
    const grn = readBackendSource('modules/goods-received-notes/goods-received-notes.service.ts');
    expect(grn).toMatch(/createMovement\(/);
    expect(grn).toMatch(/movementType: 'PURCHASE_RECEIPT'/);
  });

  it('raising a purchase order moves no stock at all — only receiving one does', () => {
    const po = readBackendSource('modules/purchase-orders/purchase-orders.service.ts');
    const receive = bodyOf(po, 'receive');

    const writesInModule = po.match(/createMovement\(|inventoryMovement\.create/g) ?? [];
    const writesInReceive = receive.match(/createMovement\(|inventoryMovement\.create/g) ?? [];
    expect(writesInReceive.length).toBeGreaterThan(0);
    // Every stock write in the module is inside receive(); create() and
    // confirm() have none, which is the claim the primer makes.
    expect(writesInModule.length).toBe(writesInReceive.length);
  });

  it('mobile-pos-lite routes are scoped to one terminal rather than to the company', () => {
    const pos = readBackendSource('modules/mobile-pos-lite/mobile-pos-lite.controller.ts');
    // Terminal code AND the terminal's own device secret. This is an excluded
    // transport contract, not model context: the action envelope deliberately
    // cannot carry either credential header.
    expect(pos).toMatch(/@Headers\('x-mobile-pos-terminal'\)/);
    expect(pos).toMatch(/@Headers\('x-mobile-pos-device'\)/);
    const customers = manifest.find((c) => c.id === 'MobilePosLiteController.customers');
    expect(customers?.path).toBe('mobile-pos-lite/customers');
  });

  it('a POS counter sale is a SalesOrder, its SALE_ISSUE movements, and a receivable or a cash receipt', () => {
    // The plan's third named claim (§4.5), and the one the primer leans on
    // hardest: "to say what a sale did to stock, look at sales orders and
    // inventory movements, not only at the POS routes". Follow the chain.
    const pos = readBackendSource('modules/mobile-pos-lite/mobile-pos-lite.service.ts');
    expect(pos).toMatch(/salesOrders\.mobilePosLiteQuickSale\(/);

    const salesOrders = readBackendSource('modules/sales-orders/sales-orders.service.ts');
    expect(bodyOf(salesOrders, 'mobilePosLiteQuickSale')).toMatch(/this\.createAndConfirm\(/);
    expect(bodyOf(salesOrders, 'createAndConfirm')).toMatch(/this\.confirm\(/);

    // confirm() is the counter event: it issues the stock and raises exactly
    // one of the two money records.
    const confirm = bodyOf(salesOrders, 'confirm');
    expect(confirm).toMatch(/movementType: 'SALE_ISSUE'/);
    expect(confirm).toMatch(/tx\.receivable\.create\(/);
    expect(confirm).toMatch(/paymentMethod === 'CREDIT'/);
    expect(confirm).toMatch(/tx\.cashAccount\.update\(/);
  });
});

// ─────────────────── 3 & 4. the DISAMBIGUATION map itself ────────────────

describe('every DISAMBIGUATION key names something the agent can actually be handed', () => {
  const keys = Object.keys(DISAMBIGUATION);

  function matches(key: string): Capability[] {
    return manifest.filter((c) => c.id === key || c.controller === key);
  }

  it('found keys to check', () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  it('resolves each key to at least one capability in the live manifest', () => {
    // This is the assertion a renamed controller fails. Naming the orphans
    // rather than counting them is the difference between a usable failure and
    // a puzzle.
    expect(keys.filter((key) => matches(key).length === 0)).toEqual([]);
  });

  it('gates every matched capability on a permission code', () => {
    const ungated = keys.flatMap((key) =>
      matches(key)
        .filter((c) => c.guard !== 'permission' && c.guard !== 'permission-any')
        .map((c) => `${key} -> ${c.id} (${c.guard})`),
    );
    expect(ungated).toEqual([]);
  });

  it('leaves each key with at least one capability the agent can be offered', () => {
    // A note on a wholly agent-excluded controller is prompt budget spent on a
    // tool that can never be sent.
    const unreachable = keys.filter((key) => !matches(key).some((c) => reachableIds.has(c.id)));
    expect(unreachable).toEqual([]);
  });
});

describe('every name a DISAMBIGUATION note quotes is derivable from the live manifest', () => {
  const notes = Object.entries(DISAMBIGUATION);

  /** `Customers_findAll` — PascalCase base, underscore, camelCase handler. */
  const TOOL_NAME = /\b[A-Z][A-Za-z0-9]*_[a-z][A-Za-z0-9]*\b/g;
  /** `SALE_ISSUE` — a Prisma enum value quoted in prose. */
  const ENUM_VALUE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
  /** `Customer.creditLimit` — a model field quoted in prose. */
  const MODEL_FIELD = /\b([A-Z][A-Za-z0-9]*)\.([a-z][A-Za-z0-9]*)\b/g;

  const allMatches = (pattern: RegExp) =>
    notes.flatMap(([, note]) => [...note.matchAll(pattern)].map((m) => m[0]));

  it('quotes tool names, enum values and model fields, so each check has something to bite on', () => {
    // Without this, a map that stopped quoting enum values would make the enum
    // assertion below pass on an empty list — the shape of vacuous pass that
    // makes a suite look like a gate while guarding nothing.
    expect(allMatches(TOOL_NAME).length).toBeGreaterThan(10);
    expect(allMatches(ENUM_VALUE).length).toBeGreaterThan(0);
    expect(allMatches(MODEL_FIELD).length).toBeGreaterThan(0);
  });

  it('every quoted tool name is one the model will actually see', () => {
    const bad = notes.flatMap(([key, note]) =>
      [...note.matchAll(TOOL_NAME)]
        .map((m) => m[0])
        .filter((name) => !toolNames.has(name))
        .map((name) => `${key} -> ${name}`),
    );
    expect(bad).toEqual([]);
  });

  it('every quoted enum value is a real one', () => {
    const bad = notes.flatMap(([key, note]) =>
      [...note.matchAll(ENUM_VALUE)]
        .map((m) => m[0])
        .filter((value) => !allEnumValues.has(value))
        .map((value) => `${key} -> ${value}`),
    );
    expect(bad).toEqual([]);
  });

  it('every quoted model field is a real one', () => {
    const bad = notes.flatMap(([key, note]) =>
      [...note.matchAll(MODEL_FIELD)]
        .filter(([, model, field]) => !models.get(model)?.fields.includes(field))
        .map(([whole]) => `${key} -> ${whole}`),
    );
    expect(bad).toEqual([]);
  });
});

/**
 * The map's own doc comment makes two claims about how a note reaches the
 * model. Both are behaviour, so both are checkable, and neither was.
 */
describe('a note reaches the model the way tool-registry.ts says it does', () => {
  it('lets an exact capability id beat the controller-level note', () => {
    const exactKey = 'OperationsReportsController.getInventoryMovements';
    const controllerKey = 'OperationsReportsController';

    // The fixture proves nothing unless BOTH notes exist and differ — a map
    // that dropped the route-level note would otherwise pass this happily.
    expect(DISAMBIGUATION[exactKey]).toBeDefined();
    expect(DISAMBIGUATION[controllerKey]).toBeDefined();
    expect(DISAMBIGUATION[exactKey]).not.toBe(DISAMBIGUATION[controllerKey]);

    const exact = manifest.find((c) => c.id === exactKey);
    const sibling = manifest.find((c) => c.controller === controllerKey && c.id !== exactKey);
    expect(exact).toBeDefined();
    expect(sibling).toBeDefined();

    expect(disambiguationFor(exact as Capability)).toBe(DISAMBIGUATION[exactKey]);
    expect(disambiguationFor(sibling as Capability)).toBe(DISAMBIGUATION[controllerKey]);
  });

  it('puts the note directly after the action phrase, ahead of the tier warning', () => {
    const noted = manifest.filter((c) => disambiguationFor(c) !== undefined && c.tier !== 'green');
    // If every noted capability were read-only there would be no tier warning
    // to be ahead of, and the ordering claim would go untested.
    expect(noted.length).toBeGreaterThan(0);

    for (const capability of noted) {
      const note = disambiguationFor(capability) as string;
      const { description } = buildToolDefinition(capability, toolNameFor(capability, new Set()));
      const prefix = `${describeAction(capability)} ${note}`;

      expect(description.slice(0, prefix.length)).toBe(prefix);
      expect(description.indexOf('This action')).toBeGreaterThan(prefix.length - 1);
    }
  });
});

/**
 * The primer's header does not only state facts about the business; it states
 * two facts about the MANIFEST as its reason for existing at all. If those stop
 * being true the primer should shrink, and nobody would otherwise notice.
 */
describe('the reason prompts.ts gives for the primer existing still holds', () => {
  it('leaves most of the toolbox described by nothing but a path and a handler name', () => {
    const undescribed = manifest.filter((c) => c.summary === undefined);
    expect(undescribed.length / manifest.length).toBeGreaterThan(0.8);
  });

  it('still describes the two customer-ish endpoints identically apart from the path', () => {
    // The motivating failure, kept as a live fixture: "how many customers are
    // on file" answered 0 from the orphan review table. If a summary is ever
    // added to either route this stops being the reason, and the assertion
    // fails rather than the justification quietly going stale.
    const master = manifest.find((c) => c.id === 'CustomersController.findAll');
    const profiles = manifest.find((c) => c.id === 'CustomerCreditProfilesController.findAll');
    expect(master).toBeDefined();
    expect(profiles).toBeDefined();

    const withoutPath = (c: Capability) => describeAction(c).replace(c.path, '<path>');
    expect(withoutPath(master as Capability)).toBe(withoutPath(profiles as Capability));
  });
});

// ─────────────────── the prompt prompts.ts says it assembles ─────────────

/**
 * `prompts.ts` opens by saying the prompt is "assembled from a stable prefix
 * plus a small variable tail, so the prefix stays byte-identical across turns
 * and caches", and that the primer "sits inside the cached prefix". Those are
 * claims about money — a prefix that stops being byte-stable silently stops
 * hitting the cache — and about the read-only guarantee.
 */
describe('the prompt is assembled the way prompts.ts says it is', () => {
  it('carries the primer inside the cache-controlled block', () => {
    const [first, ...rest] = buildSystemPrompt({ writeMode: 'read-only' });
    expect(first.text).toContain(DOMAIN_PRIMER);
    expect(first.cache_control).toEqual({ type: 'ephemeral' });
    expect(rest.every((block) => block.cache_control === undefined)).toBe(true);
  });

  it('keeps the cached block byte-identical across people, names and dates', () => {
    const a = buildSystemPrompt({ writeMode: 'red', userName: 'Asha', today: '2026-08-19' });
    const b = buildSystemPrompt({ writeMode: 'red', userName: 'Baraka', today: '2019-01-01' });

    expect(a[0].text).toBe(b[0].text);
    // ...and the volatile content is really in the tail, not merely absent.
    expect(a[1].text).not.toBe(b[1].text);
    expect(a[1].text).toContain('Asha');
    expect(a[1].text).toContain('2026-08-19');
  });

  it('never hands a read-only deployment a clause about changing things', () => {
    const readOnly = buildSystemPrompt({ writeMode: 'read-only' })
      .map((block) => block.text)
      .join('\n');

    expect(readOnly).toContain('## You cannot change anything');
    expect(readOnly).not.toContain('## Changing things');
    expect(readOnly).not.toContain('## Irreversible and financial actions');
  });

  it('adds the irreversible-action clause at the red tier and not at amber', () => {
    const amber = buildSystemPrompt({ writeMode: 'amber' })[0].text as string;
    const red = buildSystemPrompt({ writeMode: 'red' })[0].text as string;

    expect(amber).toContain('## Changing things');
    expect(amber).not.toContain('## Irreversible and financial actions');
    expect(red).toContain('## Changing things');
    expect(red).toContain('## Irreversible and financial actions');
  });
});

// ──────────────────────────── 5. the budgets ─────────────────────────────

describe('the prompt budgets are enforced rather than aspirational', () => {
  it('keeps DOMAIN_PRIMER inside its character cap', () => {
    // Paid roughly once per user turn; growth should be a decision, not a drift.
    expect(DOMAIN_PRIMER.length).toBeLessThanOrEqual(DOMAIN_PRIMER_MAX_CHARS);
  });

  it('keeps the disambiguation map inside the size past which curation has lost', () => {
    expect(Object.keys(DISAMBIGUATION).length).toBeLessThanOrEqual(DISAMBIGUATION_MAX_ENTRIES);
  });

  it('quotes the same primer cap in prose as the constant actually holds', () => {
    // The comment explains the cap in characters AND in tokens. Both numbers
    // are claims; a cap edited in one place and not the other is the drift this
    // file is for.
    const prompts = readBackendSource('modules/msaidizi/prompts.ts');
    const quoted = /([\d,]+) characters is roughly ([\d,]+) tokens/.exec(prompts);
    expect(quoted).not.toBeNull();

    const number = (raw: string) => Number(raw.replace(/,/g, ''));
    expect(number((quoted as RegExpExecArray)[1])).toBe(DOMAIN_PRIMER_MAX_CHARS);
    // The ~4-chars-per-token heuristic the same sentence names, to 100 tokens.
    expect(number((quoted as RegExpExecArray)[2])).toBe(
      Math.round(DOMAIN_PRIMER_MAX_CHARS / 4 / 100) * 100,
    );
  });

  it('keeps each note short, since one is appended to every matching tool', () => {
    const tooLong = Object.entries(DISAMBIGUATION)
      .filter(([, note]) => note.length > DISAMBIGUATION_MAX_NOTE_CHARS)
      .map(([key, note]) => `${key} (${note.length} chars)`);
    expect(tooLong).toEqual([]);
  });
});

// ───────────── the claims the two doc comments make about the code ───────

/**
 * The doc comments in `prompts.ts` and `tool-registry.ts` also make factual
 * claims about how the surrounding machinery behaves. Those are claims too, and
 * the same rule applies to them.
 */
describe('the doc comments describe the machinery accurately', () => {
  it('the lexical narrowing never reads the primer', () => {
    const filter = readBackendSource('modules/msaidizi/domain-filter.ts');
    expect(filter).not.toMatch(/DOMAIN_PRIMER|prompts/);
  });

  it('a procedure sealed with restrictTo bypasses re-narrowing entirely', () => {
    const service = readBackendSource('modules/msaidizi/msaidizi.service.ts');
    expect(service).toMatch(/request\.restrictTo\)\s*return request\.restrictTo/);
  });

  it('the per-turn tool budget the note reasons about is the one the service uses', () => {
    // The note reasons about prompt cost from this figure ("a note is appended
    // to the description of every matching tool and up to N tools are sent per
    // turn"), so the figure has to be the service's, not a remembered one.
    const service = readBackendSource('modules/msaidizi/msaidizi.service.ts');
    const registry = readBackendSource('modules/msaidizi/tool-registry.ts');

    const inService = /const TOOL_BUDGET = (\d+);/.exec(service);
    expect(inService).not.toBeNull();

    const quoted = [...registry.matchAll(/up to (\d+) tools/g)].map((m) => m[1]);
    expect(quoted.length).toBeGreaterThan(0);
    expect([...new Set(quoted)]).toEqual([(inService as RegExpExecArray)[1]]);
  });
});
