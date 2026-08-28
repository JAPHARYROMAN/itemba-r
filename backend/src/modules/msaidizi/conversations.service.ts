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
 *   1. **A storage FAILURE never fails a run.** Every write path here swallows
 *      its own errors, following `AuditLogsService.log()`: `close()`,
 *      `appendTurn()`, `startConversation()` and `sweep()` all catch, and
 *      `open()` degrades to an unpersisted turn rather than throwing. A user
 *      losing their answer because a history row could not be written would be a
 *      worse system than one with no history at all.
 *
 *      What the store SAYS is a different thing, and it does refuse runs — on
 *      purpose, in four places, each of which throws rather than degrading: a
 *      conversation that is not the caller's (404), a resume state past its
 *      clock or never stored because it was too large (410), a tab whose
 *      sequence has fallen behind another window (409), and a conversation whose
 *      last turn was never closed (409, on a timer — `assertStoredStateIsUsable`).
 *      Those are answers the user can act on rather than failures, and each says
 *      which it is in prose, because on the wire the client cannot tell them
 *      apart any other way.
 *   2. **A conversation is readable only by its author.** Not company-scoped,
 *      not admin-readable. See `scopeFor()` for why that is not a deferral.
 *   3. **Retention is swept, not merely stamped.** There is no scheduler in this
 *      codebase, and an "expired" row still holding customer records is a
 *      deletion that did not delete.
 *   4. **Turn ordering is a database guarantee**, never a read-then-write check.
 *   5. **The approval ledger fails CLOSED, and that contradicts rule 1 on
 *      purpose.** `issue()` and `spend()` — the two methods of the
 *      `ApprovalGrantStore` port the agent loop injects — are the only
 *      operations here whose unavailability stops something happening, and the
 *      only ones that THROW rather than reporting. Rule 1 holds everywhere else
 *      because by the time this file writes anything, the model turn and the
 *      tool calls have already happened and swallowing costs only a record of
 *      them. A grant is the opposite: an unspendable grant is an UNPROVEN
 *      APPROVAL, so a store that cannot be reached means the irreversible action
 *      is proposed again rather than dispatched. The rejection has to travel:
 *      `spend()` resolving `false` means "the ledger holds no such grant", the
 *      loop re-proposes on it, and re-proposing needs a write to the same
 *      ledger — so an outage reported as `false` would ask the user to approve
 *      what can never be recorded. Said here, and again at both methods,
 *      because a reader who has just absorbed rule 1 will otherwise "fix" it.
 *   6. **The server mints the session id.** A client-supplied one is honoured
 *      only where it resolves — through `scopeFor()` — to a conversation that
 *      caller owns; anything else is ignored and a fresh id is minted. Never
 *      rejected: failing a run over a stale id is worse than re-identifying it.
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
import {
  EncryptionService,
  PersistenceSecretGuard,
  companyWhereForUser,
} from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { redactSensitiveFields } from '../audit-logs/audit-logs.service';
import {
  containsPersistedSecret,
  PERSISTED_SECRET_PLACEHOLDER,
  redactPersistedSecrets,
} from '../../common/utils/persistent-secret-redaction';
import { ReversibilityTier, TIER_RANK } from '../../common/capabilities/reversibility';
import { ModelMessage } from './model-client';
import { MsaidiziConfig } from './msaidizi.config';
import {
  ApprovalGrant,
  ApprovalGrantClaim,
  ApprovalGrantStore,
  MsaidiziEvent,
  RunResult,
} from './msaidizi.service';

/** Longest title we derive from a first prompt. */
const TITLE_MAX = 120;

/**
 * How long a turn row may sit at `reason: 'running'` before it is read as the
 * trace of a run that died rather than one still going.
 *
 * `reason` is written when the row is opened and overwritten only by `close()`,
 * which is an in-memory handle that dies with the process. Nothing else in this
 * backend ever writes it: `close()` holds the only
 * `msaidiziConversationTurn.update` in the codebase, and `sweep()` either clears
 * resume columns or deletes whole conversations — it never settles a turn. So a
 * deploy, an OOM, a pod eviction, or `MsaidiziController.askStream`'s catch —
 * which deliberately leaves the row open as the trace of a run that never
 * reported back — leaves a row nothing will ever close. Read without a clock,
 * that trace makes `assertStoredStateIsUsable()` refuse every later turn of the
 * conversation for the life of the row: one crashed run would cost the user the
 * whole thread, and the 409 would tell them to wait for a write that is never
 * going to happen.
 *
 * Thirty minutes is past any run this service can produce. The default budgets
 * bound one run at 40 tool calls (`MSAIDIZI_MAX_TOOL_CALLS`) of at most 30
 * seconds each (`MSAIDIZI_INVOKE_TIMEOUT_MS`) — twenty minutes of tool time —
 * plus the model latency around them. Deliberately generous rather than tight:
 * the cost of waiting too long is a user asked to come back in a few minutes,
 * and the cost of waiting too little is resuming from a state a live run is
 * about to overwrite.
 *
 * The row is never rewritten to say any of this. The trace stays exactly as the
 * failure left it; only how it is READ changes with age.
 */
const ABANDONED_TURN_MS = 30 * 60 * 1000;

// There is no GRANT_TTL_MS here, and its absence is deliberate. A grant arrives
// with its own `expiresAt`, set by the agent loop that minted it (`GRANT_TTL_MS`
// in `msaidizi.service.ts`), because the loop is what proposes the action and
// what the clock is measured from. This file stores that instant verbatim and
// enforces it in `spend()`'s WHERE clause — which is the half that has to be
// here, since an expiry nothing compares against is a comment. A second constant
// would be a second answer to one question, agreeing with the first until the
// day someone changed one of them, and nothing in the build would notice.
// `ABANDONED_TURN_MS` above stays because it answers a different question — how
// long a `running` row is read as a live run — which only this file can answer.

/**
 * Machine-readable discriminators for the two 409s this file raises.
 *
 * They are opposite answers wearing the same status code. One clears by itself
 * within `ABANDONED_TURN_MS` and a retry is the right thing to offer; the other
 * is exactly as true on the tenth ask as the first and a retry is a lie. Until
 * these existed the only thing separating them on the wire was the English in
 * `message`, so the client read the prose — and an ordinary copy-edit to either
 * sentence silently flipped the answer, putting "asking again gets the same
 * answer" underneath a server sentence promising the opposite.
 *
 * A code is not a tripwire, it is the fix: reword either sentence freely, the
 * client's branch does not move. `HttpExceptionFilter` is what carries this
 * onto the response body — it rebuilds the body field by field, so a `code` it
 * did not know about would be dropped between here and the browser.
 *
 * Values are wire format. Renaming one is a breaking change to the client, and
 * the mirror is `MsaidiziConflictCode` in `frontend/src/lib/msaidizi-types.ts`.
 */
export const CONVERSATION_CONFLICT_CODES = {
  /**
   * The newest turn row still reads `reason: 'running'`. Either a run is in
   * flight or one died before it could close its row; both are "not yet", and
   * both stop being true on their own.
   */
  unfinishedTurn: 'unfinished_turn',
  /**
   * The caller's sequence is behind the stored turn count: this conversation
   * moved on somewhere else. Nothing about that expires.
   */
  continuedElsewhere: 'continued_elsewhere',
} as const;

/**
 * A turn whose row has been opened and whose run has not finished.
 *
 * `conversationId` and `turnId` are optional on purpose: when the database is
 * unavailable the run still proceeds, unpersisted, and `close()` becomes a
 * no-op. Everything the caller actually needs to run — the session id and the
 * prior messages — is always present.
 */
export interface OpenedTurn {
  /**
   * The audit key every `audit_logs` row this run writes is stamped with.
   *
   * Server-minted, on every path, with no qualifier — which this said before it
   * was true. Exactly two things reach this field now:
   *
   *   - an id `mintSessionId()` produced during this call;
   *   - a conversation's own `agentSessionId`, read back off a row this caller
   *     owns — so server-issued on some earlier turn, by definition.
   *
   * The id the REQUEST carried never reaches it except by being the second case.
   * `continueBySession` resolves it through `scopeFor()`, and a value that
   * resolves to nothing of this caller's — naming nothing, naming a stranger's
   * conversation, naming one this author deleted, or arriving while the store
   * could not be read at all — is IGNORED and replaced by a fresh mint. Ignored
   * rather than rejected: a stale id is an ordinary thing for a tab to be
   * holding, and failing the user's question over it would be a worse outcome
   * than re-identifying the run.
   *
   * What that costs, stated because it is a real cost and it is now affordable:
   * during a read outage, consecutive turns a client believes are one thread are
   * filed under different session ids, so the audit trail shows several short
   * runs where a reader expected one. That is a correlation that is coarser than
   * hoped. The thing it replaced was a correlation that was WRONG — two users'
   * rows sharing a key, because the id was adopted on the caller's word.
   *
   * What made adoption look necessary until now: red-tier confirmation ids were
   * derived from this value, so re-minting mid-approval recomputed every id the
   * user had approved and re-asked them for ever. Approvals are
   * `msaidizi_approval_grants` rows now — server-issued nonces bound to a
   * conversation and an argument digest, not to this string — so a fresh id
   * cannot invalidate one. Closing the ledger is what let this be closed.
   * See `schema.prisma` on `MsaidiziConversation.agentSessionId`.
   */
  sessionId: string;
  /** Absent when the conversation could not be persisted. */
  conversationId?: string;
  turnId?: string;
  /**
   * This turn's position in the conversation, and ABSENT — never zero — when the
   * turn was not persisted.
   *
   * The client stores whatever arrives here and sends it back as
   * `AskDto.sequence`, where it is compared against the conversation's own turn
   * count. A number is therefore a claim about stored state, and an unpersisted
   * turn has no such claim to make: reporting `0` for one would say "I have seen
   * no turns of this conversation", which `continueById` can only read as a tab
   * that has fallen behind. One degraded turn would then answer every later
   * question in that tab with "this conversation continued in another window",
   * which is not true and which no retry can clear.
   *
   * Absent is the honest answer, and the only one the client can hold its last
   * known-good value through.
   */
  sequence?: number;
  /**
   * The prior turns this run should start from: whichever of the server's stored
   * resume state and the caller's own array holds more of the conversation. See
   * `continueById` for the rule and for why the two can ever differ.
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
   * A LOOKUP KEY, not a value to adopt. It is honoured — meaning the run
   * proceeds under it — in exactly one case: it resolves through `scopeFor()` to
   * a conversation this caller owns, in which case the id being honoured is that
   * row's own `agentSessionId` and was minted here on some earlier turn. In
   * every other case the run is given a fresh mint and this value is dropped: an
   * id naming nothing, one naming another user's conversation, one naming a
   * conversation this author has deleted, and one that arrived while the store
   * could not be read.
   *
   * Dropped silently rather than 400'd. A tab holding a stale id is ordinary —
   * the conversation aged out, or the first turn's row was never written — and
   * answering the user's question under a new id is strictly better than
   * refusing to answer it.
   *
   * This used to be adopted on the caller's word wherever no insert collided,
   * because red-tier confirmation ids were derived from the session id and a
   * fresh mint mid-approval re-asked the user for ever. Approvals no longer
   * derive from it (see the approval ledger below), so nothing is owed to continuity
   * of this string any more.
   */
  clientSessionId?: string;
  /**
   * The turn sequence the client last saw. When the conversation has moved on,
   * the request is a 409 rather than a silent divergence between two tabs.
   *
   * Only a POSITIVE value is a claim. Sequences are 1-based, so zero cannot mean
   * "I am up to date with turn zero" — it means the client has nothing to say,
   * and a client that says nothing is not evidence that another window wrote.
   */
  clientSequence?: number;
  /**
   * The client's own copy of the conversation.
   *
   * Used whenever the server has no state to use — an expired resume clock, a
   * conversation too large to store, a failed write — and ALSO whenever it holds
   * more of the conversation than the server does, which is how a turn the store
   * failed to record survives into the next one. See `continueById` for why
   * array length is the measure and why the server wins a tie.
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

/**
 * `implements ApprovalGrantStore` is the load-bearing half of this declaration.
 *
 * The agent loop injects the ledger behind a DI token, and a token binding is
 * untyped — Nest resolves whatever object was bound and never checks it against
 * the interface the injecting class declared. So this clause, and the return
 * type on `approvalGrantStoreProvider` in `msaidizi.module.ts`, are between them
 * the only things that make a divergence between the port and these two methods
 * a BUILD failure rather than a `TypeError` thrown inside the red-tier gate at
 * the moment a user clicks approve — on the one path production has never run,
 * because `MSAIDIZI_WRITE_MODE=read-only` means no confirmation has ever fired
 * there. Removing it would compile and would put that back.
 */
@Injectable()
export class MsaidiziConversationsService implements ApprovalGrantStore {
  private readonly logger = new Logger(MsaidiziConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MsaidiziConfig,
    private readonly encryption: EncryptionService,
    private readonly persistenceSecrets: PersistenceSecretGuard,
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

      // The transcript is redacted then encrypted. The resume state must remain
      // byte-identical to the model conversation, so it is stored only when the
      // persistence DLP detector finds no credential at all — see encodeResume.
      const messagesContainSecret =
        containsPersistedSecret(JSON.stringify(result.messages)) ||
        this.persistenceSecrets.sanitizeJson(result.messages).redactionsApplied;
      const durableEvents = this.persistenceSecrets.sanitizeJson(
        redactEvents(result.events, messagesContainSecret),
      ).value as MsaidiziEvent[];
      const eventsCipher = this.encryption.encrypt(JSON.stringify(durableEvents));
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

  // ─── The approval ledger ────────────────────────────────────────────────────

  /**
   * Records that one red-tier action was PROPOSED, so the approval that comes
   * back can be recognised as an answer to it.
   *
   * This and `spend()` below are `ApprovalGrantStore` (`msaidizi.service.ts`) —
   * the two-method port the agent loop injects. The names, the payloads and the
   * failure behaviour are the port's, not this file's, and the `implements`
   * clause on the class is what makes that a compiler obligation.
   *
   * ─── Why this exists at all ─────────────────────────────────────────────────
   *
   * An approval used to be `confirmationIdFor(sessionId, toolName, args)` — a
   * value DERIVED from three things the caller supplies on the same request that
   * claims them approved. So it was a NAME for an action, not a receipt for one:
   * nothing on this server had issued it, and nothing could recognise it. Two
   * consequences, and this ledger closes both. It was a pre-authorisation
   * channel — a request could name an action nobody had been shown — and the
   * spend was an in-memory Set inside one `run()`, so re-sending the same id on
   * a LATER request bought another execution of the same irreversible action.
   *
   * A grant is the other shape: issued by the server when it proposes, spent by
   * the server when it dispatches, and useless to anyone who did not receive it.
   *
   * ─── Why a nonce and not a remembered id ────────────────────────────────────
   *
   * The tempting repair is to remember derived ids as permanently spent. It is
   * wrong, and specifically so: the derived id is deterministic, so the same
   * weekly payroll journal posted again next week produces the same id. Marking
   * it spent for ever would make a legitimately repeated identical action
   * permanently unapprovable, because re-approving it can only ever produce that
   * same id again. A fresh nonce per proposal has no such collision: the repeat
   * is proposed, gets its own grant, and is approvable exactly as the first was.
   *
   * ─── Why the grant arrives already minted ───────────────────────────────────
   *
   * `grant.grantId` is the loop's own nonce, and this file no longer mints one.
   * Not a question of which module owns a helper: the loop needs the id for the
   * `confirmation_required` event it emits in the same breath as this write, so
   * it has to hold the value before the row exists. It is server-issued either
   * way — a caller can no more compute the loop's `randomUUID()` than this
   * file's — and unguessability, not authorship, is the property that makes
   * possession of one mean anything.
   *
   * The clock arrives with it too (`expiresAt`, `GRANT_TTL_MS` in
   * `msaidizi.service.ts`). This file stores it verbatim and enforces it in
   * `spend()`'s WHERE clause, which is the half that has to be here: an expiry
   * nothing compares against is a comment.
   *
   * ─── And why the digest is supplied rather than computed here ───────────────
   *
   * The canonical encoding and the SHA-256 over it live in `msaidizi.service.ts`
   * (`canonicalise`, `confirmationIdFor`) and are load-bearing in their own
   * right — the nesting collapse they were rewritten to fix is the reason the
   * digest has to be injective at every level. Reimplementing them here would
   * give this module two encodings that must agree for ever and no test that
   * would notice the day they stop. The ledger needs equality, not authorship.
   *
   * What it therefore requires of whatever produces the digest: determinism and
   * injectivity in `(toolName, args)` across the life of a conversation. Nothing
   * else. It is never parsed, never compared to anything but another digest, and
   * never shown to a user.
   *
   * ─── What it does NOT establish ─────────────────────────────────────────────
   *
   * That a human read the proposal. Nothing in this process can. What a spent
   * grant proves is that this server proposed this exact action in this
   * conversation, and that the id came back from the surface it was sent to —
   * which is the whole of what a server can know, and strictly more than the
   * derived id could say.
   *
   * ─── FAIL CLOSED — and it REJECTS, it does not report ───────────────────────
   *
   * Every other write in this file swallows its own failure (header, rule 1).
   * This one throws, and the caller must not soften it: the loop catches, logs,
   * and then does NOT offer the action for approval. A grant nobody can spend is
   * an approval nobody can prove, and during a store outage the correct
   * behaviour for an irreversible action is that it does not run.
   *
   * The reason this is a throw rather than the `null` it used to be is one the
   * loop cannot reconstruct afterwards: a returned value that means "I did not
   * record it" is indistinguishable from one that means "there was nothing to
   * record", and the loop dispatches differently on those two. Rejecting says
   * which without asking the caller to guess.
   */
  async issue(grant: ApprovalGrant): Promise<void> {
    const conversation = await this.conversationForGrant(grant);
    if (!conversation) {
      // Not a store failure, and still fatal to the proposal: this conversation
      // is not this caller's live thread, so there is nowhere to file an
      // approval for it. Thrown rather than returned for the reason above — the
      // loop's only correct response is the same one an outage gets, which is
      // to propose nothing.
      throw new Error(
        `No approval grant can be filed on conversation ${grant.conversationId}: it is not ` +
          `this caller's, or it has been removed. The action must not be offered for approval.`,
      );
    }

    await this.prisma.msaidiziApprovalGrant.create({
      data: {
        id: grant.grantId,
        conversationId: conversation.id,
        // The claim's own userId, not the row's, and they are the same value:
        // the lookup above matched on it, so a grant is never filed under an
        // author the conversation does not have. Taking it from the claim is
        // what keeps this column equal to the one `spend()` compares against —
        // copying the row's instead would put a second opinion in the WHERE
        // clause that decides every later dispatch.
        userId: grant.userId,
        // The turn in flight, as the loop counted it. `turnCount` is the
        // fallback rather than the source now: `open()` has already incremented
        // it under the conversation's row lock, so it is this turn's own
        // sequence, and it is the honest answer for a caller that had none to
        // give. Audit context either way — the spend does not read this column.
        turnSequence: grant.proposedOnTurn ?? conversation.turnCount,
        toolName: grant.toolName,
        argsDigest: grant.argumentDigest,
        // Both clocks from the proposal, so the row cannot say it was created
        // after it expired.
        createdAt: grant.createdAt,
        expiresAt: grant.expiresAt,
      },
    });
  }

  /**
   * Spends the named grant for the action about to be dispatched, and reports
   * whether it won.
   *
   * `true` means this call, and no other, holds that grant: dispatch. `false`
   * means the ledger holds no such spendable grant — the id named nothing, named
   * another conversation's or another user's grant, named one for a DIFFERENT
   * action, had expired, or had already been spent — and the loop's answer to
   * that is to propose the action again under a fresh grant.
   *
   * `false` NEVER means the store could not be asked. That case throws, and the
   * distance between those two answers is the whole reason this method's
   * signature is the port's rather than this file's: the loop re-proposes on a
   * refusal, and re-proposing needs a WRITE to the same ledger that just failed,
   * so an outage softened into `false` asks the user to approve something that
   * can never be recorded — for ever, once per turn.
   *
   * One grant per call, tried by the loop against its own candidate list. Not an
   * economy: a request can approve several proposals at once, nothing tells the
   * server which id belongs to which action, and the ledger deciding one at a
   * time is what makes "approve two actions together" spend one grant each
   * rather than draining both on the first dispatch.
   *
   * ─── The spend is one conditional UPDATE, and that is the whole point ───────
   *
   * `updateMany` on the primary key with `usedAt: null` in the WHERE clause,
   * reading the row count it reports. Never a read followed by a write: two
   * concurrent requests naming one grant would both read `usedAt IS NULL`, both
   * conclude they may proceed, and both dispatch the irreversible action. This
   * codebase has already paid for that shape once — a create race that could not
   * be decided by reading first, because Postgres stamps `createdAt` at
   * transaction START — and the discipline is the same one `appendTurn` uses for
   * the turn sequence and `close()` uses for the tier raise.
   *
   * The count is 0 or 1 because `id` is the primary key, so "did I win" has no
   * ambiguous middle. `> 0`, never `>= 0`: `updateMany` reports 0 when the WHERE
   * clause matched nothing, which is the answer for every case this gate exists
   * to refuse.
   *
   * ─── What the WHERE clause is carrying ──────────────────────────────────────
   *
   *   `conversationId` and `userId` — a grant issued in one conversation cannot
   *   be spent in another, nor by anyone but its author. Both are compared
   *   against the columns written at issue, so this holds whatever the caller
   *   claims; and the conversation is resolved through `conversationForGrant()`
   *   first, so a thread its author has removed reaches no grant of its own.
   *
   *   `toolName` and `argsDigest` — a grant issued for "delete invoice 41"
   *   cannot dispatch "delete invoice 42", including when both are approved in
   *   the same batch, where nothing else tells the two ids apart.
   *
   *   `usedAt IS NULL` and `expiresAt > now` — once, and not for ever. The clock
   *   is the dispatch's own (`claim.now`), so every candidate in one run is
   *   judged against one instant rather than against a clock that moves between
   *   them.
   *
   * ─── FAIL CLOSED ────────────────────────────────────────────────────────────
   *
   * A store that cannot be reached rejects, and the red action does not run.
   * This is the deliberate exception to the rule that persistence never fails a
   * run (file header, rule 5): everywhere else the work has already happened and
   * only its record is at stake, whereas here the work has NOT happened and an
   * unspendable grant is an unproven approval. A future reader who makes this
   * swallow like its neighbours turns an outage into a free pass on exactly the
   * actions that move money.
   */
  async spend(claim: ApprovalGrantClaim): Promise<boolean> {
    // Nothing named is not a store failure and needs no query: an approval
    // nobody sent is simply absent.
    if (!claim.grantId) return false;

    const conversation = await this.conversationForGrant(claim);
    if (!conversation) {
      this.logger.warn(
        `Refusing to spend an approval grant for ${claim.toolName}: conversation ` +
          `${claim.conversationId} is not this caller's live thread.`,
      );
      return false;
    }

    const spent = await this.prisma.msaidiziApprovalGrant.updateMany({
      where: {
        id: claim.grantId,
        conversationId: conversation.id,
        userId: claim.userId,
        toolName: claim.toolName,
        argsDigest: claim.argumentDigest,
        usedAt: null,
        expiresAt: { gt: claim.now },
      },
      data: { usedAt: claim.now },
    });

    return spent.count > 0;
  }

  /**
   * The conversation a grant is scoped to, if it is this caller's and still
   * there.
   *
   * The one authorisation point both halves of the ledger share. It is NOT
   * `scopeFor()`, and the difference is worth stating rather than reading as an
   * omission: the port hands this file a userId, not an `AuthUser`, so the
   * company clause cannot be evaluated here at all. It does not need to be. The
   * conversation id the loop passes is never a caller's claim — `open()`
   * resolved it through the whole of `scopeFor()`, company clause included,
   * earlier in the same request, and the controller passes the RESOLVED row's id
   * rather than the one the client sent (`MsaidiziController.runRequestFor`). So
   * a caller who has lost the company cannot reach a conversation id to be
   * scoped by in the first place.
   *
   * What is left here is what can still change between that resolution and the
   * dispatch, and what the ledger must therefore check for itself: authorship,
   * and a thread removed from another tab mid-run.
   */
  private async conversationForGrant(scope: { conversationId: string; userId: string }) {
    return this.prisma.msaidiziConversation.findFirst({
      where: { id: scope.conversationId, userId: scope.userId, deletedAt: null },
      select: { id: true, turnCount: true },
    });
  }

  // ─── Read path ──────────────────────────────────────────────────────────────

  /**
   * The caller's own CHATS, newest first. Metadata only — a list never decrypts
   * anything.
   *
   * Procedure runs are excluded, and that is a decision rather than a filter for
   * tidiness. This list is the chat rail: its empty state says "Ask Msaidizi
   * something and it will appear here", and clicking a row hydrates it into the
   * composer as a conversation to carry on. A procedure run is neither. Its
   * title is a slice of a saved instruction rather than anything the user
   * typed, and continuing it as a chat would run inside the full capability
   * registry against the procedure's own working state — dropping the
   * `restrictTo` list a human reviewed and approved it with. Not an escalation
   * (the agent still runs under the caller's own permissions either way), but a
   * scope the procedure surface never offered, reached by clicking a row in a
   * list of chats.
   *
   * Nothing about the record is lost by leaving it out of this list. The
   * conversation and its turn still exist, still carry `procedureId`, still
   * appear in `oversight()`, and still open by id through `findOne()`; what the
   * run DID is in `audit_logs` under the same `agentSessionId` regardless. The
   * one thing that goes is the affordance.
   *
   * The predicate is "any turn a procedure opened", not "every turn": a thread a
   * procedure has run in stays out of the rail even if a later turn did not come
   * from one. Nothing mixes the two today — a procedure run is only ever filed
   * under a session id the procedure surface itself minted or was handed back —
   * and if that ever changes, the conservative half is the one that does not put
   * an unrestricted continuation one click away.
   */
  async list(user: AuthUser, page = 1, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    const where: Prisma.MsaidiziConversationWhereInput = {
      ...this.scopeFor(user),
      turns: { none: { procedureId: { not: null } } },
    };

    const [rows, total] = await Promise.all([
      this.prisma.msaidiziConversation.findMany({
        where,
        orderBy: [{ lastTurnAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.msaidiziConversation.count({ where }),
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
    // Same explicit `deletedAt` as `scopeFor()`, and for the same reason. A
    // removed conversation drops out of this projection too, which loses nothing
    // an overseer needs: what the agent DID is in `audit_logs`, under the user's
    // own id, and no delete on this table touches it.
    const where: Prisma.MsaidiziConversationWhereInput = {
      deletedAt: null,
      ...companyWhereForUser(user, query.companyId),
    };

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
      //
      //    `resumable` is deliberately NOT cleared here. It answers a different
      //    question — "was this conversation's working state small enough to
      //    keep at all" — and it is the field both the 410 below and the rail's
      //    notice branch on to choose which sentence the user reads. Clearing it
      //    on ordinary ageing makes every aged-out conversation say "this
      //    conversation is too long to continue", which is a different fact
      //    about a different cause, and the two ask the user for different
      //    things: wait-and-it-will-happen-again versus keep-them-shorter.
      //    Whether the state is still THERE is already answered by
      //    `resumeState` and `resumeExpiresAt`, which this does clear.
      await this.prisma.$executeRaw`
        UPDATE "msaidizi_conversations"
           SET "resumeState" = NULL, "resumeBytes" = 0, "resumeExpiresAt" = NULL
         WHERE "id" IN (
           SELECT "id" FROM "msaidizi_conversations"
            WHERE "resumeExpiresAt" IS NOT NULL
              AND "resumeExpiresAt" < now()
            LIMIT ${batch}
         )`;

      // 2. Approval grants past their clock, spent or not.
      //
      //    THIS IS HYGIENE, NOT THE ENFORCEMENT, and the difference matters
      //    enough to state where the statement lives. What makes an expired
      //    grant unspendable is `expiresAt > now` in `spend()`'s own WHERE
      //    clause; this only reclaims the rows. So a sweep that never
      //    runs — because it is bounded, opportunistic and swallowed — cannot
      //    resurrect an approval, which is the failure mode a ledger enforced by
      //    a cleanup job would have.
      //
      //    Raw SQL for the same reason as the statements around it, with one
      //    difference worth knowing: this table has no `deletedAt`, so the
      //    soft-delete middleware would leave a `deleteMany` alone today. The
      //    column is absent deliberately (see `schema.prisma`), and writing the
      //    delete the same way as its neighbours keeps the sweep reading as one
      //    thing rather than three shapes with an invisible rule about which is
      //    safe where.
      await this.prisma.$executeRaw`
        DELETE FROM "msaidizi_approval_grants"
         WHERE "id" IN (
           SELECT "id" FROM "msaidizi_approval_grants"
            WHERE "expiresAt" < now()
            LIMIT ${batch}
         )`;

      // 3. Conversations past the retention window, and removed ones past their
      //    grace. A real DELETE; turns and grants cascade.
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
   *
   * `deletedAt: null` is stated here rather than left to the Prisma soft-delete
   * middleware. The middleware does add it today, so this is not a live leak —
   * but every other service in this codebase states it anyway (over a thousand
   * call sites), the middleware hangs off `$use`, which Prisma has deprecated,
   * and the failure mode if it ever stops running is that removed conversations
   * quietly return to their author's list while the delete dialog goes on
   * promising they will not. A guarantee this file makes in its own comments
   * should be enforced by this file.
   */
  private scopeFor(user: AuthUser): Prisma.MsaidiziConversationWhereInput {
    return {
      userId: user.id,
      deletedAt: null,
      OR: [{ companyId: null }, companyWhereForUser(user)],
    };
  }

  private async startConversation(input: OpenTurnInput, sessionId: string): Promise<OpenedTurn> {
    const now = new Date();
    const persistedPrompt = this.persistenceSecrets.sanitizeText(input.prompt).value;

    try {
      const conversation = await this.prisma.msaidiziConversation.create({
        data: {
          agentSessionId: sessionId,
          userId: input.user.id,
          companyId: input.user.companyId ?? null,
          title: deriveTitle(persistedPrompt),
          turnCount: 1,
          lastTurnAt: now,
          expiresAt: new Date(now.getTime() + this.config.conversationRetentionDays * 86_400_000),
          turns: {
            create: {
              sequence: 1,
              prompt: persistedPrompt,
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
      // A session id already taken is the one failure here whose cause is known,
      // and it is the one id that must not be run under.
      //
      // This is now a backstop rather than a gate, and saying so is the point.
      // Every caller reaches this method with a freshly minted id — `open()`
      // mints when no id arrived, and `continueBySession` mints whenever the
      // one that did resolved to nothing this caller owns — so a collision here
      // means two `randomUUID()` calls produced the same 128 bits, which is not
      // a thing that happens. Kept because the alternative to a defence that
      // never fires is a `degraded()` that would hand the run the colliding id,
      // and because the branch below is what the unique index is FOR: whatever
      // the cause, an id already naming a conversation is one this run must not
      // be filed under.
      if (isSessionIdTaken(err)) {
        const fresh = mintSessionId();
        this.logger.warn(
          `Session id ${sessionId} already names a conversation, so this run cannot be filed ` +
            `under it; running unpersisted under a freshly minted id instead. This id was ` +
            `minted, not supplied, so a collision here means two random 128-bit values matched.`,
        );
        return this.degraded(fresh, input, err);
      }
      return this.degraded(sessionId, input, err);
    }
  }

  /**
   * Continue by conversation id — the path a chat client uses.
   *
   * ─── Which side's history wins ──────────────────────────────────────────────
   *
   * THE RULE: whichever copy holds MORE of the conversation wins, and the server
   * wins a tie.
   *
   * "The server is authoritative" is the shorter sentence and it is only correct
   * while the server's copy is actually the fresher one. It usually is, and the
   * two cases this path exists for are exactly the cases where it is: a
   * conversation reopened in a second tab or on another device carries no
   * history at all, and a socket that died during the large `result` frame
   * leaves that tab a turn behind a store that had already committed. Both are
   * answered correctly by preferring the stored state.
   *
   * But the server's copy CAN be a turn behind, by a mechanism this file builds
   * itself. When `appendTurn`'s transaction fails, the turn comes back from its
   * catch with no `conversationId` and no `turnId`; `close()` early-returns on
   * exactly that, so `resumeState` keeps the PREVIOUS turn's array while the run
   * itself happened and handed the client its `messages` in full. `close()`'s
   * own transaction failing has the same effect. The rolled-back turn left
   * `turnCount` where it was too, so the 409 guard above sees nothing to
   * complain about: both sides claim the same sequence, and only the arrays
   * differ. Taking the server's copy there discards a turn the client is holding
   * — including, on the run that matters most, a red-tier proposal the user is
   * about to approve.
   *
   * Length is the clock, and it is a sound one because both arrays are the same
   * array. `RunResult.messages` is seeded from the history the run was given and
   * is only ever pushed onto (`msaidizi.service.ts`), the client echoes it back
   * by reference without touching it, and `close()` stores it verbatim. So along
   * one conversation it grows strictly, a turn at a time, and its length is how
   * many turns of that one lineage each side has seen. Equal lengths mean the
   * same turn, and the tie goes to the stored copy — the one that survives this
   * tab closing.
   *
   * Nothing here trusts the client with more than it already had: a client that
   * wants to hand the model an array of its own choosing can do so today on the
   * `continueBySession` path, under its own permissions, in its own
   * conversation. What is new is only that a longer client array is no longer
   * thrown away in favour of a shorter server one.
   *
   * ─── Where length cannot decide, and the answer is "no" ─────────────────────
   *
   * The comparison needs two copies. The two ways a turn goes unrecorded leave
   * the client holding a different number of them, and only one is answered by
   * comparing:
   *
   *   `appendTurn` rolls back — no row, `turnCount` untouched, and the opened
   *   turn reports no `conversationId`. The client's `session` frame therefore
   *   carries none either, so it knows its own turn went unrecorded and sends
   *   its full array. Two copies, longest wins, resolved.
   *
   *   `close()` fails — the row EXISTS, `turnCount` was already incremented, and
   *   the run reported `done` normally because `close()` swallows its own
   *   failures. The client sees a conversation id and a verdict, concludes the
   *   server holds this turn, and withholds its array as a courtesy. One copy,
   *   and it is the stale one. Nothing on the wire distinguishes this from a
   *   healthy conversation.
   *
   * What distinguishes it is in the store: `close()` is what overwrites a turn
   * row's `reason`, so the newest row still reading `'running'` is that failure's
   * own trace. `assertStoredStateIsUsable()` reads it, and this path answers 409
   * rather than resuming — because the alternative is appending an approval to a
   * conversation whose stored memory never contained the proposal, and a written
   * refusal the user can act on beats a silent substitution they cannot see.
   *
   * That refusal is on a clock, and has to be: nothing ever rewrites the row, so
   * a run killed by a deploy would otherwise leave the conversation refusing
   * every later turn forever. See `ABANDONED_TURN_MS`.
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
      //
      // The authoritative session id for this run is `conversation.agentSessionId`
      // — a column on the row we just failed to read. Nothing else can stand in
      // for it, least of all the id the request carried: this path cannot check
      // it against anything, and an id nothing checked is exactly what a
      // caller-chosen correlation key looks like in the audit trail. So the run
      // is re-identified. The turns either side of the outage land under
      // different session ids, which is coarser correlation and honest; adopting
      // the request's string would have been finer correlation and false.
      return this.degraded(mintSessionId(), input, err);
    }

    // Author-only. A peer or an admin asking for this id gets the same answer a
    // stranger gets, because there is no reading of it that could be correct.
    if (!conversation) throw new NotFoundException('Conversation not found.');

    // `> 0` is load-bearing, not defensive tidiness. Sequences are 1-based, so
    // the only way a client can hold a non-positive one is by having been handed
    // it — which nothing here does any more, and which older clients still do
    // for an unpersisted turn. Reading that as "behind by every turn" turns one
    // degraded turn into a permanent 409 on a conversation nothing is competing
    // for, and the sentence below would be a plain untruth.
    const claimed = input.clientSequence ?? 0;
    if (claimed > 0 && claimed < conversation.turnCount) {
      throw new ConflictException({
        message: 'This conversation continued in another window. Reload it before adding to it.',
        error: 'Conflict',
        code: CONVERSATION_CONFLICT_CODES.continuedElsewhere,
      });
    }

    const resumed = this.decodeResume(conversation);
    const sent = input.fallbackHistory ?? [];
    if (!resumed && sent.length === 0) {
      // Stated, not generic. A conversation past its resume clock is readable
      // and not continuable, and the user is told which of those it is.
      throw new GoneException(
        conversation.resumable
          ? 'This conversation can no longer be continued — its working state has expired. Its history is still readable; start a new conversation to carry on.'
          : 'This conversation is too long to continue — start a new one. Its history is still readable.',
      );
    }

    // The freshness comparison the header sets out. `>=` rather than `>` is the
    // tie going to the server; `resumed` being null is the server holding
    // nothing at all, which is already a loss.
    const preferServer = resumed !== null && resumed.length >= sent.length;
    if (!preferServer && resumed !== null) {
      this.logger.warn(
        `Conversation ${conversationId} resumed from the client: its stored state holds ` +
          `${resumed.length} messages and the client sent ${sent.length}. A turn was run ` +
          `against this conversation and never recorded.`,
      );
    }

    // Refuse rather than substitute, when we are about to resume from a stored
    // state we have positive evidence is stale and a run may still be writing
    // it. `assertStoredStateIsUsable` carries the argument and the clock.
    //
    // Only on the path that would take the server's copy. Where the client's is
    // longer it already holds the turn the store is missing, so it is the repair
    // rather than the casualty and refusing it would throw the repair away.
    if (preferServer) {
      await this.assertStoredStateIsUsable(conversation.id, conversation.turnCount);
    }

    return this.appendTurn(input, conversation, preferServer ? resumed : sent, {
      fromServer: preferServer,
    });
  }

  /**
   * Continue by agent session id — the pre-persistence path, kept working.
   *
   * The client owns the session id on this path and nothing here replaces it.
   * It is also authoritative on the history — WHEN IT SENT ONE. A client that
   * sends none is not asserting an empty conversation, it is asserting nothing,
   * and the difference decides whether this thread continues or silently starts
   * over under its own name. Reading silence as an empty history costs both
   * halves of the conversation:
   *
   *   - The question reaches the model with no context. It has never seen the
   *     supplier the user is asking a follow-up about, so it answers from
   *     nothing while the transcript above reads like a coherent thread.
   *   - `close()` then stores THAT run's message array as the conversation's
   *     resume state, replacing however many turns it held with one turn's
   *     worth. The transcript keeps growing, `continuable` stays true, and the
   *     model's memory of the conversation is gone irreversibly.
   *
   * So when the client sends nothing, the conversation's own stored state is
   * used — the same array `continueById` would have used. That is not the
   * client losing authority; it is the server answering a question the client
   * did not answer, with the only record that exists.
   *
   * Note the deliberate difference from `continueById`, which compares the two
   * copies and keeps the longer. There is nothing to compare here: a client on
   * this path has no `conversationId` and therefore never received a `sequence`
   * either, so it is not carrying a claim about stored state at all. Sent or not
   * sent is the only question this path can answer, and it answers it.
   *
   * The COMPARISON is the only thing that differs. The staleness refusal needs
   * no second copy to compare against — it reads the store — so it applies here
   * exactly as it does there, and on the same clock. Leaving it off would have
   * been the sharpest version of the substitution it prevents: this is the path
   * every procedure approval takes.
   */
  private async continueBySession(input: OpenTurnInput, sessionId: string): Promise<OpenedTurn> {
    let conversation: Prisma.MsaidiziConversationGetPayload<object> | null;
    try {
      conversation = await this.prisma.msaidiziConversation.findFirst({
        where: { agentSessionId: sessionId, ...this.scopeFor(input.user) },
      });
    } catch (err) {
      // The read that would have resolved this id to one of this caller's own
      // conversations is the read that just failed. An id nothing could check is
      // not honoured — it is dropped, and the run is re-identified. See
      // `OpenedTurn.sessionId` for what that costs and why it is now the cheaper
      // of the two.
      return this.degraded(mintSessionId(), input, err);
    }

    // THE ONE PLACE A CLIENT-SUPPLIED ID IS HONOURED is the line above this
    // one: `conversation` non-null means the id resolved, through `scopeFor()`,
    // to a conversation this caller owns — so the id `appendTurn` runs under is
    // that row's own `agentSessionId`, minted here on an earlier turn.
    //
    // Resolving to nothing starts a fresh conversation under a FRESH id, never
    // under the one that arrived. Four cases land here and the same answer is
    // right for all of them: the id names nothing at all (a client whose first
    // turn was never written), it names another user's conversation (the threat
    // the DTO's shape check cannot see), it names one this author deleted, or it
    // names one filed under a company they have since lost. Adopting it would
    // stamp this run's `audit_logs` rows with a correlation key this server
    // never issued to this caller, which is precisely what an overseer reading
    // the trail by session id would be misled by.
    //
    // Ignored, not rejected. A stale id in a reopened tab is ordinary, and
    // failing the user's question over it would be a worse outcome than
    // answering it under a new one.
    //
    // What this used to cost, and no longer does: red-tier confirmation ids were
    // derived from the session id, so a fresh id here recomputed every id an
    // approval could match and the user approved the same action for ever.
    // Approvals are `msaidizi_approval_grants` rows now — server-issued nonces
    // bound to a conversation and an argument digest — so re-identifying a run
    // cannot invalidate one. What a fresh conversation does cost an approval
    // still open in a stale tab is its grant's conversation, which no longer
    // resolves: the action is proposed again, with a new grant, and the user
    // answers it once. That is the correct outcome for an approval whose thread
    // the server cannot find.
    if (!conversation) return this.startConversation(input, mintSessionId());

    const sent = input.fallbackHistory ?? [];
    const resumed = sent.length > 0 ? null : this.decodeResume(conversation);

    // The same refusal `continueById` makes, on the same clock, and scoped the
    // same way: only when the STORED state is what this turn will run on. A
    // client that sent its own history is not about to be handed a stale copy of
    // anything, so there is nothing here to refuse.
    //
    // `ProceduresController.openTurn` never sends a `fallbackHistory`, so every
    // procedure approval resumes from stored state and every one of them reaches
    // this line. An approval appended to a conversation whose stored memory
    // never held the proposal is precisely the substitution being prevented, on
    // the surface this codebase calls the one a human pre-approved.
    if (resumed) {
      await this.assertStoredStateIsUsable(conversation.id, conversation.turnCount);
    }

    return this.appendTurn(input, conversation, resumed ?? sent, {
      fromServer: Boolean(resumed),
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
    const persistedPrompt = this.persistenceSecrets.sanitizeText(input.prompt).value;

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
            prompt: persistedPrompt,
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
      //
      // No `sequence`: the transaction rolled back, so the conversation's turn
      // count is unchanged and this turn occupies no position in it. Reporting
      // the position it WOULD have had would have the client claim, on its next
      // question, to have seen a turn the store never wrote.
      return {
        sessionId: conversation.agentSessionId,
        history,
        fromServer: opts.fromServer,
        priorTier,
      };
    }
  }

  /**
   * Persistence is unavailable. The run proceeds; only the history is lost.
   *
   * No `sequence` and no `conversationId`: this turn has no position in any
   * stored conversation, so it reports neither. See `OpenedTurn.sequence` for
   * why a zero here would be worse than silence.
   */
  private degraded(sessionId: string, input: OpenTurnInput, err: unknown): OpenedTurn {
    // Not "persistence unavailable": a session id collision reaches here too,
    // and on that path the store answered perfectly well.
    this.logger.error(
      `Conversation could not be persisted; running unpersisted: ${(err as Error)?.message}`,
    );
    return {
      sessionId,
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
   * Nothing here is redacted because the API requires content to be echoed back
   * unchanged. Instead, a payload containing a recognisable credential is not
   * stored at all. The live run still receives the original bytes; only durable
   * resume is disabled for that conversation turn. A supervisor-owned secret
   * reference is the long-term way to preserve resumability without persistence.
   */
  private encodeResume(messages: ModelMessage[]): {
    ciphertext: string | null;
    bytes: number;
    stored: boolean;
  } {
    const plaintext = JSON.stringify(messages);
    if (
      containsPersistedSecret(plaintext) ||
      this.persistenceSecrets.sanitizeJson(messages).redactionsApplied
    ) {
      return { ciphertext: null, bytes: 0, stored: false };
    }
    const bytes = Buffer.byteLength(plaintext, 'utf8');
    if (bytes > this.config.resumeMaxBytes) {
      // Store nothing rather than truncating. Dropping arbitrary blocks breaks
      // tool_use/tool_result pairing and produces a request the API rejects,
      // which the user would see as a generic failure.
      return { ciphertext: null, bytes: 0, stored: false };
    }
    return { ciphertext: this.encryption.encrypt(plaintext), bytes, stored: true };
  }

  /**
   * Refuses to resume from a stored state a turn still in flight is about to
   * overwrite — and lets the conversation through once that turn can only be
   * dead.
   *
   * ─── Why refuse at all ──────────────────────────────────────────────────────
   *
   * The freshness comparison callers make before this one only helps when the
   * client HAS the missing turn. It cannot when the client sends nothing, and
   * the client that most often sends nothing is the one that most needs this. A
   * run whose socket died on the `result` frame, but which reported its verdict,
   * leaves the client treating "row opened + run reported `done`" as "the server
   * has this turn" and withholding its own array as a courtesy. If `close()`'s
   * transaction is what failed, that inference is wrong and nothing on the wire
   * says so: `close()` swallows the failure, the run answered normally,
   * `turnCount` is already incremented, and only the resume state stayed behind.
   * The next request — an approval, typically — would then be appended to a
   * conversation that never saw the proposal, and the model would be handed a
   * yes to a question it has no record of asking.
   *
   * A turn row left at `reason: 'running'` is the trace that says so. It covers
   * a live run too, which is not a false positive: a second turn opened against
   * a conversation whose first run has not finished writing is two runs racing
   * to be its stored memory, and the correct answer to that is also "not yet".
   *
   * ─── Why the refusal has to expire ──────────────────────────────────────────
   *
   * "Not yet" is the whole of what this can honestly say, and without a clock it
   * said it forever. Nothing in this backend clears a stale `'running'`, so a
   * run killed by a deploy, an OOM or a dropped stream left the guard firing on
   * every later turn of that conversation for the life of the row — a crashed
   * run costing someone their conversation, under a sentence telling them to
   * wait for a write that was never going to happen.
   *
   * Past `ABANDONED_TURN_MS` the row is read as the trace of a run that died
   * rather than one still going, and the conversation resumes from the state it
   * does have — one turn short, which is exactly where it stood before this
   * guard existed, and survivable in a way a dead thread is not. The row is left
   * untouched: it is the record of an incident, not a lock, and rewriting it
   * would erase the only evidence that anything went wrong.
   */
  private async assertStoredStateIsUsable(
    conversationId: string,
    turnCount: number,
  ): Promise<void> {
    const unfinished = await this.unfinishedTurn(conversationId, turnCount);

    if (unfinished === 'in_flight') {
      throw new ConflictException({
        message:
          'The last thing you asked in this conversation has not finished being saved, so ' +
          'Msaidizi cannot safely carry on from it yet. Reload in a moment to see where it ' +
          'got to; if that run stopped without finishing, this clears by itself. Nothing ' +
          'you were asked to approve has been approved.',
        error: 'Conflict',
        code: CONVERSATION_CONFLICT_CODES.unfinishedTurn,
      });
    }

    if (unfinished === 'abandoned') {
      this.logger.warn(
        `Conversation ${conversationId} is being continued past turn ${turnCount}, whose row ` +
          `never reported how it ended and is now too old to still be running. Its resume ` +
          `state may be a turn behind.`,
      );
    }
  }

  /**
   * How this conversation's newest turn row stands: settled, still running, or
   * left running by something that is not coming back.
   *
   * `reason` is set to `'running'` when the row is opened and overwritten by
   * `close()`, so a newest row still reading `'running'` means exactly one
   * thing: no `close()` has succeeded for the turn the store believes is the
   * latest. Either it is happening right now, or its transaction failed and
   * never will. Nothing in the row distinguishes those two — but `startedAt`
   * bounds them, which is why it is read here alongside the reason.
   *
   * Sequence rather than `orderBy: createdAt`: the sequence is allocated under
   * the conversation's row lock and is unique per conversation, so it is the one
   * ordering two concurrent turns cannot disagree about. `turnCount` is the
   * sequence the last successful `appendTurn` handed out, so the row at that
   * number IS the newest — a rolled-back `appendTurn` leaves neither behind.
   *
   * Fails OPEN, at both ends. A row that cannot be read is not evidence of
   * anything, and turning an unrelated database hiccup into a refusal to
   * continue every conversation in the product is a worse failure than the one
   * this prevents; a row whose `startedAt` is missing or unreadable is called
   * abandoned rather than forever-live, for the same reason. The house rule that
   * persistence never fails a run applies here too: this is a guard built out of
   * stored state, so it can only be as available as the store, and it must not
   * be MORE consequential than it.
   */
  private async unfinishedTurn(
    conversationId: string,
    turnCount: number,
  ): Promise<'none' | 'in_flight' | 'abandoned'> {
    if (turnCount <= 0) return 'none';
    try {
      const newest = await this.prisma.msaidiziConversationTurn.findUnique({
        where: { conversationId_sequence: { conversationId, sequence: turnCount } },
        select: { reason: true, startedAt: true },
      });
      if (newest?.reason !== 'running') return 'none';

      const startedAt = newest.startedAt instanceof Date ? newest.startedAt.getTime() : 0;
      return Date.now() - startedAt < ABANDONED_TURN_MS ? 'in_flight' : 'abandoned';
    } catch (err) {
      this.logger.warn(
        `Could not check whether conversation ${conversationId} has an unfinished turn: ` +
          `${(err as Error)?.message}. Continuing without the check.`,
      );
      return 'none';
    }
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

/**
 * A fresh agent session id.
 *
 * Exported because `MsaidiziController` needs the same shape for the one case
 * this service cannot reach: `open()` itself failing in a way it does not own,
 * where the run still has to proceed under an id that stamps its audit rows.
 */
export function mintSessionId(): string {
  return `ms_${randomUUID().replace(/-/g, '')}`;
}

/**
 * A rejected insert whose cause was the unique index on `agentSessionId`.
 *
 * Worth telling apart from every other reason a conversation cannot be written,
 * because it is the only one that says something about the ID rather than about
 * the store: this exact session id already names a conversation, and — since the
 * caller's own rows were searched first — not one of the caller's own. Every
 * other failure leaves the id's standing unchanged.
 *
 * Unreachable in practice now that every id offered to this insert is one
 * `mintSessionId()` just produced; kept as the backstop that stops a colliding
 * id being run under whatever the cause. See `startConversation`'s catch.
 *
 * `target` is checked rather than assumed: `id` is unique here too, and a
 * collision on a v4 UUID primary key says nothing at all about the session id.
 * An absent target is read as this index because it is the only one a create on
 * this model can realistically collide on.
 */
function isSessionIdTaken(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = err.meta?.target;
  return !Array.isArray(target) || target.includes('agentSessionId');
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
export function redactEvents(
  events: MsaidiziEvent[],
  suppressModelOutput = false,
): MsaidiziEvent[] {
  return events.map((event) => {
    if (event.type === 'text') {
      return {
        ...event,
        text: suppressModelOutput
          ? PERSISTED_SECRET_PLACEHOLDER
          : redactPersistedSecrets(event.text),
      };
    }
    if (event.type === 'tool_call') {
      return {
        ...event,
        args: suppressModelOutput
          ? { redacted: PERSISTED_SECRET_PLACEHOLDER }
          : redactSensitiveFields(event.args ?? {}),
      };
    }
    if (event.type === 'confirmation_required') {
      return {
        ...event,
        description: suppressModelOutput
          ? PERSISTED_SECRET_PLACEHOLDER
          : redactPersistedSecrets(event.description),
        args: suppressModelOutput
          ? { redacted: PERSISTED_SECRET_PLACEHOLDER }
          : redactSensitiveFields(event.args ?? {}),
      };
    }
    if (event.type === 'tool_result' && event.error) {
      return {
        ...event,
        error: suppressModelOutput
          ? PERSISTED_SECRET_PLACEHOLDER
          : redactPersistedSecrets(event.error),
      };
    }
    if (event.type === 'error') {
      return {
        ...event,
        message: suppressModelOutput
          ? PERSISTED_SECRET_PLACEHOLDER
          : redactPersistedSecrets(event.message),
      };
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
