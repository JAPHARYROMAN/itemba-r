/**
 * The output ceiling.
 *
 * `MSAIDIZI_MAX_TOKENS` is 32,000 in production, and a model turn that reaches
 * it comes back with `stopReason: 'max_tokens'` and content that stops wherever
 * the counter ran out. Before the `truncated` reason existed the loop read that
 * turn exactly as it reads a finished one — no tool_use blocks, therefore
 * `end_turn` — and the client had no way to tell the difference, because the
 * distinction lives only in `stopReason` and `DoneReason` had no member for it.
 * A supplier-balance answer cut at "totalling TZS 4,18" was delivered as a
 * complete answer, with no notice of any kind.
 *
 * Three of the four tests below are negative controls on that. Measured with
 * the `stopReason === 'max_tokens'` branch deleted from `msaidizi.service.ts`:
 * the reason test fails (`end_turn`), the conversation-state test fails (the
 * half-written assistant turn is kept), and the dispatch test fails (a real
 * call goes out built from an unfinished tool_use block). The fragment test
 * passes either way — it is there to pin that the fix labels the text rather
 * than suppressing it, not to discriminate the fix.
 *
 * The manifest is deliberately small (under TOOL_BUDGET), because narrowing is
 * not what is under test here; `msaidizi.write-path.spec.ts` owns that.
 */

import { Capability } from '../../common/capabilities/capability-manifest';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CapabilityInvoker, InvocationRequest, InvocationResult } from './capability-invoker';
import { ManifestProvider } from './manifest.provider';
import { ModelClient, ModelRequest, ModelResponse } from './model-client';
import { MsaidiziConfig } from './msaidizi.config';
import { DoneReason, MsaidiziEvent, MsaidiziService } from './msaidizi.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const READ_CAP: Capability = {
  id: 'SupplierInvoicesController.findAll',
  controller: 'SupplierInvoicesController',
  handler: 'findAll',
  verb: 'GET',
  path: 'supplier-invoices',
  permissions: ['supplier-invoices.view'],
  anyPermissions: [],
  roles: [],
  apiScopes: [],
  guard: 'permission',
  tier: 'green',
  tierReason: 'read-verb',
  params: { path: [], query: [], freeFormQuery: false, hasBody: false },
  agentExcluded: false,
};

const READ_TOOL = 'SupplierInvoices_findAll';

const USER = {
  id: 'user-A',
  email: 'a@itemba.local',
  fullName: 'Asha',
  roles: ['Company Manager'],
  roleScopes: ['COMPANY'],
  permissions: ['supplier-invoices.view'],
  companyId: 'company-A',
  companyAccess: [],
} as unknown as AuthUser;

const CONFIG = {
  enabled: true,
  model: 'claude-opus-5',
  classifierModel: 'claude-haiku-4-5',
  effort: 'medium',
  writeMode: 'read-only',
  allowedTiers: ['green'],
  maxWritesPerRun: 10,
  maxToolCallsPerRun: 40,
  // The ceiling under test. The production default.
  maxTokens: 32000,
  invokeTimeoutMs: 30000,
  loopbackBaseUrl: 'http://127.0.0.1:3001/api/v1',
} as unknown as MsaidiziConfig;

const USAGE = {
  inputTokens: 2000,
  outputTokens: 32000,
  cacheReadInputTokens: 1024,
  cacheCreationInputTokens: 0,
};

class ScriptedModel extends ModelClient {
  readonly seen: ModelRequest[] = [];
  constructor(private readonly script: ModelResponse[]) {
    super();
  }
  async createMessage(request: ModelRequest): Promise<ModelResponse> {
    this.seen.push(request);
    const next = this.script.shift();
    if (!next) throw new Error('ScriptedModel ran past the end of its script.');
    return next;
  }
}

class RecordingInvoker extends CapabilityInvoker {
  readonly calls: InvocationRequest[] = [];
  constructor() {
    super(CONFIG);
  }
  async invoke(request: InvocationRequest): Promise<InvocationResult> {
    this.calls.push(request);
    return { ok: true, status: 200, body: [] };
  }
}

function makeService(model: ModelClient, invoker: CapabilityInvoker): MsaidiziService {
  const manifest = new ManifestProvider();
  manifest.setForTesting([READ_CAP]);
  return new MsaidiziService(CONFIG, manifest, model, invoker);
}

const ASK = [{ role: 'user' as const, content: 'How much do we owe suppliers?' }];

/** The half-sentence the ceiling left behind. */
const CUT_OFF = 'Three suppliers have unpaid invoices totalling TZS 4,18';

function doneReasons(events: MsaidiziEvent[]): DoneReason[] {
  return events
    .filter((e): e is { type: 'done'; reason: DoneReason } => e.type === 'done')
    .map((e) => e.reason);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('a model turn cut off at the token ceiling', () => {
  it('is reported as truncated rather than as a finished answer', async () => {
    // Exactly what the provider returns when `max_tokens` is reached: prose, no
    // tool_use blocks, and the only thing distinguishing it from a completed
    // turn sitting in `stopReason`.
    const model = new ScriptedModel([
      { content: [{ type: 'text', text: CUT_OFF }], stopReason: 'max_tokens', usage: USAGE },
    ]);
    const service = makeService(model, new RecordingInvoker());

    const result = await service.run({
      user: USER,
      authorization: 'Bearer t',
      sessionId: 'ms_fixed',
      messages: ASK,
    });

    // Without the branch this is `end_turn`, and every downstream surface —
    // the `done` frame, the stored turn, the thread — calls a fragment finished.
    expect(result.reason).toBe('truncated');
    expect(doneReasons(result.events)).toEqual(['truncated']);
  });

  it('still delivers the fragment the user already has on screen', async () => {
    // The text was streamed before the ceiling was noticed. Suppressing it would
    // trade a mislabelled answer for a missing one; it is kept, and labelled.
    const model = new ScriptedModel([
      { content: [{ type: 'text', text: CUT_OFF }], stopReason: 'max_tokens', usage: USAGE },
    ]);
    const service = makeService(model, new RecordingInvoker());

    const result = await service.run({
      user: USER,
      authorization: 'Bearer t',
      sessionId: 'ms_fixed',
      messages: ASK,
    });

    expect(result.events).toContainEqual({ type: 'text', text: CUT_OFF });
  });

  it('does not carry the half-written turn into the conversation state', async () => {
    // A truncated assistant turn is not conversation state worth resuming from,
    // and when the cut lands inside a tool_use block it is state the provider
    // rejects outright: a tool_use with no tool_result to pair with is a 400 on
    // the next request. The run returns the messages as they stood.
    const model = new ScriptedModel([
      { content: [{ type: 'text', text: CUT_OFF }], stopReason: 'max_tokens', usage: USAGE },
    ]);
    const service = makeService(model, new RecordingInvoker());

    const result = await service.run({
      user: USER,
      authorization: 'Bearer t',
      sessionId: 'ms_fixed',
      messages: ASK,
    });

    expect(result.messages).toEqual(ASK);
    expect(result.messages.some((m) => m.role === 'assistant')).toBe(false);
  });

  it('does not dispatch a call assembled from arguments the model never finished writing', async () => {
    // The cut can land mid-`tool_use`. The block is still present and still
    // looks well-formed to a filter that only reads `type` — its `input` is
    // whatever had been emitted when the counter ran out. Reading the content
    // before the stop reason is what turns a truncated turn into a real HTTP
    // call against the business.
    const model = new ScriptedModel([
      {
        content: [
          { type: 'text', text: 'Let me check' },
          { type: 'tool_use', id: 'tu_1', name: READ_TOOL, input: {} },
        ],
        stopReason: 'max_tokens',
        usage: USAGE,
      },
    ]);
    const invoker = new RecordingInvoker();
    const service = makeService(model, invoker);

    const result = await service.run({
      user: USER,
      authorization: 'Bearer t',
      sessionId: 'ms_fixed',
      messages: ASK,
    });

    expect(invoker.calls).toEqual([]);
    expect(result.reason).toBe('truncated');
    expect(result.events.some((e) => e.type === 'tool_call')).toBe(false);
  });
});

describe('the control: turns that were not cut off are unaffected', () => {
  it('still reports a turn that finished on its own as end_turn', async () => {
    const model = new ScriptedModel([
      {
        content: [{ type: 'text', text: 'Three suppliers, TZS 4,180,000 in total.' }],
        stopReason: 'end_turn',
        usage: USAGE,
      },
    ]);
    const service = makeService(model, new RecordingInvoker());

    const result = await service.run({
      user: USER,
      authorization: 'Bearer t',
      sessionId: 'ms_fixed',
      messages: ASK,
    });

    expect(result.reason).toBe('end_turn');
  });

  it('still dispatches a complete tool call', async () => {
    // The other half of the pair above: the branch keys on the stop reason, not
    // on the presence of a tool_use block, so a normal turn is untouched.
    const model = new ScriptedModel([
      {
        content: [{ type: 'tool_use', id: 'tu_1', name: READ_TOOL, input: {} }],
        stopReason: 'tool_use',
        usage: USAGE,
      },
      {
        content: [{ type: 'text', text: 'Three suppliers.' }],
        stopReason: 'end_turn',
        usage: USAGE,
      },
    ]);
    const invoker = new RecordingInvoker();
    const service = makeService(model, invoker);

    const result = await service.run({
      user: USER,
      authorization: 'Bearer t',
      sessionId: 'ms_fixed',
      messages: ASK,
    });

    expect(invoker.calls).toHaveLength(1);
    expect(result.reason).toBe('end_turn');
  });
});
