import { Capability } from '../../common/capabilities/capability-manifest';
import { narrowCapabilities, tokenize } from './domain-filter';
import { buildRegistry, buildToolDefinition, toolNameFor } from './tool-registry';

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

    expect(tool.input_schema.required).toEqual(['id']);
    expect(Object.keys(tool.input_schema.properties)).toEqual(['id', 'dateFrom']);
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
    expect(tool.input_schema.additionalProperties).toBe(true);
    expect(tool.description).toMatch(/do not invent parameter names/i);
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
