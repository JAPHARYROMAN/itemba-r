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
import { confirmationIdFor, MsaidiziEvent, MsaidiziService, RunResult } from './msaidizi.service';

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
    maxWritesPerRun: 10,
    maxToolCallsPerRun: 40,
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

function makeService(
  model: ModelClient,
  invoker: CapabilityInvoker,
  config: MsaidiziConfig,
  manifestCaps: Capability[] = MANIFEST,
) {
  const manifest = new ManifestProvider();
  manifest.setForTesting(manifestCaps);
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

// ─── The argument binding ─────────────────────────────────────────────────────

/**
 * A red-tier capability that carries a request BODY — the shape the money tier
 * actually has.
 *
 * Every confirmation test above this line uses `{ id: '41' }`: one key, one
 * scalar, no nesting. That is the exception in the red tier, not the rule.
 * `buildToolDefinition` puts every request body under a single `body` property
 * whenever `capability.params.hasBody`, and `reversibility.ts` makes every write
 * to journal entries, payments, customer payments, bank accounts, credit notes,
 * period close, roles and permissions red. So the arguments an approval is bound
 * to are, for the whole money-movement and accounting-close tier, NESTED — and a
 * suite made entirely of flat scalars cannot see anything that goes wrong one
 * level down.
 *
 * Something did go wrong one level down, and it survived three review passes for
 * exactly that reason. `confirmationIdFor` canonicalised with
 * `JSON.stringify(args, Object.keys(args).sort())`, whose second argument is a
 * replacer ARRAY rather than an ordering hint — and a replacer array filters
 * property names RECURSIVELY, emptying every nested object. A TZS 50,000 rent
 * journal and a TZS 9,000,000 payroll journal both canonicalised to
 * `{"body":{}}` and shared one confirmation id.
 *
 * These tests use the shapes the real tool schema produces: a body, nested
 * objects, arrays of line items, and keys in the order the model happened to
 * emit them.
 */
const JOURNAL_CAP = capability({
  id: 'JournalEntriesController.post',
  controller: 'JournalEntriesController',
  handler: 'post',
  verb: 'POST',
  path: 'journal-entries',
  permissions: ['journal.create'],
  tier: 'red',
  tierReason: 'money-movement',
  params: { path: [], query: [], freeFormQuery: false, hasBody: true },
});

const JOURNAL_TOOL = 'JournalEntries_post';

type ConfirmationEvent = Extract<MsaidiziEvent, { type: 'confirmation_required' }>;

function gatesIn(events: readonly MsaidiziEvent[]): ConfirmationEvent[] {
  return events.filter((e): e is ConfirmationEvent => e.type === 'confirmation_required');
}

/** Still above TOOL_BUDGET, so narrowing runs here as it does everywhere else. */
const JOURNAL_MANIFEST = [JOURNAL_CAP, ...PADDING];
const JOURNAL_PERMISSIONS = ['journal.create', ...PADDING.map((c) => c.permissions[0])];

/** What the user approved. */
const RENT = {
  body: { memo: 'Rent Aug', lines: [{ account: '6000', debit: 50000 }] },
};

/** What the model proposed on the resumed turn instead. */
const PAYROLL = {
  body: { memo: 'Payroll', lines: [{ account: '7000', debit: 9000000 }] },
};

describe('a confirmation id is bound to the arguments at every level of nesting', () => {
  const SESSION = 'ms_fixed_session_id';
  const idFor = (args: Record<string, unknown>) => confirmationIdFor(SESSION, JOURNAL_TOOL, args);

  it('distinguishes two bodies that differ only below the top level', () => {
    // The blocker, at unit scale. Both of these have the identical top-level key
    // set — `{ body }` — and differ only inside it, which is where every real
    // red-tier argument lives.
    expect(idFor(RENT)).not.toBe(idFor(PAYROLL));
  });

  it('distinguishes a single changed figure inside a line item', () => {
    const fifty = { body: { memo: 'Rent Aug', lines: [{ account: '6000', debit: 50000 }] } };
    const millions = { body: { memo: 'Rent Aug', lines: [{ account: '6000', debit: 5000000 }] } };

    expect(idFor(fifty)).not.toBe(idFor(millions));
  });

  it('treats array order as significant: two journal lines swapped are a different entry', () => {
    const debitFirst = {
      body: {
        lines: [
          { account: '6000', debit: 50000 },
          { account: '1000', credit: 50000 },
        ],
      },
    };
    const creditFirst = {
      body: {
        lines: [
          { account: '1000', credit: 50000 },
          { account: '6000', debit: 50000 },
        ],
      },
    };

    // Sorting arrays would make these one action. They are two: which account is
    // debited and which is credited is the entry.
    expect(idFor(debitFirst)).not.toBe(idFor(creditFirst));
  });

  it('does not collide a key that is explicitly undefined with a key that is absent', () => {
    // `JSON.stringify` drops an undefined-valued key, so these two used to be
    // one id. A body is `additionalProperties: true`, so a model emitting an
    // optional field as `undefined` is a shape that reaches here.
    expect(idFor({ id: '9', memo: undefined })).not.toBe(idFor({ id: '9' }));
  });

  it('keeps every scalar type, null, empty container and nested value apart', () => {
    const distinct = [
      { v: '41' },
      { v: 41 },
      { v: true },
      { v: false },
      { v: null },
      { v: 'null' },
      { v: undefined },
      { v: [] },
      { v: {} },
      { v: { a: 1 } },
      { v: { a: 2 } },
      { v: [1] },
      { v: ['1'] },
      {},
    ].map(idFor);

    expect(new Set(distinct).size).toBe(distinct.length);
  });

  it('is stable across the key order the model happened to emit, at every level', () => {
    // The other half of the requirement, and the reason the ids cannot simply be
    // made unguessable by being unstable: the same logical action asked for
    // twice must match the approval the user gave, whatever order the provider
    // serialised the object in.
    const oneWay = {
      id: '9',
      body: {
        memo: 'Rent Aug',
        reference: 'JV-1',
        lines: [{ account: '6000', debit: 50000, memo: 'Aug' }],
      },
    };
    const another = {
      body: {
        lines: [{ memo: 'Aug', debit: 50000, account: '6000' }],
        reference: 'JV-1',
        memo: 'Rent Aug',
      },
      id: '9',
    };

    expect(idFor(oneWay)).toBe(idFor(another));
  });

  it('cannot be impersonated by a string that spells out the encoding', () => {
    // A guard on the canonical form itself rather than on the old defect: the
    // length prefixes are what stop a value containing the encoding's own
    // punctuation from passing itself off as a different structure.
    expect(idFor({ a: '1,1:b=n:2' })).not.toBe(idFor({ a: 1, b: 2 }));
    expect(idFor({ a: 'x', b: 'y' })).not.toBe(idFor({ 'a=s:1:x,1:b': 'y' }));
    expect(idFor({ a: ['x'] })).not.toBe(idFor({ a: 'a[s:1:x]' }));
  });

  it('does not fold an unpaired surrogate into the replacement character', () => {
    // The canonical TEXT was already injective; the digest was not. Hashing the
    // material as UTF-8 replaces every unpaired surrogate with U+FFFD, so these
    // three distinct memos shared one id — an approval for one authorising the
    // others. `JSON.parse('"\\ud800"')` yields a lone surrogate, so a tool
    // result flowing back into a proposed argument can carry one.
    const lone = { body: { memo: 'Rent \uD800' } };
    const otherLone = { body: { memo: 'Rent \uDC00' } };
    const replacement = { body: { memo: 'Rent \uFFFD' } };

    expect(new Set([idFor(lone), idFor(otherLone), idFor(replacement)]).size).toBe(3);
  });

  it('is still bound to the session and the tool as well as the arguments', () => {
    expect(confirmationIdFor('ms_A', JOURNAL_TOOL, RENT)).not.toBe(
      confirmationIdFor('ms_B', JOURNAL_TOOL, RENT),
    );
    expect(confirmationIdFor(SESSION, JOURNAL_TOOL, RENT)).not.toBe(
      confirmationIdFor(SESSION, RED_TOOL, RENT),
    );
  });
});

/**
 * The same defect through the real `service.run()`, in the shape it was measured
 * in: a body-carrying red capability, a manifest above TOOL_BUDGET, an approval
 * given on one turn and a different action of the same tool proposed on the next.
 *
 * The unit tests above pin the id function. These pin the gate, which is the
 * thing that actually protects the user — the id only matters because `run()`
 * consults it before dispatching.
 */
describe('an approval for one journal entry does not authorise another', () => {
  const sessionId = 'ms_fixed_session_id';

  /** Turn 1: the model proposes `args`, the run suspends, nothing has changed. */
  async function propose(args: Record<string, unknown>) {
    const model = new ScriptedModel([toolUse(JOURNAL_TOOL, args)]);
    const invoker = new RecordingInvoker();
    const service = makeService(model, invoker, configFor('red'), JOURNAL_MANIFEST);

    const result = await service.run({
      user: authUser(JOURNAL_PERMISSIONS),
      authorization: 'Bearer caller-token',
      sessionId,
      messages: [{ role: 'user', content: 'post the August rent journal entry, TZS 50,000' }],
    });

    expect(result.reason).toBe('awaiting_confirmation');
    expect(invoker.calls).toEqual([]);

    const gates = gatesIn(result.events);
    expect(gates).toHaveLength(1);
    return { proposed: result, gate: gates[0] };
  }

  it('suspends for its own confirmation when the resumed turn proposes a different entry', async () => {
    const { proposed, gate } = await propose(RENT);
    expect(gate.args).toEqual(RENT);

    // ── Turn 2: the user approved the rent entry; the model asks for payroll. ──
    const model = new ScriptedModel([toolUse(JOURNAL_TOOL, PAYROLL)]);
    const invoker = new RecordingInvoker();
    const service = makeService(model, invoker, configFor('red'), JOURNAL_MANIFEST);

    const resumed = await service.run({
      user: authUser(JOURNAL_PERMISSIONS),
      authorization: 'Bearer caller-token',
      sessionId,
      confirmed: [gate.confirmationId],
      messages: [...(proposed.messages as ModelMessage[]), { role: 'user', content: 'yes' }],
    });

    // Nothing was posted. TZS 9,000,000 did not move on an approval for 50,000.
    expect(invoker.calls).toEqual([]);
    expect(resumed.reason).toBe('awaiting_confirmation');

    // And it did not merely fall over: the payroll entry is proposed in its own
    // right, under its own id, so the user can approve or decline it knowingly.
    const second = gatesIn(resumed.events);
    expect(second).toHaveLength(1);
    expect(second[0].args).toEqual(PAYROLL);
    expect(second[0].confirmationId).not.toBe(gate.confirmationId);

    // The tool was genuinely on offer on this turn, so the suspension is the
    // gate refusing the action, not narrowing having dropped it.
    expect(toolsOn(model, 0)).toContain(JOURNAL_TOOL);
  });

  it('executes the entry that actually was approved, keys in any order', async () => {
    // The positive control. Without it, "every id is different" would pass by
    // making ids unstable, which would break approval altogether.
    const { proposed, gate } = await propose(RENT);

    const reordered = {
      body: { lines: [{ debit: 50000, account: '6000' }], memo: 'Rent Aug' },
    };
    const model = new ScriptedModel([toolUse(JOURNAL_TOOL, reordered)]);
    const invoker = new RecordingInvoker();
    const service = makeService(model, invoker, configFor('red'), JOURNAL_MANIFEST);

    const resumed = await service.run({
      user: authUser(JOURNAL_PERMISSIONS),
      authorization: 'Bearer caller-token',
      sessionId,
      confirmed: [gate.confirmationId],
      messages: [...(proposed.messages as ModelMessage[]), { role: 'user', content: 'yes' }],
    });

    expect(invoker.calls).toHaveLength(1);
    expect(invoker.calls[0].args).toEqual(reordered);
    expect(invoker.calls[0].capability.id).toBe('JournalEntriesController.post');
    expect(resumed.events.some((e) => e.type === 'confirmation_required')).toBe(false);
    expect(resumed.reason).toBe('end_turn');
  });

  it('does not let one approval carry a second, different entry later in the same run', async () => {
    // A collapsed id would re-authorise every later proposal of that tool, not
    // only the next one, so the reach of the argument binding is tested across
    // model turns and not merely across requests. Two model turns inside ONE
    // run: the approved rent entry, then payroll. (What stops the SAME entry
    // running twice here is a different mechanism — the approval being spent —
    // and it has its own section at the foot of this file.)
    const { proposed, gate } = await propose(RENT);

    const model = new ScriptedModel([
      toolUse(JOURNAL_TOOL, RENT, 'tu_rent'),
      toolUse(JOURNAL_TOOL, PAYROLL, 'tu_payroll'),
    ]);
    const invoker = new RecordingInvoker();
    const service = makeService(model, invoker, configFor('red'), JOURNAL_MANIFEST);

    const resumed = await service.run({
      user: authUser(JOURNAL_PERMISSIONS),
      authorization: 'Bearer caller-token',
      sessionId,
      confirmed: [gate.confirmationId],
      messages: [...(proposed.messages as ModelMessage[]), { role: 'user', content: 'yes' }],
    });

    // Exactly one posting, and it is the one that was approved.
    expect(invoker.calls).toHaveLength(1);
    expect(invoker.calls[0].args).toEqual(RENT);
    expect(resumed.reason).toBe('awaiting_confirmation');
  });
});

// ─── The approval is spent, not merely held ───────────────────────────────────

/**
 * One assistant turn proposing SEVERAL tool calls at once.
 *
 * `toolUse` above builds a turn with a single block, which is why every replay
 * test in this file until now was a test about two consecutive turns. The
 * identical-repeat case lives inside one turn as well, and it needed a fixture
 * that can express it.
 */
function toolUseTurn(
  calls: Array<{ name: string; input: Record<string, unknown>; id: string }>,
): ModelResponse {
  return {
    content: calls.map((call) => ({
      type: 'tool_use' as const,
      id: call.id,
      name: call.name,
      input: call.input,
    })),
    stopReason: 'tool_use',
    usage: {
      inputTokens: 2000,
      outputTokens: 120,
      cacheReadInputTokens: 1024,
      cacheCreationInputTokens: 256,
    },
  };
}

/** What the loopback call returns when it could not be reached at all. */
const UNREACHABLE: InvocationResult = {
  ok: false,
  status: 0,
  body: undefined,
  error: 'The action could not be reached.',
};

/**
 * Turn one: the model proposes `args`, the run suspends, nothing has run.
 *
 * Separate from the `propose` helper in the describe above because these tests
 * assert different things about that first turn, and because they need the real
 * suspended `messages` — the union in `registryFor` only re-admits a tool named
 * in the prior assistant turn, so a hand-written history would let a suspension
 * pass for the gate refusing when it was really narrowing dropping the tool.
 */
async function proposeJournalEntry(args: Record<string, unknown>, sessionId: string) {
  const model = new ScriptedModel([toolUse(JOURNAL_TOOL, args)]);
  const invoker = new RecordingInvoker();
  const service = makeService(model, invoker, configFor('red'), JOURNAL_MANIFEST);

  const result = await service.run({
    user: authUser(JOURNAL_PERMISSIONS),
    authorization: 'Bearer caller-token',
    sessionId,
    messages: [{ role: 'user', content: 'post the August rent journal entry, TZS 50,000' }],
  });

  expect(result.reason).toBe('awaiting_confirmation');
  expect(invoker.calls).toEqual([]);
  return { proposed: result, gate: gatesIn(result.events)[0] };
}

/**
 * Turn one, proposing SEVERAL entries in a single assistant turn.
 *
 * The batch case cannot be built from `proposeJournalEntry` twice: two calls are
 * two separate runs, and an approval only binds to a proposal the conversation
 * it is sent with actually contains. A user who ticks two boxes ticked them on
 * one gate screen, which is one assistant turn carrying two `tool_use` blocks —
 * so that is what this builds.
 */
async function proposeJournalEntries(argsList: Array<Record<string, unknown>>, sessionId: string) {
  const model = new ScriptedModel([
    toolUseTurn(argsList.map((args, i) => ({ name: JOURNAL_TOOL, input: args, id: `tu_p${i}` }))),
  ]);
  const invoker = new RecordingInvoker();
  const service = makeService(model, invoker, configFor('red'), JOURNAL_MANIFEST);

  const result = await service.run({
    user: authUser(JOURNAL_PERMISSIONS),
    authorization: 'Bearer caller-token',
    sessionId,
    messages: [{ role: 'user', content: 'post the August rent and payroll journal entries' }],
  });

  expect(result.reason).toBe('awaiting_confirmation');
  expect(invoker.calls).toEqual([]);
  expect(gatesIn(result.events)).toHaveLength(argsList.length);
  return { proposed: result, gates: gatesIn(result.events) };
}

/**
 * The other half of "this exact action was approved": ONCE.
 *
 * Every replay test above this line has the word "different" in its title, and
 * that is exactly why this survived three waves — those fixtures can only
 * express "approval for A, model proposes B", so the case where the model
 * proposes A again was structurally outside what the suite could see. Measured
 * before the fix, through this same `service.run()`: one approved TZS 9,000,000
 * payroll journal, ten identical tool_use blocks, ten invocations, TZS
 * 90,000,000 posted, not one further gate.
 *
 * The shapes covered here, deliberately: a repeat inside ONE assistant turn; a
 * repeat on a LATER model turn of the same run; the same id listed twice in one
 * request; a retry after a write that could not be reached (the ordinary case,
 * with no attacker in it); and, on the other side, the two things that must keep
 * working — one approval still executes once, and two DIFFERENT approvals sent
 * together both execute. Arguments are the nested body shape the money tier
 * actually has, not `{ id: '41' }`; `msaidizi.isolation.spec.ts` carries the
 * flat-argument repeat.
 */
describe('one approval authorises exactly one execution', () => {
  const sessionId = 'ms_fixed_session_id';

  /** Resume a suspended run with `confirmed`, and report what actually ran. */
  async function resume(
    proposed: RunResult,
    confirmed: string[],
    script: ModelResponse[],
    invoker: RecordingInvoker = new RecordingInvoker(),
  ) {
    const model = new ScriptedModel(script);
    const service = makeService(model, invoker, configFor('red'), JOURNAL_MANIFEST);

    const result = await service.run({
      user: authUser(JOURNAL_PERMISSIONS),
      authorization: 'Bearer caller-token',
      sessionId,
      confirmed,
      messages: [...(proposed.messages as ModelMessage[]), { role: 'user', content: 'yes' }],
    });

    return { result, invoker, model };
  }

  it('posts the entry once when the same entry is proposed twice in one turn', async () => {
    const { proposed, gate } = await proposeJournalEntry(RENT, sessionId);

    // One assistant turn, two identical tool_use blocks. The user saw one row
    // and ticked one box.
    const { result, invoker, model } = await resume(
      proposed,
      [gate.confirmationId],
      [
        toolUseTurn([
          { name: JOURNAL_TOOL, input: RENT, id: 'tu_a' },
          { name: JOURNAL_TOOL, input: RENT, id: 'tu_b' },
        ]),
      ],
    );

    expect(invoker.calls).toHaveLength(1);
    expect(invoker.calls[0].args).toEqual(RENT);

    // The second one is not silently dropped either — it comes back as a
    // proposal the user can approve or decline knowingly, under the same id,
    // because the same action always has the same name.
    const second = gatesIn(result.events);
    expect(second).toHaveLength(1);
    expect(second[0].args).toEqual(RENT);
    expect(second[0].confirmationId).toBe(gate.confirmationId);
    expect(result.reason).toBe('awaiting_confirmation');

    // The suspension is the gate refusing, not narrowing having removed the tool.
    expect(toolsOn(model, 0)).toContain(JOURNAL_TOOL);
  });

  it('posts the entry once when the same entry comes back on a later turn of the run', async () => {
    const { proposed, gate } = await proposeJournalEntry(RENT, sessionId);

    // Two model turns inside ONE run: the approved entry executes, its result
    // goes back to the model, and the model asks for it again.
    const { result, invoker } = await resume(
      proposed,
      [gate.confirmationId],
      [toolUse(JOURNAL_TOOL, RENT, 'tu_first'), toolUse(JOURNAL_TOOL, RENT, 'tu_again')],
    );

    expect(invoker.calls).toHaveLength(1);
    expect(gatesIn(result.events)).toHaveLength(1);
    expect(result.reason).toBe('awaiting_confirmation');
  });

  it('does not let a write that could not be reached be retried on the same approval', async () => {
    // The ordinary case, with no attacker anywhere in it. `{ok:false, status:0}`
    // means the call never got an answer — precisely the state in which the
    // write MAY ALREADY HAVE COMMITTED. The model retries, as any model would; a
    // duplicate payment is the exact harm the red tier exists to prevent, and
    // only a human can know whether the first one landed.
    const { proposed, gate } = await proposeJournalEntry(RENT, sessionId);

    const { result, invoker } = await resume(
      proposed,
      [gate.confirmationId],
      [toolUse(JOURNAL_TOOL, RENT, 'tu_first'), toolUse(JOURNAL_TOOL, RENT, 'tu_retry')],
      new RecordingInvoker(UNREACHABLE),
    );

    expect(invoker.calls).toHaveLength(1);
    // The failure genuinely reached the model, so the retry is a response to it
    // rather than to nothing.
    expect(result.events).toContainEqual({
      type: 'tool_result',
      tool: JOURNAL_TOOL,
      ok: false,
      status: 0,
      error: 'The action could not be reached.',
    });
    expect(gatesIn(result.events)).toHaveLength(1);
    expect(result.reason).toBe('awaiting_confirmation');
  });

  it('treats the same id listed twice in one request as one approval', async () => {
    // A client that sends `[id, id]` has still shown the user one row and taken
    // one click. Duplicates collapse rather than accumulating grants.
    const { proposed, gate } = await proposeJournalEntry(RENT, sessionId);

    const { result, invoker } = await resume(
      proposed,
      [gate.confirmationId, gate.confirmationId],
      [
        toolUseTurn([
          { name: JOURNAL_TOOL, input: RENT, id: 'tu_a' },
          { name: JOURNAL_TOOL, input: RENT, id: 'tu_b' },
        ]),
      ],
    );

    expect(invoker.calls).toHaveLength(1);
    expect(result.reason).toBe('awaiting_confirmation');
  });

  it('still executes an approved entry once, with no spurious second prompt', async () => {
    // The positive control this whole section could otherwise pass by breaking:
    // spending the id must not cost the legitimate path its one execution.
    const { proposed, gate } = await proposeJournalEntry(RENT, sessionId);

    const { result, invoker } = await resume(
      proposed,
      [gate.confirmationId],
      [toolUse(JOURNAL_TOOL, RENT, 'tu_only')],
    );

    expect(invoker.calls).toHaveLength(1);
    expect(invoker.calls[0].args).toEqual(RENT);
    expect(gatesIn(result.events)).toEqual([]);
    expect(result.reason).toBe('end_turn');
  });

  it('executes both of two different entries approved together in one batch', async () => {
    // A batch of two ticked boxes is two approvals, and spending one must not
    // touch the other. Both run, in one turn, with no further gate.
    //
    // Both entries are PROPOSED on the suspended turn, because that is the only
    // conversation in which a user could have ticked two boxes. Approving a
    // second entry the model never proposed is a different case entirely, and it
    // is refused — see 'an approval must name an action this conversation
    // proposed' below.
    const { proposed, gates } = await proposeJournalEntries([RENT, PAYROLL], sessionId);
    expect(gates.map((gate) => gate.args)).toEqual([RENT, PAYROLL]);

    const { result, invoker } = await resume(
      proposed,
      [
        confirmationIdFor(sessionId, JOURNAL_TOOL, RENT),
        confirmationIdFor(sessionId, JOURNAL_TOOL, PAYROLL),
      ],
      [
        toolUseTurn([
          { name: JOURNAL_TOOL, input: RENT, id: 'tu_rent' },
          { name: JOURNAL_TOOL, input: PAYROLL, id: 'tu_payroll' },
        ]),
      ],
    );

    expect(invoker.calls.map((call) => call.args)).toEqual([RENT, PAYROLL]);
    expect(gatesIn(result.events)).toEqual([]);
    expect(result.reason).toBe('end_turn');
  });

  it('documents the boundary: a fresh request re-sending the same id is a fresh grant', async () => {
    // Not an endorsement — a marker on where the enforcement stops. The spent
    // set lives inside one `run()`. `confirmed` arrives from the client on every
    // request and `confirmationIdFor` is deterministic, so a client that keeps
    // an id and sends it again buys one more execution per request it sends.
    // Across runs the one-shot is still only the client's discipline, and the
    // fix is a durable grant ledger this service is not wired for — see the
    // comment at the red gate for why it cannot simply remember spent ids.
    const { proposed, gate } = await proposeJournalEntry(RENT, sessionId);

    const first = await resume(proposed, [gate.confirmationId], [toolUse(JOURNAL_TOOL, RENT)]);
    expect(first.invoker.calls).toHaveLength(1);

    const second = await resume(proposed, [gate.confirmationId], [toolUse(JOURNAL_TOOL, RENT)]);
    expect(second.invoker.calls).toHaveLength(1);
  });
});

// ─── The approval has to answer a proposal ────────────────────────────────────

/**
 * `confirmed` is not a pre-authorisation channel.
 *
 * `confirmationIdFor(sessionId, toolName, args)` takes three arguments, and on a
 * resumed turn the CALLER supplies all three on the same request that carries
 * `confirmed` — so the id is a name anyone can compute, never a token this
 * server issued and can recognise. Until `approvalsForProposals` existed that
 * was the whole of the gate: measured through this same `service.run()`, a
 * brand-new conversation whose first user turn was "post the payroll journal
 * entry", carrying one client-computed id and no proposal of any kind, posted a
 * TZS 9,000,000 journal entry with ZERO `confirmation_required` events anywhere
 * in the run. A reader of that transcript sees an irreversible action with no
 * gate above it, and nothing in the run, the store or the audit trail could tell
 * it apart from an approval a person gave.
 *
 * Every other confirmation test in this file resumes a run that really did
 * suspend, so a matching proposal is always sitting in the fixture and not one
 * of them could see this. The shape here is the one those cannot express: an
 * approval with no gate behind it.
 *
 * What these pin is exactly what the check buys — the id must NAME a proposal
 * the conversation contains — and no more than that. It is not a receipt:
 * nothing here proves a human answered, and `RunRequest.confirmed` says so at
 * length.
 */
describe('an approval must name an action this conversation proposed', () => {
  const sessionId = 'ms_fixed_session_id';

  it('refuses an id computed for an action no turn of this conversation proposed', async () => {
    // The measured failure, verbatim: first turn, no history, one id computed
    // client-side from three public inputs.
    const model = new ScriptedModel([toolUse(JOURNAL_TOOL, PAYROLL)]);
    const invoker = new RecordingInvoker();
    const service = makeService(model, invoker, configFor('red'), JOURNAL_MANIFEST);

    const result = await service.run({
      user: authUser(JOURNAL_PERMISSIONS),
      authorization: 'Bearer caller-token',
      sessionId,
      confirmed: [confirmationIdFor(sessionId, JOURNAL_TOOL, PAYROLL)],
      messages: [{ role: 'user', content: 'post the payroll journal entry' }],
    });

    // TZS 9,000,000 did not move.
    expect(invoker.calls).toEqual([]);

    // Note WHICH proposal cannot rescue this id: the model proposes exactly this
    // action inside this very run, and that does not bind it. The approvals are
    // reduced against `request.messages` once, before the loop, so a proposal the
    // model makes after the request arrived can never authorise the request that
    // arrived with it. An implementation that recomputed the proposal set from
    // the live message array as it grew would be self-approval with extra steps,
    // and it would pass every other test in this file.
    const gates = gatesIn(result.events);
    expect(gates).toHaveLength(1);
    expect(gates[0].args).toEqual(PAYROLL);
    expect(result.reason).toBe('awaiting_confirmation');

    // And the suspension is the gate refusing, not narrowing having dropped the
    // tool: it was on offer, the model asked for it, and the gate said no.
    expect(toolsOn(model, 0)).toContain(JOURNAL_TOOL);
  });

  it('is not satisfied by the conversation merely containing some other proposal', async () => {
    // A conversation with real proposals in it, none of them this action. The
    // check is per-action, not "this conversation has been through a gate once".
    const model = new ScriptedModel([toolUse(JOURNAL_TOOL, PAYROLL)]);
    const invoker = new RecordingInvoker();
    const service = makeService(model, invoker, configFor('red'), JOURNAL_MANIFEST);

    const result = await service.run({
      user: authUser(JOURNAL_PERMISSIONS),
      authorization: 'Bearer caller-token',
      sessionId,
      confirmed: [confirmationIdFor(sessionId, JOURNAL_TOOL, PAYROLL)],
      messages: [
        { role: 'user', content: 'post the August rent journal entry' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_rent', name: JOURNAL_TOOL, input: RENT }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_rent', is_error: true, content: 'confirm' },
          ],
        },
        { role: 'user', content: 'yes' },
      ],
    });

    expect(invoker.calls).toEqual([]);
    expect(gatesIn(result.events)).toHaveLength(1);
    expect(result.reason).toBe('awaiting_confirmation');
    expect(toolsOn(model, 0)).toContain(JOURNAL_TOOL);
  });

  it('still honours an approval whose proposal is several turns back', async () => {
    // The positive control, and the one that pins the deliberately WIDE search.
    // `approvalsForProposals` scans the whole history rather than the newest
    // tool-calling turn, because a user who asks a question before answering the
    // gate has not withdrawn their approval — and a tightening that reads only
    // the last turn would silently re-ask them forever.
    const { proposed, gate } = await proposeJournalEntry(RENT, sessionId);

    const model = new ScriptedModel([toolUse(JOURNAL_TOOL, RENT)]);
    const invoker = new RecordingInvoker();
    const service = makeService(model, invoker, configFor('red'), JOURNAL_MANIFEST);

    const result = await service.run({
      user: authUser(JOURNAL_PERMISSIONS),
      authorization: 'Bearer caller-token',
      sessionId,
      confirmed: [gate.confirmationId],
      messages: [
        ...(proposed.messages as ModelMessage[]),
        { role: 'user', content: 'wait — what date will that land on?' },
        { role: 'assistant', content: [{ type: 'text', text: 'The 31st of August.' }] },
        { role: 'user', content: 'ok, post it' },
      ],
    });

    expect(invoker.calls).toHaveLength(1);
    expect(invoker.calls[0].args).toEqual(RENT);
    expect(gatesIn(result.events)).toEqual([]);
    expect(result.reason).toBe('end_turn');
  });
});

// ─── What the write ceiling actually bounds ───────────────────────────────────

/**
 * `maxWritesPerRun` bounds ONE REQUEST, and its name used to say session.
 *
 * The counter is a local declared inside `run()`, so it is reinitialised on
 * every HTTP request. Nothing in this system holds a session-level count of
 * irreversible actions. That was already true when the knob was called
 * `maxWritesPerSession` and its doc promised "a permission that allows an action
 * does not allow it fifty times" — and wave 3's blocker report then reasoned
 * from the figure as a per-conversation cap, which is how a wrong name becomes a
 * wrong safety argument.
 *
 * Both halves are pinned here because a doc that says "per run" is worth no more
 * than the doc that said "per session" unless something checks it: the ceiling
 * genuinely stops a runaway loop inside one request, and it genuinely does not
 * carry across requests.
 */
describe('the write ceiling bounds one run and nothing wider', () => {
  const sessionId = 'ms_fixed_session_id';

  /** One whole request under a ceiling of a single write: propose, approve, post. */
  async function postOneEntry(entry: Record<string, unknown>) {
    const { proposed, gate } = await proposeJournalEntry(entry, sessionId);

    const model = new ScriptedModel([toolUse(JOURNAL_TOOL, entry)]);
    const invoker = new RecordingInvoker();
    const service = makeService(
      model,
      invoker,
      configFor('red', { maxWritesPerRun: 1 }),
      JOURNAL_MANIFEST,
    );

    const result = await service.run({
      user: authUser(JOURNAL_PERMISSIONS),
      authorization: 'Bearer caller-token',
      sessionId,
      confirmed: [gate.confirmationId],
      messages: [...(proposed.messages as ModelMessage[]), { role: 'user', content: 'yes' }],
    });

    return { result, invoker };
  }

  it('stops the second write inside one request, however it was approved', async () => {
    // The control: the ceiling is real. Two entries proposed on one gate screen,
    // both approved, both emitted in one assistant turn, ceiling of one.
    const { proposed, gates } = await proposeJournalEntries([RENT, PAYROLL], sessionId);

    const model = new ScriptedModel([
      toolUseTurn([
        { name: JOURNAL_TOOL, input: RENT, id: 'tu_rent' },
        { name: JOURNAL_TOOL, input: PAYROLL, id: 'tu_payroll' },
      ]),
    ]);
    const invoker = new RecordingInvoker();
    const service = makeService(
      model,
      invoker,
      configFor('red', { maxWritesPerRun: 1 }),
      JOURNAL_MANIFEST,
    );

    const result = await service.run({
      user: authUser(JOURNAL_PERMISSIONS),
      authorization: 'Bearer caller-token',
      sessionId,
      confirmed: gates.map((gate) => gate.confirmationId),
      messages: [...(proposed.messages as ModelMessage[]), { role: 'user', content: 'yes' }],
    });

    expect(invoker.calls).toHaveLength(1);
    expect(invoker.calls[0].args).toEqual(RENT);
    expect(result.reason).toBe('write_budget_exhausted');
  });

  it('documents the boundary: a second request on the same session id starts again at zero', async () => {
    // Not an endorsement — a marker on where the enforcement stops, and the
    // reason `msaidizi.config.ts` no longer claims a per-session guarantee. Two
    // requests, one session id, a configured ceiling of ONE write: two red-tier
    // postings happen. A deployment that needs to cap what one conversation can
    // post has to bound requests, upstream of this service.
    const first = await postOneEntry(RENT);
    expect(first.invoker.calls).toHaveLength(1);
    expect(first.result.reason).toBe('end_turn');

    const second = await postOneEntry(PAYROLL);
    expect(second.invoker.calls).toHaveLength(1);
    expect(second.result.reason).toBe('end_turn');
  });
});
