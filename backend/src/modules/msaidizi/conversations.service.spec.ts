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
import { MsaidiziConversationsService, OpenedTurn } from './conversations.service';
import { GRANT_ID, mintGrantId } from './dto/approval-grants';
import { ModelMessage } from './model-client';
import { MsaidiziConfig } from './msaidizi.config';
import {
  ApprovalGrant,
  ApprovalGrantClaim,
  ApprovalGrantStore,
  confirmationIdFor,
  MsaidiziEvent,
  RunResult,
} from './msaidizi.service';

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
      // Range comparison, which the approval ledger's spend depends on:
      // `expiresAt: { gt: now }` is the entire reason an expired grant cannot be
      // spent. A double that fell through to the equality branch below would
      // read the operator object as a value, never match, and pass the expiry
      // test for the wrong reason — while a double that ignored it would let
      // every expired grant through and pass nothing honestly.
      const range = condition as Record<string, unknown>;
      for (const [operator, bound] of Object.entries(range)) {
        if (!['gt', 'gte', 'lt', 'lte'].includes(operator)) continue;
        const left = time(value);
        const right = time(bound);
        if (operator === 'gt' && !(left > right)) return false;
        if (operator === 'gte' && !(left >= right)) return false;
        if (operator === 'lt' && !(left < right)) return false;
        if (operator === 'lte' && !(left <= right)) return false;
        return true;
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
  grants: Row[] = [];
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

    findFirst: async ({
      where,
      include,
      select,
    }: {
      where?: Row;
      include?: Row;
      select?: Record<string, boolean>;
    }) => {
      const row = this.conversations.find((c) => matches(this.joined(c), where));
      if (!row) return null;
      // `select` is honoured rather than ignored, for the reason the turn
      // lookup below states: the ledger's conversation resolution asks for
      // `turnCount` and files it on every grant as `turnSequence`, and a double
      // that returned whole rows would keep passing the day the service stopped
      // asking for it.
      if (select) return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
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
   * The approval ledger, and the one model here that offers NO way to read a
   * row.
   *
   * That omission is the test, not an economy. The spend has to be a single
   * conditional UPDATE whose row count is the verdict; the shape it must never
   * be is a read followed by a write, because two concurrent requests would both
   * read `usedAt: null` and both dispatch an irreversible action. A double with
   * a `findUnique` here would let that implementation exist and pass every test
   * except the concurrency one — so there is no `findUnique`, no `findFirst` and
   * no `findMany`, and a service that reached for one fails loudly rather than
   * subtly.
   *
   * `updateMany` applies its filter and its data with no `await` in between,
   * which is what makes it the atomic primitive the real statement is. Two
   * overlapping `spend()` calls interleave at their own awaits, and
   * the loser reads a row whose `usedAt` the winner has already set.
   */
  readonly msaidiziApprovalGrant = {
    create: async ({ data }: { data: Row }) => {
      // The FOREIGN KEY, modelled rather than assumed away. The store checks the
      // conversation itself before it writes, and this is what stops that check
      // being the only thing between a grant and a conversation that is not
      // there: an implementation that dropped the lookup would still have to
      // meet this, exactly as it would meet Postgres. Existence only — a
      // soft-deleted conversation is still a row, which is why refusing one is
      // the store's job and not the database's.
      if (!this.conversations.some((c) => c.id === data.conversationId)) {
        throw new Prisma.PrismaClientKnownRequestError(
          'Foreign key constraint failed on the field: `conversationId`',
          { code: 'P2003', clientVersion: 'test', meta: { field_name: 'conversationId' } },
        );
      }
      // The primary key arrives with the data. It is not defaulted here because
      // the id IS the grant — a nonce the agent loop mints before it emits the
      // proposal that carries it — and a double that generated its own would be
      // testing a different mechanism.
      if (this.grants.some((g) => g.id === data.id)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on `id`', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['id'] },
        });
      }
      const row: Row = { usedAt: null, createdAt: new Date(), ...data };
      this.grants.push(row);
      return row;
    },

    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = this.grants.filter((g) => matches(g, where));
      rows.forEach((row) => applyData(row, data));
      return { count: rows.length };
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

    if (sql.startsWith('DELETE FROM "msaidizi_approval_grants"')) {
      // Modelled rather than left to throw, and not only so the sweep completes:
      // an approval ledger swept by nothing is a table that grows for ever, and
      // a double that ignored this statement would let the sweep silently stop
      // covering it. The expiry the SPEND enforces is a separate mechanism and
      // is tested separately — deliberately, because a ledger whose expiry lived
      // only in a bounded, swallowed sweep would honour approvals for as long as
      // the sweep fell behind.
      const doomed = this.grants.filter((row) => time(row.expiresAt) < Date.now());
      const ids = new Set(doomed.map((row) => row.id));
      this.grants = this.grants.filter((row) => !ids.has(row.id));
      return doomed.length;
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
      // Grants cascade with the conversation, exactly as the foreign key says.
      // A deleted conversation must not leave a spendable approval behind.
      this.grants = this.grants.filter((grant) => !ids.has(grant.conversationId));
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
 * A second service over the same store — a LATER REQUEST, or another process.
 *
 * The limit this ledger exists to close was an in-memory `Set` inside one
 * `run()`: an approval that died at the request boundary, so re-sending the same
 * id tomorrow bought another execution. A test that spends twice through one
 * service instance cannot tell a durable ledger from an instance-level one, so
 * every "later request" test below goes through a service that has never seen
 * the first call. The store is the only thing the two share.
 */
function laterRequest(prisma: FakePrisma) {
  return new MsaidiziConversationsService(
    prisma as unknown as PrismaService,
    configFor(),
    encryption(),
  );
}

/**
 * The argument digest, produced by the real thing.
 *
 * `confirmationIdFor` is imported rather than stubbed because its canonical
 * encoding is the half of this that has already failed review once: a replacer
 * array passed to `JSON.stringify` emptied every NESTED object, so
 * `{body:{invoiceId:41}}` and `{body:{invoiceId:42}}` hashed the same and one
 * approval authorised any later action of the same tool. The ledger only ever
 * compares digests for equality, so a stubbed digest would test string equality
 * and nothing else — and the fixtures below differ only DEEP inside a body,
 * which is exactly the shape a flat fixture would have hidden.
 */
function digestOf(toolName: string, args: Record<string, unknown>): string {
  return confirmationIdFor('ms_ledger_digest', toolName, args);
}

const POST_JOURNAL = 'JournalEntries_post';

/** TZS 900,000 of rent, posted. */
const RENT_900K = {
  body: {
    memo: 'Rent — August',
    lines: [
      { account: '6000', debit: 900_000 },
      { account: '1000', credit: 900_000 },
    ],
  },
};

/** The same journal with a zero added, differing nowhere but inside the lines. */
const RENT_9M = {
  body: {
    memo: 'Rent — August',
    lines: [
      { account: '6000', debit: 9_000_000 },
      { account: '1000', credit: 9_000_000 },
    ],
  },
};

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

  /**
   * A STORED PROPOSAL MUST STILL BE APPROVABLE, and nothing else asserted that.
   *
   * `redactEvents()` keeps `grantId` today only because it rebuilds each event
   * as `{ ...event, args: redact(event.args) }` — a spread, which preserves
   * every field it does not name. That is a property of how the function
   * happens to be written, not of anything the build checks, and this codebase
   * has already paid twice for the opposite shape: an allowlist copy that
   * silently dropped `conversationId` and `sequence` on their way out.
   *
   * Rewrite this as an allowlist that forgets `grantId` and the damage is
   * invisible here and total in the product. Every reopened suspended
   * conversation replays its proposals with no grant id, the client's gate
   * correctly refuses to offer an approval it cannot name, and the user is told
   * each proposal 'cannot be approved from here' for ever. It would read as a
   * UI bug and be a storage bug, so the assertion belongs on the storage side.
   *
   * The round trip is the whole path — redact, encrypt, store, decrypt, read
   * back — because the claim is about what a later request can spend, not about
   * one function's return value.
   */
  it('keeps grantId on a stored confirmation_required, so a reopened proposal is still approvable', async () => {
    const { service } = makeService();
    const user = authUser();
    const grantId = mintGrantId();

    const proposal: MsaidiziEvent[] = [
      {
        type: 'confirmation_required',
        grantId,
        confirmationId: 'cnf_whatever',
        tool: 'Payments_create',
        capabilityId: 'PaymentsController.create',
        description: 'Pay TZS 9,000,000 to Neema Supplies',
        args: { body: { amount: 9_000_000, password: 'hunter2' } },
      },
    ];

    const opened = await service.open({ user, prompt: 'Pay Neema Supplies' });
    await service.close(opened, runResult({ events: proposal }));

    const stored = await service.findOne(opened.conversationId!, user);
    const replayed = stored.turns[0].events[0] as unknown as {
      type: string;
      grantId?: string;
      args: { body: Record<string, unknown> };
    };

    expect(replayed.type).toBe('confirmation_required');
    // The grant id is the only thing a client can send back as an approval, so
    // it must survive verbatim — not merely be present.
    expect(replayed.grantId).toBe(grantId);
    expect(replayed.grantId).toMatch(GRANT_ID);

    // And it survives WITHOUT the redaction having been weakened to achieve it:
    // the proposal's own body is still scrubbed on the way to rest.
    expect(replayed.args.body.password).toBe('[REDACTED]');
    expect(replayed.args.body.amount).toBe(9_000_000);
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
 * Five comments in this module used to call it server-minted while the code
 * adopted whatever a request carried, checked only against
 * `/^ms_[0-9a-f]{32}$/` — a constraint on SHAPE that any client with a
 * random-hex generator satisfies. These tests hold the claim the comments now
 * make: THE SERVER MINTS IT. A client-supplied id is honoured in exactly one
 * case, that it resolves through `scopeFor()` to a conversation this caller
 * owns, in which case the value honoured is that row's own — minted here on an
 * earlier turn. Every other case mints fresh.
 *
 * Ignored, never rejected, and that half is tested too: a stale id in a reopened
 * tab is ordinary, and failing a user's question over one would be worse than
 * re-identifying the run.
 *
 * What made adoption look unavoidable until now was that red-tier confirmation
 * ids were DERIVED from this value, so a fresh mint mid-approval recomputed
 * every id an approval could match. Approvals are grants now — server-issued
 * nonces bound to a conversation and an argument digest — so nothing is owed to
 * continuity of this string.
 */
describe('the server mints the session id; a client’s is honoured only when it resolves', () => {
  it('honours one that resolves to a conversation this caller owns, which is the round trip', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult());

    // The ordinary case, and the only one where the request's id survives: it
    // names this caller's own conversation, so the id honoured is the column's
    // own value.
    const second = await service.open({
      user,
      prompt: 'And the August one?',
      clientSessionId: first.sessionId,
    });

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.conversationId).toBe(first.conversationId);
    expect(prisma.conversations).toHaveLength(1);
  });

  it('ignores one that names no conversation at all, and mints instead', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    // What a client holds after a first turn whose row could not be written: a
    // well-formed id naming nothing stored. It used to be ADOPTED — the run, and
    // every audit row it wrote, carried a string this server had not issued to
    // this caller — because red-tier confirmation ids were derived from it and
    // replacing it re-asked the user for ever. The ledger removed that debt.
    const carried = 'ms_0123456789abcdef0123456789abcdef';

    const opened = await service.open({ user, prompt: ASKED, clientSessionId: carried });

    expect(opened.sessionId).not.toBe(carried);
    expect(opened.sessionId).toMatch(/^ms_[0-9a-f]{32}$/);
    // Ignored, not rejected: the question is answered, and the conversation is
    // stored under the id this server chose.
    expect(opened.conversationId).toBeDefined();
    expect(prisma.conversations[0].agentSessionId).toBe(opened.sessionId);
  });

  it('ignores another user’s id rather than filing this run under it', async () => {
    const { prisma, service } = makeService();
    const owner = authUser();
    const stranger = authUser({ id: 'user-B', email: 'b@itemba.local' });

    const first = await service.open({ user: owner, prompt: ASKED });
    await service.close(first, runResult());

    // The threat the DTO's shape check cannot see: a well-formed id, read
    // somewhere else. It passes the pattern by construction — this server minted
    // it, for somebody else.
    const intruding = await service.open({
      user: stranger,
      prompt: 'What did they look at?',
      clientSessionId: first.sessionId,
    });

    expect(intruding.sessionId).not.toBe(first.sessionId);
    expect(intruding.sessionId).toMatch(/^ms_[0-9a-f]{32}$/);

    // The stranger's own question is still answered and still stored — under the
    // server's id, in a conversation of their own. Nothing of theirs was filed
    // into the owner's thread and no audit row of theirs carries the owner's key.
    expect(intruding.conversationId).toBeDefined();
    expect(intruding.conversationId).not.toBe(first.conversationId);
    expect(prisma.conversations).toHaveLength(2);
    const theirs = prisma.conversations.find((row) => row.id === intruding.conversationId)!;
    expect(theirs.userId).toBe(stranger.id);
    expect(theirs.agentSessionId).toBe(intruding.sessionId);

    // And the owner's conversation is untouched.
    const owned = prisma.conversations.find((row) => row.id === first.conversationId)!;
    expect(owned.agentSessionId).toBe(first.sessionId);
    expect(owned.turnCount).toBe(1);
  });

  it('ignores one naming a conversation its own author has deleted', async () => {
    const { service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult());
    await service.remove(first.conversationId!, user);

    // `scopeFor()` does not match the soft-deleted row, so the id resolves to
    // nothing and a fresh conversation is started under a fresh id — rather than
    // the question being filed back into a thread the user has just removed.
    const after = await service.open({
      user,
      prompt: 'Actually, one more thing',
      clientSessionId: first.sessionId,
    });

    expect(after.sessionId).not.toBe(first.sessionId);
    expect(after.sessionId).toMatch(/^ms_[0-9a-f]{32}$/);
    expect(after.conversationId).not.toBe(first.conversationId);
  });

  it('ignores one naming a conversation filed under a company the author has lost', async () => {
    const { service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: ASKED });
    await service.close(first, runResult());

    // Same person, later, without access to company-A. `scopeFor()` applies the
    // company clause in addition to authorship, so their own id resolves to
    // nothing and the run is re-identified rather than continuing a thread they
    // can no longer read.
    const moved = authUser({ companyId: 'company-B', companyAccess: [] });
    const after = await service.open({
      user: moved,
      prompt: 'Carry on',
      clientSessionId: first.sessionId,
    });

    expect(after.sessionId).not.toBe(first.sessionId);
  });

  it('mints when the store cannot be read, rather than adopting an id nothing checked', async () => {
    // The case that used to be the acknowledged hole, and the reason the
    // comments on `OpenedTurn.sessionId` and `MsaidiziConversation.agentSessionId`
    // were conditional. The read that would have resolved the id is the read
    // that failed, so nothing could check it — and it was taken anyway, which
    // meant two users' audit rows could share a correlation key during an
    // outage. The id below is deliberately one that DOES name another user's
    // conversation.
    const { prisma, service } = makeService();
    const owner = authUser();
    const stranger = authUser({ id: 'user-B', email: 'b@itemba.local' });

    const theirs = await service.open({ user: owner, prompt: ASKED });
    await service.close(theirs, runResult());

    jest
      .spyOn(prisma.msaidiziConversation, 'findFirst')
      .mockRejectedValue(new Error('connection refused'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const opened = await service.open({
      user: stranger,
      prompt: 'post the payroll journal entry',
      clientSessionId: theirs.sessionId,
    });

    // Re-identified. The run still happens — unpersisted, because the store is
    // down — and its audit rows carry an id this server minted for it.
    expect(opened.sessionId).not.toBe(theirs.sessionId);
    expect(opened.sessionId).toMatch(/^ms_[0-9a-f]{32}$/);
    expect(opened.conversationId).toBeUndefined();
    expect(prisma.conversations).toHaveLength(1);
    expect(prisma.conversations[0].userId).toBe(owner.id);
    error.mockRestore();
  });

  it('does the same on the conversation-id path, where the id is pure decoration', async () => {
    // `continueById` normally takes the session id off the row it read, so the
    // client's copy is never consulted. When that read fails there is no row to
    // take it from — and the answer is a mint, not the client's string.
    const { prisma, service } = makeService();
    const user = authUser();

    const conversation = await service.open({ user, prompt: ASKED });
    await service.close(conversation, runResult());

    jest
      .spyOn(prisma.msaidiziConversation, 'findFirst')
      .mockRejectedValue(new Error('connection refused'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const carried = 'ms_0123456789abcdef0123456789abcdef';
    const opened = await service.open({
      user,
      prompt: 'and the August one?',
      conversationId: conversation.conversationId,
      clientSessionId: carried,
      fallbackHistory: [{ role: 'user', content: ASKED }],
    });

    expect(opened.sessionId).not.toBe(carried);
    expect(opened.sessionId).toMatch(/^ms_[0-9a-f]{32}$/);
    expect(opened.conversationId).toBeUndefined();
    error.mockRestore();
  });

  it('mints when the insert fails for any other reason', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest
      .spyOn(prisma.msaidiziConversation, 'create')
      .mockRejectedValue(new Error('connection refused'));

    // A store that cannot be reached says nothing about whose id this is — and
    // that used to be the argument for keeping it, because the run had to
    // recompute the confirmation ids the user approved and could only do so
    // under the id they were derived from. It no longer does.
    const carried = 'ms_0123456789abcdef0123456789abcdef';
    const opened = await service.open({ user, prompt: ASKED, clientSessionId: carried });

    expect(opened.sessionId).not.toBe(carried);
    expect(opened.sessionId).toMatch(/^ms_[0-9a-f]{32}$/);
    expect(opened.conversationId).toBeUndefined();
    error.mockRestore();
  });

  it('does not run under a minted id that already names a conversation', async () => {
    // The backstop, exercised by forcing the collision the unique index exists
    // for. It is unreachable in practice now — every id offered to this insert
    // is one `randomUUID()` just produced — but the branch is what stops a
    // colliding id being run under, whatever produced it.
    const { prisma, service } = makeService();
    const user = authUser();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const first = await service.open({ user, prompt: ASKED });
    jest.spyOn(prisma.msaidiziConversation, 'create').mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`agentSessionId`)',
        { code: 'P2002', clientVersion: 'test', meta: { target: ['agentSessionId'] } },
      );
    });

    const opened = await service.open({ user, prompt: 'A brand new thread' });

    expect(opened.conversationId).toBeUndefined();
    expect(opened.sessionId).toMatch(/^ms_[0-9a-f]{32}$/);
    expect(opened.sessionId).not.toBe(first.sessionId);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already names a conversation'));
    warn.mockRestore();
    error.mockRestore();
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

// ─── The approval ledger ──────────────────────────────────────────────────────

/**
 * The two limits this ledger closes, and the shape of every test below.
 *
 * A red-tier approval used to be `confirmationIdFor(sessionId, toolName, args)`
 * — a value DERIVED from three things the caller supplies on the same request
 * that claims them approved. So:
 *
 *   (a) the spend was an in-memory `Set` inside one `run()` and died at the
 *       request boundary. Re-sending the same id on a LATER request bought
 *       another execution of the same irreversible action.
 *   (b) an approval was never bound to a proposal having been made. Nothing on
 *       the server had issued the id, so nothing could recognise one.
 *
 * A grant is the other shape: the server issues it when it proposes and spends
 * it when it dispatches.
 *
 * ─── THREE ANSWERS, NOT TWO ──────────────────────────────────────────────────
 *
 * These tests are at the ledger's own level rather than `run()`'s, so they read
 * the ledger's answers as the loop reads them:
 *
 *   `spend()` resolving `true`   IS "dispatch".
 *   `spend()` resolving `false`  IS "propose it again under a fresh grant" —
 *                                and it says the ledger ANSWERED.
 *   either method REJECTING      IS "the ledger could not be asked", which the
 *                                loop reports as unavailable and dispatches
 *                                nothing on.
 *
 * The third answer is the one the store could not previously express: it caught
 * its own failures and reported `false`, so an outage arrived at the loop
 * wearing the face of a refusal — and the loop's response to a refusal is to
 * propose the action again, which needs a WRITE to the same ledger that just
 * failed. The user would be asked to approve something that could never be
 * recorded, once per turn, for as long as the outage lasted. Every test in the
 * last describe below exists to keep those two answers apart.
 *
 * THE FIXTURE SHAPES THAT MATTER, stated because the ones that were missing are
 * how four earlier defects in this effort survived review:
 *
 *   - the same action across two REQUESTS, through a service that never saw the
 *     first one (`laterRequest`). An instance-level spend passes every
 *     single-instance test there is.
 *   - a repeat that is IDENTICAL, not "different". The rule that makes a durable
 *     deny list wrong is that the same weekly journal produces the same derived
 *     id, and a test whose second action differs never exercises it.
 *   - arguments differing only DEEP inside a body, so the digest is asked for
 *     something a flat fixture would not ask of it.
 *   - concurrency, and a grant crossing a conversation or a user boundary.
 *   - a store that THROWS rather than answering. A double that only ever answers
 *     cannot tell a ledger that reports its failures from one that hides them.
 */

/**
 * How long the loop's grants stay spendable (`GRANT_TTL_MS`, msaidizi.service.ts).
 *
 * A stand-in for the loop's clock, not this file's own: the store no longer owns
 * a TTL constant, and the test that issues on a deliberately odd expiry proves
 * it stores whatever instant it is handed rather than imposing one.
 */
const LOOP_GRANT_TTL_MS = 30 * 60_000;

/**
 * A proposal, exactly as the agent loop hands it to the ledger.
 *
 * The id is minted HERE — by `mintGrantId()`, the real one off the wire DTO —
 * because that is where it is minted in production: the loop needs the value for
 * the `confirmation_required` event it emits in the same breath, so it holds the
 * nonce before the row exists and the store is handed a finished grant. A
 * fixture that let the store mint would be testing a store that does not exist,
 * and would hide the seam this whole change is about.
 */
function proposal(
  opened: OpenedTurn,
  user: AuthUser,
  action: { toolName?: string; args: Record<string, unknown> },
  overrides: Partial<ApprovalGrant> = {},
): ApprovalGrant {
  const toolName = action.toolName ?? POST_JOURNAL;
  const createdAt = new Date();
  return {
    grantId: mintGrantId(),
    conversationId: opened.conversationId!,
    userId: user.id,
    toolName,
    argumentDigest: digestOf(toolName, action.args),
    proposedOnTurn: opened.sequence,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + LOOP_GRANT_TTL_MS),
    ...overrides,
  };
}

/**
 * The claim a dispatch makes against a grant it believes it holds.
 *
 * Built FROM the grant so that every honest claim matches in full and each test
 * has to say which single field it is bending — the conversation, the user, the
 * arguments, the clock. A claim assembled field by field per test would drift
 * from the grant for reasons no reader could see.
 */
function claimOn(
  grant: ApprovalGrant,
  overrides: Partial<ApprovalGrantClaim> = {},
): ApprovalGrantClaim {
  return {
    grantId: grant.grantId,
    conversationId: grant.conversationId,
    userId: grant.userId,
    toolName: grant.toolName,
    argumentDigest: grant.argumentDigest,
    now: new Date(),
    ...overrides,
  };
}

describe('an approval grant is issued on the proposal and spent on the dispatch', () => {
  it('is the port the agent loop injects, and answers through it', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });

    // Typed as the PORT, not as the class. The loop reaches this object through
    // `APPROVAL_GRANT_STORE`, which Nest resolves without checking anything, so
    // the only things standing between a divergence and a `TypeError` inside the
    // red-tier gate are this annotation, the `implements` clause on the service
    // and the return type on `approvalGrantStoreProvider`. Two agents built the
    // two halves of this contract to different names once already.
    const ledger: ApprovalGrantStore = service;

    const grant = proposal(opened, user, { args: RENT_900K });
    await expect(ledger.issue(grant)).resolves.toBeUndefined();
    expect(await ledger.spend(claimOn(grant))).toBe(true);
    expect(prisma.grants[0].usedAt).toBeInstanceOf(Date);
  });

  it('records the proposal it was handed, verbatim, against this conversation and turn', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });

    // A deliberately odd clock, and the point of it: the store has no TTL of its
    // own any more. The instant it writes is the loop's, and a store that
    // recomputed one — from a constant of its own, from `now()` — would silently
    // overrule the module that proposed the action.
    const grant = proposal(
      opened,
      user,
      { args: RENT_900K },
      { expiresAt: new Date(Date.now() + 97_000) },
    );
    await service.issue(grant);

    expect(prisma.grants).toHaveLength(1);
    expect(prisma.grants[0]).toEqual(
      expect.objectContaining({
        // The loop's nonce, not one this file minted. Unguessable, and its own
        // prefix: the id it replaced was `cnf_<tool>_<hash of things the caller
        // already holds>` — computable by anyone, which is why possession of one
        // proved nothing.
        id: grant.grantId,
        conversationId: opened.conversationId,
        userId: user.id,
        // The turn in flight, as the loop counted it.
        turnSequence: 1,
        toolName: POST_JOURNAL,
        argsDigest: digestOf(POST_JOURNAL, RENT_900K),
        createdAt: grant.createdAt,
        expiresAt: grant.expiresAt,
        usedAt: null,
      }),
    );
  });

  it('falls back to the conversation’s own turn count when the loop names no turn', async () => {
    // `proposedOnTurn` is optional on the port and the column is not. Zero would
    // be a lie in an audit column — the conversation's own counter is the turn
    // this proposal was made on, incremented under the row lock by `open()`.
    const { prisma, service } = makeService();
    const user = authUser();
    const first = await service.open({ user, prompt: 'Post the August rent journal' });
    await service.close(first, runResult());
    // The SECOND turn of the same conversation, so the fallback has a number to
    // be wrong about: on a fresh conversation `turnCount` is 1 and so is the
    // sequence, and the two are indistinguishable.
    const second = await service.open({
      user,
      prompt: 'And the September one',
      conversationId: first.conversationId,
    });
    expect(second.sequence).toBe(2);

    await service.issue(proposal(second, user, { args: RENT_900K }, { proposedOnTurn: undefined }));

    expect(prisma.grants[0].turnSequence).toBe(2);
  });

  it('approve once, execute once: the second spend of one grant loses', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });

    const grant = proposal(opened, user, { args: RENT_900K });
    await service.issue(grant);

    expect(await service.spend(claimOn(grant))).toBe(true);
    // One tick of one checkbox. Ten identical tool_use blocks against one
    // approved TZS 900,000 journal used to post TZS 9,000,000.
    expect(await service.spend(claimOn(grant))).toBe(false);
    expect(await service.spend(claimOn(grant))).toBe(false);

    expect(prisma.grants[0].usedAt).toBeInstanceOf(Date);
  });

  it('refuses the same grant re-sent on a LATER REQUEST — the durable half of the fix', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });

    const grant = proposal(opened, user, { args: RENT_900K });
    await service.issue(grant);
    expect(await service.spend(claimOn(grant))).toBe(true);

    // A second request — a service instance that has never seen the first, which
    // is what the next HTTP request gets. The in-memory Set this replaced would
    // be empty here, and would have said yes.
    expect(await laterRequest(prisma).spend(claimOn(grant))).toBe(false);
    expect(await laterRequest(prisma).spend(claimOn(grant))).toBe(false);
  });

  it('lets an IDENTICAL action later be approved again, on a new grant', async () => {
    // The case that rules out simply remembering derived ids as spent for ever.
    // The same weekly journal, posted again next week, produces the SAME derived
    // id — so a deny list would make a legitimate repeat permanently
    // unapprovable. Nothing about this action differs from the one before it.
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });

    const first = proposal(opened, user, { args: RENT_900K });
    await service.issue(first);
    expect(await service.spend(claimOn(first))).toBe(true);

    // A later turn proposes exactly the same thing again. Same tool, same
    // arguments, same digest — and a fresh nonce.
    const later = laterRequest(prisma);
    const second = proposal(opened, user, { args: RENT_900K });
    expect(second.grantId).not.toBe(first.grantId);
    await later.issue(second);
    expect(prisma.grants[1].argsDigest).toBe(prisma.grants[0].argsDigest);

    expect(await later.spend(claimOn(second))).toBe(true);
    // And the first is still spent — a new grant does not refresh an old one.
    expect(await later.spend(claimOn(first))).toBe(false);
  });

  it('spends one grant per action when two distinct proposals are approved together', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post both journals' });

    const small = proposal(opened, user, { args: RENT_900K });
    const large = proposal(opened, user, { args: RENT_9M });
    await service.issue(small);
    await service.issue(large);

    // One request approving both. The loop offers its candidates one at a time
    // and each dispatch has to find its OWN grant, which is the property the
    // ledger owns: the claim carries the digest of the action about to run.
    expect(await service.spend(claimOn(small))).toBe(true);
    expect(await service.spend(claimOn(large))).toBe(true);

    expect(prisma.grants.every((grant) => grant.usedAt instanceof Date)).toBe(true);
  });

  it('will not let a grant for one journal dispatch another', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });

    // TZS 900,000 is what was proposed, and what was approved.
    const small = proposal(opened, user, { args: RENT_900K });
    await service.issue(small);

    // TZS 9,000,000 is what turns up at the dispatch, holding the approved
    // grant's id. The two differ nowhere except inside `body.lines`, which is the
    // nesting a collapsed canonical encoding once flattened away — leaving one
    // approval good for any later action of the same tool.
    expect(
      await service.spend(claimOn(small, { argumentDigest: digestOf(POST_JOURNAL, RENT_9M) })),
    ).toBe(false);
    expect(prisma.grants[0].usedAt).toBeNull();

    // Nor by the tool alone: a grant for one capability cannot dispatch another,
    // and the digest is not the only field carrying that.
    expect(
      await service.spend(
        claimOn(small, {
          toolName: 'Payments_create',
          argumentDigest: digestOf('Payments_create', RENT_900K),
        }),
      ),
    ).toBe(false);
    expect(prisma.grants[0].usedAt).toBeNull();

    // The approval that WAS given still stands. Refusing the wrong action must
    // not quietly burn the right one.
    expect(await service.spend(claimOn(small))).toBe(true);
  });

  it('refuses a grant id the server never issued, including the derived form', async () => {
    const { service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });
    const never = proposal(opened, user, { args: RENT_900K });

    // Well-formed and invented — never issued, so there is no row to win.
    expect(await service.spend(claimOn(never))).toBe(false);

    // The old wire form: an id the caller computes from the three public inputs.
    // It was the whole of an approval once; it now names no row.
    expect(
      await service.spend(
        claimOn(never, {
          grantId: confirmationIdFor(opened.sessionId, POST_JOURNAL, RENT_900K),
        }),
      ),
    ).toBe(false);

    // And nothing at all is not an approval either. Answered without a query:
    // an id nobody sent names nothing, and that is a fact about the claim rather
    // than about the store.
    expect(await service.spend(claimOn(never, { grantId: '' }))).toBe(false);
  });
});

describe('a grant is spendable only inside the conversation, and by the user, it was issued to', () => {
  it('refuses a grant issued in another conversation of the same user', async () => {
    const { prisma, service } = makeService();
    const user = authUser();

    const first = await service.open({ user, prompt: 'Post the August rent journal' });
    await service.close(first, runResult());
    const second = await service.open({ user, prompt: 'Post the September rent journal' });

    const grant = proposal(first, user, { args: RENT_900K });
    await service.issue(grant);

    // Same person, same tool, same arguments — a different thread. An approval
    // given in one conversation is not an approval given in another, and the
    // digest alone cannot tell the two apart.
    expect(await service.spend(claimOn(grant, { conversationId: second.conversationId }))).toBe(
      false,
    );
    expect(prisma.grants[0].usedAt).toBeNull();
    // Still spendable where it was issued.
    expect(await service.spend(claimOn(grant))).toBe(true);
  });

  it('refuses another user, whether they reach for their own conversation or its owner’s', async () => {
    const { prisma, service } = makeService();
    const asha = authUser();
    const brian = authUser({ id: 'user-B', email: 'b@itemba.local', fullName: 'Brian' });

    const hers = await service.open({ user: asha, prompt: 'Post the August rent journal' });
    await service.close(hers, runResult());
    const his = await service.open({ user: brian, prompt: 'What do I owe?' });

    const grant = proposal(hers, asha, { args: RENT_900K });
    await service.issue(grant);

    // Under his own conversation: the grant is not filed there.
    expect(
      await service.spend(claimOn(grant, { conversationId: his.conversationId, userId: brian.id })),
    ).toBe(false);
    // Reaching into hers: that conversation is not his, so there is nothing to
    // look in — the same answer the rest of this service gives a non-author.
    expect(await service.spend(claimOn(grant, { userId: brian.id }))).toBe(false);

    expect(prisma.grants[0].usedAt).toBeNull();
    // And it is still hers to spend.
    expect(await service.spend(claimOn(grant))).toBe(true);
  });

  it('files no grant on a conversation that is not the claimed author’s', async () => {
    // The boundary held at ISSUE as well as at spend, and it has to be here to
    // be held at all: `spend()` compares the claim against the grant's own
    // `userId` column, so a row written under the wrong author would be spendable
    // by that same wrong author and the comparison would agree with itself. The
    // author is checked against the CONVERSATION, once, before the row exists.
    const { prisma, service } = makeService();
    const asha = authUser();
    const brian = authUser({ id: 'user-B', email: 'b@itemba.local', fullName: 'Brian' });

    const hers = await service.open({ user: asha, prompt: 'Post the August rent journal' });

    await expect(service.issue(proposal(hers, brian, { args: RENT_900K }))).rejects.toThrow(
      /not this caller's, or it has been removed/,
    );
    expect(prisma.grants).toHaveLength(0);
  });

  it('refuses a grant whose conversation its author has removed', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });
    const grant = proposal(opened, user, { args: RENT_900K });
    await service.issue(grant);

    await service.close(opened, runResult());
    await service.remove(opened.conversationId!, user);

    // A tab left open while the thread was deleted in another. The grant row is
    // still there — a soft delete does not cascade — so the ledger has to refuse
    // it on the conversation's own state rather than on the row's absence.
    expect(await service.spend(claimOn(grant))).toBe(false);
    expect(prisma.grants[0].usedAt).toBeNull();

    // And nothing new can be filed on it either.
    await expect(service.issue(proposal(opened, user, { args: RENT_9M }))).rejects.toThrow(
      /not this caller's, or it has been removed/,
    );
    expect(prisma.grants).toHaveLength(1);
  });

  it('cannot be reached at all by a caller who has lost the company', async () => {
    // WHERE THIS GUARD MOVED, and why it is asserted here rather than inside the
    // ledger. The port hands the store a `userId`, not an `AuthUser`, so the
    // company half of `scopeFor()` cannot be evaluated at the spend. It does not
    // need to be: the conversation id the loop passes is never the client's
    // claim. `open()` resolves it through the whole of `scopeFor()` — company
    // clause included — and the controller passes the RESOLVED row's id, so a
    // caller who has lost the company cannot obtain the scope a grant is
    // spendable under in the first place. This test holds THAT gate, because it
    // is now the one carrying the property.
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });
    await service.issue(proposal(opened, user, { args: RENT_900K }));
    await service.close(opened, runResult());

    const moved = authUser({ companyId: 'company-B', companyAccess: [] });
    await expect(
      service.open({ user: moved, prompt: 'Carry on', conversationId: opened.conversationId }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.grants[0].usedAt).toBeNull();
  });
});

describe('the spend is one conditional update, and it decides the race', () => {
  it('lets exactly one of three concurrent spends of the same grant win', async () => {
    // The shape this is written against is read-then-write: every racer reads
    // `usedAt IS NULL`, every racer concludes it may proceed, and one approved
    // payment is made three times. This codebase has already paid for that shape
    // once, in a create race that could not be decided by reading first.
    //
    // The double has no way to READ a grant at all — no findUnique, no findFirst,
    // no findMany — so an implementation of that shape cannot even run here.
    // What this test adds on top is the verdict: `updateMany` applies its filter
    // and its data with no await between them, exactly as the real statement
    // does, so the losers meet a row the winner has already stamped.
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });
    const grant = proposal(opened, user, { args: RENT_900K });
    await service.issue(grant);

    // Three requests in flight at once — two tabs and a double-clicked button.
    const verdicts = await Promise.all([
      service.spend(claimOn(grant)),
      laterRequest(prisma).spend(claimOn(grant)),
      laterRequest(prisma).spend(claimOn(grant)),
    ]);

    expect(verdicts.filter(Boolean)).toHaveLength(1);
    expect(prisma.grants[0].usedAt).toBeInstanceOf(Date);
  });

  it('spends the grant it was named, not every grant that would fit', async () => {
    // Two grants for the SAME action, which is what a turn proposing a repeat
    // produces. The spend is keyed on the id: a WHERE clause built from the
    // scope and the digest alone — conversation, user, tool, args, unused — would
    // match both rows and `updateMany` would stamp both, so one dispatch would
    // silently burn the approval the next one needs. Identical fixtures are the
    // only shape that can catch it.
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post both journals' });

    const first = proposal(opened, user, { args: RENT_900K });
    const second = proposal(opened, user, { args: RENT_900K });
    await service.issue(first);
    await service.issue(second);

    expect(await service.spend(claimOn(first))).toBe(true);
    expect(prisma.grants.filter((grant) => grant.usedAt === null)).toHaveLength(1);
    // The second dispatch still has its own approval to spend.
    expect(await service.spend(claimOn(second))).toBe(true);
  });
});

describe('an expired grant cannot be spent, and the sweep is not what enforces that', () => {
  it('refuses a grant past its clock while the row is still sitting there', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });
    const grant = proposal(opened, user, { args: RENT_900K });
    await service.issue(grant);

    // Half an hour later. The row has NOT been swept, deliberately: the sweep is
    // bounded, opportunistic and swallowed, so a ledger that depended on it
    // would honour approvals for as long as it fell behind.
    prisma.grants[0].expiresAt = new Date(Date.now() - 60_000);

    expect(await service.spend(claimOn(grant))).toBe(false);
    expect(prisma.grants).toHaveLength(1);
    expect(prisma.grants[0].usedAt).toBeNull();
  });

  it('judges the expiry against the dispatch’s own clock, not the machine’s', async () => {
    // `claim.now` is the instant the loop opened the dispatch with, and one run
    // offers its candidates against one instant rather than against a clock that
    // moves between them. A store reading `new Date()` here would answer a
    // question nobody asked — and would be untestable at the boundary, which is
    // the tell.
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });
    const grant = proposal(opened, user, { args: RENT_900K });
    await service.issue(grant);

    // A clock past the grant's expiry: refused, though the row is live by the
    // machine's own reckoning.
    const late = new Date(grant.expiresAt.getTime() + 1_000);
    expect(await service.spend(claimOn(grant, { now: late }))).toBe(false);
    expect(prisma.grants[0].usedAt).toBeNull();

    // And the stamp is that clock too, so the row says when it was spent rather
    // than when the process got round to writing it.
    const at = new Date(grant.createdAt.getTime() + 5_000);
    expect(await service.spend(claimOn(grant, { now: at }))).toBe(true);
    expect(prisma.grants[0].usedAt).toEqual(at);
  });

  it('sweeps expired grants on the feature’s own traffic, and leaves live ones alone', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });

    await service.issue(proposal(opened, user, { args: RENT_900K }));
    const live = proposal(opened, user, { args: RENT_9M });
    await service.issue(live);
    prisma.grants[0].expiresAt = new Date(Date.now() - 60_000);

    // Any question anyone in the deployment asks runs the sweep. There is still
    // no scheduler in this codebase.
    await service.open({ user, prompt: 'An unrelated question' });

    expect(prisma.grants.map((grant) => grant.id)).toEqual([live.grantId]);
  });

  it('destroys a conversation’s grants along with the conversation', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });
    await service.issue(proposal(opened, user, { args: RENT_900K }));
    await service.close(opened, runResult());

    // Past the retention window. Grants cascade, as the foreign key says: a
    // deleted conversation must never leave a spendable approval behind.
    prisma.conversations[0].expiresAt = new Date(Date.now() - 60_000);
    await service.open({ user, prompt: 'Something else entirely' });

    expect(prisma.conversations.map((row) => row.id)).not.toContain(opened.conversationId);
    expect(prisma.grants).toHaveLength(0);
  });
});

describe('the approval ledger fails CLOSED, unlike everything else in this file', () => {
  it('rejects rather than refusing when the spend cannot reach the store', async () => {
    // The deliberate contradiction of this file's own first rule. Everywhere
    // else the model turn and the tool calls have already happened, so
    // swallowing costs only a record of them. Here the work has NOT happened,
    // and an unspendable grant is an unproven approval.
    //
    // A REJECTION, not `false`. The loop dispatches on neither, but it behaves
    // differently: `false` re-proposes, and re-proposing writes a fresh grant to
    // the same ledger that just failed. An outage reported as a refusal asks the
    // user to approve what cannot be recorded — every turn, until it clears.
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });
    const grant = proposal(opened, user, { args: RENT_900K });
    await service.issue(grant);

    jest
      .spyOn(prisma.msaidiziApprovalGrant, 'updateMany')
      .mockRejectedValue(new Error('connection refused'));

    await expect(service.spend(claimOn(grant))).rejects.toThrow('connection refused');
    expect(prisma.grants[0].usedAt).toBeNull();
  });

  it('rejects when the store cannot say whose conversation this is', async () => {
    // The other half of the same call, and it fails the same way. The scope
    // lookup is a read of a different table, so a store that answers one and not
    // the other is an ordinary partial outage — and reading "I could not check
    // the author" as "this is not your grant" would put an outage back inside
    // the refusal.
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });
    const grant = proposal(opened, user, { args: RENT_900K });
    await service.issue(grant);

    jest
      .spyOn(prisma.msaidiziConversation, 'findFirst')
      .mockRejectedValue(new Error('connection refused'));

    await expect(service.spend(claimOn(grant))).rejects.toThrow('connection refused');
    expect(prisma.grants[0].usedAt).toBeNull();
  });

  it('tells "no such grant" and "the ledger did not answer" apart on the same claim', async () => {
    // The distinction, made once, on one claim, with nothing else differing —
    // because the failure this replaced was precisely that these two collapsed
    // into one value. A store that catches its own errors passes every other
    // test in this file.
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });
    const grant = proposal(opened, user, { args: RENT_900K });
    await service.issue(grant);
    const claim = claimOn(grant);

    // Spent: the ledger answered, and holds no spendable grant. Re-propose.
    expect(await service.spend(claim)).toBe(true);
    expect(await service.spend(claim)).toBe(false);

    // Unreachable: the ledger did not answer. Do not re-propose.
    const outage = jest
      .spyOn(prisma.msaidiziApprovalGrant, 'updateMany')
      .mockRejectedValue(new Error('connection refused'));
    await expect(service.spend(claim)).rejects.toThrow('connection refused');

    // And the answer goes back to being an answer when the store recovers.
    outage.mockRestore();
    expect(await service.spend(claim)).toBe(false);
  });

  it('rejects rather than returning when a grant cannot be recorded', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });

    jest
      .spyOn(prisma.msaidiziApprovalGrant, 'create')
      .mockRejectedValue(new Error('connection refused'));

    // The proposal still reaches the user; what cannot happen is its approval
    // being honoured on the strength of nothing. The loop catches this, logs it,
    // and does not offer the action — the same response it gives a grant that
    // was refused, and reached by being TOLD rather than by inferring it from a
    // null.
    await expect(service.issue(proposal(opened, user, { args: RENT_900K }))).rejects.toThrow(
      'connection refused',
    );
    expect(prisma.grants).toHaveLength(0);
  });

  it('files no grant for a run whose turn was never persisted', async () => {
    const { prisma, service } = makeService();
    const user = authUser();
    jest
      .spyOn(prisma.msaidiziConversation, 'create')
      .mockRejectedValue(new Error('connection refused'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    // A degraded run: it answers, unpersisted, under a minted id that names no
    // conversation. There is nowhere to file an approval, so red-tier actions in
    // it are proposed and cannot be approved — the correct end of that trade,
    // not a gap in it. The loop's own gate stops before it reaches the ledger;
    // this is the ledger refusing the same thing on its own account, so the gate
    // is not the only thing holding it.
    const opened = await service.open({ user, prompt: 'Post the August rent journal' });
    expect(opened.conversationId).toBeUndefined();

    await expect(
      service.issue(
        proposal(opened, user, { args: RENT_900K }, { conversationId: 'conv-never-written' }),
      ),
    ).rejects.toThrow(/No approval grant can be filed/);
    expect(prisma.grants).toHaveLength(0);

    warn.mockRestore();
    error.mockRestore();
  });
});
