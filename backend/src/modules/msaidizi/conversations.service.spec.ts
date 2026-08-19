/**
 * Conversation persistence — the read gate, the delete, and the round trip.
 *
 * This service had no spec at all, which is why every guarantee in its header
 * was a guarantee nobody had ever run. The ones that matter most cannot be
 * checked by reading:
 *
 *   1. A conversation is readable only by its author. Not company-scoped, not
 *      admin-readable. The transcript is a permission-bypass channel if that
 *      gate is ever loosened to the house scoping helper, because it holds
 *      whatever the author's own permissions let the agent retrieve.
 *   2. A removed conversation is gone from the author's list AND unreadable by
 *      id, and its resume state — the only column holding retrieved customer
 *      records — is destroyed at once rather than stamped for later.
 *   3. `open()` then `close()` actually leaves behind the rows the chat client
 *      reads back: the transcript at display fidelity, the resume state at API
 *      fidelity, and the counters.
 *   4. Nothing this service reports back can turn one bad minute into a
 *      permanent one. An unpersisted turn claims no position in a conversation,
 *      a turn continued without a client history is answered from the stored
 *      state rather than from nothing, a turn the store failed to record is not
 *      then erased from the model's memory by the stale copy it left behind, and
 *      ageing out is reported as ageing out rather than as a conversation that
 *      grew too long.
 *
 * ─── Why a fake Prisma rather than mock call assertions ──────────────────────
 *
 * The defect this file is written against is a MISSING WHERE CLAUSE, and a test
 * that asserts `findMany` was called with a particular object proves only that
 * the code says what it says. The store below actually evaluates the where
 * clause, so a scope the service forgets to apply shows up as a row the wrong
 * person can read — the same way it would in production.
 *
 * It deliberately does NOT reproduce the `$use` soft-delete middleware in
 * `PrismaService`. That middleware adds `deletedAt: null` to reads today, which
 * is exactly why the omission in `scopeFor()` was invisible: the file's own
 * promise was being kept by a global hook it does not control and that Prisma
 * has deprecated. These tests hold the service to the promise itself.
 */

import { ConfigService } from '@nestjs/config';
import { ConflictException, GoneException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EncryptionService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { MsaidiziConversationsService } from './conversations.service';
import { ModelMessage } from './model-client';
import { MsaidiziConfig } from './msaidizi.config';
import { MsaidiziEvent, RunResult } from './msaidizi.service';

// ─── The store ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/**
 * Evaluates the subset of Prisma's where grammar this service actually uses:
 * scalar equality, `{ in: [] }`, `{ not: … }`, the `none` / `some` / `every`
 * relation filters, and `OR` / `AND` / `NOT` nesting. Anything else is a shape
 * no query here builds, and silently ignoring it would let a broken filter pass.
 *
 * Relation filters read `row.turns`, which the conversation queries below attach
 * before matching — the same join the database does, and the reason a
 * conversation that a procedure opened can be filtered out of the chat rail
 * without a column of its own.
 */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Row[]).some((clause) => matches(row, clause));
    if (key === 'AND') return (condition as Row[]).every((clause) => matches(row, clause));
    if (key === 'NOT') return !matches(row, condition as Row);

    const value = row[key];

    if (Array.isArray(value)) {
      const related = value as Row[];
      const filter = condition as { none?: Row; some?: Row; every?: Row };
      if (filter.none) return !related.some((child) => matches(child, filter.none));
      if (filter.some) return related.some((child) => matches(child, filter.some));
      if (filter.every) return related.every((child) => matches(child, filter.every));
      throw new Error(`Unsupported relation filter: ${JSON.stringify(condition)}`);
    }

    if (condition && typeof condition === 'object') {
      if ('in' in (condition as object)) {
        return (condition as { in: unknown[] }).in.includes(value);
      }
      if ('not' in (condition as object)) {
        const not = (condition as { not: unknown }).not;
        return not === null ? value !== null && value !== undefined : value !== not;
      }
    }

    if (condition === null) return value === null || value === undefined;
    return value === condition;
  });
}

function applyData(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in (value as object)) {
      row[key] = ((row[key] as number) ?? 0) + (value as { increment: number }).increment;
      continue;
    }
    row[key] = value;
  }
}

function time(value: unknown): number {
  return value instanceof Date ? value.getTime() : 0;
}

class FakePrisma {
  conversations: Row[] = [];
  turns: Row[] = [];
  /** Set to make the next turn update reject — the "history write failed" case. */
  failTurnUpdate = false;
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  readonly msaidiziConversation = {
    create: async ({ data, include }: { data: Row; include?: Row }) => {
      const { turns, ...rest } = data as Row & { turns?: { create: Row } };

      // The unique index on agentSessionId is modelled because the service
      // depends on it: it is what stops one user's turn being filed into
      // another user's conversation when a session id collides.
      //
      // Thrown as Prisma throws it, not as a bare Error, because the service
      // now READS this failure rather than only surviving it — a collision is
      // the one insert failure that says something about the id rather than
      // about the store, and it is answered by minting a fresh one. A double
      // that threw an anonymous Error would send that branch down the
      // store-unavailable path and quietly test the opposite behaviour.
      if (this.conversations.some((c) => c.agentSessionId === rest.agentSessionId)) {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`agentSessionId`)',
          { code: 'P2002', clientVersion: 'test', meta: { target: ['agentSessionId'] } },
        );
      }

      const now = new Date();
      const row: Row = {
        id: this.id('conv'),
        toolCallCount: 0,
        writeCallCount: 0,
        highestTier: 'green',
        resumeState: null,
        resumeBytes: 0,
        resumeExpiresAt: null,
        resumable: true,
        companyId: null,
        title: null,
        turnCount: 0,
        lastTurnAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...rest,
      };
      this.conversations.push(row);

      if (turns?.create) {
        await this.msaidiziConversationTurn.create({
          data: { conversationId: row.id as string, ...turns.create },
        });
      }
      return include?.turns ? { ...row, turns: this.turnsFor(row.id as string) } : row;
    },

    findFirst: async ({ where, include }: { where?: Row; include?: Row }) => {
      const row = this.conversations.find((c) => matches(this.joined(c), where));
      if (!row) return null;
      return include?.turns ? { ...row, turns: this.turnsFor(row.id as string) } : row;
    },

    findMany: async ({
      where,
      skip = 0,
      take = 100,
      select,
    }: {
      where?: Row;
      orderBy?: unknown;
      skip?: number;
      take?: number;
      select?: Record<string, boolean>;
    }) => {
      const rows = this.conversations
        .filter((c) => matches(this.joined(c), where))
        // Both list() and oversight() order by lastTurnAt then createdAt, newest
        // first. Hardcoded rather than read off `orderBy` — no query here uses
        // any other ordering, and a test double that guesses is worse than one
        // that states its assumption.
        .sort(
          (a, b) =>
            time(b.lastTurnAt) - time(a.lastTurnAt) || time(b.createdAt) - time(a.createdAt),
        )
        .slice(skip, skip + take);

      if (!select) return rows;
      return rows.map((row) =>
        Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])),
      );
    },

    count: async ({ where }: { where?: Row }) =>
      this.conversations.filter((c) => matches(this.joined(c), where)).length,

    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = this.conversations.find((c) => matches(c, where));
      if (!row) throw new Error('Record to update not found.');
      applyData(row, data);
      return row;
    },

    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = this.conversations.filter((c) => matches(c, where));
      rows.forEach((row) => applyData(row, data));
      return { count: rows.length };
    },
  };

  readonly msaidiziConversationTurn = {
    create: async ({ data }: { data: Row }) => {
      const row: Row = {
        id: this.id('turn'),
        toolCallCount: 0,
        writeCallCount: 0,
        procedureId: null,
        startedAt: new Date(),
        endedAt: null,
        ...data,
      };
      this.turns.push(row);
      return row;
    },

    update: async ({ where, data }: { where: Row; data: Row }) => {
      if (this.failTurnUpdate) throw new Error('deadlock detected');
      const row = this.turns.find((t) => matches(t, where));
      if (!row) throw new Error('Record to update not found.');
      applyData(row, data);
      return row;
    },

    /**
     * The compound-unique lookup `unfinishedTurn()` uses.
     *
     * Modelled rather than left off, and the difference is not cosmetic: the
     * service catches a throwing store here and continues WITHOUT the check, so
     * a double missing this method turns every test of the guard into a test
     * that the guard is skipped — passing, and proving nothing. The `where` key
     * is unwrapped by hand because Prisma's compound-unique form nests the
     * fields under the index name, which `matches()` would otherwise compare
     * against a column that does not exist.
     *
     * `select` is honoured rather than ignored for the same reason: the guard
     * reads `startedAt` as well as `reason` — it is what separates a run still
     * going from one that died — and a double that returned the whole row would
     * hide a service that had stopped asking for it.
     */
    findUnique: async ({ where, select }: { where: Row; select?: Record<string, boolean> }) => {
      const compound = (where.conversationId_sequence ?? where) as Row;
      const row = this.turns.find(
        (t) => t.conversationId === compound.conversationId && t.sequence === compound.sequence,
      );
      if (!row) return null;
      if (!select) return row;
      return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
    },
  };

  /**
   * Both forms the service uses.
   *
   * The array form is not atomic here — every promise in it has already been
   * issued by the time it arrives — which is accurate enough for these tests and
   * stated so nobody reads atomicity into a passing result.
   *
   * The CALLBACK form rolls back, and that part is not a nicety. `appendTurn()`
   * increments `turnCount` and inserts the turn row inside one callback, and
   * what it reports back for a failed insert depends on whether the increment
   * survived. A double that let the increment stand would model a database this
   * service is written against the opposite of, and would answer the "one
   * degraded turn poisons the conversation" tests with the wrong turn count.
   *
   * The snapshot is a row-wise spread and NOT `structuredClone`, which is what
   * it used to be. Jest runs the suite inside a VM realm whose `Date` is not the
   * one `structuredClone` (a host global) constructs with, so every date on a
   * rolled-back row came back failing `instanceof Date` — which `time()` reads
   * as epoch zero, which makes `expiresAt` look decades past, which makes the
   * next `open()`'s retention sweep DELETE the conversation. Any test that
   * continued a conversation after a rolled-back turn therefore got
   * `NotFoundException` from a store that had silently emptied itself. Rows here
   * are flat and `applyData` replaces values rather than mutating them in place,
   * so one level of copying is a faithful snapshot.
   */
  $transaction = async (arg: unknown) => {
    if (typeof arg !== 'function') return Promise.all(arg as Promise<unknown>[]);

    const conversations = this.conversations.map((row) => ({ ...row }));
    const turns = this.turns.map((row) => ({ ...row }));
    try {
      return await (arg as (tx: FakePrisma) => unknown)(this);
    } catch (err) {
      this.conversations = conversations;
      this.turns = turns;
      throw err;
    }
  };

  /**
   * The retention sweep, actually applied.
   *
   * Raw SQL by design — the Prisma soft-delete middleware would rewrite the
   * DELETE into an UPDATE — so a double has to read the statement rather than a
   * query object. The SET clause is PARSED rather than assumed: which columns
   * the sweep clears is the whole question on the ageing path, and a double that
   * hardcoded the answer would pass whatever the sweep actually wrote.
   */
  $executeRaw = jest.fn(async (template: TemplateStringsArray, ...values: unknown[]) => {
    const sql = template.join(' ').replace(/\s+/g, ' ').trim();

    if (sql.startsWith('UPDATE "msaidizi_conversations"')) {
      const set = /SET (.+?) WHERE/.exec(sql)?.[1] ?? '';
      const assignments = set.split(',').map((pair) => {
        const [column, literal] = pair.split('=').map((part) => part.trim());
        return [column.replace(/"/g, ''), sqlLiteral(literal)] as const;
      });
      const due = this.conversations.filter(
        (row) => row.resumeExpiresAt != null && time(row.resumeExpiresAt) < Date.now(),
      );
      due.forEach((row) => assignments.forEach(([column, value]) => (row[column] = value)));
      return due.length;
    }

    if (sql.startsWith('DELETE FROM "msaidizi_conversations"')) {
      const graceCutoff = values.find((value) => value instanceof Date) as Date | undefined;
      const doomed = this.conversations.filter(
        (row) =>
          time(row.expiresAt) < Date.now() ||
          (row.deletedAt != null && graceCutoff && time(row.deletedAt) < graceCutoff.getTime()),
      );
      const ids = new Set(doomed.map((row) => row.id));
      this.conversations = this.conversations.filter((row) => !ids.has(row.id));
      this.turns = this.turns.filter((turn) => !ids.has(turn.conversationId));
      return doomed.length;
    }

    throw new Error(`Unmodelled raw statement: ${sql}`);
  });

  /** A conversation as the database sees it when a query joins its turns. */
  private joined(row: Row): Row {
    return { ...row, turns: this.turnsFor(row.id as string) };
  }

  private turnsFor(conversationId: string): Row[] {
    return this.turns
      .filter((t) => t.conversationId === conversationId)
      .sort((a, b) => (a.sequence as number) - (b.sequence as number));
  }
}

function sqlLiteral(literal: string): unknown {
  if (literal === 'NULL') return null;
  if (literal === 'true') return true;
  if (literal === 'false') return false;
  return Number(literal);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long';

function encryption(): EncryptionService {
  const service = new EncryptionService(new ConfigService({ APP_ENCRYPTION_KEY: ENCRYPTION_KEY }));
  service.onModuleInit();
  return service;
}

function configFor(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    resumeTtlHours: 24,
    conversationRetentionDays: 90,
    resumeMaxBytes: 1_048_576,
    sweepBatchSize: 200,
    deletedGraceHours: 24,
    ...overrides,
  } as unknown as MsaidiziConfig;
}

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-A',
    email: 'a@itemba.local',
    fullName: 'Asha',
    roles: ['Company Manager'],
    roleScopes: ['COMPANY'],
    permissions: ['msaidizi.use'],
    companyId: 'company-A',
    companyAccess: [],
    ...overrides,
  } as unknown as AuthUser;
}

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  const prisma = new FakePrisma();
  const service = new MsaidiziConversationsService(
    prisma as unknown as PrismaService,
    configFor(overrides),
    encryption(),
  );
  return { prisma, service };
}

function runResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    sessionId: 'ms_ignored',
    reason: 'end_turn',
    events: [],
    messages: [{ role: 'user', content: 'Which suppliers are unpaid?' }],
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      modelTurns: 1,
    },
    ...overrides,
  };
}

const ASKED = 'Which suppliers have unpaid invoices?';

/**
 * The rejection's own body, so its discriminator can be read.
 *
 * `rejects.toBeInstanceOf(ConflictException)` says a 409 happened and nothing
 * about WHICH 409 — and the two this service raises are opposite answers, one
 * that clears by itself within `ABANDONED_TURN_MS` and one that never will. The
 * client branches on `code` to decide whether offering a retry is honest, so
 * the code is the contract; asserting only the class would let a throw site lose
 * it, or swap it for the other one, with every test still green.
 */
async function conflictBody(run: () => Promise<unknown>): Promise<{
  message: string;
  code?: string;
}> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(ConflictException);
    return (err as ConflictException).getResponse() as { message: string; code?: string };
  }
  throw new Error('expected a ConflictException, and nothing was thrown');
}

// ─── The read gate ────────────────────────────────────────────────────────────

describe('a conversation is readable only by its author', () => {
  it('does not list one user’s conversation to another', async () => {
    const { service } = makeService();
    const asha = authUser();
    const brian = authUser({ id: 'user-B', email: 'b@itemba.local', fullName: 'Brian' });

    await service.open({ user: asha, prompt: ASKED });

    expect((await service.list(asha)).meta.total).toBe(1);
    // Same company, same permissions. The transcript still is not theirs.
    expect(await service.list(brian)).toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0 },
    });
  });

  it('answers a second user asking for the conversation by id with a 404, not a 403', async () => {
    const { service } = makeService();
    const asha = authUser();
    const brian = authUser({ id: 'user-B' });

    const opened = await service.open({ user: asha, prompt: ASKED });

    // Not "forbidden": there is nothing to tell a non-author about a
    // conversation that is not theirs, including that it exists.
    await expect(service.findOne(opened.conversationId!, brian)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a second user’s delete and leaves the conversation live', async () => {
    const { prisma, service } = makeService();
    const asha = authUser();
    const brian = authUser({ id: 'user-B' });

    const opened = await service.open({ user: asha, prompt: ASKED });

    await expect(service.remove(opened.conversationId!, brian)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.conversations[0].deletedAt).toBeNull();
    expect((await service.list(asha)).meta.total).toBe(1);
  });

  it('refuses a second user’s attempt to continue the conversation by id', async () => {
    const { service } = makeService();
    const asha = authUser();
    const brian = authUser({ id: 'user-B' });

    const opened = await service.open({ user: asha, prompt: ASKED });
    await service.close(opened, runResult());

    // The write path is a read gate too: continuing by id reads the stored
    // resume state, which is the array of everything the author retrieved.
    await expect(
      service.open({
        user: brian,
        prompt: 'And what did she ask?',
        conversationId: opened.conversationId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('applies company scope in addition to authorship, never instead of it', async () => {
    const { service } = makeService();
    const asha = authUser();
    await service.open({ user: asha, prompt: ASKED });

    // Same person, later, after losing access to company-A. Their own
    // conversation, filed under a company they can no longer reach.
    const moved = authUser({ companyId: 'company-B', companyAccess: [] });
    expect((await service.list(moved)).meta.total).toBe(0);

    // A conversation with no company has no such access to lose.
    const groupUser = authUser({ id: 'user-G', companyId: null as unknown as string });
    const opened = await service.open({ user: groupUser, prompt: 'Group-level question' });
    expect(opened.conversationId).toBeDefined();
    expect((await service.list(groupUser)).meta.total).toBe(1);
  });
});

// ─── The delete ───────────────────────────────────────────────────────────────

describe('a removed conversation is gone from its author’s view', () => {
  it('disappears from list() — the sentence the delete dialog promises', async () => {
    const { service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: ASKED });
    await service.close(opened, runResult());

    expect((await service.list(user)).meta.total).toBe(1);

    await service.remove(opened.conversationId!, user);

    const after = await service.list(user);
    expect(after.data).toEqual([]);
    expect(after.meta.total).toBe(0);
  });

  it('is unreadable by id afterwards, so a stale link cannot reopen the transcript', async () => {
    const { service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: ASKED });
    await service.close(opened, runResult());

    await service.remove(opened.conversationId!, user);

    await expect(service.findOne(opened.conversationId!, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('drops out of the oversight projection too', async () => {
    const { service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: ASKED });

    expect((await service.oversight({}, user)).meta.total).toBe(1);

    await service.remove(opened.conversationId!, user);

    expect(await service.oversight({}, user)).toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0 },
    });
  });

  it('destroys the resume state at once rather than stamping the row for later', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: ASKED });
    await service.close(opened, runResult());

    expect(prisma.conversations[0].resumeState).toEqual(expect.any(String));

    await service.remove(opened.conversationId!, user);

    // A `deletedAt` stamp leaving retrieved records in `resumeState` would be
    // theatre. The row survives for the sweep's grace window; the customer data
    // in it does not.
    const row = prisma.conversations[0];
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(row.resumeState).toBeNull();
    expect(row.resumeBytes).toBe(0);
    expect(row.resumable).toBe(false);
    expect(row.resumeExpiresAt).toBeNull();
  });
});

// ─── The round trip ───────────────────────────────────────────────────────────

describe('open() then close() leaves behind what the chat client reads', () => {
  const events: MsaidiziEvent[] = [
    { type: 'text', text: 'Let me look.' },
    {
      type: 'tool_call',
      tool: 'SupplierInvoices_findAll',
      capabilityId: 'SupplierInvoicesController.findAll',
      tier: 'green',
      args: { status: 'UNPAID' },
    },
    { type: 'tool_result', tool: 'SupplierInvoices_findAll', ok: true, status: 200 },
    {
      type: 'tool_call',
      tool: 'SupplierInvoices_update',
      capabilityId: 'SupplierInvoicesController.update',
      tier: 'amber',
      args: { id: 'inv-41' },
    },
    { type: 'tool_result', tool: 'SupplierInvoices_update', ok: true, status: 200 },
    { type: 'done', reason: 'end_turn' },
  ];

  it('records the turn, its transcript, its verdict and its counters', async () => {
    const { service } = makeService();
    const user = authUser();

    const opened = await service.open({ user, prompt: ASKED });
    expect(opened.sequence).toBe(1);
    expect(opened.sessionId).toMatch(/^ms_[0-9a-f]{32}$/);

    await service.close(opened, runResult({ events, reason: 'end_turn' }));

    const detail = await service.findOne(opened.conversationId!, user);
    expect(detail.agentSessionId).toBe(opened.sessionId);
    expect(detail.title).toBe(ASKED);
    expect(detail.turnCount).toBe(1);
    // Counted from the events, not from anything the caller declared: two tool
    // calls, one of them a write, so the conversation has touched amber.
    expect(detail.toolCallCount).toBe(2);
    expect(detail.writeCallCount).toBe(1);
    expect(detail.highestTier).toBe('amber');
    expect(detail.continuable).toBe(true);

    expect(detail.turns).toHaveLength(1);
    expect(detail.turns[0]).toEqual(
      expect.objectContaining({
        sequence: 1,
        prompt: ASKED,
        reason: 'end_turn',
        toolCallCount: 2,
        writeCallCount: 1,
      }),
    );
    // The transcript decrypts back to the array the client already rendered.
    expect(detail.turns[0].events).toEqual(events);
    expect(detail.turns[0].endedAt).toBeInstanceOf(Date);
  });

  it('opens the row before the run, so a run that never reports back still left a trace', async () => {
    const { service } = makeService();
    const user = authUser();

    const opened = await service.open({ user, prompt: ASKED });
    // No close() — the stream dropped, or the process died mid-loop.
    const detail = await service.findOne(opened.conversationId!, user);

    expect(detail.turns[0].reason).toBe('running');
    expect(detail.turns[0].endedAt).toBeNull();
    // And the handle into the audit trail is there regardless.
    expect(detail.agentSessionId).toBe(opened.sessionId);
  });

  it('files a second question under the same conversation and keeps the session id', async () => {
    const { service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ events }));

    // What a client on the pre-persistence path sends: its own session id.
    const second = await service.open({
      user,
      prompt: 'And which is the oldest?',
      clientSessionId: first.sessionId,
    });

    expect(second.conversationId).toBe(first.conversationId);
    expect(second.sequence).toBe(2);
    // Load-bearing: red-tier confirmation ids are derived from the session id,
    // so a fresh one minted here would produce ids that never match the ones the
    // user approved — an approval loop that looks like the server ignoring them.
    expect(second.sessionId).toBe(first.sessionId);

    const detail = await service.findOne(first.conversationId!, user);
    expect(detail.turns.map((turn) => turn.sequence)).toEqual([1, 2]);
    // Counters accumulate across turns rather than being overwritten by the last.
    await service.close(second, runResult({ events }));
    expect((await service.findOne(first.conversationId!, user)).toolCallCount).toBe(4);
  });

  it('hands a conversation continued by id the server’s own history, not the client’s', async () => {
    const { service } = makeService();
    const user = authUser();

    const stored = [
      { role: 'user' as const, content: ASKED },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'Three of them.' }] },
    ];
    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ events, messages: stored }));

    const second = await service.open({
      user,
      prompt: 'Which is the oldest?',
      conversationId: first.conversationId,
      fallbackHistory: [{ role: 'user', content: 'something stale from another tab' }],
    });

    expect(second.fromServer).toBe(true);
    // Verbatim, including the assistant turn's content blocks — the API requires
    // them echoed back unchanged.
    expect(second.history).toEqual(stored);
    expect(second.sessionId).toBe(first.sessionId);
    // The stored copy wins here because it holds more of the conversation than
    // the tab does, which is the usual case and the one this path exists for. It
    // is not an unconditional rule — see "a turn the store failed to record
    // survives into the next one" for the case where it is the stale one.
  });

  it('rejects a client that is behind, rather than letting two tabs diverge', async () => {
    const { service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ events }));
    const second = await service.open({
      user,
      prompt: 'And the oldest?',
      conversationId: first.conversationId,
    });
    await service.close(second, runResult({ events }));

    const conflict = await conflictBody(() =>
      service.open({
        user,
        prompt: 'Sent from the first tab, which never saw turn 2',
        conversationId: first.conversationId,
        clientSequence: 1,
      }),
    );
    // The permanent one. Nothing about this expires, and the client must not be
    // shown a retry for it.
    expect(conflict.code).toBe('continued_elsewhere');
    expect(conflict.message).toContain('another window');
  });

  it('refuses to continue a conversation whose state was too large to store, and says which', async () => {
    // A ceiling below the smallest message array, so the resume state is
    // dropped whole rather than truncated.
    const { service } = makeService({ resumeMaxBytes: 8 });
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ events }));

    expect((await service.list(user)).data[0]).toEqual(
      expect.objectContaining({ resumable: false, continuable: false }),
    );

    await expect(
      service.open({ user, prompt: 'Carry on', conversationId: first.conversationId }),
    ).rejects.toThrow(GoneException);
    await expect(
      service.open({ user, prompt: 'Carry on', conversationId: first.conversationId }),
    ).rejects.toThrow(/too long to continue/);

    // Still readable. Not continuable is not the same as gone.
    expect((await service.findOne(first.conversationId!, user)).turns).toHaveLength(1);
  });

  it('redacts the stored transcript without touching the array the client was sent', async () => {
    const { service } = makeService();
    const user = authUser();

    const withSecret: MsaidiziEvent[] = [
      {
        type: 'tool_call',
        tool: 'Users_create',
        capabilityId: 'UsersController.create',
        tier: 'red',
        args: { body: { email: 'new@itemba.local', password: 'hunter2' } },
      },
    ];
    const result = runResult({ events: withSecret });

    const opened = await service.open({ user, prompt: 'Create a user for Neema' });
    await service.close(opened, result);

    const stored = await service.findOne(opened.conversationId!, user);
    const args = (
      stored.turns[0].events[0] as unknown as { args: { body: Record<string, unknown> } }
    ).args;
    expect(args.body.password).toBe('[REDACTED]');
    expect(args.body.email).toBe('new@itemba.local');

    // The caller's own array is not rewritten under it — it has already been
    // streamed to the client, and redaction is a property of what comes to rest.
    expect(result.events).toBe(withSecret);
    expect(
      (withSecret[0] as unknown as { args: { body: { password: string } } }).args.body.password,
    ).toBe('hunter2');
  });
});

// ─── Persistence never fails a run ────────────────────────────────────────────

describe('persistence never fails a run', () => {
  it('swallows a failed close() — the answer is already the user’s', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    const opened = await service.open({ user, prompt: ASKED });
    prisma.failTurnUpdate = true;

    await expect(service.close(opened, runResult())).resolves.toBeUndefined();
  });

  it('runs unpersisted when the store cannot be reached at all', async () => {
    const { prisma, service } = makeService();
    jest
      .spyOn(prisma.msaidiziConversation, 'create')
      .mockRejectedValue(new Error('connection refused'));

    const opened = await service.open({ user: authUser(), prompt: ASKED });

    // Everything the run itself needs is still there; only the history is lost.
    expect(opened.sessionId).toMatch(/^ms_/);
    expect(opened.conversationId).toBeUndefined();
    expect(opened.history).toEqual([]);
    // And close() on an unpersisted turn is a no-op rather than a crash.
    await expect(service.close(opened, runResult())).resolves.toBeUndefined();
  });
});

// ─── The sequence a client is allowed to carry ────────────────────────────────

describe('an unpersisted turn reports no sequence, and does not poison the ones after it', () => {
  it('reports none — not zero — when the store cannot be reached at all', async () => {
    const { prisma, service } = makeService();
    jest
      .spyOn(prisma.msaidiziConversation, 'create')
      .mockRejectedValue(new Error('connection refused'));

    const opened = await service.open({ user: authUser(), prompt: ASKED });

    // The client stores whatever arrives here and sends it back as its claim
    // about this conversation. Zero IS a claim — "I have seen no turns of it" —
    // and continueById can only read that as a tab that has fallen behind.
    expect(opened.sequence).toBeUndefined();
  });

  it('reports none when the turn row could not be opened on a live conversation', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult());

    jest
      .spyOn(prisma.msaidiziConversationTurn, 'create')
      .mockRejectedValueOnce(new Error('deadlock detected'));
    const degraded = await service.open({
      user,
      prompt: 'And the oldest?',
      clientSessionId: first.sessionId,
    });

    expect(degraded.conversationId).toBeUndefined();
    expect(degraded.sequence).toBeUndefined();
    // The position it would have had is not the position it has: the
    // transaction rolled back, so the conversation is still on turn 1.
    expect(prisma.conversations[0].turnCount).toBe(1);
  });

  it('does not answer a client carrying no claim with "continued in another window"', async () => {
    const { service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult());
    const second = await service.open({
      user,
      prompt: 'And the oldest?',
      conversationId: first.conversationId,
      clientSequence: first.sequence,
    });
    await service.close(second, runResult());

    // Zero is what this server used to report for a degraded turn, and what a
    // client already in the field will keep sending afterwards. Sequences are
    // 1-based, so it cannot mean "up to date with turn zero" — it means the tab
    // has nothing to say, and a tab with nothing to say is not evidence that a
    // second window wrote. Refusing it makes one blip permanent: every later
    // question in that tab answered with a sentence that is not true, and no
    // retry that clears it.
    const third = await service.open({
      user,
      prompt: 'Carry on',
      conversationId: first.conversationId,
      clientSequence: 0,
    });
    expect(third.sequence).toBe(3);
  });
});

// ─── Reopening a conversation the client holds no history for ─────────────────

describe('a conversation continued without a client history keeps the server one', () => {
  const stored: ModelMessage[] = [
    { role: 'user', content: ASKED },
    { role: 'assistant', content: [{ type: 'text', text: 'Mwanza Traders and two others.' }] },
    { role: 'user', content: 'How much does Mwanza Traders owe?' },
    { role: 'assistant', content: [{ type: 'text', text: 'TZS 4,180,000.' }] },
  ];

  it('hands back the stored working state rather than starting over under its name', async () => {
    const { service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ messages: stored }));

    // What a reopened conversation sends: its session id and nothing else. The
    // rail's hydration builds a client history of `[]` by construction, so an
    // empty array here is the client asserting nothing, not asserting empty.
    const second = await service.open({
      user,
      prompt: 'And the second supplier?',
      clientSessionId: first.sessionId,
    });

    expect(second.fromServer).toBe(true);
    expect(second.history).toEqual(stored);
  });

  it('does not replace four turns of resume state with one turn worth', async () => {
    const { service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ messages: stored }));

    const second = await service.open({
      user,
      prompt: 'And the second supplier?',
      clientSessionId: first.sessionId,
    });
    // What the run produces: everything it was given, plus this turn. Derived
    // from `second.history` rather than stated, because that is what
    // `MsaidiziController.messagesFor` and the agent loop actually build — a
    // run that was handed nothing produces one message, and the point of this
    // test is what then comes to rest.
    await service.close(
      second,
      runResult({
        messages: [...second.history, { role: 'user', content: 'And the second supplier?' }],
      }),
    );

    // Read back the way a later turn reads it, and asserted against the four
    // turns that were there — NOT against what the run happened to produce,
    // which is self-consistent whether or not the state survived. A run that
    // started from nothing overwrites the conversation's memory with its own one
    // turn, irreversibly, while `continuable` goes on saying otherwise and the
    // transcript goes on showing every turn the model can no longer see.
    const third = await service.open({
      user,
      prompt: 'Third question',
      conversationId: first.conversationId,
    });
    expect(third.history).toEqual([
      ...stored,
      { role: 'user', content: 'And the second supplier?' },
    ]);
  });

  it('leaves a client that sent its own history in charge of it', async () => {
    const { service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ messages: stored }));

    const clientHeld: ModelMessage[] = [{ role: 'user', content: 'the tab own copy' }];
    const second = await service.open({
      user,
      prompt: 'And the second supplier?',
      clientSessionId: first.sessionId,
      fallbackHistory: clientHeld,
    });

    // The pre-persistence path is unchanged: a client that sent a history is
    // authoritative on it. Only silence is answered from the store.
    expect(second.fromServer).toBe(false);
    expect(second.history).toEqual(clientHeld);
  });
});

// ─── Whose copy of the history is the fresher one ─────────────────────────────

/**
 * `continueById` prefers the stored resume state, and that is right up to the
 * point where the stored copy is the STALE one — which this service arranges
 * itself. A turn whose row could not be opened rolls back its own `turnCount`
 * increment and comes back with no `conversationId`, so `close()` is a no-op and
 * the conversation's resume state stays on the turn before it. The run happened;
 * the client has its messages. Nothing in the sequence guard can see the gap,
 * because the rolled-back turn moved no counter.
 *
 * Both arrays are the same array — `RunResult.messages`, seeded from the history
 * the run was given and only ever pushed onto — so length is how many turns of
 * one lineage each side is holding, and the rule is that the longer copy wins
 * with ties to the server.
 */
describe('a turn the store failed to record survives into the next one', () => {
  const throughTurnOne: ModelMessage[] = [
    { role: 'user', content: ASKED },
    { role: 'assistant', content: [{ type: 'text', text: 'Mwanza Traders and two others.' }] },
  ];

  it('resumes from the client’s copy when the stored one is a turn behind', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ messages: throughTurnOne }));
    const afterTurnOne = prisma.conversations[0].resumeState;

    // Turn two, with the turn insert failing. `open()` still hands back the
    // history and the session id, so the run happens and the user gets their
    // answer — it is only the ROW that is missing.
    jest
      .spyOn(prisma.msaidiziConversationTurn, 'create')
      .mockRejectedValueOnce(new Error('deadlock detected'));
    const degraded = await service.open({
      user,
      prompt: 'How much does Mwanza Traders owe?',
      conversationId: first.conversationId,
      clientSequence: first.sequence,
    });
    expect(degraded.conversationId).toBeUndefined();

    const throughTurnTwo: ModelMessage[] = [
      ...degraded.history,
      { role: 'user', content: 'How much does Mwanza Traders owe?' },
      { role: 'assistant', content: [{ type: 'text', text: 'TZS 4,180,000.' }] },
    ];
    await service.close(degraded, runResult({ messages: throughTurnTwo }));

    // The store really is a turn behind, and that is measured rather than
    // assumed: the ciphertext is byte-identical to what turn one left, and the
    // rolled-back increment left the turn count where it was — which is why the
    // 409 guard above has nothing to say about this request.
    expect(prisma.conversations[0].resumeState).toBe(afterTurnOne);
    expect(prisma.conversations[0].turnCount).toBe(1);

    const third = await service.open({
      user,
      prompt: 'And the oldest invoice?',
      conversationId: first.conversationId,
      // Unchanged, because the degraded turn reported no sequence for the client
      // to move onto. Same claim, same turn count, and only the arrays differ.
      clientSequence: first.sequence,
      fallbackHistory: throughTurnTwo,
    });

    // The turn the store lost is in the model's memory anyway. Taking the stored
    // copy here would hand the model a conversation in which the second question
    // was never asked — and on the run that matters, an approval for a proposal
    // it can no longer see.
    expect(third.fromServer).toBe(false);
    expect(third.history).toEqual(throughTurnTwo);
  });

  it('still prefers the stored state when the client is the one that is behind', async () => {
    const { service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ messages: throughTurnOne }));

    const second = await service.open({
      user,
      prompt: 'How much does Mwanza Traders owe?',
      conversationId: first.conversationId,
      clientSequence: first.sequence,
    });
    const throughTurnTwo: ModelMessage[] = [
      ...second.history,
      { role: 'user', content: 'How much does Mwanza Traders owe?' },
      { role: 'assistant', content: [{ type: 'text', text: 'TZS 4,180,000.' }] },
    ];
    await service.close(second, runResult({ messages: throughTurnTwo }));

    // The socket died while the large `result` frame was being written, so this
    // tab never took turn two into its own history. The server committed it
    // before sending the frame, so the server is the copy with the answer in it.
    const third = await service.open({
      user,
      prompt: 'And the oldest invoice?',
      conversationId: first.conversationId,
      clientSequence: second.sequence,
      fallbackHistory: throughTurnOne,
    });

    expect(third.fromServer).toBe(true);
    expect(third.history).toEqual(throughTurnTwo);
  });

  it('breaks a tie in the stored copy’s favour', async () => {
    const { service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ messages: throughTurnOne }));

    // Same number of messages, different content: the client is not ahead of
    // anything, so there is nothing here that the stored state is missing, and
    // the copy that survives this tab closing is the one that is used.
    const sameLength: ModelMessage[] = [
      { role: 'user', content: ASKED },
      { role: 'assistant', content: [{ type: 'text', text: 'a copy from somewhere else' }] },
    ];
    const second = await service.open({
      user,
      prompt: 'And the oldest invoice?',
      conversationId: first.conversationId,
      clientSequence: first.sequence,
      fallbackHistory: sameLength,
    });

    expect(second.fromServer).toBe(true);
    expect(second.history).toEqual(throughTurnOne);
  });
});

/**
 * The case the length comparison above cannot reach.
 *
 * `close()` failing is not `appendTurn()` failing. The row exists, `turnCount`
 * moved, and the run reported `done` normally because `close()` swallows its own
 * failures — so the client sees a conversation id and a verdict, concludes the
 * server has this turn, and deliberately sends no history of its own. One copy
 * reaches `continueById`, and it is the stale one. There is no second array to
 * be longer.
 *
 * The trace that says so is the turn row: `reason` is written as `'running'` when
 * the row is opened and only `close()` overwrites it, so a newest row still
 * reading `'running'` is the failure's own signature. The answer is a refusal
 * with words in it, because the alternative is appending the user's approval to
 * a conversation whose stored memory never contained the proposal.
 */
/**
 * `close()`'s transaction failing, as a real database would fail it.
 *
 * The double's ARRAY `$transaction` is not atomic — its promises have already
 * run by the time it sees them — so failing only the turn update models a
 * database that committed half the batch, which is not one this service can
 * meet. Postgres rolls the whole thing back: the turn keeps `reason: 'running'`
 * AND the conversation keeps the previous turn's resume state. Both writes are
 * therefore refused before they mutate anything, which reproduces that end state
 * exactly.
 *
 * Module-scope because both continuation paths are guarded against the state it
 * produces, and a helper living inside one path's describe is how the other's
 * guard went unwritten.
 */
function failClose(prisma: FakePrisma): () => void {
  prisma.failTurnUpdate = true;
  const spy = jest
    .spyOn(prisma.msaidiziConversation, 'update')
    .mockRejectedValueOnce(new Error('deadlock detected'));
  return () => {
    prisma.failTurnUpdate = false;
    spy.mockRestore();
  };
}

/**
 * Backdates a turn row's `startedAt` to yesterday — the deploy, OOM or pod
 * eviction that killed the run, a day ago.
 *
 * Nothing in the backend ever rewrites `reason`, so the row is left reading
 * `'running'`: this is the trace as the failure left it, aged, not a row edited
 * into a different verdict.
 */
function abandon(prisma: FakePrisma, sequence: number): void {
  const row = prisma.turns.find((t) => t.sequence === sequence);
  if (!row) throw new Error(`No turn at sequence ${sequence} to abandon.`);
  row.startedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
}

describe('a conversation whose last turn was never closed is not resumed from', () => {
  const throughTurnOne: ModelMessage[] = [
    { role: 'user', content: ASKED },
    { role: 'assistant', content: [{ type: 'text', text: 'Mwanza Traders and two others.' }] },
  ];

  it('refuses in words rather than resuming from a state a turn behind', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ messages: throughTurnOne }));
    const afterTurnOne = prisma.conversations[0].resumeState;

    // Turn two runs and answers. Its row was opened, so the client's `session`
    // frame carried a conversation id; only `close()`'s transaction fails.
    const second = await service.open({
      user,
      prompt: 'How much does Mwanza Traders owe?',
      conversationId: first.conversationId,
      clientSequence: first.sequence,
    });
    const restore = failClose(prisma);
    await service.close(
      second,
      runResult({
        messages: [
          ...second.history,
          { role: 'user', content: 'How much does Mwanza Traders owe?' },
          { role: 'assistant', content: [{ type: 'text', text: 'TZS 4,180,000.' }] },
        ],
      }),
    );
    restore();

    // Measured, not assumed: the counter moved, the resume state did not, and
    // the row is still open. That is the whole shape of the defect.
    expect(prisma.conversations[0].turnCount).toBe(2);
    expect(prisma.conversations[0].resumeState).toBe(afterTurnOne);
    expect(prisma.turns.find((t) => t.sequence === 2)?.reason).toBe('running');

    // The client withholds its array here — it believes the server has the turn
    // — so this is the request that would otherwise resume from a state that
    // never saw turn two.
    const conflict = await conflictBody(() =>
      service.open({
        user,
        prompt: 'Yes, go ahead',
        conversationId: first.conversationId,
        clientSequence: second.sequence,
      }),
    );
    // The transient one, and it has to be labelled as such: it is the only 409
    // here the client may honestly offer a retry for, and the label is what
    // tells it apart from the one above now that prose no longer does.
    expect(conflict.code).toBe('unfinished_turn');
    expect(conflict.message).toContain('clears by itself');

    // And it refused instead of half-doing it: no third turn was opened.
    expect(prisma.conversations[0].turnCount).toBe(2);
  });

  it('still runs when the client is holding the turn the store lost', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ messages: throughTurnOne }));

    const second = await service.open({
      user,
      prompt: 'How much does Mwanza Traders owe?',
      conversationId: first.conversationId,
      clientSequence: first.sequence,
    });
    const throughTurnTwo: ModelMessage[] = [
      ...second.history,
      { role: 'user', content: 'How much does Mwanza Traders owe?' },
      { role: 'assistant', content: [{ type: 'text', text: 'TZS 4,180,000.' }] },
    ];
    const restore = failClose(prisma);
    await service.close(second, runResult({ messages: throughTurnTwo }));
    restore();

    // Same unfinished row as above. The difference is entirely on the wire: this
    // client sent the turn the store is missing, so refusing would throw away
    // the repair rather than prevent the harm. The guard is scoped to the path
    // that would have taken the server's copy, and this is not that path.
    const third = await service.open({
      user,
      prompt: 'And the oldest invoice?',
      conversationId: first.conversationId,
      clientSequence: second.sequence,
      fallbackHistory: throughTurnTwo,
    });

    expect(third.fromServer).toBe(false);
    expect(third.history).toEqual(throughTurnTwo);
    expect(prisma.conversations[0].turnCount).toBe(3);
  });

  it('does not refuse a healthy conversation', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ messages: throughTurnOne }));

    // The guard reads a real row here — the double models `findUnique` — so this
    // is the check passing, not the check being skipped.
    expect(prisma.turns.find((t) => t.sequence === 1)?.reason).toBe('end_turn');

    const second = await service.open({
      user,
      prompt: 'And the oldest invoice?',
      conversationId: first.conversationId,
      clientSequence: first.sequence,
    });

    expect(second.fromServer).toBe(true);
    expect(second.history).toEqual(throughTurnOne);
  });

  /**
   * The other half of "not yet", and the reason the refusal above is survivable.
   *
   * `reason` is written once at row creation and overwritten only by `close()`,
   * an in-memory handle that dies with the process. No sweep clears it, and
   * `close()` holds the only `msaidiziConversationTurn.update` in the backend. So
   * a run killed outright — a deploy, an OOM, a pod eviction, or the `askStream`
   * catch that deliberately leaves the row open as the trace of a run that never
   * reported back — leaves a row nothing will ever close, and a guard with no
   * clock reads it as "still writing" for the life of the row. Every later turn
   * of that conversation is then refused, permanently, under a sentence telling
   * the user to reload and wait.
   *
   * Deliberately the SAME request shape the refusal test uses — continued by id,
   * no `fallbackHistory`, so the stored copy is what this turn will run on. Only
   * the age of the abandoned row differs, which is the whole of what changed.
   */
  it('lets the conversation on once that turn is too old to still be running', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ messages: throughTurnOne }));

    const second = await service.open({
      user,
      prompt: 'How much does Mwanza Traders owe?',
      conversationId: first.conversationId,
      clientSequence: first.sequence,
    });
    const restore = failClose(prisma);
    await service.close(
      second,
      runResult({
        messages: [
          ...second.history,
          { role: 'user', content: 'How much does Mwanza Traders owe?' },
          { role: 'assistant', content: [{ type: 'text', text: 'TZS 4,180,000.' }] },
        ],
      }),
    );
    restore();
    expect(prisma.turns.find((t) => t.sequence === 2)?.reason).toBe('running');

    // The process that would have closed it died yesterday.
    abandon(prisma, 2);

    // `fallbackHistory: []` rather than an absent field, because that is what
    // `MsaidiziController.openTurn` actually sends — `dto.history ?? []` — and a
    // fixture that only ever omits the key would not notice a guard that started
    // keying off the difference. The refusal test above covers the absent form.
    const third = await service.open({
      user,
      prompt: 'Yes, go ahead',
      conversationId: first.conversationId,
      clientSequence: second.sequence,
      fallbackHistory: [],
    });

    // It resumed, and it resumed from the STORE — not from an empty array a
    // failing decode would also have produced. One turn short, which is where
    // this conversation stood before the guard existed and is survivable in a
    // way a permanently dead thread is not.
    expect(third.fromServer).toBe(true);
    expect(third.history).toEqual(throughTurnOne);
    expect(prisma.conversations[0].turnCount).toBe(3);

    // And the trace is still the trace. The row is the record of an incident,
    // not a lock, so nothing here rewrites it into a verdict it never reported.
    expect(prisma.turns.find((t) => t.sequence === 2)?.reason).toBe('running');
    expect(prisma.turns.find((t) => t.sequence === 2)?.endedAt).toBeNull();
  });
});

// ─── The same refusal on the session path ─────────────────────────────────────

/**
 * `continueBySession` resumes from stored state whenever the client sent no
 * history of its own, so it can hand a run the same stale array `continueById`
 * refuses to — and it is the path every procedure approval takes, because
 * `ProceduresController.openTurn` never sends a `fallbackHistory` at all.
 *
 * The guard is not a copy of the length comparison, which genuinely has nothing
 * to compare on this path. It reads the store, so it needs no second copy.
 */
describe('the session path refuses the same stale state, and on the same clock', () => {
  const throughTurnOne: ModelMessage[] = [
    { role: 'user', content: ASKED },
    { role: 'assistant', content: [{ type: 'text', text: 'Mwanza Traders and two others.' }] },
  ];

  /** A conversation whose turn two ran, answered, and never got recorded. */
  async function withLostTurnTwo() {
    const { prisma, service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ messages: throughTurnOne }));
    const afterTurnOne = prisma.conversations[0].resumeState;

    // Opened on the session path, the way a procedure approval opens it.
    const second = await service.open({
      user,
      prompt: 'Post the payroll journal',
      clientSessionId: first.sessionId,
    });
    const throughTurnTwo: ModelMessage[] = [
      ...second.history,
      { role: 'user', content: 'Post the payroll journal' },
      { role: 'assistant', content: [{ type: 'text', text: 'May I post it?' }] },
    ];
    const restore = failClose(prisma);
    await service.close(second, runResult({ messages: throughTurnTwo }));
    restore();

    // The shape of the defect, measured rather than assumed.
    expect(prisma.conversations[0].turnCount).toBe(2);
    expect(prisma.conversations[0].resumeState).toBe(afterTurnOne);
    expect(prisma.turns.find((t) => t.sequence === 2)?.reason).toBe('running');

    return { prisma, service, user, first, throughTurnTwo };
  }

  it('refuses an approval that would be appended to a memory without the proposal', async () => {
    const { prisma, service, user, first } = await withLostTurnTwo();

    // Everything a procedure approval sends: the session id it was told to echo,
    // and nothing else. No conversation id, no history, no sequence.
    await expect(
      service.open({ user, prompt: 'Yes, go ahead', clientSessionId: first.sessionId }),
    ).rejects.toBeInstanceOf(ConflictException);

    // And in the shape the ask path sends, which is not the same shape: it
    // always passes `fallbackHistory: dto.history ?? []`, so the field is an
    // empty ARRAY rather than absent. Both are the client asserting nothing, and
    // a guard that read them differently would be guarding one caller only.
    await expect(
      service.open({
        user,
        prompt: 'Yes, go ahead',
        clientSessionId: first.sessionId,
        fallbackHistory: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.conversations[0].turnCount).toBe(2);
  });

  it('still runs when the client sent the turn the store lost', async () => {
    const { prisma, service, user, first, throughTurnTwo } = await withLostTurnTwo();

    // Bounding the guard: a client holding its own array is not about to be
    // handed a stale copy of anything, so refusing it would throw away the only
    // repair available.
    const third = await service.open({
      user,
      prompt: 'And the oldest invoice?',
      clientSessionId: first.sessionId,
      fallbackHistory: throughTurnTwo,
    });

    expect(third.fromServer).toBe(false);
    expect(third.history).toEqual(throughTurnTwo);
    expect(prisma.conversations[0].turnCount).toBe(3);
  });

  it('lets the conversation on once that turn is too old to still be running', async () => {
    const { prisma, service, user, first } = await withLostTurnTwo();

    abandon(prisma, 2);

    const third = await service.open({
      user,
      prompt: 'Yes, go ahead',
      clientSessionId: first.sessionId,
    });

    expect(third.fromServer).toBe(true);
    expect(third.history).toEqual(throughTurnOne);
    expect(third.sessionId).toBe(first.sessionId);
    expect(prisma.turns.find((t) => t.sequence === 2)?.reason).toBe('running');
  });

  it('does not refuse a healthy conversation on this path either', async () => {
    const { service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult({ messages: throughTurnOne }));

    const second = await service.open({
      user,
      prompt: 'And the oldest invoice?',
      clientSessionId: first.sessionId,
    });

    expect(second.fromServer).toBe(true);
    expect(second.history).toEqual(throughTurnOne);
  });
});

// ─── Whose session id a run is filed under ────────────────────────────────────

/**
 * The session id is the audit correlation key: whatever `open()` settles on is
 * what the agent runs under and what `capability-invoker` sends as the header
 * every `audit_logs` row of the run is stamped with.
 *
 * Both DTOs pin the field to `/^ms_[0-9a-f]{32}$/`, and that is a constraint on
 * SHAPE — any client with a random-hex generator satisfies it. So these tests do
 * not claim provenance. What they hold is the property the audit trail actually
 * needs, and the one the shape check cannot give: a caller cannot file its run
 * under an id that already names somebody else's conversation. The unique index
 * is the enforcement; a freshly minted id is the answer.
 *
 * The index is only enforcement where an insert is attempted, and the last two
 * tests here mark the edge where none is. They are boundary markers, not
 * approvals of the behaviour: read them together with `unverifiedSessionId()`.
 */
describe('a session id that already names a conversation is never adopted', () => {
  it('does not file one user’s run under another user’s session id', async () => {
    const { prisma, service } = makeService();
    const owner = authUser();
    const stranger = authUser({ id: 'user-B', email: 'b@itemba.local' });

    const first = await service.open({ user: owner, prompt: ASKED });
    await service.close(first, runResult());

    // The threat the DTO comments name: a well-formed id, read somewhere else.
    // It passes the shape check by construction — this server minted it.
    const intruding = await service.open({
      user: stranger,
      prompt: 'What did they look at?',
      clientSessionId: first.sessionId,
    });

    expect(intruding.sessionId).not.toBe(first.sessionId);
    expect(intruding.sessionId).toMatch(/^ms_[0-9a-f]{32}$/);
    // Unpersisted, because the id it asked for is taken: the run still happens,
    // under an id of this server's choosing, correlating to nothing of the
    // owner's.
    expect(intruding.conversationId).toBeUndefined();

    // And the owner's conversation is untouched — no turn of the stranger's was
    // filed into it, and its own key still means what it meant.
    expect(prisma.conversations).toHaveLength(1);
    expect(prisma.conversations[0].agentSessionId).toBe(first.sessionId);
    expect(prisma.conversations[0].turnCount).toBe(1);
  });

  it('does the same for a conversation its own author has deleted', async () => {
    const { service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult());
    await service.remove(first.conversationId!, user);

    // The row is gone from `scopeFor()` but its `agentSessionId` still occupies
    // the unique index, so this is the same collision. The cost is stated rather
    // than hidden: a red-tier approval still open in a stale tab recomputes its
    // confirmation ids off this fresh id and will not match. That is a thread
    // the author removed.
    const after = await service.open({
      user,
      prompt: 'Actually, one more thing',
      clientSessionId: first.sessionId,
    });

    expect(after.sessionId).not.toBe(first.sessionId);
    expect(after.sessionId).toMatch(/^ms_[0-9a-f]{32}$/);
  });

  it('keeps the client’s id when the insert failed for any other reason', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    jest
      .spyOn(prisma.msaidiziConversation, 'create')
      .mockRejectedValue(new Error('connection refused'));

    // The branch that must NOT be widened. A store that cannot be reached says
    // nothing about whose id this is, and the run still has to recompute the
    // red-tier confirmation ids the user approved — which it can only do under
    // the id they were derived from. Only a collision is evidence about the id.
    const carried = 'ms_0123456789abcdef0123456789abcdef';
    const opened = await service.open({ user, prompt: ASKED, clientSessionId: carried });

    expect(opened.sessionId).toBe(carried);
    expect(opened.conversationId).toBeUndefined();
  });

  it('still adopts one that names no conversation at all, which is the round trip', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    // What a client holds after a first turn whose row could not be written:
    // a session id this server handed it, naming no stored conversation. The
    // approval that follows has to run under it — `confirmationIdFor()` derives
    // every red-tier id from the session id, so replacing it here would recompute
    // ids that match nothing the user approved and suspend the run again, for
    // ever. Adopting it is also what makes the shape check the ONLY check on a
    // fresh id, which is why the comments on this field say shape and not
    // provenance.
    const carried = 'ms_0123456789abcdef0123456789abcdef';

    const opened = await service.open({ user, prompt: ASKED, clientSessionId: carried });

    expect(opened.sessionId).toBe(carried);
    expect(opened.conversationId).toBeDefined();
    expect(prisma.conversations[0].agentSessionId).toBe(carried);
  });

  it('documents the boundary: an unreadable store adopts the id with nothing checking it', async () => {
    // Where the guarantee above stops, and the reason the comments on
    // `OpenedTurn.sessionId` and `MsaidiziConversation.agentSessionId` are
    // conditional rather than absolute.
    //
    // The unique index rejects a stranger's id at INSERT. On this path there is
    // no insert: the read that would have resolved the id failed, so nothing is
    // offered to the index and the caller's own string is what the run — and
    // every `audit_logs` row it writes — is stamped with. The id below is
    // deliberately one that DOES name another user's conversation, which is the
    // case the absolute claimed could never happen.
    const { prisma, service } = makeService();
    const owner = authUser();
    const stranger = authUser({ id: 'user-B', email: 'b@itemba.local' });

    const theirs = await service.open({ user: owner, prompt: ASKED });
    await service.close(theirs, runResult());

    jest
      .spyOn(prisma.msaidiziConversation, 'findFirst')
      .mockRejectedValue(new Error('connection refused'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const opened = await service.open({
      user: stranger,
      prompt: 'post the payroll journal entry',
      clientSessionId: theirs.sessionId,
    });

    // Adopted verbatim, and the turn is unpersisted — no row of user B's is
    // written under user A's session id, because no row is written at all.
    expect(opened.sessionId).toBe(theirs.sessionId);
    expect(opened.conversationId).toBeUndefined();
    expect(prisma.conversations).toHaveLength(1);
    expect(prisma.conversations[0].userId).toBe(owner.id);

    // Not silent: this is the only record that a session id in the trail was
    // never checked against anything.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(theirs.sessionId));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not be checked'));
    warn.mockRestore();
  });

  it('says so on the conversation-id path too, where the id is pure decoration', async () => {
    // `continueById` normally takes the session id off the row it read, so the
    // client's copy is never consulted. When that read fails there is no row to
    // take it from and the client's value is adopted — same adoption, same
    // absence of any check, and it reaches the same audit header.
    const { prisma, service } = makeService();
    const user = authUser();

    const conversation = await service.open({ user, prompt: ASKED });
    await service.close(conversation, runResult());

    jest
      .spyOn(prisma.msaidiziConversation, 'findFirst')
      .mockRejectedValue(new Error('connection refused'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const carried = 'ms_0123456789abcdef0123456789abcdef';
    const opened = await service.open({
      user,
      prompt: 'and the August one?',
      conversationId: conversation.conversationId,
      clientSessionId: carried,
      fallbackHistory: [{ role: 'user', content: ASKED }],
    });

    expect(opened.sessionId).toBe(carried);
    expect(opened.conversationId).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(carried));
    warn.mockRestore();
  });
});

// ─── Retention ────────────────────────────────────────────────────────────────

describe('the retention sweep ages a conversation out without calling it too long', () => {
  it('destroys the working state and leaves `resumable` meaning what it says', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult());
    expect(prisma.conversations[0].resumable).toBe(true);

    // Past the 24-hour resume clock.
    prisma.conversations[0].resumeExpiresAt = new Date(Date.now() - 60_000);

    // The sweep rides the traffic the feature itself generates, so any question
    // anyone in the deployment asks runs it.
    await service.open({ user, prompt: 'An unrelated question' });

    const row = prisma.conversations.find((c) => c.id === first.conversationId)!;
    expect(row.resumeState).toBeNull();
    expect(row.resumeExpiresAt).toBeNull();
    // `resumable` answers "was there little enough of it to keep at all", a fact
    // about the conversation's size that does not change with time. Whether the
    // state is still there is answered by the two fields above.
    expect(row.resumable).toBe(true);

    expect((await service.list(user)).data.find((c) => c.id === first.conversationId)).toEqual(
      expect.objectContaining({ resumable: true, continuable: false }),
    );
  });

  it('tells the user its state expired rather than that the conversation is too long', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult());
    prisma.conversations[0].resumeExpiresAt = new Date(Date.now() - 60_000);

    // Two causes, two sentences, and the user does something different with
    // each: ordinary ageing happens again tomorrow and is nobody's doing, while
    // "too long" asks them to keep conversations shorter. Reporting the second
    // for the first invents an explanation for the common case.
    await expect(
      service.open({ user, prompt: 'Carry on', conversationId: first.conversationId }),
    ).rejects.toThrow(/working state has expired/);
    await expect(
      service.open({ user, prompt: 'Carry on', conversationId: first.conversationId }),
    ).rejects.toBeInstanceOf(GoneException);
  });
});

// ─── Procedure runs ───────────────────────────────────────────────────────────

describe('a procedure run is recorded, and is not a chat', () => {
  it('stays out of the chat rail while staying readable and counted', async () => {
    const { service } = makeService();
    const user = authUser();

    const chat = await service.open({ user, prompt: ASKED });
    await service.close(chat, runResult());
    const procedure = await service.open({
      user,
      prompt: 'Reconcile the supplier ledger.',
      procedureId: 'proc-7',
    });
    await service.close(procedure, runResult());

    // The rail is a list of chats: its empty state invites the user to ask
    // something, and clicking a row hydrates it into the composer to carry on.
    // A procedure run is neither, and continuing one as a chat would run inside
    // the full registry rather than the capability list a human approved it
    // with.
    const rail = await service.list(user);
    expect(rail.data.map((row) => row.id)).toEqual([chat.conversationId]);
    expect(rail.meta.total).toBe(1);

    // Nothing about the record is lost — only the affordance.
    const detail = await service.findOne(procedure.conversationId!, user);
    expect(detail.turns[0].procedureId).toBe('proc-7');
    expect((await service.oversight({}, user)).meta.total).toBe(2);
  });
});
