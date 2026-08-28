/**
 * ADVERSARIAL: the real MsaidiziService.run() against the REAL grant store.
 * Temporary verification file. Not part of the branch.
 */
import { Capability } from '../../common/capabilities/capability-manifest';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  EncryptionService,
  EphemeralSecretFingerprintRegistry,
  PersistenceSecretGuard,
} from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { CapabilityInvoker, InvocationRequest, InvocationResult } from './capability-invoker';
import { MsaidiziConversationsService } from './conversations.service';
import { ManifestProvider } from './manifest.provider';
import { ModelClient, ModelRequest, ModelResponse } from './model-client';
import { MsaidiziConfig, WriteMode } from './msaidizi.config';
import {
  ApprovalGrantStore,
  MsaidiziEvent,
  MsaidiziService,
  RunResult,
  argumentDigestFor,
} from './msaidizi.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function capability(o: Partial<Capability> = {}): Capability {
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
    ...o,
  } as Capability;
}

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

const RED_CAP_2 = capability({
  id: 'PaymentsController.remove',
  controller: 'PaymentsController',
  handler: 'remove',
  verb: 'DELETE',
  path: 'payments/:id',
  permissions: ['payments.delete'],
  tier: 'red',
  tierReason: 'delete-verb',
  params: { path: ['id'], query: [], freeFormQuery: false, hasBody: false },
});
const RED_TOOL_2 = 'Payments_remove';

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
const MANIFEST = [RED_CAP, RED_CAP_2, ...PADDING];
const ALL_PERMISSIONS = [
  'invoices.delete',
  'payments.delete',
  ...PADDING.map((c) => c.permissions[0]),
];

function authUser(id = 'user-A'): AuthUser {
  return {
    id,
    email: `${id}@itemba.local`,
    fullName: 'Asha',
    roles: ['Company Manager'],
    roleScopes: ['COMPANY'],
    permissions: ALL_PERMISSIONS,
    companyId: 'company-A',
    companyAccess: [],
  } as unknown as AuthUser;
}

function configFor(writeMode: WriteMode = 'red' as WriteMode) {
  return {
    enabled: true,
    model: 'claude-opus-5',
    classifierModel: 'claude-haiku-4-5',
    effort: 'medium',
    writeMode,
    allowedTiers: ['green', 'amber', 'red'],
    maxWritesPerRun: 10,
    maxToolCallsPerRun: 40,
    maxTokens: 32000,
    invokeTimeoutMs: 30000,
    loopbackBaseUrl: 'http://127.0.0.1:3001/api/v1',
  } as unknown as MsaidiziConfig;
}

class ScriptedModel extends ModelClient {
  readonly seen: ModelRequest[] = [];
  script: ModelResponse[];
  constructor(script: ModelResponse[]) {
    super();
    this.script = script;
  }
  async createMessage(request: ModelRequest): Promise<ModelResponse> {
    this.seen.push(request);
    return (
      this.script.shift() ?? {
        content: [{ type: 'text', text: 'Done.' }],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      }
    );
  }
}

function toolUses(
  blocks: Array<{ name: string; input: Record<string, unknown>; id: string }>,
): ModelResponse {
  return {
    content: blocks.map((b) => ({
      type: 'tool_use' as const,
      id: b.id,
      name: b.name,
      input: b.input,
    })),
    stopReason: 'tool_use',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
  };
}

class RecordingInvoker extends CapabilityInvoker {
  readonly calls: InvocationRequest[] = [];
  constructor(private readonly result: InvocationResult = { ok: true, status: 200, body: [] }) {
    super(configFor());
  }
  async invoke(request: InvocationRequest): Promise<InvocationResult> {
    this.calls.push(request);
    return this.result;
  }
}

const tick = () => new Promise<void>((r) => setImmediate(r));

/**
 * Minimal Prisma double covering ONLY what the ledger touches. Models the FK,
 * the primary key, and an atomic conditional updateMany (filter and apply with
 * no await between them).
 */
class LedgerPrisma {
  conversations: Row[] = [];
  grants: Row[] = [];
  down = false;

  readonly msaidiziConversation = {
    findFirst: async ({ where, select }: { where: Row; select?: Row }) => {
      await tick();
      if (this.down) throw new Error('database is not reachable');
      const row = this.conversations.find(
        (c) =>
          c.id === where.id &&
          c.userId === where.userId &&
          (where.deletedAt === null ? c.deletedAt == null : true),
      );
      if (!row) return null;
      if (!select) return row;
      return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
    },
  };

  readonly msaidiziApprovalGrant = {
    create: async ({ data }: { data: Row }) => {
      await tick();
      if (this.down) throw new Error('database is not reachable');
      if (!this.conversations.some((c) => c.id === data.conversationId)) {
        throw new Error('Foreign key constraint failed on the field: `conversationId`');
      }
      if (this.grants.some((g) => g.id === data.id)) {
        throw new Error('Unique constraint failed on `id`');
      }
      const row: Row = { usedAt: null, ...data };
      this.grants.push(row);
      return row;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      await tick();
      if (this.down) throw new Error('database is not reachable');
      // ── indivisible from here down: no await ──
      const rows = this.grants.filter(
        (g) =>
          g.id === where.id &&
          g.conversationId === where.conversationId &&
          g.userId === where.userId &&
          g.toolName === where.toolName &&
          g.argsDigest === where.argsDigest &&
          (where.usedAt === null ? g.usedAt == null : true) &&
          (where.expiresAt?.gt
            ? (g.expiresAt as Date).getTime() > (where.expiresAt.gt as Date).getTime()
            : true),
      );
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
  };
}

const CONVERSATION = 'conv-A';

function makeWorld(script: ModelResponse[]) {
  const prisma = new LedgerPrisma();
  prisma.conversations.push({ id: CONVERSATION, userId: 'user-A', deletedAt: null, turnCount: 3 });
  prisma.conversations.push({ id: 'conv-B', userId: 'user-A', deletedAt: null, turnCount: 1 });
  prisma.conversations.push({
    id: 'conv-OTHER-USER',
    userId: 'user-Z',
    deletedAt: null,
    turnCount: 1,
  });

  const store = new MsaidiziConversationsService(
    prisma as unknown as PrismaService,
    configFor(),
    {} as EncryptionService,
    new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
  );
  const manifest = new ManifestProvider();
  manifest.setForTesting(MANIFEST);
  const model = new ScriptedModel(script);
  const invoker = new RecordingInvoker();
  const service = new MsaidiziService(
    configFor(),
    manifest,
    model,
    invoker,
    store as ApprovalGrantStore,
  );
  return { prisma, store, model, invoker, service };
}

type World = ReturnType<typeof makeWorld>;

function history(tool: string, input: Record<string, unknown>, tuId = 'tu_prev') {
  return [
    { role: 'user' as const, content: 'delete invoice 41' },
    { role: 'assistant' as const, content: [{ type: 'tool_use', id: tuId, name: tool, input }] },
    {
      role: 'user' as const,
      content: [{ type: 'tool_result', tool_use_id: tuId, is_error: true, content: 'confirm' }],
    },
    { role: 'user' as const, content: 'yes' },
  ];
}

function grantIds(events: MsaidiziEvent[]): string[] {
  return events.filter((e) => e.type === 'confirmation_required').map((e: any) => e.grantId);
}

function dispatched(events: MsaidiziEvent[]): string[] {
  return events.filter((e) => e.type === 'tool_call').map((e: any) => e.tool);
}

const ARGS = { id: '41' };

async function issuedGrant(
  world: World,
  over: Partial<{
    conversationId: string;
    userId: string;
    toolName: string;
    args: Record<string, unknown>;
    grantId: string;
    expiresAt: Date;
  }> = {},
) {
  const id = over.grantId ?? `grt_${String(world.prisma.grants.length).padStart(32, 'a')}`;
  const now = new Date();
  await world.store.issue({
    grantId: id,
    conversationId: over.conversationId ?? CONVERSATION,
    userId: over.userId ?? 'user-A',
    toolName: over.toolName ?? RED_TOOL,
    argumentDigest: argumentDigestFor(over.args ?? ARGS),
    proposedOnTurn: 3,
    createdAt: now,
    expiresAt: over.expiresAt ?? new Date(now.getTime() + 30 * 60 * 1000),
  });
  return id;
}

function confirmRun(world: World, confirmed: string[], tool = RED_TOOL, args = ARGS) {
  return world.service.run({
    user: authUser(),
    authorization: 'Bearer t',
    sessionId: 'ms_1',
    conversationId: CONVERSATION,
    turnSequence: 4,
    confirmed,
    messages: history(tool, args),
  });
}

describe('ADVERSARIAL — grant model, real service + real store', () => {
  it('LEGIT: approve once and it runs', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])]);
    const id = await issuedGrant(world);
    const result = await confirmRun(world, [id]);
    expect(dispatched(result.events)).toEqual([RED_TOOL]);
    expect(world.invoker.calls).toHaveLength(1);
    expect(world.prisma.grants[0].usedAt).toBeInstanceOf(Date);
  });

  it('ATTACK: one grant, two identical tool_use blocks in ONE request', async () => {
    const world = makeWorld([
      toolUses([
        { name: RED_TOOL, input: ARGS, id: 'tu_1' },
        { name: RED_TOOL, input: ARGS, id: 'tu_2' },
      ]),
    ]);
    const id = await issuedGrant(world);
    const result = await confirmRun(world, [id]);
    expect(world.invoker.calls).toHaveLength(1);
    expect(result.reason).toBe('awaiting_confirmation');
    expect(grantIds(result.events)).toHaveLength(1);
  });

  it('ATTACK: the same grant replayed on a LATER request', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])]);
    const id = await issuedGrant(world);
    const first = await confirmRun(world, [id]);
    expect(dispatched(first.events)).toEqual([RED_TOOL]);

    world.model.script = [toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])];
    const second = await confirmRun(world, [id]);
    expect(world.invoker.calls).toHaveLength(1);
    expect(second.reason).toBe('awaiting_confirmation');
  });

  it('ATTACK: a grant for action A dispatched against action B (different args)', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: { id: '42' }, id: 'tu_1' }])]);
    const id = await issuedGrant(world, { args: { id: '41' } });
    const result = await confirmRun(world, [id], RED_TOOL, { id: '42' });
    expect(world.invoker.calls).toHaveLength(0);
    expect(result.reason).toBe('awaiting_confirmation');
  });

  it('ATTACK: a grant for tool A dispatched against tool B (same args)', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL_2, input: ARGS, id: 'tu_1' }])]);
    const id = await issuedGrant(world, { toolName: RED_TOOL, args: ARGS });
    const result = await confirmRun(world, [id], RED_TOOL_2, ARGS);
    expect(world.invoker.calls).toHaveLength(0);
    expect(result.reason).toBe('awaiting_confirmation');
  });

  it('ATTACK: a grant from another conversation', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])]);
    const id = await issuedGrant(world, { conversationId: 'conv-B' });
    const result = await confirmRun(world, [id]);
    expect(world.invoker.calls).toHaveLength(0);
    expect(result.reason).toBe('awaiting_confirmation');
  });

  it('ATTACK: another user names the owner conversation AND the owner grant', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])]);
    const id = await issuedGrant(world, { conversationId: 'conv-OTHER-USER', userId: 'user-Z' });
    const result = await world.service.run({
      user: authUser('user-A'),
      authorization: 'Bearer t',
      sessionId: 'ms_1',
      conversationId: 'conv-OTHER-USER',
      turnSequence: 4,
      confirmed: [id],
      messages: history(RED_TOOL, ARGS),
    });
    expect(world.invoker.calls).toHaveLength(0);
  });

  it('ATTACK: an expired grant', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])]);
    const id = await issuedGrant(world, { expiresAt: new Date(Date.now() - 1000) });
    const result = await confirmRun(world, [id]);
    expect(world.invoker.calls).toHaveLength(0);
    expect(result.reason).toBe('awaiting_confirmation');
    expect(grantIds(result.events)).toHaveLength(1);
  });

  it('ATTACK: a fabricated grant id', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])]);
    const result = await confirmRun(world, [`grt_${'f'.repeat(32)}`]);
    expect(world.invoker.calls).toHaveLength(0);
    expect(result.reason).toBe('awaiting_confirmation');
  });

  it('ATTACK: the same id listed three times in one confirmed', async () => {
    const world = makeWorld([
      toolUses([
        { name: RED_TOOL, input: ARGS, id: 'tu_1' },
        { name: RED_TOOL, input: ARGS, id: 'tu_2' },
      ]),
    ]);
    const id = await issuedGrant(world);
    const result = await confirmRun(world, [id, id, id]);
    expect(world.invoker.calls).toHaveLength(1);
    expect(result.reason).toBe('awaiting_confirmation');
  });

  it('LEGIT: two proposals sharing arguments — two grants, two dispatches, one each', async () => {
    const world = makeWorld([
      toolUses([
        { name: RED_TOOL, input: ARGS, id: 'tu_1' },
        { name: RED_TOOL, input: ARGS, id: 'tu_2' },
      ]),
    ]);
    const a = await issuedGrant(world, { grantId: `grt_${'a'.repeat(32)}` });
    const b = await issuedGrant(world, { grantId: `grt_${'b'.repeat(32)}` });
    const result = await confirmRun(world, [a, b]);
    expect(world.invoker.calls).toHaveLength(2);
    expect(world.prisma.grants.every((g) => g.usedAt)).toBe(true);
    expect(result.reason).not.toBe('awaiting_confirmation');
  });

  it('LEGIT: two DISTINCT approvals in one batch both run', async () => {
    const world = makeWorld([
      toolUses([
        { name: RED_TOOL, input: { id: '41' }, id: 'tu_1' },
        { name: RED_TOOL_2, input: { id: '99' }, id: 'tu_2' },
      ]),
    ]);
    const a = await issuedGrant(world, {
      grantId: `grt_${'a'.repeat(32)}`,
      toolName: RED_TOOL,
      args: { id: '41' },
    });
    const b = await issuedGrant(world, {
      grantId: `grt_${'b'.repeat(32)}`,
      toolName: RED_TOOL_2,
      args: { id: '99' },
    });
    const result = await world.service.run({
      user: authUser(),
      authorization: 'Bearer t',
      sessionId: 'ms_1',
      conversationId: CONVERSATION,
      turnSequence: 4,
      confirmed: [a, b],
      messages: [
        { role: 'user', content: 'delete invoice 41 and payment 99' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'p1', name: RED_TOOL, input: { id: '41' } },
            { type: 'tool_use', id: 'p2', name: RED_TOOL_2, input: { id: '99' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'p1', is_error: true, content: 'confirm' },
            { type: 'tool_result', tool_use_id: 'p2', is_error: true, content: 'confirm' },
          ],
        },
        { role: 'user', content: 'yes' },
      ],
    });
    expect(dispatched(result.events).sort()).toEqual([RED_TOOL, RED_TOOL_2].sort());
    expect(world.invoker.calls).toHaveLength(2);
  });

  it('ATTACK: two concurrent requests racing one grant', async () => {
    const world = makeWorld([
      toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }]),
      toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }]),
    ]);
    const id = await issuedGrant(world);
    const [r1, r2] = await Promise.all([confirmRun(world, [id]), confirmRun(world, [id])]);
    expect(world.invoker.calls).toHaveLength(1);
    expect([r1.reason, r2.reason]).toContain('awaiting_confirmation');
  });

  it('ATTACK: the store THROWS on spend — nothing dispatches, nothing re-proposed', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])]);
    const id = await issuedGrant(world);
    world.prisma.down = true;
    const result = await confirmRun(world, [id]);
    expect(world.invoker.calls).toHaveLength(0);
    expect(grantIds(result.events)).toHaveLength(0);
    expect(result.reason).toBe('failed');
    expect(result.events.some((e) => e.type === 'error')).toBe(true);
  });

  it('ATTACK: the store THROWS on issue — no confirmation offered', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])]);
    world.prisma.down = true;
    const result = await world.service.run({
      user: authUser(),
      authorization: 'Bearer t',
      sessionId: 'ms_1',
      conversationId: CONVERSATION,
      turnSequence: 3,
      messages: [{ role: 'user', content: 'delete invoice 41' }],
    });
    expect(world.invoker.calls).toHaveLength(0);
    expect(grantIds(result.events)).toHaveLength(0);
    expect(result.reason).toBe('failed');
  });

  it('LEGIT: propose with the real minted id, then approve and run', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])]);
    const proposal = await world.service.run({
      user: authUser(),
      authorization: 'Bearer t',
      sessionId: 'ms_1',
      conversationId: CONVERSATION,
      turnSequence: 3,
      messages: [{ role: 'user', content: 'delete invoice 41' }],
    });
    const g = grantIds(proposal.events)[0];
    expect(g).toMatch(/^grt_[0-9a-f]{32}$/);
    expect(world.invoker.calls).toHaveLength(0);
    expect(proposal.reason).toBe('awaiting_confirmation');

    world.model.script = [toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_9' }])];
    const run = await confirmRun(world, [g]);
    expect(dispatched(run.events)).toEqual([RED_TOOL]);
    expect(world.invoker.calls).toHaveLength(1);
  });

  it('LEGIT: the same action approved again LATER gets a new grant and runs', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])]);
    const g1 = await issuedGrant(world, { grantId: `grt_${'1'.repeat(32)}` });
    await confirmRun(world, [g1]);
    expect(world.invoker.calls).toHaveLength(1);

    world.model.script = [toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_2' }])];
    const proposal = await world.service.run({
      user: authUser(),
      authorization: 'Bearer t',
      sessionId: 'ms_1',
      conversationId: CONVERSATION,
      turnSequence: 5,
      messages: [{ role: 'user', content: 'delete invoice 41' }],
    });
    const g2 = grantIds(proposal.events)[0];
    expect(g2).toBeDefined();
    expect(g2).not.toBe(g1);

    world.model.script = [toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_3' }])];
    const run = await confirmRun(world, [g2]);
    expect(dispatched(run.events)).toEqual([RED_TOOL]);
    expect(world.invoker.calls).toHaveLength(2);
  });

  it('ATTACK: no conversation id (unpersisted turn) — red cannot run', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])]);
    const id = await issuedGrant(world);
    const result = await world.service.run({
      user: authUser(),
      authorization: 'Bearer t',
      sessionId: 'ms_1',
      confirmed: [id],
      messages: history(RED_TOOL, ARGS),
    });
    expect(world.invoker.calls).toHaveLength(0);
    expect(result.reason).toBe('failed');
  });

  it('ATTACK: soft-deleted conversation — a live grant becomes unspendable', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: ARGS, id: 'tu_1' }])]);
    const id = await issuedGrant(world);
    world.prisma.conversations[0].deletedAt = new Date();
    const result = await confirmRun(world, [id]);
    expect(world.invoker.calls).toHaveLength(0);
    expect(grantIds(result.events)).toHaveLength(0);
    expect(result.reason).toBe('failed');
  });
});
