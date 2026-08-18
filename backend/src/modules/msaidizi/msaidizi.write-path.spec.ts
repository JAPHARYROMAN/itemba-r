/**
 * The write path: a confirmed red-tier action actually executes.
 *
 * These tests exist because the confirmation gate has never been proved end to
 * end. `msaidizi.isolation.spec.ts` already asserts that a confirmed action
 * runs — but its manifest holds a single capability, so `permitted.length` never
 * exceeds TOOL_BUDGET, narrowing never runs, and the defect it would have caught
 * is invisible to it. That is the shape of this project's whole history: the
 * positive controls find the real bugs, and they only find them when the fixture
 * is realistic enough for the bug to fire.
 *
 * So every test here uses a manifest ABOVE the tool budget. The negative control
 * below proves the fixture genuinely reproduces the defect; without it, the
 * positive control could pass for the wrong reason.
 */

import { Capability } from '../../common/capabilities/capability-manifest';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CapabilityInvoker, InvocationRequest, InvocationResult } from './capability-invoker';
import { ManifestProvider } from './manifest.provider';
import { ModelClient, ModelMessage, ModelRequest, ModelResponse } from './model-client';
import { MsaidiziConfig, WriteMode } from './msaidizi.config';
import { confirmationIdFor, MsaidiziService } from './msaidizi.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

/** The red-tier action under test. Deeper than the padding, which matters below. */
const RED_CAP = capability({
  id: 'InvoicesController.remove',
  controller: 'InvoicesController',
  handler: 'remove',
  verb: 'DELETE',
  path: 'invoices/:id',
  permissions: ['invoices.delete'],
  tier: 'red',
  tierReason: 'delete-verb',
  params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
});

const RED_TOOL = 'Invoices_remove';

/**
 * Enough unrelated collection endpoints to push the permitted set past
 * TOOL_BUDGET, so relevance narrowing actually runs.
 *
 * They are shallow (`ledger7`, depth 1) while the red capability is deeper
 * (`invoices/:id`, depth 2). That is not incidental: when a message scores
 * nothing, `narrowCapabilities` falls back to the *shallowest* capabilities, so
 * shallow padding is exactly what displaces the red tool on a bare "yes".
 */
const PADDING: Capability[] = Array.from({ length: 70 }, (_, i) =>
  capability({
    id: `Ledger${i}Controller.findAll`,
    controller: `Ledger${i}Controller`,
    handler: 'findAll',
    verb: 'GET',
    path: `ledger${i}`,
    permissions: [`ledger${i}.view`],
  }),
);

const MANIFEST = [RED_CAP, ...PADDING];

const ALL_PERMISSIONS = ['invoices.delete', ...PADDING.map((c) => c.permissions[0])];

function authUser(permissions: string[]): AuthUser {
  return {
    id: 'user-A',
    email: 'a@itemba.local',
    fullName: 'Asha',
    roles: ['Company Manager'],
    roleScopes: ['COMPANY'],
    permissions,
    companyId: 'company-A',
    companyAccess: [],
  } as unknown as AuthUser;
}

function configFor(writeMode: WriteMode, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    enabled: true,
    model: 'claude-opus-5',
    classifierModel: 'claude-haiku-4-5',
    effort: 'medium',
    writeMode,
    allowedTiers:
      writeMode === 'read-only'
        ? ['green']
        : writeMode === 'amber'
          ? ['green', 'amber']
          : ['green', 'amber', 'red'],
    maxWritesPerSession: 10,
    maxToolCallsPerSession: 40,
    maxTokens: 32000,
    invokeTimeoutMs: 30000,
    loopbackBaseUrl: 'http://127.0.0.1:3001/api/v1',
    ...overrides,
  } as unknown as MsaidiziConfig;
}

class ScriptedModel extends ModelClient {
  readonly seen: ModelRequest[] = [];
  constructor(private readonly script: ModelResponse[]) {
    super();
  }
  async createMessage(request: ModelRequest): Promise<ModelResponse> {
    this.seen.push(request);
    return (
      this.script.shift() ?? {
        content: [{ type: 'text', text: 'Done.' }],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 1000,
          outputTokens: 50,
          cacheReadInputTokens: 900,
          cacheCreationInputTokens: 0,
        },
      }
    );
  }
}

function toolUse(name: string, input: Record<string, unknown> = {}, id = 'tu_1'): ModelResponse {
  return {
    content: [{ type: 'tool_use', id, name, input }],
    stopReason: 'tool_use',
    usage: {
      inputTokens: 2000,
      outputTokens: 120,
      cacheReadInputTokens: 1024,
      cacheCreationInputTokens: 256,
    },
  };
}

class RecordingInvoker extends CapabilityInvoker {
  readonly calls: InvocationRequest[] = [];
  constructor(private readonly result: InvocationResult = { ok: true, status: 200, body: [] }) {
    super(configFor('read-only'));
  }
  async invoke(request: InvocationRequest): Promise<InvocationResult> {
    this.calls.push(request);
    return this.result;
  }
}

function makeService(model: ModelClient, invoker: CapabilityInvoker, config: MsaidiziConfig) {
  const manifest = new ManifestProvider();
  manifest.setForTesting(MANIFEST);
  return new MsaidiziService(config, manifest, model, invoker);
}

/** Tool names offered to the model on a given turn. */
function toolsOn(model: ScriptedModel, turn: number): string[] {
  return model.seen[turn].tools.map((t) => t.name);
}

// ─── The fixture reproduces the defect ────────────────────────────────────────

describe('the narrowing defect this fixture must reproduce', () => {
  it('drops the approved tool on a bare "yes" when confirmed is absent', async () => {
    // The negative control. Without it, the positive control below could pass
    // simply because narrowing never ran, which is precisely how the existing
    // isolation spec missed this for the whole life of the project.
    const model = new ScriptedModel([]);
    const service = makeService(model, new RecordingInvoker(), configFor('red'));

    await service.run({
      user: authUser(ALL_PERMISSIONS),
      authorization: 'Bearer t',
      sessionId: 'ms_fixed_session_id',
      messages: [
        { role: 'user', content: 'delete invoice 41' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: RED_TOOL, input: { id: '41' } }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'confirm' },
          ],
        },
        { role: 'user', content: 'yes' },
      ],
    });

    // Narrowing ran (the set was cut) and it deleted the tool being confirmed.
    expect(model.seen[0].tools.length).toBeLessThan(MANIFEST.length);
    expect(toolsOn(model, 0)).not.toContain(RED_TOOL);
  });

  it('keeps the approved tool when confirmed is non-empty', async () => {
    // The fix, asserted directly: same bare "yes", same narrowing, but the tool
    // named in the prior turn's tool_use block is unioned back in.
    const model = new ScriptedModel([]);
    const service = makeService(model, new RecordingInvoker(), configFor('red'));
    const sessionId = 'ms_fixed_session_id';

    await service.run({
      user: authUser(ALL_PERMISSIONS),
      authorization: 'Bearer t',
      sessionId,
      confirmed: [confirmationIdFor(sessionId, RED_TOOL, { id: '41' })],
      messages: [
        { role: 'user', content: 'delete invoice 41' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: RED_TOOL, input: { id: '41' } }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'confirm' },
          ],
        },
        { role: 'user', content: 'yes' },
      ],
    });

    expect(toolsOn(model, 0)).toContain(RED_TOOL);
    // Still narrowed — the union adds the proposed tool, it does not lift the budget.
    expect(model.seen[0].tools.length).toBeLessThan(MANIFEST.length);
  });

  it('keeps it for a confirmation in any language, not just one that scores well', () => {
    // The gate must not depend on the confirming message carrying useful
    // vocabulary. "ndiyo" scores against nothing, exactly like "yes".
    return Promise.all(
      ['yes', 'ndiyo', 'ok', 'y'].map(async (word) => {
        const model = new ScriptedModel([]);
        const service = makeService(model, new RecordingInvoker(), configFor('red'));
        const sessionId = 'ms_fixed_session_id';

        await service.run({
          user: authUser(ALL_PERMISSIONS),
          authorization: 'Bearer t',
          sessionId,
          confirmed: [confirmationIdFor(sessionId, RED_TOOL, { id: '41' })],
          messages: [
            { role: 'user', content: 'delete invoice 41' },
            {
              role: 'assistant',
              content: [{ type: 'tool_use', id: 'tu_1', name: RED_TOOL, input: { id: '41' } }],
            },
            {
              role: 'user',
              content: [
                { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'confirm' },
              ],
            },
            { role: 'user', content: word },
          ],
        });

        expect(toolsOn(model, 0)).toContain(RED_TOOL);
      }),
    );
  });
});

// ─── The positive control ─────────────────────────────────────────────────────

describe('a confirmed red-tier action executes (full two-turn flow)', () => {
  it('proposes on turn one, suspends, then actually invokes on turn two', async () => {
    const sessionId = 'ms_fixed_session_id';

    // ── Turn 1: the user asks, the model proposes, the run suspends. ──
    const turn1Model = new ScriptedModel([toolUse(RED_TOOL, { id: '41' })]);
    const turn1Invoker = new RecordingInvoker();
    const turn1Service = makeService(turn1Model, turn1Invoker, configFor('red'));

    const proposed = await turn1Service.run({
      user: authUser(ALL_PERMISSIONS),
      authorization: 'Bearer caller-token',
      sessionId,
      messages: [{ role: 'user', content: 'delete invoice 41' }],
    });

    expect(proposed.reason).toBe('awaiting_confirmation');
    expect(turn1Invoker.calls).toEqual([]); // nothing has changed yet

    const gate = proposed.events.find((e) => e.type === 'confirmation_required');
    expect(gate).toBeDefined();
    const confirmationId = (gate as { confirmationId: string }).confirmationId;

    // ── Turn 2: the client echoes the transport state and the approval. ──
    // Exactly what the controller builds: prior messages, then the new turn.
    const turn2Model = new ScriptedModel([toolUse(RED_TOOL, { id: '41' })]);
    const turn2Invoker = new RecordingInvoker();
    const turn2Service = makeService(turn2Model, turn2Invoker, configFor('red'));

    const executed = await turn2Service.run({
      user: authUser(ALL_PERMISSIONS),
      authorization: 'Bearer caller-token',
      sessionId,
      confirmed: [confirmationId],
      messages: [...(proposed.messages as ModelMessage[]), { role: 'user', content: 'yes' }],
    });

    // The whole point: the tool ran.
    expect(turn2Invoker.calls).toHaveLength(1);
    expect(turn2Invoker.calls[0].args).toEqual({ id: '41' });
    expect(turn2Invoker.calls[0].capability.id).toBe('InvoicesController.remove');

    // Under the caller's own credential, correlated to the same session, so the
    // audit row this produces is findable by agentSessionId.
    expect(turn2Invoker.calls[0].authorization).toBe('Bearer caller-token');
    expect(turn2Invoker.calls[0].agentSessionId).toBe(sessionId);

    // And it is reported as a real tool call, not a second confirmation prompt.
    expect(executed.events.some((e) => e.type === 'tool_call' && e.tool === RED_TOOL)).toBe(true);
    expect(executed.events.some((e) => e.type === 'confirmation_required')).toBe(false);
    expect(executed.reason).toBe('end_turn');
  });

  it('does not let a confirmation be replayed against a different action', async () => {
    // Approval is bound to the exact arguments, and the union must not smuggle a
    // neighbouring action through just because the tool name matches.
    const sessionId = 'ms_fixed_session_id';
    const approved = confirmationIdFor(sessionId, RED_TOOL, { id: '41' });

    const model = new ScriptedModel([toolUse(RED_TOOL, { id: '42' })]);
    const invoker = new RecordingInvoker();
    const service = makeService(model, invoker, configFor('red'));

    const result = await service.run({
      user: authUser(ALL_PERMISSIONS),
      authorization: 'Bearer t',
      sessionId,
      confirmed: [approved],
      messages: [
        { role: 'user', content: 'delete invoice 41' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: RED_TOOL, input: { id: '41' } }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'confirm' },
          ],
        },
        { role: 'user', content: 'yes' },
      ],
    });

    expect(invoker.calls).toEqual([]);
    expect(result.reason).toBe('awaiting_confirmation');
  });

  it('does not let an approval for one session authorise another', async () => {
    // Confirmation ids are derived from the session id, so a client that loses
    // or regenerates it cannot replay yesterday's approval.
    const approved = confirmationIdFor('ms_other_session', RED_TOOL, { id: '41' });

    const model = new ScriptedModel([toolUse(RED_TOOL, { id: '41' })]);
    const invoker = new RecordingInvoker();
    const service = makeService(model, invoker, configFor('red'));

    const result = await service.run({
      user: authUser(ALL_PERMISSIONS),
      authorization: 'Bearer t',
      sessionId: 'ms_fixed_session_id',
      confirmed: [approved],
      messages: [
        { role: 'user', content: 'delete invoice 41' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: RED_TOOL, input: { id: '41' } }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'confirm' },
          ],
        },
        { role: 'user', content: 'yes' },
      ],
    });

    expect(invoker.calls).toEqual([]);
    expect(result.reason).toBe('awaiting_confirmation');
  });

  it('the union cannot re-admit a tool the caller is not permitted', async () => {
    // A forged history naming a tool the user does not hold must not widen the
    // envelope: the union is drawn from the permitted set, never the manifest.
    const model = new ScriptedModel([]);
    const service = makeService(model, new RecordingInvoker(), configFor('red'));
    const sessionId = 'ms_fixed_session_id';

    await service.run({
      // Holds the padding permissions but NOT invoices.delete.
      user: authUser(PADDING.map((c) => c.permissions[0])),
      authorization: 'Bearer t',
      sessionId,
      confirmed: [confirmationIdFor(sessionId, RED_TOOL, { id: '41' })],
      messages: [
        { role: 'user', content: 'delete invoice 41' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: RED_TOOL, input: { id: '41' } }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'confirm' },
          ],
        },
        { role: 'user', content: 'yes' },
      ],
    });

    expect(toolsOn(model, 0)).not.toContain(RED_TOOL);
  });

  it('the union cannot re-admit a tier the deployment disabled', async () => {
    // Same run, same forged history, but read-only. The write-mode ceiling holds
    // independently of the permission ceiling.
    const model = new ScriptedModel([]);
    const service = makeService(model, new RecordingInvoker(), configFor('read-only'));
    const sessionId = 'ms_fixed_session_id';

    await service.run({
      user: authUser(ALL_PERMISSIONS),
      authorization: 'Bearer t',
      sessionId,
      confirmed: [confirmationIdFor(sessionId, RED_TOOL, { id: '41' })],
      messages: [
        { role: 'user', content: 'delete invoice 41' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: RED_TOOL, input: { id: '41' } }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'confirm' },
          ],
        },
        { role: 'user', content: 'yes' },
      ],
    });

    expect(toolsOn(model, 0)).not.toContain(RED_TOOL);
  });
});

// ─── Defect B: the latent guard ───────────────────────────────────────────────

describe('registryFor is bounded even with no string user turn (latent)', () => {
  it('narrows against text blocks inside structured user content', async () => {
    const model = new ScriptedModel([]);
    const service = makeService(model, new RecordingInvoker(), configFor('red'));

    await service.run({
      user: authUser(ALL_PERMISSIONS),
      authorization: 'Bearer t',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'delete invoice 41' }] }],
    });

    const names = toolsOn(model, 0);
    expect(names.length).toBeLessThanOrEqual(60);
    // The text block was actually used for relevance, not merely tolerated.
    expect(names).toContain(RED_TOOL);
  });

  it('falls back to a bounded set when a user turn carries no text at all', async () => {
    const model = new ScriptedModel([]);
    const service = makeService(model, new RecordingInvoker(), configFor('red'));

    await service.run({
      user: authUser(ALL_PERMISSIONS),
      authorization: 'Bearer t',
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: false, content: 'x' }],
        },
      ],
    });

    // Before the guard this returned the entire permitted set (71 here; 474 to
    // over a thousand in production).
    expect(model.seen[0].tools.length).toBeLessThanOrEqual(60);
    expect(model.seen[0].tools.length).toBeGreaterThan(0);
  });
});

// ─── Usage ────────────────────────────────────────────────────────────────────

describe('a run reports what it actually cost', () => {
  it('accumulates input, output and cache tokens across every model turn', async () => {
    const invoker = new RecordingInvoker();
    // Two model turns: one tool call, then the closing text turn.
    const model = new ScriptedModel([toolUse('Ledger0_findAll', {})]);
    const service = makeService(model, invoker, configFor('read-only'));

    const result = await service.run({
      user: authUser(ALL_PERMISSIONS),
      authorization: 'Bearer t',
      messages: [{ role: 'user', content: 'show ledger0' }],
    });

    expect(result.usage.modelTurns).toBe(2);
    // 2000 from the tool turn + 1000 from the default closing turn.
    expect(result.usage.inputTokens).toBe(3000);
    expect(result.usage.outputTokens).toBe(170);
    expect(result.usage.cacheReadInputTokens).toBe(1924);
    expect(result.usage.cacheCreationInputTokens).toBe(256);
  });

  it('reports usage on a suspended run too, because those tokens were spent', async () => {
    const model = new ScriptedModel([toolUse(RED_TOOL, { id: '41' })]);
    const service = makeService(model, new RecordingInvoker(), configFor('red'));

    const result = await service.run({
      user: authUser(ALL_PERMISSIONS),
      authorization: 'Bearer t',
      messages: [{ role: 'user', content: 'delete invoice 41' }],
    });

    expect(result.reason).toBe('awaiting_confirmation');
    expect(result.usage.modelTurns).toBe(1);
    expect(result.usage.inputTokens).toBe(2000);
    expect(result.usage.cacheReadInputTokens).toBe(1024);
  });

  it('reports zeroed usage rather than throwing when the model turn fails', async () => {
    const model = new (class extends ModelClient {
      async createMessage(): Promise<ModelResponse> {
        throw new Error('upstream down');
      }
    })();
    const service = makeService(model, new RecordingInvoker(), configFor('read-only'));

    const result = await service.run({
      user: authUser(ALL_PERMISSIONS),
      authorization: 'Bearer t',
      messages: [{ role: 'user', content: 'show ledger0' }],
    });

    expect(result.reason).toBe('failed');
    expect(result.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      modelTurns: 0,
    });
  });
});

// ─── Capabilities ─────────────────────────────────────────────────────────────

describe('GET /msaidizi/capabilities reports only what the caller can reach', () => {
  it('lists the caller permitted capabilities and nothing else', () => {
    const service = makeService(new ScriptedModel([]), new RecordingInvoker(), configFor('red'));

    const report = service.capabilitiesFor(authUser(['ledger0.view', 'ledger1.view']));

    expect(report.capabilities.map((c) => c.name).sort()).toEqual([
      'Ledger0_findAll',
      'Ledger1_findAll',
    ]);
    expect(report.capabilities.map((c) => c.name)).not.toContain(RED_TOOL);
  });

  it('withholds a permitted capability whose tier the deployment disabled', () => {
    const service = makeService(
      new ScriptedModel([]),
      new RecordingInvoker(),
      configFor('read-only'),
    );

    const report = service.capabilitiesFor(authUser(ALL_PERMISSIONS));

    expect(report.capabilities.map((c) => c.name)).not.toContain(RED_TOOL);
    expect(report.writeMode).toBe('read-only');
    expect(report.allowedTiers).toEqual(['green']);
  });

  it('returns nothing at all to a caller with no permissions', () => {
    const service = makeService(new ScriptedModel([]), new RecordingInvoker(), configFor('red'));

    const report = service.capabilitiesFor(authUser([]));

    expect(report.capabilities).toEqual([]);
    expect(report.narrowing).toEqual({ active: false, permitted: 0, perRun: 0 });
  });

  it('says whether narrowing is active for this caller', () => {
    const service = makeService(new ScriptedModel([]), new RecordingInvoker(), configFor('red'));

    const broad = service.capabilitiesFor(authUser(ALL_PERMISSIONS));
    expect(broad.narrowing).toEqual({ active: true, permitted: 71, perRun: 60 });

    const narrow = service.capabilitiesFor(authUser(['ledger0.view']));
    expect(narrow.narrowing).toEqual({ active: false, permitted: 1, perRun: 1 });
  });

  it('carries a plain description, tier and route for each capability', () => {
    const service = makeService(new ScriptedModel([]), new RecordingInvoker(), configFor('red'));

    const report = service.capabilitiesFor(authUser(['invoices.delete']));

    expect(report.capabilities).toHaveLength(1);
    expect(report.capabilities[0]).toEqual({
      name: RED_TOOL,
      description: 'remove (DELETE /invoices/:id)',
      tier: 'red',
      path: 'DELETE /invoices/:id',
      capabilityId: 'InvoicesController.remove',
    });
  });

  it('answers while the module is disabled instead of pretending it is absent', () => {
    const service = makeService(
      new ScriptedModel([]),
      new RecordingInvoker(),
      configFor('read-only', { enabled: false }),
    );

    const report = service.capabilitiesFor(authUser(ALL_PERMISSIONS));

    expect(report.enabled).toBe(false);
    expect(report.budgets).toEqual({ maxToolCalls: 40, maxWrites: 10, toolBudget: 60 });
  });
});
