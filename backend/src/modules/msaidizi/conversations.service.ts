/**
 * Conversation persistence.
 *
 * A chat is a place you return to, so the conversation lives on the server. It
 * cannot live in `localStorage`: the model's message array carries fenced
 * tool_result payloads — real customer records, supplier balances, invoice
 * lines — and writing those to a shared office machine's disk under a key any
 * script on the origin can read is not acceptable.
 *
 * ─── The observation the whole design rests on ───────────────────────────────
 *
 * A run returns TWO arrays and they are not two views of one thing.
 *
 *   `events`   is built for the human. Its `tool_result` variant is
 *              `{ type, tool, ok, status, error }` and carries NO body.
 *              Kilobytes. This is what displaying a past conversation needs,
 *              and it is all it needs.
 *
 *   `messages` is built for the API. It carries the fenced tool_result payload
 *              verbatim, because the API requires every `tool_use` block paired
 *              with a `tool_result` of the same id echoed back unchanged.
 *              Megabytes. This is what RESUMING a conversation needs, and
 *              nothing else can stand in for it.
 *
 * The three reductions one is tempted by all fail. Reconstructing `messages`
 * from `events` is impossible — no block ids, no bodies — and synthesising them
 * with placeholders is the failure to refuse, because the model would then
 * answer follow-ups from invented data while sounding exactly as confident as
 * before. Replacing result bodies with pointers is structurally valid and
 * semantically poisoned: the system prompt requires every figure to come from a
 * tool result in the conversation, so the model's own earlier sentences become
 * unsupported by anything it can see. Keeping only the last N turn-pairs is the
 * one honest compaction, and it is a later version.
 *
 * So both are persisted, at different fidelities, on different clocks. The
 * sensitive bulk is confined to `messages`, which is exactly the array display
 * does not need — which is why the resume state can be destroyed within a day
 * while the transcript is kept for months.
 *
 * ─── The rules this file enforces ────────────────────────────────────────────
 *
 *   1. **Persistence never fails a run.** Every storage path here swallows its
 *      own failures, following `AuditLogsService.log()`. A user losing their
 *      answer because a history row could not be written would be a worse
 *      system than one with no history at all.
 *   2. **A conversation is readable only by its author.** Not company-scoped,
 *      not admin-readable. See `scopeFor()` for why that is not a deferral.
 *   3. **Retention is swept, not merely stamped.** There is no scheduler in this
 *      codebase, and an "expired" row still holding customer records is a
 *      deletion that did not delete.
 *   4. **Turn ordering is a database guarantee**, never a read-then-write check.
 */

import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService, companyWhereForUser } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { redactSensitiveFields } from '../audit-logs/audit-logs.service';
import { ReversibilityTier, TIER_RANK } from '../../common/capabilities/reversibility';
import { ModelMessage } from './model-client';
import { MsaidiziConfig } from './msaidizi.config';
import { MsaidiziEvent, RunResult } from './msaidizi.service';

/** Longest title we derive from a first prompt. */
const TITLE_MAX = 120;

/**
 * A turn whose row has been opened and whose run has not finished.
 *
 * `conversationId` and `turnId` are optional on purpose: when the database is
 * unavailable the run still proceeds, unpersisted, and `close()` becomes a
 * no-op. Everything the caller actually needs to run — the session id and the
 * prior messages — is always present.
 */
export interface OpenedTurn {
  /** Server-owned. Correlates this run in the audit trail. */
  sessionId: string;
  /** Absent when the conversation could not be persisted. */
  conversationId?: string;
  turnId?: string;
  sequence: number;
  /**
   * The prior turns this run should start from: server-held resume state when a
   * conversation was continued, the caller's own fallback otherwise.
   */
  history: ModelMessage[];
  /** True when `history` came from the server rather than the client. */
  fromServer: boolean;
  /** Highest tier the conversation had already reached, for a monotonic raise. */
  priorTier: ReversibilityTier;
}

export interface OpenTurnInput {
  user: AuthUser;
  /** The user's new question, stored in plaintext. */
  prompt: string;
  /** Continue an existing conversation. Author-only; 404 otherwise. */
  conversationId?: string;
  /**
   * The session id a client is carrying on the pre-persistence path.
   *
   * It MUST be honoured rather than replaced. Red-tier confirmation ids are
   * derived from the session id, so minting a fresh one on a turn that carries
   * an approval would produce ids that never match the ones the user approved —
   * an infinite approval loop that looks exactly like the server ignoring them.
   */
  clientSessionId?: string;
  /**
   * The turn sequence the client last saw. When the conversation has moved on,
   * the request is a 409 rather than a silent divergence between two tabs.
   */
  clientSequence?: number;
  /**
   * Client-held history, used only when there is no server state to use. Keeps
   * in-tab continuation working across an expired resume, a conversation too
   * large to store, and a failed write.
   */
  fallbackHistory?: ModelMessage[];
  procedureId?: string;
}

/** What the list endpoint returns. Never includes turn content. */
export interface ConversationSummary {
  id: string;
  agentSessionId: string;
  title: string | null;
  companyId: string | null;
  turnCount: number;
  toolCallCount: number;
  writeCallCount: number;
  highestTier: string;
  resumable: boolean;
  /** Whether a next turn can still be continued server-side. */
  continuable: boolean;
  lastTurnAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
}

@Injectable()
export class MsaidiziConversationsService {
  private readonly logger = new Logger(MsaidiziConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MsaidiziConfig,
    private readonly encryption: EncryptionService,
  ) {}

  // ─── Write path ─────────────────────────────────────────────────────────────

  /**
   * Opens a turn before the agent loop runs.
   *
   * Deliberately before, not after. A run that crashes or whose stream drops
   * mid-loop has still left a row saying it happened, carrying the
   * `agentSessionId` needed to find whatever it changed. Once the agent can
   * write, that is the difference between a traceable incident and a silent one.
   */
  async open(input: OpenTurnInput): Promise<OpenedTurn> {
    // The sweep rides the traffic the feature itself generates. Bounded and
    // swallowed, so it can never be the reason a question goes unanswered.
    await this.sweep();

    if (input.conversationId) {
      return this.continueById(input, input.conversationId);
    }
    // The pre-persistence path: a client carrying its own session id and its own
    // history. Its conversation is found by session id so the turns land in one
    // thread instead of a new conversation per turn — and, more importantly, so
    // the caller's session id survives untouched.
    if (input.clientSessionId) {
      return this.continueBySession(input, input.clientSessionId);
    }
    return this.startConversation(input, mintSessionId());
  }

  /**
   * Records a finished run: the transcript at display fidelity, the resume state
   * verbatim, and the counters.
   *
   * Awaited rather than fire-and-forget, because the client's next action — a
   * confirmation click — can arrive within a second and will resume by
   * conversation id. One encrypted insert after a run that already took seconds
   * of model latency is not the cost worth optimising.
   *
   * Never throws. A failure here costs the last turn of history; it must not
   * cost the answer.
   */
  async close(opened: OpenedTurn, result: RunResult): Promise<void> {
    if (!opened.conversationId || !opened.turnId) return;

    try {
      const counts = countCalls(result.events);
      const now = new Date();

      // The transcript, redacted then encrypted. Redaction is applied HERE and
      // not to `messages`: a red-tier POST /users would otherwise put a
      // plaintext password in the transcript, which is exactly what this helper
      // already exists to catch on the audit path. The resume state cannot be
      // redacted — see `encodeResume`.
      const eventsCipher = this.encryption.encrypt(JSON.stringify(redactEvents(result.events)));
      const resume = this.encodeResume(result.messages);

      const writes: Prisma.PrismaPromise<unknown>[] = [
        this.prisma.msaidiziConversationTurn.update({
          where: { id: opened.turnId },
          data: {
            events: eventsCipher,
            reason: result.reason,
            toolCallCount: counts.toolCalls,
            writeCallCount: counts.writeCalls,
            endedAt: now,
          },
        }),
        this.prisma.msaidiziConversation.update({
          where: { id: opened.conversationId },
          data: {
            resumeState: resume.ciphertext,
            resumeBytes: resume.bytes,
            resumable: resume.stored,
            resumeExpiresAt: resume.stored
              ? new Date(now.getTime() + this.config.resumeTtlHours * 3_600_000)
              : null,
            toolCallCount: { increment: counts.toolCalls },
            writeCallCount: { increment: counts.writeCalls },
            lastTurnAt: now,
            expiresAt: new Date(now.getTime() + this.config.conversationRetentionDays * 86_400_000),
          },
        }),
      ];

      // `highestTier` is raised by a conditional UPDATE rather than by reading
      // it and writing back what looked highest. The WHERE clause is evaluated
      // under the row lock, so two turns finishing at once cannot lower it
      // between them — the same discipline the turn sequence uses.
      const raise = tiersBelow(counts.highestTier);
      if (raise.length > 0) {
        writes.push(
          this.prisma.msaidiziConversation.updateMany({
            where: { id: opened.conversationId, highestTier: { in: raise } },
            data: { highestTier: counts.highestTier },
          }),
        );
      }

      await this.prisma.$transaction(writes);
    } catch (err) {
      // House rule: a document or telemetry failure must never fail the
      // operation it records. The user has their answer; the audit trail still
      // has whatever was changed; only this turn of history is lost, and the
      // next turn falls back to client-supplied history.
      this.logger.error(
        `Failed to persist conversation ${opened.conversationId} turn ${opened.sequence}: ` +
          `${(err as Error)?.message}`,
      );
    }
  }

  // ─── Read path ──────────────────────────────────────────────────────────────

  /**
   * The caller's own conversations, newest first. Metadata only — a list never
   * decrypts anything.
   */
  async list(user: AuthUser, page = 1, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;

    const [rows, total] = await Promise.all([
      this.prisma.msaidiziConversation.findMany({
        where: this.scopeFor(user),
        orderBy: [{ lastTurnAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.msaidiziConversation.count({ where: this.scopeFor(user) }),
    ]);

    return {
      data: rows.map((row) => this.toSummary(row)),
      meta: { page: Math.max(page, 1), limit: take, total },
    };
  }

  /** One conversation with its turns, decrypted. Author-only. */
  async findOne(id: string, user: AuthUser) {
    const conversation = await this.prisma.msaidiziConversation.findFirst({
      where: { id, ...this.scopeFor(user) },
      include: { turns: { orderBy: { sequence: 'asc' } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');

    return {
      ...this.toSummary(conversation),
      turns: conversation.turns.map((turn) => ({
        id: turn.id,
        sequence: turn.sequence,
        prompt: turn.prompt,
        reason: turn.reason,
        toolCallCount: turn.toolCallCount,
        writeCallCount: turn.writeCallCount,
        procedureId: turn.procedureId,
        startedAt: turn.startedAt,
        endedAt: turn.endedAt,
        events: this.decodeEvents(turn.events, turn.id),
      })),
    };
  }

  /**
   * Removes a conversation from its author's view.
   *
   * Soft-deletes the transcript, matching the codebase's convention, and
   * destroys the resume state immediately rather than waiting for the sweep.
   * That split is the point: a `deletedAt` stamp leaving customer records in
   * `resumeState` would be theatre.
   *
   * This never deletes evidence. What the agent changed lives in `audit_logs`
   * under the user's own id, joined only by `agentSessionId`, and is untouched.
   */
  async remove(id: string, user: AuthUser) {
    const conversation = await this.prisma.msaidiziConversation.findFirst({
      where: { id, ...this.scopeFor(user) },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');

    await this.prisma.msaidiziConversation.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        resumeState: null,
        resumeBytes: 0,
        resumable: false,
        resumeExpiresAt: null,
      },
    });

    return { id, removed: true };
  }

  /**
   * Metadata-only oversight projection: who is using the agent, and how much.
   *
   * What it deliberately does NOT return: `title`, `prompt`, `events`, or any
   * tool argument. Title is excluded specifically because it is derived from the
   * first prompt and will name a customer — it is the field an implementer would
   * naturally include and the one that leaks.
   *
   * This exists because reading another user's transcript is not a deferred
   * feature, it is one that cannot be made correct. See `scopeFor()`.
   */
  async oversight(query: { companyId?: string; page?: number; limit?: number }, user: AuthUser) {
    const take = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const skip = (Math.max(query.page ?? 1, 1) - 1) * take;
    const where: Prisma.MsaidiziConversationWhereInput = companyWhereForUser(user, query.companyId);

    const [rows, total] = await Promise.all([
      this.prisma.msaidiziConversation.findMany({
        where,
        orderBy: [{ lastTurnAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        select: {
          id: true,
          agentSessionId: true,
          userId: true,
          companyId: true,
          turnCount: true,
          toolCallCount: true,
          writeCallCount: true,
          highestTier: true,
          lastTurnAt: true,
          createdAt: true,
        },
      }),
      this.prisma.msaidiziConversation.count({ where }),
    ]);

    return { data: rows, meta: { page: Math.max(query.page ?? 1, 1), limit: take, total } };
  }

  // ─── Retention ──────────────────────────────────────────────────────────────

  /**
   * Destroys what has aged out. Opportunistic, bounded, and swallowed.
   *
   * There is no scheduler in this codebase — `@nestjs/schedule` is not a
   * dependency and `@Cron` appears nowhere — and `cache_entries` already carries
   * an `expiresAt` that nothing sweeps, with `getStats()` merely counting the
   * rows that should be gone. This does not repeat that: an "expired" row still
   * holding customer records is a deletion that did not delete. The precedent
   * that works is the refresh-token prune, which runs inline on the traffic the
   * feature itself generates.
   *
   * RAW SQL IS NOT AN OPTIMISATION HERE, IT IS THE REQUIREMENT. The Prisma
   * soft-delete middleware rewrites `delete` and `deleteMany` into `update` for
   * any model carrying `deletedAt`, so the obvious Prisma call would stamp these
   * rows and leave the ciphertext exactly where it was.
   */
  async sweep(): Promise<void> {
    const batch = this.config.sweepBatchSize;
    try {
      // 1. Resume state past its short clock. The row survives and stays
      //    readable; only the array holding retrieved records is destroyed.
      await this.prisma.$executeRaw`
        UPDATE "msaidizi_conversations"
           SET "resumeState" = NULL, "resumeBytes" = 0, "resumable" = false,
               "resumeExpiresAt" = NULL
         WHERE "id" IN (
           SELECT "id" FROM "msaidizi_conversations"
            WHERE "resumeExpiresAt" IS NOT NULL
              AND "resumeExpiresAt" < now()
            LIMIT ${batch}
         )`;

      // 2. Conversations past the retention window, and removed ones past their
      //    grace. A real DELETE; turns cascade.
      const graceMs = this.config.deletedGraceHours * 3_600_000;
      const graceCutoff = new Date(Date.now() - graceMs);
      await this.prisma.$executeRaw`
        DELETE FROM "msaidizi_conversations"
         WHERE "id" IN (
           SELECT "id" FROM "msaidizi_conversations"
            WHERE "expiresAt" < now()
               OR ("deletedAt" IS NOT NULL AND "deletedAt" < ${graceCutoff})
            LIMIT ${batch}
         )`;
    } catch (err) {
      this.logger.error(`Retention sweep failed: ${(err as Error)?.message}`);
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /**
   * The read filter, and the most important six lines in this file.
   *
   * It is `userId = requester.id`, NOT `companyWhereForUser`. Reaching for the
   * house scoping helper is the obvious move and it is wrong here.
   *
   * The agent runs under the caller's own permissions and their own bearer
   * token, so a conversation contains exactly what THAT user was entitled to
   * see. A second manager in the same company, without `payroll.view`, reading
   * the first one's transcript would see data their own permissions deny. The
   * transcript is a permission-bypass channel unless the read gate is tighter
   * than the application's normal one.
   *
   * That is also why there is no admin read, and why that is a refusal rather
   * than a deferral: to decide whether reader R may see conversation C you would
   * have to re-evaluate every record inside C against R's permissions, and the
   * transcript stores prose and fenced payloads, not record identities. There is
   * nothing to re-check. Any "admins can review conversations" feature is a
   * permission bypass wearing an oversight costume. Oversight gets metadata
   * (see `oversight()`) and the audit trail, which are properly scoped already.
   *
   * Company scope is applied IN ADDITION, never instead: a conversation filed
   * under a company the author has since lost access to disappears from their
   * own list too. A conversation with no company has no such access to lose.
   */
  private scopeFor(user: AuthUser): Prisma.MsaidiziConversationWhereInput {
    return {
      userId: user.id,
      OR: [{ companyId: null }, companyWhereForUser(user)],
    };
  }

  private async startConversation(input: OpenTurnInput, sessionId: string): Promise<OpenedTurn> {
    const now = new Date();

    try {
      const conversation = await this.prisma.msaidiziConversation.create({
        data: {
          agentSessionId: sessionId,
          userId: input.user.id,
          companyId: input.user.companyId ?? null,
          title: deriveTitle(input.prompt),
          turnCount: 1,
          lastTurnAt: now,
          expiresAt: new Date(now.getTime() + this.config.conversationRetentionDays * 86_400_000),
          turns: {
            create: {
              sequence: 1,
              prompt: input.prompt,
              events: this.encryption.encrypt('[]'),
              reason: 'running',
              procedureId: input.procedureId ?? null,
              startedAt: now,
            },
          },
        },
        include: { turns: true },
      });

      return {
        sessionId,
        conversationId: conversation.id,
        turnId: conversation.turns[0]?.id,
        sequence: 1,
        history: input.fallbackHistory ?? [],
        fromServer: false,
        priorTier: 'green',
      };
    } catch (err) {
      return this.degraded(sessionId, input, err);
    }
  }

  /**
   * Continue by conversation id — the path a chat client uses. Server state is
   * authoritative here: the stored resume state replaces whatever history the
   * client sent, which is what retires the byte-fidelity contract on the client.
   */
  private async continueById(input: OpenTurnInput, conversationId: string): Promise<OpenedTurn> {
    let conversation: Prisma.MsaidiziConversationGetPayload<object> | null;
    try {
      conversation = await this.prisma.msaidiziConversation.findFirst({
        where: { id: conversationId, ...this.scopeFor(input.user) },
      });
    } catch (err) {
      // The store is unavailable, which is not the same as "this conversation
      // is not yours". Degrade to the client's own history rather than telling
      // the user their conversation does not exist.
      return this.degraded(input.clientSessionId ?? mintSessionId(), input, err);
    }

    // Author-only. A peer or an admin asking for this id gets the same answer a
    // stranger gets, because there is no reading of it that could be correct.
    if (!conversation) throw new NotFoundException('Conversation not found.');

    if (input.clientSequence !== undefined && input.clientSequence < conversation.turnCount) {
      throw new ConflictException(
        'This conversation continued in another window. Reload it before adding to it.',
      );
    }

    const resumed = this.decodeResume(conversation);
    if (!resumed && !input.fallbackHistory?.length) {
      // Stated, not generic. A conversation past its resume clock is readable
      // and not continuable, and the user is told which of those it is.
      throw new GoneException(
        conversation.resumable
          ? 'This conversation can no longer be continued — its working state has expired. Its history is still readable; start a new conversation to carry on.'
          : 'This conversation is too long to continue — start a new one. Its history is still readable.',
      );
    }

    return this.appendTurn(input, conversation, resumed ?? input.fallbackHistory ?? [], {
      fromServer: Boolean(resumed),
    });
  }

  /**
   * Continue by agent session id — the pre-persistence path, kept working.
   *
   * The client is authoritative on this path: it sent its own history and it
   * owns the session id, so nothing here replaces either. All this does is file
   * the turn in the right conversation, and create that conversation the first
   * time a session is seen.
   */
  private async continueBySession(input: OpenTurnInput, sessionId: string): Promise<OpenedTurn> {
    let conversation: Prisma.MsaidiziConversationGetPayload<object> | null;
    try {
      conversation = await this.prisma.msaidiziConversation.findFirst({
        where: { agentSessionId: sessionId, ...this.scopeFor(input.user) },
      });
    } catch (err) {
      return this.degraded(sessionId, input, err);
    }

    // A session id that resolves to nothing this user owns starts a fresh
    // conversation under it. If it collides with someone else's row the unique
    // index rejects the insert and the run proceeds unpersisted — never
    // attaching one user's turn to another user's conversation.
    if (!conversation) return this.startConversation(input, sessionId);

    return this.appendTurn(input, conversation, input.fallbackHistory ?? [], {
      fromServer: false,
    });
  }

  private async appendTurn(
    input: OpenTurnInput,
    conversation: Prisma.MsaidiziConversationGetPayload<object>,
    history: ModelMessage[],
    opts: { fromServer: boolean },
  ): Promise<OpenedTurn> {
    const conversationId = conversation.id;
    const priorTier = asTier(conversation.highestTier);

    try {
      const { turnId, sequence } = await this.prisma.$transaction(async (tx) => {
        // The sequence comes from an atomic increment that RETURNs the new
        // value, so two concurrent turns serialise on the row lock and receive
        // distinct numbers. This is deliberately not "read turnCount, add one,
        // write it back" — both racers would conclude they won. The unique index
        // on (conversationId, sequence) is the backstop.
        const updated = await tx.msaidiziConversation.update({
          where: { id: conversationId },
          data: { turnCount: { increment: 1 }, lastTurnAt: new Date() },
        });
        const turn = await tx.msaidiziConversationTurn.create({
          data: {
            conversationId,
            sequence: updated.turnCount,
            prompt: input.prompt,
            events: this.encryption.encrypt('[]'),
            reason: 'running',
            procedureId: input.procedureId ?? null,
          },
        });
        return { turnId: turn.id, sequence: turn.sequence };
      });

      return {
        sessionId: conversation.agentSessionId,
        conversationId,
        turnId,
        sequence,
        history,
        fromServer: opts.fromServer,
        priorTier,
      };
    } catch (err) {
      this.logger.error(
        `Failed to open a turn on conversation ${conversationId}: ${(err as Error)?.message}`,
      );
      // The run still happens, on the session id this conversation already owns,
      // so its audit rows still correlate even though this turn is unrecorded.
      return {
        sessionId: conversation.agentSessionId,
        sequence: conversation.turnCount + 1,
        history,
        fromServer: opts.fromServer,
        priorTier,
      };
    }
  }

  /** Persistence is unavailable. The run proceeds; only the history is lost. */
  private degraded(sessionId: string, input: OpenTurnInput, err: unknown): OpenedTurn {
    this.logger.error(
      `Conversation persistence unavailable; running unpersisted: ${(err as Error)?.message}`,
    );
    return {
      sessionId,
      sequence: 0,
      history: input.fallbackHistory ?? [],
      fromServer: false,
      priorTier: 'green',
    };
  }

  /**
   * Encrypts the model message array, or refuses to store it.
   *
   * Verbatim or nothing: `JSON.stringify` in, the identical string back out of
   * `decrypt`. GCM round-trips the exact bytes, and the bulky part is already a
   * string inside the block — `fenceToolResult` stringifies before it goes in —
   * so no numeric or key-order normalisation can touch a customer balance on the
   * way through.
   *
   * Nothing here is redacted, and that is not an oversight. The API requires the
   * content echoed back unchanged; an altered tool result is a different
   * conversation. (It also becomes cryptographically impossible the moment
   * thinking-block signatures stop being stripped, since a signature covers the
   * content you would be altering.) The protection is the encryption, the
   * 24-hour clock, and the author-only read gate — not selective rewriting.
   */
  private encodeResume(messages: ModelMessage[]): {
    ciphertext: string | null;
    bytes: number;
    stored: boolean;
  } {
    const plaintext = JSON.stringify(messages);
    const bytes = Buffer.byteLength(plaintext, 'utf8');
    if (bytes > this.config.resumeMaxBytes) {
      // Store nothing rather than truncating. Dropping arbitrary blocks breaks
      // tool_use/tool_result pairing and produces a request the API rejects,
      // which the user would see as a generic failure.
      return { ciphertext: null, bytes: 0, stored: false };
    }
    return { ciphertext: this.encryption.encrypt(plaintext), bytes, stored: true };
  }

  private decodeResume(conversation: {
    id: string;
    resumeState: string | null;
    resumeExpiresAt: Date | null;
  }): ModelMessage[] | null {
    if (!conversation.resumeState) return null;
    if (conversation.resumeExpiresAt && conversation.resumeExpiresAt.getTime() <= Date.now()) {
      return null;
    }
    try {
      const parsed = JSON.parse(this.encryption.decrypt(conversation.resumeState));
      return Array.isArray(parsed) ? (parsed as ModelMessage[]) : null;
    } catch (err) {
      // The GCM auth tag failed, or the key rotated. Fail closed: someone
      // editing a stored conversation to inject an instruction gets a refusal to
      // resume, never a poisoned message array handed to the model.
      this.logger.error(
        `Resume state for conversation ${conversation.id} could not be decrypted: ` +
          `${(err as Error)?.message}`,
      );
      return null;
    }
  }

  private decodeEvents(ciphertext: string, turnId: string): MsaidiziEvent[] {
    try {
      const parsed = JSON.parse(this.encryption.decrypt(ciphertext));
      return Array.isArray(parsed) ? (parsed as MsaidiziEvent[]) : [];
    } catch (err) {
      // One unreadable turn must not make the whole conversation unopenable.
      this.logger.error(
        `Transcript for turn ${turnId} could not be decrypted: ${(err as Error)?.message}`,
      );
      return [];
    }
  }

  private toSummary(row: {
    id: string;
    agentSessionId: string;
    title: string | null;
    companyId: string | null;
    turnCount: number;
    toolCallCount: number;
    writeCallCount: number;
    highestTier: string;
    resumable: boolean;
    resumeState: string | null;
    resumeExpiresAt: Date | null;
    lastTurnAt: Date | null;
    createdAt: Date;
    expiresAt: Date;
  }): ConversationSummary {
    return {
      id: row.id,
      agentSessionId: row.agentSessionId,
      title: row.title,
      companyId: row.companyId,
      turnCount: row.turnCount,
      toolCallCount: row.toolCallCount,
      writeCallCount: row.writeCallCount,
      highestTier: row.highestTier,
      resumable: row.resumable,
      continuable:
        Boolean(row.resumeState) &&
        (!row.resumeExpiresAt || row.resumeExpiresAt.getTime() > Date.now()),
      lastTurnAt: row.lastTurnAt,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mintSessionId(): string {
  return `ms_${randomUUID().replace(/-/g, '')}`;
}

function deriveTitle(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  return flat.length <= TITLE_MAX ? flat : `${flat.slice(0, TITLE_MAX - 1)}…`;
}

/**
 * Redacts the transcript before it is stored.
 *
 * Only two event shapes carry model-authored input, and both are kept because
 * they are the reviewable substance of a run — a search term is a customer name,
 * a red-tier write body is the change itself. What is removed is the material
 * that must never come to rest: a red-tier `POST /users` would otherwise put a
 * plaintext password in the transcript. The rules are the audit trail's own, so
 * the two surfaces cannot drift apart.
 *
 * Returns a new array; the caller's events — already sent to the client — are
 * untouched.
 */
export function redactEvents(events: MsaidiziEvent[]): MsaidiziEvent[] {
  return events.map((event) => {
    if (event.type === 'tool_call' || event.type === 'confirmation_required') {
      return { ...event, args: redactSensitiveFields(event.args ?? {}) };
    }
    return event;
  });
}

function countCalls(events: MsaidiziEvent[]): {
  toolCalls: number;
  writeCalls: number;
  highestTier: ReversibilityTier;
} {
  let toolCalls = 0;
  let writeCalls = 0;
  let highestTier: ReversibilityTier = 'green';

  for (const event of events) {
    if (event.type === 'tool_call') {
      toolCalls += 1;
      if (event.tier !== 'green') writeCalls += 1;
      if (TIER_RANK[event.tier] > TIER_RANK[highestTier]) highestTier = event.tier;
    } else if (event.type === 'confirmation_required') {
      // Only red-tier actions ask, and a conversation that proposed one has
      // touched red even if the user never approved it. Oversight ranks on
      // what was reached for, not only on what completed.
      highestTier = 'red';
    }
  }

  return { toolCalls, writeCalls, highestTier };
}

/** Tiers strictly below `tier` — the set a monotonic raise is allowed to replace. */
function tiersBelow(tier: ReversibilityTier): ReversibilityTier[] {
  return (['green', 'amber', 'red'] as ReversibilityTier[]).filter(
    (candidate) => TIER_RANK[candidate] < TIER_RANK[tier],
  );
}

function asTier(value: string): ReversibilityTier {
  return value === 'red' || value === 'amber' ? value : 'green';
}
