/**
 * ADVERSARIAL round 2 — digest edges, candidate-list behaviour, partial outages.
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
  id: 'JournalEntriesController.post',
  controller: 'JournalEntriesController',
  handler: 'post',
  verb: 'POST',
  path: 'journal-entries',
  permissions: ['journal.post'],
  tier: 'red',
  tierReason: 'post-verb',
  params: { path: [], query: [], freeFormQuery: false, hasBody: true },
});
const RED_TOOL = 'JournalEntries_post';

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
  'journal.post',
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

function configFor() {
  return {
    enabled: true,
    model: 'claude-opus-5',
    classifierModel: 'claude-haiku-4-5',
    effort: 'medium',
    writeMode: 'red' as WriteMode,
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

class LedgerPrisma {
  conversations: Row[] = [];
  grants: Row[] = [];
  /** Throw on the Nth spend statement (1-based). 0 = never. */
  throwOnSpendCall = 0;
  spendCalls = 0;

  readonly msaidiziConversation = {
    findFirst: async ({ where, select }: { where: Row; select?: Row }) => {
      await tick();
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
      this.spendCalls += 1;
      if (this.throwOnSpendCall && this.spendCalls === this.throwOnSpendCall) {
        throw new Error('database is not reachable');
      }
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
  prisma.conversations.push({ id: 'conv-Z', userId: 'user-Z', deletedAt: null, turnCount: 1 });
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

function grantIds(events: MsaidiziEvent[]): string[] {
  return events.filter((e) => e.type === 'confirmation_required').map((e: any) => e.grantId);
}
function dispatchedArgs(events: MsaidiziEvent[]): unknown[] {
  return events.filter((e) => e.type === 'tool_call').map((e: any) => e.args);
}
function dispatched(events: MsaidiziEvent[]): string[] {
  return events.filter((e) => e.type === 'tool_call').map((e: any) => e.tool);
}

let seq = 0;
async function issuedGrant(
  world: World,
  over: {
    conversationId?: string;
    userId?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    expiresAt?: Date;
  } = {},
) {
  seq += 1;
  const id = `grt_${String(seq).padStart(32, '0')}`;
  const now = new Date();
  await world.store.issue({
    grantId: id,
    conversationId: over.conversationId ?? CONVERSATION,
    userId: over.userId ?? 'user-A',
    toolName: over.toolName ?? RED_TOOL,
    argumentDigest: argumentDigestFor(over.args ?? {}),
    proposedOnTurn: 3,
    createdAt: now,
    expiresAt: over.expiresAt ?? new Date(now.getTime() + 30 * 60 * 1000),
  });
  return id;
}

function historyWith(blocks: Array<{ name: string; input: Record<string, unknown>; id: string }>) {
  return [
    { role: 'user' as const, content: 'post the journal' },
    {
      role: 'assistant' as const,
      content: blocks.map((b) => ({
        type: 'tool_use',
        id: b.id,
        name: b.name,
        input: b.input,
      })),
    },
    {
      role: 'user' as const,
      content: blocks.map((b) => ({
        type: 'tool_result',
        tool_use_id: b.id,
        is_error: true,
        content: 'confirm',
      })),
    },
    { role: 'user' as const, content: 'yes' },
  ];
}

function run(world: World, confirmed: string[], blocks: any[], user = authUser()) {
  return world.service.run({
    user,
    authorization: 'Bearer t',
    sessionId: 'ms_1',
    conversationId: user.id === 'user-Z' ? 'conv-Z' : CONVERSATION,
    turnSequence: 4,
    confirmed,
    messages: historyWith(blocks),
  });
}

const BODY = { body: { memo: 'Rent', lines: [{ account: '1000', amount: 50000 }] } };

describe('ADVERSARIAL 2 — digest edges and candidate-list behaviour', () => {
  it('LEGIT: key order differs — the same action still spends', async () => {
    const world = makeWorld([
      toolUses([
        {
          name: RED_TOOL,
          input: { body: { lines: [{ amount: 50000, account: '1000' }], memo: 'Rent' } },
          id: 'tu_1',
        },
      ]),
    ]);
    const g = await issuedGrant(world, { args: BODY });
    const r = await run(world, [g], [{ name: RED_TOOL, input: BODY, id: 'p1' }]);
    expect(world.invoker.calls).toHaveLength(1);
    expect(dispatched(r.events)).toEqual([RED_TOOL]);
  });

  it('ATTACK: one number changed deep in the body', async () => {
    const bigger = { body: { memo: 'Rent', lines: [{ account: '1000', amount: 9000000 }] } };
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: bigger, id: 'tu_1' }])]);
    const g = await issuedGrant(world, { args: BODY });
    const r = await run(world, [g], [{ name: RED_TOOL, input: BODY, id: 'p1' }]);
    expect(world.invoker.calls).toHaveLength(0);
    expect(r.reason).toBe('awaiting_confirmation');
  });

  it('ATTACK: two journal lines swapped', async () => {
    const two = {
      body: {
        lines: [
          { account: 'A', amount: 1 },
          { account: 'B', amount: 2 },
        ],
      },
    };
    const swapped = {
      body: {
        lines: [
          { account: 'B', amount: 2 },
          { account: 'A', amount: 1 },
        ],
      },
    };
    const world = makeWorld([toolUses([{ name: RED_TOOL, input: swapped, id: 'tu_1' }])]);
    const g = await issuedGrant(world, { args: two });
    const r = await run(world, [g], [{ name: RED_TOOL, input: two, id: 'p1' }]);
    expect(world.invoker.calls).toHaveLength(0);
    expect(r.reason).toBe('awaiting_confirmation');
  });

  it('ATTACK: a numeric id sent back as a string', async () => {
    const world = makeWorld([
      toolUses([{ name: RED_TOOL, input: { body: { n: '41' } }, id: 'tu_1' }]),
    ]);
    const g = await issuedGrant(world, { args: { body: { n: 41 } } });
    const r = await run(world, [g], [{ name: RED_TOOL, input: { body: { n: 41 } }, id: 'p1' }]);
    expect(world.invoker.calls).toHaveLength(0);
    expect(r.reason).toBe('awaiting_confirmation');
  });

  it('ATTACK: an extra field added to the approved body', async () => {
    const world = makeWorld([
      toolUses([{ name: RED_TOOL, input: { body: { memo: 'Rent', force: true } }, id: 'tu_1' }]),
    ]);
    const g = await issuedGrant(world, { args: { body: { memo: 'Rent' } } });
    const r = await run(
      world,
      [g],
      [{ name: RED_TOOL, input: { body: { memo: 'Rent' } }, id: 'p1' }],
    );
    expect(world.invoker.calls).toHaveLength(0);
  });

  it('MIXED: unapproved action A and approved action B in ONE turn', async () => {
    const world = makeWorld([
      toolUses([
        { name: RED_TOOL, input: { body: { memo: 'not approved' } }, id: 'tu_1' },
        { name: RED_TOOL_2, input: { id: '99' }, id: 'tu_2' },
      ]),
    ]);
    const g = await issuedGrant(world, { toolName: RED_TOOL_2, args: { id: '99' } });
    const r = await run(
      world,
      [g],
      [
        { name: RED_TOOL, input: { body: { memo: 'not approved' } }, id: 'p1' },
        { name: RED_TOOL_2, input: { id: '99' }, id: 'p2' },
      ],
    );
    expect(dispatched(r.events)).toEqual([RED_TOOL_2]);
    expect(dispatchedArgs(r.events)).toEqual([{ id: '99' }]);
    expect(grantIds(r.events)).toHaveLength(1); // A re-proposed
    expect(r.reason).toBe('awaiting_confirmation');
  });

  it('MIXED (reversed order): approved B first, unapproved A second', async () => {
    const world = makeWorld([
      toolUses([
        { name: RED_TOOL_2, input: { id: '99' }, id: 'tu_1' },
        { name: RED_TOOL, input: { body: { memo: 'not approved' } }, id: 'tu_2' },
      ]),
    ]);
    const g = await issuedGrant(world, { toolName: RED_TOOL_2, args: { id: '99' } });
    const r = await run(
      world,
      [g],
      [
        { name: RED_TOOL_2, input: { id: '99' }, id: 'p1' },
        { name: RED_TOOL, input: { body: { memo: 'not approved' } }, id: 'p2' },
      ],
    );
    expect(dispatched(r.events)).toEqual([RED_TOOL_2]);
    expect(grantIds(r.events)).toHaveLength(1);
  });

  it('ATTACK: user-Z offers user-A grant inside user-Z own conversation', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL_2, input: { id: '99' }, id: 'tu_1' }])]);
    const g = await issuedGrant(world, {
      conversationId: CONVERSATION,
      userId: 'user-A',
      toolName: RED_TOOL_2,
      args: { id: '99' },
    });
    const r = await run(
      world,
      [g],
      [{ name: RED_TOOL_2, input: { id: '99' }, id: 'p1' }],
      authUser('user-Z'),
    );
    expect(world.invoker.calls).toHaveLength(0);
    expect(world.prisma.grants.find((x) => x.id === g)!.usedAt).toBeNull();
  });

  it('ATTACK: a throw on the FIRST candidate must not fall through to the second', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL_2, input: { id: '99' }, id: 'tu_1' }])]);
    const bad = await issuedGrant(world, { toolName: RED_TOOL, args: { x: 1 } });
    const good = await issuedGrant(world, { toolName: RED_TOOL_2, args: { id: '99' } });
    world.prisma.throwOnSpendCall = 1;
    const r = await run(world, [bad, good], [{ name: RED_TOOL_2, input: { id: '99' }, id: 'p1' }]);
    expect(world.invoker.calls).toHaveLength(0);
    expect(grantIds(r.events)).toHaveLength(0);
    expect(r.reason).toBe('failed');
    expect(world.prisma.grants.find((x) => x.id === good)!.usedAt).toBeNull();
  });

  it('PARTIAL OUTAGE: first action spends, second action throws — failure wins', async () => {
    const world = makeWorld([
      toolUses([
        { name: RED_TOOL_2, input: { id: '99' }, id: 'tu_1' },
        { name: RED_TOOL, input: { body: { memo: 'x' } }, id: 'tu_2' },
      ]),
    ]);
    const g1 = await issuedGrant(world, { toolName: RED_TOOL_2, args: { id: '99' } });
    const g2 = await issuedGrant(world, { toolName: RED_TOOL, args: { body: { memo: 'x' } } });
    world.prisma.throwOnSpendCall = 2;
    const r = await run(
      world,
      [g1, g2],
      [
        { name: RED_TOOL_2, input: { id: '99' }, id: 'p1' },
        { name: RED_TOOL, input: { body: { memo: 'x' } }, id: 'p2' },
      ],
    );
    expect(dispatched(r.events)).toEqual([RED_TOOL_2]);
    expect(r.reason).toBe('failed');
    expect(grantIds(r.events)).toHaveLength(0);
    expect(world.prisma.grants.find((x) => x.id === g2)!.usedAt).toBeNull();
  });

  it('ATTACK: expiry boundary — expiresAt exactly equal to the dispatch clock', async () => {
    const world = makeWorld([toolUses([{ name: RED_TOOL_2, input: { id: '99' }, id: 'tu_1' }])]);
    const at = Date.now() + 60_000;
    const g = await issuedGrant(world, {
      toolName: RED_TOOL_2,
      args: { id: '99' },
      expiresAt: new Date(at),
    });
    jest.useFakeTimers({
      now: at,
      doNotFake: ['setImmediate', 'queueMicrotask', 'nextTick', 'setTimeout'],
    });
    try {
      const r = await run(world, [g], [{ name: RED_TOOL_2, input: { id: '99' }, id: 'p1' }]);
      expect(world.invoker.calls).toHaveLength(0);
      expect(r.reason).toBe('awaiting_confirmation');
    } finally {
      jest.useRealTimers();
    }
  });

  it('ATTACK: model re-emits the approved action on a SECOND model turn of the same run', async () => {
    const world = makeWorld([
      toolUses([{ name: RED_TOOL_2, input: { id: '99' }, id: 'tu_1' }]),
      toolUses([{ name: RED_TOOL_2, input: { id: '99' }, id: 'tu_2' }]),
    ]);
    const g = await issuedGrant(world, { toolName: RED_TOOL_2, args: { id: '99' } });
    const r = await run(world, [g], [{ name: RED_TOOL_2, input: { id: '99' }, id: 'p1' }]);
    expect(world.invoker.calls).toHaveLength(1);
    expect(r.reason).toBe('awaiting_confirmation');
    expect(grantIds(r.events)).toHaveLength(1);
  });
});
