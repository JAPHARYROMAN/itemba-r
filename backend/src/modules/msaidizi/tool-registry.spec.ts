import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Capability, extractCapabilities } from '../../common/capabilities/capability-manifest';
import { CustomersController } from '../customers/customers.controller';
import { ExpensesController } from '../expenses/expenses.controller';
import { InventoryBalancesController } from '../inventory-balances/inventory-balances.controller';
import { PayablesController } from '../payables/payables.controller';
import { ReceivablesController } from '../receivables/receivables.controller';
import { SuppliersController } from '../suppliers/suppliers.controller';
import { narrowCapabilities, tokenize } from './domain-filter';
import {
  BENCHMARK_FAST_PATH_CAPABILITY_IDS,
  buildRegistry,
  buildSearchToolSet,
  buildToolDefinition,
  ENTRY_POINT_BUDGET,
  selectEntryPoints,
  TOOL_SEARCH_DEFINITION,
  toolNameFor,
} from './tool-registry';

function capability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: 'CustomersController.findAll',
    controller: 'CustomersController',
    handler: 'findAll',
    verb: 'GET',
    path: 'customers',
    permissions: ['customers.view'],
    anyPermissions: [],
    roles: [],
    apiScopes: [],
    guard: 'permission',
    tier: 'green',
    tierReason: 'read-verb',
    params: { path: [], query: [], freeFormQuery: false, hasBody: false },
    agentExcluded: false,
    ...overrides,
  };
}

describe('tool naming', () => {
  it('is readable, stable, and valid for the API', () => {
    const name = toolNameFor(capability(), new Set());
    expect(name).toBe('Customers_findAll');
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('resolves collisions deterministically', () => {
    const taken = new Set(['Customers_findAll']);
    expect(toolNameFor(capability(), taken)).toBe('Customers_findAll_2');
  });
});

describe('tool schemas', () => {
  it('requires path params and offers named query params', () => {
    const tool = buildToolDefinition(
      capability({
        path: 'customers/:id/statements',
        params: { path: ['id'], query: ['dateFrom'], freeFormQuery: false, hasBody: false },
      }),
      'Customers_statements',
    );

    expect(tool.input_schema.required).toEqual(['path']);
    expect(Object.keys(tool.input_schema.properties)).toEqual(['path', 'query']);
    expect(tool.input_schema.properties.path).toMatchObject({
      required: ['id'],
      additionalProperties: false,
    });
    expect(tool.input_schema.properties.query).toMatchObject({
      properties: { dateFrom: { type: 'string' } },
      additionalProperties: false,
    });
  });

  it('closes the schema when the handler enumerates its parameters', () => {
    // A hallucinated parameter then fails locally instead of being rejected
    // downstream by the global ValidationPipe with forbidNonWhitelisted.
    const tool = buildToolDefinition(
      capability({ params: { path: [], query: ['search'], freeFormQuery: false, hasBody: false } }),
      'X',
    );
    expect(tool.input_schema.additionalProperties).toBe(false);
  });

  it('opens the schema only where the handler genuinely takes free-form query', () => {
    const tool = buildToolDefinition(
      capability({ params: { path: [], query: [], freeFormQuery: true, hasBody: false } }),
      'X',
    );
    expect(tool.input_schema.additionalProperties).toBe(false);
    expect(tool.input_schema.properties.query).toMatchObject({ additionalProperties: true });
    expect(tool.description).toMatch(/do not invent parameter/i);
  });

  it('derives a strict body contract from the controller DTO metadata', () => {
    const create = extractCapabilities([ExpensesController]).find(
      (entry) => entry.id === 'ExpensesController.create',
    );
    expect(create).toBeDefined();

    const tool = buildToolDefinition(create!, 'Expenses_create');
    const body = tool.input_schema.properties.body as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
      additionalProperties: boolean;
    };

    expect(tool.input_schema.required).toEqual(['body']);
    expect(body.additionalProperties).toBe(false);
    expect(body.required).toEqual(
      expect.arrayContaining(['companyId', 'expenseCategoryId', 'amount', 'expenseDate']),
    );
    expect(body.properties.amount).toMatchObject({ type: 'number' });
    expect(body.properties.currency.enum).toEqual(expect.arrayContaining(['TZS', 'USD']));
    expect(body.properties.vendorName).toMatchObject({ type: 'string' });
  });

  it('derives and closes typed whole-query DTOs instead of treating them as free form', () => {
    const findAll = extractCapabilities([ExpensesController]).find(
      (entry) => entry.id === 'ExpensesController.findAll',
    );
    expect(findAll).toBeDefined();

    const tool = buildToolDefinition(findAll!, 'Expenses_findAll');
    const query = tool.input_schema.properties.query as {
      properties: Record<string, Record<string, unknown>>;
      additionalProperties: boolean;
    };

    expect(query.additionalProperties).toBe(false);
    expect(query.properties.page).toMatchObject({ type: 'integer', minimum: 1 });
    expect(query.properties.limit).toMatchObject({ type: 'integer', minimum: 1, maximum: 5000 });
    expect(tool.input_schema.required).toBeUndefined();
  });

  it('warns the model about tiers that change or destroy data', () => {
    const amber = buildToolDefinition(capability({ verb: 'POST', tier: 'amber' }), 'X');
    const red = buildToolDefinition(capability({ verb: 'DELETE', tier: 'red' }), 'Y');
    expect(amber.description).toMatch(/changes data/i);
    expect(red.description).toMatch(/irreversible|confirmation/i);
  });

  it('only marks tools deferred when asked, since deferral needs a search tool', () => {
    expect(buildToolDefinition(capability(), 'X').defer_loading).toBeUndefined();
    expect(buildToolDefinition(capability(), 'X', { defer: true }).defer_loading).toBe(true);
  });
});

describe('buildRegistry', () => {
  const manifest = [
    capability(),
    capability({
      id: 'CustomersController.create',
      handler: 'create',
      verb: 'POST',
      permissions: ['customers.create'],
      tier: 'amber',
    }),
    capability({
      id: 'CustomersController.remove',
      handler: 'remove',
      verb: 'DELETE',
      permissions: ['customers.delete'],
      tier: 'red',
    }),
  ];
  const allPerms = ['customers.view', 'customers.create', 'customers.delete'];

  it('emits only the tiers the deployment allows', () => {
    expect(buildRegistry(manifest, allPerms, ['green']).map((e) => e.capability.tier)).toEqual([
      'green',
    ]);
    expect(
      buildRegistry(manifest, allPerms, ['green', 'amber'])
        .map((e) => e.capability.tier)
        .sort(),
    ).toEqual(['amber', 'green']);
  });

  it('intersects tier and permission rather than choosing between them', () => {
    // Holds the delete permission, but the deployment is read-only.
    expect(buildRegistry(manifest, ['customers.delete'], ['green'])).toEqual([]);
    // Deployment allows red, but the user lacks the permission.
    expect(buildRegistry(manifest, ['customers.view'], ['green', 'amber', 'red'])).toHaveLength(1);
  });
});

describe('domain narrowing', () => {
  const manifest = [
    capability({ id: 'a', path: 'customers', permissions: ['customers.view'] }),
    capability({ id: 'b', path: 'suppliers', permissions: ['suppliers.view'] }),
    capability({ id: 'c', path: 'hr/payroll/runs', permissions: ['payroll.view'] }),
    capability({
      id: 'd',
      path: 'customers/:id/statements/archive',
      permissions: ['customers.view'],
    }),
  ];

  it('ignores filler words', () => {
    expect(tokenize('show me all of the customers please')).toEqual(new Set(['customer']));
  });

  it('matches on singular and plural alike', () => {
    const picked = narrowCapabilities(manifest, 'which supplier owes us money', { limit: 5 });
    expect(picked.map((c) => c.id)).toContain('b');
  });

  it('prefers the shallowest route when two match equally', () => {
    const picked = narrowCapabilities(manifest, 'customers', { limit: 5 });
    expect(picked[0].id).toBe('a');
  });

  it('returns a usable starting set when nothing matches', () => {
    const picked = narrowCapabilities(manifest, 'zzzz qqqq', { limit: 5, floor: 2 });
    expect(picked.length).toBeGreaterThanOrEqual(2);
  });

  it('respects the limit', () => {
    const picked = narrowCapabilities(manifest, 'customers suppliers payroll', { limit: 2 });
    expect(picked).toHaveLength(2);
  });
});

/**
 * The gate behind this module's doc comments, asserted to exist.
 *
 * `prompts.domain.spec.ts` is what makes the enforcement claims in `prompts.ts`
 * and in this file's own `DISAMBIGUATION` comment true. That suite guards its
 * own RENAME — its pointer test reads `path.basename(__filename)` and requires
 * both files to name it — but it cannot guard its own DELETION: a deleted spec
 * runs nothing, and the two doc comments would go quietly back to citing a gate
 * that does not exist, which is the precise defect it was written for. A file
 * cannot notice its own absence, so a neighbouring committed spec does it.
 */
describe('domain drift gate', () => {
  it('still exists, because the doc comments in this module promise it does', () => {
    expect(existsSync(join(__dirname, 'prompts.domain.spec.ts'))).toBe(true);
  });
});

/**
 * Tool search changes what the model can SEE at once. It must not change what it
 * can REACH — that is still permission ∩ write mode, decided in buildRegistry
 * before any of this runs.
 *
 * The distinction is the whole risk of deferral. "The model cannot see it" and
 * "the model cannot reach it" are different claims, and only the second one is a
 * security property. A deferred tool is still declared, so if an unpermitted
 * capability ever reached the declared set it would be one search away —
 * invisible in review and fully reachable in practice.
 */
describe('tool search', () => {
  const manifest = [
    capability({ id: 'a', path: 'customers', permissions: ['customers.view'] }),
    capability({ id: 'b', path: 'suppliers', permissions: ['suppliers.view'] }),
    capability({
      id: 'c',
      path: 'customers/:id/statements',
      permissions: ['customers.view'],
      params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
    }),
    capability({
      id: 'd',
      handler: 'create',
      verb: 'POST',
      permissions: ['customers.create'],
      tier: 'amber',
      tierReason: 'write-verb',
    }),
    capability({ id: 'e', path: 'hr/payroll', permissions: ['payroll.view'] }),
  ];
  const allPerms = ['customers.view', 'suppliers.view', 'customers.create', 'payroll.view'];

  it('declares every permitted capability, deferring the ones outside the entry set', () => {
    const permitted = buildRegistry(manifest, allPerms, ['green', 'amber']);
    const { tools } = buildSearchToolSet(permitted, 2);

    // One search tool plus every permitted capability — nothing dropped.
    expect(tools).toHaveLength(permitted.length + 1);

    const deferred = tools.filter((t) => 'defer_loading' in t && t.defer_loading);
    expect(deferred).toHaveLength(permitted.length - 2);
  });

  it('never declares a capability the caller cannot reach', () => {
    // The property that matters. Deferral must not smuggle anything in.
    const permitted = buildRegistry(manifest, ['customers.view'], ['green']);
    const { tools } = buildSearchToolSet(permitted);

    const names = tools.map((t) => t.name);
    expect(names).toContain(TOOL_SEARCH_DEFINITION.name);
    expect(names).not.toContain('Customers_create'); // permission not held
    expect(names).not.toContain('Payroll_findAll'); // permission not held
  });

  it('never declares a tier the deployment disabled, deferred or not', () => {
    const permitted = buildRegistry(manifest, allPerms, ['green']);
    const { tools } = buildSearchToolSet(permitted);

    expect(tools.map((t) => t.name)).not.toContain('Customers_create');
  });

  it('always keeps the search tool resident, since a fully deferred set is rejected', () => {
    const permitted = buildRegistry(manifest, allPerms, ['green', 'amber']);
    const { tools } = buildSearchToolSet(permitted, 0);

    const resident = tools.filter((t) => !('defer_loading' in t && t.defer_loading));
    expect(resident).toHaveLength(1);
    expect(resident[0].name).toBe(TOOL_SEARCH_DEFINITION.name);
  });

  it('picks entry points that do not depend on the request', () => {
    // The cache property. Tools render before system, and the breakpoint is on
    // system, so a resident set that varied per request would move the bytes
    // ahead of the breakpoint and nothing would ever cache.
    const permitted = buildRegistry(manifest, allPerms, ['green']);

    const a = buildSearchToolSet(permitted).tools.map((t) => t.name);
    const b = buildSearchToolSet(permitted).tools.map((t) => t.name);

    expect(a).toEqual(b);
  });

  it('prefers shallow collection reads as entry points', () => {
    const permitted = buildRegistry(manifest, allPerms, ['green', 'amber']);
    const picked = selectEntryPoints(permitted, 2).map((e) => e.capability.id);

    // Shallow green lists win over a nested one and over the amber write.
    expect(picked).not.toContain('c');
    expect(picked).not.toContain('d');
  });

  it('defaults to a small entry set', () => {
    expect(ENTRY_POINT_BUDGET).toBeLessThanOrEqual(20);
  });

  describe('2026-08-20 benchmark fast path', () => {
    const benchmarkCases = [
      ['How many customers do we have on file?', 'CustomersController.findAll'],
      ['List our suppliers.', 'SuppliersController.findAll'],
      ['Who owes us money?', 'ReceivablesController.findAll'],
      ['What do we owe our suppliers?', 'PayablesController.findAll'],
      ['What did we spend money on recently?', 'ExpensesController.findAll'],
      ['Which items are running low and need reordering?', 'InventoryBalancesController.findAll'],
      ['Are there any bills we have not settled yet?', 'PayablesController.findAll'],
    ] as const;

    const benchmarkManifest = BENCHMARK_FAST_PATH_CAPABILITY_IDS.map((id) => {
      const controller = id.split('.')[0];
      const resource = controller.replace(/Controller$/, '');
      return capability({
        id,
        controller,
        handler: 'findAll',
        path: resource.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
        permissions: [`${resource.toLowerCase()}.view`],
      });
    });

    it('names capabilities that still exist in the routed controllers', () => {
      const actualIds = new Set(
        extractCapabilities([
          CustomersController,
          SuppliersController,
          ReceivablesController,
          PayablesController,
          ExpensesController,
          InventoryBalancesController,
        ]).map((entry) => entry.id),
      );

      expect(BENCHMARK_FAST_PATH_CAPABILITY_IDS.every((id) => actualIds.has(id))).toBe(true);
    });

    it.each(benchmarkCases)('%s keeps %s resident', (_prompt, expectedId) => {
      const permissions = benchmarkManifest.flatMap((entry) => entry.permissions);
      const permitted = buildRegistry(benchmarkManifest, permissions, ['green']);
      const selected = selectEntryPoints(permitted).map((entry) => entry.capability.id);

      expect(selected).toContain(expectedId);
    });

    it('does not use the measured list to bypass permission filtering', () => {
      const permitted = buildRegistry(benchmarkManifest, ['expenses.view'], ['green']);
      const selected = selectEntryPoints(permitted).map((entry) => entry.capability.id);

      expect(selected).toEqual(['ExpensesController.findAll']);
      expect(selected).not.toContain('PayablesController.findAll');
    });

    it('prioritizes measured reads ahead of generic shallow routes when the budget is tight', () => {
      const generic = capability({
        id: 'AController.findAll',
        controller: 'AController',
        path: 'a',
        permissions: ['a.view'],
      });
      const permissions = [...benchmarkManifest.flatMap((entry) => entry.permissions), 'a.view'];
      const permitted = buildRegistry([...benchmarkManifest, generic], permissions, ['green']);

      expect(selectEntryPoints(permitted, 1)[0].capability.id).toBe('CustomersController.findAll');
    });
  });
});
