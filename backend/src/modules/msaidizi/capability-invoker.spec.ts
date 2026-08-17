/**
 * The invoker is the agent's only route to the API, so what it does and does not
 * put on the wire is a security property, not a detail.
 */

import { Capability } from '../../common/capabilities/capability-manifest';
import { AGENT_SESSION_HEADER, buildPath, CapabilityInvoker } from './capability-invoker';
import { MsaidiziConfig } from './msaidizi.config';

function capability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: 'C.h',
    controller: 'C',
    handler: 'h',
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

const config = {
  loopbackBaseUrl: 'http://127.0.0.1:3001/api/v1',
  invokeTimeoutMs: 5000,
} as unknown as MsaidiziConfig;

describe('buildPath', () => {
  it('substitutes path params and leaves the rest for query or body', () => {
    const { path, rest, missing } = buildPath('profit/products/:productId/ledger', {
      productId: 'p1',
      from: '2026-01-01',
    });
    expect(path).toBe('profit/products/p1/ledger');
    expect(rest).toEqual({ from: '2026-01-01' });
    expect(missing).toEqual([]);
  });

  it('reports missing path params rather than sending a malformed URL', () => {
    const { missing } = buildPath('invoices/:id', {});
    expect(missing).toEqual(['id']);
  });

  it('encodes path values so an argument cannot escape its segment', () => {
    const { path } = buildPath('invoices/:id', { id: '../../admin/users' });
    expect(path).toBe('invoices/..%2F..%2Fadmin%2Fusers');
    expect(path).not.toContain('/admin/');
  });
});

describe('CapabilityInvoker', () => {
  const originalFetch = global.fetch;
  let seen: { url: string; init: RequestInit };

  beforeEach(() => {
    seen = { url: '', init: {} };
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('carries the caller credential and the agent session id, and nothing else', async () => {
    const invoker = new CapabilityInvoker(config);
    await invoker.invoke({
      capability: capability(),
      args: {},
      authorization: 'Bearer caller-token',
      agentSessionId: 'ms_abc12345',
    });

    const headers = seen.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer caller-token');
    expect(headers[AGENT_SESSION_HEADER]).toBe('ms_abc12345');
    // No cookies, no API key, no ambient credential of the agent's own.
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('cookie');
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('x-api-key');
  });

  it('sends leftover arguments as query on a read', async () => {
    const invoker = new CapabilityInvoker(config);
    await invoker.invoke({
      capability: capability(),
      args: { search: 'asha', limit: '10' },
      authorization: 'Bearer t',
      agentSessionId: 'ms_abc12345',
    });

    expect(seen.url).toContain('search=asha');
    expect(seen.url).toContain('limit=10');
    expect(seen.init.body).toBeUndefined();
  });

  it('sends leftover arguments as a JSON body on a write', async () => {
    const invoker = new CapabilityInvoker(config);
    await invoker.invoke({
      capability: capability({ verb: 'POST', tier: 'amber' }),
      args: { name: 'Asha' },
      authorization: 'Bearer t',
      agentSessionId: 'ms_abc12345',
    });

    expect(seen.init.method).toBe('POST');
    expect(seen.init.body).toBe(JSON.stringify({ name: 'Asha' }));
  });

  it('fails without calling out when a required path param is absent', async () => {
    const invoker = new CapabilityInvoker(config);
    const result = await invoker.invoke({
      capability: capability({ path: 'invoices/:id' }),
      args: {},
      authorization: 'Bearer t',
      agentSessionId: 'ms_abc12345',
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('id');
  });

  it('tells the model a 403 is final rather than something to work around', async () => {
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ message: 'Missing permission' }), { status: 403 }),
    ) as unknown as typeof fetch;

    const invoker = new CapabilityInvoker(config);
    const result = await invoker.invoke({
      capability: capability(),
      args: {},
      authorization: 'Bearer t',
      agentSessionId: 'ms_abc12345',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/do not retry/i);
  });

  it('surfaces a transport failure without leaking internals to the model', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:3001');
    }) as unknown as typeof fetch;

    const invoker = new CapabilityInvoker(config);
    const result = await invoker.invoke({
      capability: capability(),
      args: {},
      authorization: 'Bearer t',
      agentSessionId: 'ms_abc12345',
    });

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('ECONNREFUSED');
  });
});
