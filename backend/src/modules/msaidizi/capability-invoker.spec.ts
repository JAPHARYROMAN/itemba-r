/**
 * The invoker is the agent's only route to the API, so what it does and does not
 * put on the wire is a security property, not a detail.
 */

import { Capability } from '../../common/capabilities/capability-manifest';
import { actionArgumentDigest } from '../../common/utils/canonical-digest';
import {
  AGENT_SESSION_HEADER,
  buildPath,
  CapabilityInvoker,
  MAX_CAPABILITY_RESPONSE_BYTES,
} from './capability-invoker';
import {
  encodeErpEgressAdapterMeasurement,
  encodeErpEgressRequestContext,
  ERP_EGRESS_CONTEXT_HEADER,
  ERP_EGRESS_MEASUREMENT_HEADER,
  ErpEgressInvocationBinding,
} from './erp-egress-metering';
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

  it('maps the explicit path/query/body envelope without leaking namespace wrappers', async () => {
    const invoker = new CapabilityInvoker(config);
    await invoker.invoke({
      capability: capability({
        verb: 'PATCH',
        path: 'customers/:id',
        tier: 'amber',
        params: { path: ['id'], query: [], freeFormQuery: false, hasBody: true },
      }),
      args: {
        path: { id: 'customer/41' },
        query: { dryRun: true },
        body: { name: 'Asha' },
      },
      authorization: 'Bearer t',
      agentSessionId: 'ms_abc12345',
    });

    expect(seen.url).toContain('/customers/customer%2F41');
    expect(seen.url).toContain('dryRun=true');
    expect(seen.init.body).toBe(JSON.stringify({ name: 'Asha' }));
  });

  it('unwraps the previously advertised nested body while accepting a legacy top-level path id', async () => {
    const invoker = new CapabilityInvoker(config);
    await invoker.invoke({
      capability: capability({
        verb: 'PATCH',
        path: 'customers/:id',
        tier: 'amber',
        params: { path: ['id'], query: [], freeFormQuery: false, hasBody: true },
      }),
      args: { id: '41', body: { name: 'Asha' } },
      authorization: 'Bearer t',
      agentSessionId: 'ms_abc12345',
    });

    expect(seen.url).toContain('/customers/41');
    expect(seen.init.body).toBe(JSON.stringify({ name: 'Asha' }));
    expect(seen.init.body).not.toBe(JSON.stringify({ body: { name: 'Asha' } }));
  });

  it('keeps explicit query parameters out of a write body', async () => {
    const invoker = new CapabilityInvoker(config);
    await invoker.invoke({
      capability: capability({
        verb: 'POST',
        tier: 'amber',
        params: { path: [], query: ['validateOnly'], freeFormQuery: false, hasBody: true },
      }),
      args: { query: { validateOnly: true }, body: { name: 'Asha' } },
      authorization: 'Bearer t',
      agentSessionId: 'ms_abc12345',
    });

    expect(seen.url).toContain('validateOnly=true');
    expect(seen.init.body).toBe(JSON.stringify({ name: 'Asha' }));
  });

  it('rejects malformed namespaces before making a request', async () => {
    const invoker = new CapabilityInvoker(config);
    const result = await invoker.invoke({
      capability: capability(),
      args: { query: 'search=asha' },
      authorization: 'Bearer t',
      agentSessionId: 'ms_abc12345',
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, status: 0 });
    expect(result.error).toMatch(/query.*object/i);
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

  it('streams within the exact caller reservation and reports raw byte provenance', async () => {
    const raw = JSON.stringify({ amount: 1250, currency: 'TZS' });
    global.fetch = jest.fn(
      async () => new Response(raw, { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await new CapabilityInvoker(config).invoke({
      capability: capability(),
      args: {},
      authorization: 'Bearer t',
      agentSessionId: 'ms_budgeted',
      maxResponseBytes: Buffer.byteLength(raw),
    });

    expect(result).toMatchObject({
      ok: true,
      responseBytes: Buffer.byteLength(raw),
      body: { amount: 1250, currency: 'TZS' },
    });
    expect(result.responseSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('cancels a response that exceeds the parent-reserved byte budget', async () => {
    global.fetch = jest.fn(
      async () => new Response('123456789', { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await new CapabilityInvoker(config).invoke({
      capability: capability(),
      args: {},
      authorization: 'Bearer t',
      agentSessionId: 'ms_budgeted',
      maxResponseBytes: 8,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 200,
      responseBytes: 8,
      responseLimitExceeded: true,
    });
    expect(result.body).toBeNull();
    expect(result.error).toMatch(/reserved 8-byte task budget/i);
  });

  it('keeps the default response ceiling outside model control', async () => {
    expect(MAX_CAPABILITY_RESPONSE_BYTES).toBe(16 * 1024 * 1024);
  });

  it('issues a result-bound receipt from a strict adapter measurement for a durable task', async () => {
    const args = { body: { message: 'hello' } };
    const binding: ErpEgressInvocationBinding = {
      taskId: 'task-1',
      planVersionId: 'plan-1',
      stepId: 'step-1',
      attemptId: 'attempt-1',
      capabilityId: 'C.h',
      capabilityVersion: '1',
      argumentsSha256: actionArgumentDigest(args),
      reservedExternalEgressBytes: 4096,
    };
    const context = encodeErpEgressRequestContext(binding);
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: {
          [ERP_EGRESS_MEASUREMENT_HEADER]: encodeErpEgressAdapterMeasurement({
            kind: 'msaidizi-erp-egress-measurement/v1',
            contextSha256: context.sha256,
            measurementId: 'a'.repeat(64),
            destinationSha256: 'b'.repeat(64),
            outcome: 'completed',
            measuredExternalEgressBytes: 700,
            uncertainExternalEgressBytes: 12,
          }),
        },
      });
    }) as unknown as typeof fetch;

    const result = await new CapabilityInvoker(config).invoke({
      capability: capability({
        verb: 'POST',
        tier: 'red',
        externalEgress: { metering: 'adapter-receipt-v1', reservationBytes: 4096 },
      }),
      args,
      authorization: 'Bearer task-token',
      agentSessionId: 'task_task1',
      egressBinding: binding,
    });

    expect((seen.init.headers as Record<string, string>)[ERP_EGRESS_CONTEXT_HEADER]).toBe(
      context.header,
    );
    expect(result).toMatchObject({
      ok: true,
      egressReceipt: {
        ...binding,
        chargedExternalEgressBytes: 712,
        httpStatus: 202,
      },
    });
    expect(result.egressReceipt?.resultSha256).toBe(result.responseSha256);
  });

  it('reports missing metering evidence without hiding the HTTP outcome', async () => {
    const args = { body: { message: 'hello' } };
    const binding: ErpEgressInvocationBinding = {
      taskId: 'task-1',
      planVersionId: 'plan-1',
      stepId: 'step-1',
      attemptId: 'attempt-1',
      capabilityId: 'C.h',
      capabilityVersion: '1',
      argumentsSha256: actionArgumentDigest(args),
      reservedExternalEgressBytes: 4096,
    };
    const result = await new CapabilityInvoker(config).invoke({
      capability: capability({
        verb: 'POST',
        tier: 'red',
        externalEgress: { metering: 'adapter-receipt-v1', reservationBytes: 4096 },
      }),
      args,
      authorization: 'Bearer task-token',
      agentSessionId: 'task_task1',
      egressBinding: binding,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      egressReceiptError: 'ERP_EGRESS_RECEIPT_MISSING',
    });
    expect(result.egressReceipt).toBeUndefined();
  });

  it('rejects a durable binding that does not match capability, reservation, or arguments', async () => {
    const args = { body: { message: 'hello' } };
    const result = await new CapabilityInvoker(config).invoke({
      capability: capability({
        verb: 'POST',
        tier: 'red',
        externalEgress: { metering: 'adapter-receipt-v1', reservationBytes: 4096 },
      }),
      args,
      authorization: 'Bearer task-token',
      agentSessionId: 'task_task1',
      egressBinding: {
        taskId: 'task-1',
        planVersionId: 'plan-1',
        stepId: 'step-1',
        attemptId: 'attempt-1',
        capabilityId: 'Different.send',
        capabilityVersion: '1',
        argumentsSha256: actionArgumentDigest(args),
        reservedExternalEgressBytes: 4096,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: 0,
      egressReceiptError: 'ERP_EGRESS_BINDING_INVALID',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('preserves the request-bound human path when no durable task binding is supplied', async () => {
    const result = await new CapabilityInvoker(config).invoke({
      capability: capability({
        verb: 'POST',
        tier: 'red',
        externalEgress: { metering: 'adapter-receipt-v1', reservationBytes: 4096 },
      }),
      args: { body: { message: 'human-approved' } },
      authorization: 'Bearer human-token',
      agentSessionId: 'ms_human1',
    });

    expect(result.ok).toBe(true);
    expect(result.egressReceipt).toBeUndefined();
    expect(result.egressReceiptError).toBeUndefined();
  });
});
