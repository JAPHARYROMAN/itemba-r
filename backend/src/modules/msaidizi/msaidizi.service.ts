/**
 * The agent loop.
 *
 * Every security property of the LOOP is a property of this file, and the loop
 * is not the whole feature — the ones below are here, and the ones named after
 * them are deliberately not:
 *
 *   - the tool set is derived from the caller's permissions, so an unpermitted
 *     capability is never offered rather than merely refused;
 *   - a tier the deployment has not enabled cannot be invoked even if a tool for
 *     it somehow reached the model;
 *   - a red-tier action suspends the run and returns to the user rather than
 *     executing on the model's say-so. The approval that comes back is a GRANT
 *     this server issued when it proposed — a random nonce written to the grant
 *     ledger, not a name the caller can compute — and it is SPENT in the ledger
 *     at dispatch, so it authorises one execution and one only, whether the
 *     action comes back inside this run or on a request next week. What no check
 *     in this file can establish is that a human answered the proposal;
 *     `RunRequest.confirmed` states exactly what the gate proves and what it
 *     does not;
 *   - every call is bounded, so a permission that allows an action once does not
 *     allow it in a loop — bounded per RUN, though, not per session, and
 *     `msaidizi.config.ts` says what that does and does not cap;
 *   - tool output re-enters the conversation fenced as data.
 *
 * Elsewhere, and not to be looked for here: the author-only read gate and the
 * encryption of retrieved records (`conversations.service.ts`), the permission
 * guard on the routes (`msaidizi.controller.ts`, `procedures.controller.ts`),
 * the minting and ownership resolution of the session id
 * (`conversations.service.ts`, `open()` — a client-supplied id is honoured only
 * where it resolves to a conversation that caller owns, and otherwise ignored in
 * favour of a fresh one), the row-level shape of the grant ledger this file
 * spends against, and the audit stamping every tool call produces
 * (`capability-invoker.ts`). A reader auditing "can user A read user B's
 * conversation" will find nothing in this file, because the answer is not here.
 *
 * The loop is written out rather than delegated to the SDK's tool runner
 * because confirmation is not an inline approve/deny — it suspends the run,
 * returns to the caller, and resumes on a later HTTP request. That is a state
 * machine, not a hook.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ReversibilityTier } from '../../common/capabilities/reversibility';
import { CapabilityInvoker } from './capability-invoker';
import { narrowCapabilities } from './domain-filter';
import { mintGrantId } from './dto/approval-grants';
import { ManifestProvider } from './manifest.provider';
import { ModelClient, ModelMessage, ModelToolUseBlock, ModelUsage } from './model-client';
import { MsaidiziConfig, WriteMode } from './msaidizi.config';
import { buildSystemPrompt, fenceToolResult } from './prompts';
import { buildRegistry, describeAction, indexByToolName, RegistryEntry } from './tool-registry';

/**
 * How many capabilities relevance narrowing may keep for one run.
 *
 * Not a hard ceiling on the tool set, and it is worth saying so where the number
 * lives: a turn carrying `confirmed` unions back the tools named in the prior
 * turn's tool_use blocks (see `registryFor`), so that one turn can exceed this by
 * however many tools a single assistant turn proposed. Every other turn lands at
 * or under it, and a caller whose permitted set is already below it is never
 * narrowed at all.
 */
const TOOL_BUDGET = 60;

export type MsaidiziEvent =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call';
      tool: string;
      capabilityId: string;
      tier: ReversibilityTier;
      args: Record<string, unknown>;
    }
  | { type: 'tool_result'; tool: string; ok: boolean; status: number; error?: string }
  | {
      type: 'confirmation_required';
      /**
       * The approval itself: a nonce this server minted and wrote to the grant
       * ledger when it proposed this action. THIS is what a client sends back in
       * `confirmed`, and it is the only thing that can authorise the dispatch —
       * it is unguessable, it is bound in the ledger to this conversation, this
       * caller, this tool and these exact arguments, and it can be spent once.
       *
       * A fresh nonce per proposal, so the same action proposed twice carries two
       * different grant ids and a client keying its checkbox rows by this value
       * gets one row per proposal rather than two rows sharing one tick.
       */
      grantId: string;
      /**
       * A NAME for the action, derived from the session, the tool and the
       * arguments — stable, reproducible by anyone, and deliberately not an
       * authorisation. It is here so the same action always renders under the
       * same label and so a proposal can be recognised across turns.
       * `confirmationIdFor` says why it cannot be the approval.
       */
      confirmationId: string;
      tool: string;
      capabilityId: string;
      description: string;
      args: Record<string, unknown>;
    }
  | { type: 'done'; reason: DoneReason }
  | { type: 'error'; message: string };

export type DoneReason =
  | 'end_turn'
  | 'awaiting_confirmation'
  | 'tool_budget_exhausted'
  | 'write_budget_exhausted'
  | 'refused'
  /**
   * The model turn was cut off at `maxTokens` — the answer above it stops
   * wherever the ceiling fell, usually mid-sentence.
   *
   * Its own reason rather than `end_turn` because the client cannot tell the two
   * apart by looking: a truncated turn carries no tool_use blocks either, so
   * before this existed a supplier-balance answer cut at "totalling TZS 4,18"
   * rendered exactly like a finished one, with no notice of any kind. The
   * distinction lives in `stopReason`, which `model-client.ts` carries through
   * from the provider, and nowhere else.
   */
  | 'truncated'
  | 'failed';

export interface RunRequest {
  user: AuthUser;
  /** The caller's own Authorization header, passed through to every tool call. */
  authorization: string;
  /** Prior turns plus the new user message. */
  messages: ModelMessage[];
  /**
   * The audit correlation key: every `audit_logs` row this run produces is
   * stamped with it, and it is the conversation's own `agentSessionId`.
   *
   * SERVER-MINTED, and that sentence is now true rather than aspirational. The
   * id is resolved before this service is reached: `open()` returns the
   * `agentSessionId` of a conversation this caller owns, or mints a fresh one.
   * A client-supplied id that resolves to no conversation of theirs is IGNORED —
   * never rejected, because failing a run over a stale id from a reopened tab is
   * a worse outcome than quietly re-identifying it. Minted here only when a
   * caller reaches `run()` directly with no id at all, which no route does.
   *
   * Approvals no longer hang off this value: a grant is bound to the
   * conversation row and to the caller, so a run that gets re-identified does
   * not strand approvals the way a session-derived id once did.
   */
  sessionId?: string;
  /**
   * The conversation this run belongs to — the row `open()` settled on.
   *
   * Required for any RED-tier action, and only for that: it is the scope a
   * grant is issued and spent under. A run given none (the store was unreachable
   * and the controller degraded to an unpersisted turn) can still read and still
   * write at amber, but cannot offer a red action for approval — there is
   * nowhere to record the grant, and an approval that cannot be recorded is one
   * that could never be proved when it came back. See the gate in `run()`.
   */
  conversationId?: string;
  /** The turn sequence this run was opened at, recorded on any grant it issues. */
  turnSequence?: number;
  /**
   * Grant ids the CALLER is sending as approved for this request.
   *
   * NOT ids the caller computed — that is the whole change. Each one is a nonce
   * this server minted when it proposed a red-tier action and wrote to the grant
   * ledger with the conversation, the caller, the tool, a digest of the exact
   * arguments, and an expiry. The client's only job is to hand back the ones it
   * was given, for the proposals the user actually ticked.
   *
   * What the gate PROVES when a red-tier call runs:
   *
   *   - this server PROPOSED that action. A grant exists only because `run()`
   *     wrote one while emitting a `confirmation_required` event, so an approval
   *     can no longer run ahead of the proposal it claims to answer, and — unlike
   *     the derived-id scheme this replaced — a fabricated conversation history
   *     buys nothing, because the ledger is the server's own record rather than
   *     a re-reading of the caller's array;
   *   - it is THIS action. The stored argument digest is compared against the
   *     digest of the action about to be dispatched, so an approval for a
   *     TZS 50,000 rent journal cannot dispatch a TZS 9,000,000 payroll one;
   *   - it is this conversation and this caller. A grant is scoped to both, so
   *     one lifted from another thread or another user's response is refused;
   *   - it bought exactly ONE dispatch, ever. The spend is a conditional update
   *     in the ledger, so the second attempt loses — whether it comes from the
   *     same turn, a later turn, a LATER REQUEST, or a concurrent request racing
   *     this one. Re-sending a spent grant re-proposes rather than re-executing;
   *   - it has not gone stale. Grants expire (`GRANT_TTL_MS`).
   *
   * What it does NOT prove, said plainly because the field's name invites the
   * opposite reading — this is not a receipt:
   *
   *   - that a human saw the proposal, or answered it. The grant proves the
   *     server OFFERED the action and that this request is holding the token it
   *     handed out; who clicked is outside anything this process can see. A
   *     client holding the run's own response can send the grant back
   *     unattended, which is why the frontend's confirmation gate — not this
   *     file — is where "a person ticked a box" is established.
   *
   * The boundary: exploiting that needs the caller's own bearer token, which
   * already reaches the underlying route directly, so no privilege boundary
   * moves. The threat this gate was built against — the MODEL approving its own
   * action — cannot reach this field at all, because nothing derives it from
   * model output or from tool results.
   */
  confirmed?: string[];
  /**
   * A saved procedure's approved capability list, when this run is an invocation
   * of one. Replaces the usual relevance-based narrowing: a procedure runs
   * inside the set it was reviewed with, not inside whatever looks relevant.
   */
  restrictTo?: RegistryEntry[];
}

/**
 * Real token spend for a run, accumulated across every model turn in the loop.
 *
 * Before this existed every cost figure in this project was an estimate. Note
 * that `inputTokens` is the uncached remainder only: the prompt actually sent is
 * `inputTokens + cacheReadInputTokens + cacheCreationInputTokens`, and a cost
 * calculation that sums `inputTokens` alone will silently under-report a run
 * whose cached prefix is doing its job.
 */
export interface RunUsage extends ModelUsage {
  /** Model turns in the loop. Each one re-sends the whole conversation. */
  modelTurns: number;
}

export interface RunResult {
  sessionId: string;
  events: MsaidiziEvent[];
  reason: DoneReason;
  /** Conversation state to send back on the next turn. */
  messages: ModelMessage[];
  /** What this run actually cost, in tokens. */
  usage: RunUsage;
}

/** One capability the caller's agent can actually reach, for the UI's lookup table. */
export interface ReachableCapability {
  /** The tool name the model sees, and the name that appears in run events. */
  name: string;
  /** Plain-language action phrase — what a step row should say instead of an identifier. */
  description: string;
  tier: ReversibilityTier;
  /** `GET /customers` — the underlying route. */
  path: string;
  capabilityId: string;
}

/**
 * What Msaidizi can do for one caller, right now, in this deployment.
 *
 * Deliberately answerable while the module is disabled: the only signal that
 * Msaidizi is off used to be a 503 from `POST /ask`, which meant a client had to
 * attempt a run to discover the feature was not available.
 */
export interface MsaidiziCapabilities {
  enabled: boolean;
  writeMode: WriteMode;
  allowedTiers: ReversibilityTier[];
  /**
   * Ceilings on ONE RUN — one request through `run()` — and on nothing wider.
   *
   * `maxWrites` in particular is not a per-conversation cap: the counter behind
   * it is a `run()` local, so a second request under the same session id starts
   * again at zero. See `msaidizi.config.ts` for what that does and does not
   * bound. A client rendering this figure should say "per request", never "for
   * this conversation".
   */
  budgets: {
    maxToolCalls: number;
    maxWrites: number;
    /** How many capabilities relevance narrowing keeps for one run. */
    toolBudget: number;
  };
  /**
   * Whether relevance narrowing runs for this caller, and how much it removes.
   *
   * A run gives no signal today that the tool set was cut from 474 to 41, and
   * that silence is the mechanism behind the worst failure mode in this design:
   * the agent answering confidently from a set that never contained the tool
   * holding the answer. The UI needs to be able to say so.
   */
  narrowing: {
    active: boolean;
    /** Everything the caller's permissions and the write mode allow. */
    permitted: number;
    /**
     * The most relevance narrowing keeps for a single turn.
     *
     * Not a hard maximum on the tool set: a turn carrying `confirmed` adds the
     * tools the prior turn proposed on top of this (`registryFor`), so a
     * confirmation turn can be a few tools wider. Every other turn lands here or
     * below.
     */
    perRun: number;
  };
  capabilities: ReachableCapability[];
}

/**
 * How long an issued approval stays spendable.
 *
 * An approval is an answer to a question the user is looking at, not a standing
 * permission, so it ages out rather than waiting forever for a tab to be
 * reopened. Thirty minutes is deliberately the same order as
 * `ABANDONED_TURN_MS` in `conversations.service.ts` — past any run this service
 * can produce, and short enough that a grant left in a browser overnight is
 * dead by morning.
 *
 * Expiry costs the user a second ask and nothing else: an expired grant is
 * refused, and the action is proposed again under a fresh one.
 */
const GRANT_TTL_MS = 30 * 60 * 1000;

/**
 * One issued approval — the server's own record that it proposed an action and
 * will execute it ONCE if the grant comes back.
 *
 * Every field is written by this service at proposal time. None of it is
 * caller-supplied except by way of what the model asked for.
 */
export interface ApprovalGrant {
  /**
   * A fresh random nonce, minted per proposal. Never derived from the action,
   * the session or anything else a caller holds — deriving it is exactly what
   * made the id it replaced computable, and therefore forgeable.
   */
  grantId: string;
  /** The conversation the proposal was made in. A grant does not travel. */
  conversationId: string;
  /** The caller it was issued to. A grant is not transferable between users. */
  userId: string;
  toolName: string;
  /** `argumentDigestFor(args)` over the exact arguments proposed. */
  argumentDigest: string;
  /** The turn the proposal was made on, where the turn has a sequence. */
  proposedOnTurn?: number;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * The claim a dispatch makes against the ledger.
 *
 * Every field must match the stored grant for the spend to win, and
 * `argumentDigest` is computed from the arguments ACTUALLY being dispatched —
 * never from the ones that were proposed — which is what makes a grant for
 * action A unable to run action B.
 */
export interface ApprovalGrantClaim {
  grantId: string;
  conversationId: string;
  userId: string;
  toolName: string;
  argumentDigest: string;
  /** The clock the stored `expiresAt` is judged against. */
  now: Date;
}

/**
 * The grant ledger.
 *
 * Two methods and no read, deliberately. There is no `find` here because a
 * spend must not be a read followed by a write: two concurrent requests holding
 * one grant would both read it unused and both dispatch, which is the duplicate
 * payment the red tier exists to prevent. `spend` is a single conditional
 * update — `usedAt IS NULL` and every scope field matching — that reports
 * whether THIS call won it.
 *
 * A narrow interface rather than the concrete store, so this service can be
 * tested against a double and so the persistence details (Prisma, the table,
 * the sweep) stay in the file that owns them.
 *
 * FAILURE SEMANTICS, and they are the opposite of the rest of this module:
 * both methods MUST reject rather than resolve when the store cannot be
 * reached. `spend` resolving `false` means "there was no such spendable grant",
 * which is a fact about the ledger; it must never mean "the ledger could not be
 * asked". `run()` treats those two differently and only one of them is safe to
 * re-propose on.
 */
export interface ApprovalGrantStore {
  /** Records a fresh, unused grant. Rejects if it could not be persisted. */
  issue(grant: ApprovalGrant): Promise<void>;
  /**
   * Atomically marks the named grant used, if and only if it matches the claim
   * in full and is neither used nor expired. Resolves whether this call won it.
   */
  spend(claim: ApprovalGrantClaim): Promise<boolean>;
}

/** DI token for {@link ApprovalGrantStore}. Wired in `msaidizi.module.ts`. */
export const APPROVAL_GRANT_STORE = 'MSAIDIZI_APPROVAL_GRANT_STORE';

/** Where a grant is issued and spent: one conversation, one caller, one turn. */
interface GrantScope {
  conversationId: string;
  userId: string;
  turn?: number;
}

/** What asking the ledger to spend an approval came back with. */
type SpendOutcome =
  /** A grant matched in full and this dispatch owns it. */
  | 'spent'
  /** The ledger answered, and holds no spendable grant for this action. */
  | 'refused'
  /** The ledger could not be asked. Not the same answer, and not safe to treat as one. */
  | 'unavailable';

@Injectable()
export class MsaidiziService {
  private readonly logger = new Logger(MsaidiziService.name);

  constructor(
    private readonly config: MsaidiziConfig,
    private readonly manifest: ManifestProvider,
    private readonly model: ModelClient,
    private readonly invoker: CapabilityInvoker,
    /**
     * Optional to CONSTRUCT, never optional to USE: a deployment that forgets to
     * wire it cannot approve a red-tier action at all, because there is nowhere
     * to record a grant and nothing to spend one against. That is the fail-closed
     * direction, and it is logged loudly at the gate rather than silently at boot,
     * because the gate is where it becomes visible to a user.
     */
    @Optional()
    @Inject(APPROVAL_GRANT_STORE)
    private readonly grants?: ApprovalGrantStore,
  ) {}

  async run(request: RunRequest, emit?: (event: MsaidiziEvent) => void): Promise<RunResult> {
    const sessionId = request.sessionId ?? `ms_${randomUUID().replace(/-/g, '')}`;
    const events: MsaidiziEvent[] = [];
    const record = (event: MsaidiziEvent) => {
      events.push(event);
      emit?.(event);
    };

    const registry = this.registryFor(request);
    const byName = indexByToolName(registry);

    /**
     * The grants this request offers, and which of them are still in hand.
     *
     * A candidate list, NOT a set of approvals: nothing here has been checked.
     * Every id in it is a string the caller sent, and the only thing that turns
     * one into an authorisation is winning a conditional update in the ledger at
     * the moment of dispatch. Which is why this reduction no longer tries to
     * decide anything on its own — the version it replaced filtered ids against
     * the proposals in `request.messages`, because the ids were derived and the
     * message array was the only record that a proposal had ever been made. It
     * was reading the caller's own array for evidence about the caller's own
     * claim. The ledger is the server's record, so that check has nothing left
     * to add and has gone.
     *
     * A SET, so a client that lists the same grant twice offers it once. That is
     * tidiness rather than protection now: the ledger would refuse the second
     * spend of one grant anyway.
     *
     * Entries are removed as they are spent, so a grant cannot be offered again
     * to a later action in the same run without a second round trip proving it
     * is gone — the ledger is still the authority, this just avoids asking it
     * something it has already answered.
     */
    const offeredGrants = new Set(request.confirmed ?? []);

    /**
     * The scope every grant in this run is issued and spent under.
     *
     * Undefined when the turn is unpersisted — the store was unreachable and the
     * controller degraded rather than failing the question. Red-tier actions
     * cannot be offered at all in that state; see the gate below.
     */
    const grantScope: GrantScope | undefined = request.conversationId
      ? {
          conversationId: request.conversationId,
          userId: request.user.id,
          turn: request.turnSequence,
        }
      : undefined;

    const messages: ModelMessage[] = [...request.messages];
    const system = buildSystemPrompt({
      writeMode: this.config.writeMode,
      userName: request.user.fullName,
      today: new Date().toISOString().slice(0, 10),
    });

    let toolCalls = 0;
    let writeCalls = 0;
    const usage: RunUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      modelTurns: 0,
    };

    for (;;) {
      let response;
      try {
        response = await this.model.createMessage({
          system,
          messages,
          tools: registry.map((entry) => entry.tool),
          maxTokens: this.config.maxTokens,
        });
      } catch (err) {
        this.logger.error(`Model request failed: ${(err as Error)?.message}`);
        record({ type: 'error', message: 'The assistant could not complete this request.' });
        return this.finish(sessionId, events, 'failed', messages, usage, record);
      }

      // Accumulated before anything can return: a run that stops on a refusal or
      // a budget still spent the tokens it spent, and a cost figure that only
      // counts clean completions is not a cost figure.
      usage.modelTurns += 1;
      if (response.usage) {
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;
        usage.cacheReadInputTokens += response.usage.cacheReadInputTokens;
        usage.cacheCreationInputTokens += response.usage.cacheCreationInputTokens;
      }

      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          record({ type: 'text', text: block.text });
        }
      }

      if (response.stopReason === 'refusal') {
        return this.finish(sessionId, events, 'refused', messages, usage, record);
      }

      // The output ceiling. Deliberately checked BEFORE the tool_use blocks are
      // filtered and dispatched — but AFTER the text blocks above have been
      // recorded — and deliberately returning like `refused` does, without
      // pushing the assistant turn onto `messages`.
      //
      // Both halves of that placement are load-bearing, so neither the loop
      // above nor this branch may move across the other. A turn cut at
      // `maxTokens` is cut wherever the counter ran out. That is usually
      // mid-sentence in the answer, but it can equally be mid-`tool_use` with
      // the argument JSON unfinished, and dispatching the blocks would run a
      // real call built from arguments the model never finished writing — so
      // this sits above the dispatch. The fragment the model did manage to write
      // is the whole point of labelling the turn rather than dropping it, and
      // moving this branch above the text loop would silently withhold it — so
      // this sits below the recording. The same cut is why the turn is not kept:
      // a partial `tool_use` in the history has no `tool_result` to pair with,
      // which the provider rejects on the next turn, and a half-written
      // assistant message is not conversation state worth resuming from.
      //
      // Without this branch the run falls through to `end_turn` at the bottom of
      // this block, because a truncated turn carries no completed tool_use
      // blocks either, and the client is told a cut-off answer is a finished one.
      if (response.stopReason === 'max_tokens') {
        return this.finish(sessionId, events, 'truncated', messages, usage, record);
      }

      const toolUses = response.content.filter(
        (block): block is ModelToolUseBlock => block.type === 'tool_use',
      );

      messages.push({ role: 'assistant', content: response.content });

      if (toolUses.length === 0) {
        return this.finish(sessionId, events, 'end_turn', messages, usage, record);
      }

      const results: unknown[] = [];
      let suspended = false;
      /**
       * A red-tier action met the gate and the grant ledger could not be reached
       * — so it was neither dispatched nor offered for approval.
       *
       * Separate from `suspended` because they are different answers: a
       * suspended run is waiting for the user and its next request continues it,
       * while this one has nothing for the user to answer and needs the run
       * reported as failed. Both may happen in one turn, and the failure wins;
       * see below.
       */
      let ledgerUnavailable = false;

      for (const toolUse of toolUses) {
        const entry = byName.get(toolUse.name);

        if (!entry) {
          // The model named something outside its own tool set. Never resolve
          // this by searching the manifest — the registry is the envelope.
          results.push(
            errorResult(toolUse.id, `No such tool: ${toolUse.name}. Use only the tools provided.`),
          );
          continue;
        }

        if (!this.tierAllowed(entry.capability.tier)) {
          // Defence in depth: buildRegistry already excludes disallowed tiers,
          // so reaching here means the two disagreed. Refuse and say so.
          this.logger.error(
            `Tier ${entry.capability.tier} tool ${toolUse.name} reached dispatch under write mode ${this.config.writeMode}.`,
          );
          results.push(errorResult(toolUse.id, 'That action is not enabled in this deployment.'));
          continue;
        }

        if (toolCalls >= this.config.maxToolCallsPerRun) {
          results.push(errorResult(toolUse.id, 'Tool call budget for this run is exhausted.'));
          record({ type: 'done', reason: 'tool_budget_exhausted' });
          return this.finish(
            sessionId,
            events,
            'tool_budget_exhausted',
            messages,
            usage,
            record,
            true,
          );
        }

        const isWrite = entry.capability.tier !== 'green';
        if (isWrite && writeCalls >= this.config.maxWritesPerRun) {
          results.push(errorResult(toolUse.id, 'Write budget for this run is exhausted.'));
          record({ type: 'done', reason: 'write_budget_exhausted' });
          return this.finish(
            sessionId,
            events,
            'write_budget_exhausted',
            messages,
            usage,
            record,
            true,
          );
        }

        const args = (toolUse.input ?? {}) as Record<string, unknown>;

        if (entry.capability.tier === 'red') {
          const confirmationId = confirmationIdFor(sessionId, toolUse.name, args);
          // Computed from the arguments about to be DISPATCHED, never from the
          // ones that were proposed — the two are the same only when the model
          // asked for the same thing twice, and the whole point of the digest is
          // to catch the case where it did not.
          const argumentDigest = argumentDigestFor(args);

          // The approval is SPENT here, at the moment of dispatch, not merely
          // consulted — and it is spent in the LEDGER, which is what makes the
          // one-shot survive the request boundary.
          //
          // "This exact action was approved" has two halves. Binding the id to
          // the exact arguments is the first; ONCE is the second, and without it
          // one tick of one checkbox authorised the approved action as many
          // times as the model cared to emit it — bounded only by the per-run
          // write ceiling (`maxWritesPerRun`, 10 by default), never by the
          // approval.
          // Measured before this line existed: one approved TZS 9,000,000
          // payroll journal, ten identical tool_use blocks, TZS 90,000,000
          // posted, no second gate.
          //
          // The case that makes this ordinary rather than adversarial is a
          // failed write. `invoke` returning `{ok:false, status:0}` means the
          // call could not be reached — which is exactly the state in which the
          // write MAY ALREADY HAVE COMMITTED on the other side. A model retrying
          // it is doing the obvious thing, and a duplicate payment is the
          // specific harm the red tier exists to prevent. Nothing in this
          // process can tell whether the first one landed; a human looking at
          // the record can. So a repeat re-proposes and the human decides again,
          // and that is the RIGHT outcome, not a tolerated cost. `prompts.ts`
          // also tells the model not to retry a failed irreversible call, but
          // prompt text is advice to a model, not a control — this branch is the
          // control.
          //
          // SCOPE, stated plainly because it is easy to read as more than it is.
          //
          // What winning a spend establishes: this server proposed that exact
          // action, in this conversation, to this caller, and wrote a grant for
          // it; the grant came back; it had not been used; it had not expired;
          // and this dispatch is the one that took it. What it does not
          // establish is that a PERSON answered the proposal. The grant proves
          // the offer and proves possession of the token the offer handed out —
          // a client holding the run's own response can send it back unattended.
          // "A human ticked a box" lives in the confirmation gate in the
          // frontend, and no check in this file can stand in for it.
          //
          // Why a ledger rather than remembering the derived id. The derived id
          // is deterministic, so an id marked spent forever would make a
          // legitimately repeated identical action — the same weekly journal,
          // posted again next week — permanently unapprovable, since approving
          // it again can only ever produce the same id. Grants invert that: the
          // server issues a NEW nonce every time it proposes, so the same action
          // is approvable as many times as it is genuinely offered, and each
          // offer is answerable exactly once.
          //
          // What the ledger closed that the per-run Set could not: the Set died
          // at the request boundary, so a client that kept an approval and sent
          // it again on a LATER request bought one more execution per request —
          // the proposal it bound to was still sitting in the history, and
          // nothing anywhere had a record that the approval had already been
          // used. Measured before this: one approved TZS 9,000,000 payroll
          // journal, the same request replayed five times, TZS 45,000,000
          // posted, five clean transcripts each showing one approval and one
          // execution.
          //
          // The ordinary case, with no attacker in it, is a failed write.
          // `invoke` returning `{ok:false, status:0}` means the call could not be
          // reached — which is exactly the state in which the write MAY ALREADY
          // HAVE COMMITTED on the other side. A model retrying it is doing the
          // obvious thing, and a duplicate payment is the specific harm the red
          // tier exists to prevent. Nothing in this process can tell whether the
          // first one landed; a human looking at the record can. So a repeat
          // re-proposes and the human decides again. `prompts.ts` also tells the
          // model not to retry a failed irreversible call, but prompt text is
          // advice to a model, not a control — this branch is the control.
          const outcome = await this.spendApproval(
            grantScope,
            offeredGrants,
            toolUse.name,
            argumentDigest,
            sessionId,
          );

          if (outcome !== 'spent') {
            // FAIL CLOSED, and this is the one place in this module that does.
            //
            // `conversations.service.ts` and `msaidizi.controller.ts` swallow
            // every persistence failure on purpose: by the time they write, the
            // model turn and the tool calls have already happened, so refusing
            // to answer would cost the user work that is already done and
            // already in `audit_logs`. Reading that rule and applying it here
            // would be exactly backwards. This write happens BEFORE the action,
            // and it is the only thing standing between an approval and an
            // irreversible dispatch. An unspendable grant is an unproven
            // approval — so when the ledger cannot be reached, nothing runs.
            // A future reader tempted to make this "consistent" with the file
            // two doors down would be turning the gate off during exactly the
            // outage in which nobody can check what it did.
            //
            // 'unavailable' is not re-proposed on: issuing the replacement grant
            // needs the same ledger that just failed, and offering an approval
            // that cannot be recorded would put a button in front of the user
            // that does nothing. The run reports the failure instead.
            const grantId =
              outcome === 'refused'
                ? await this.issueGrant(grantScope, toolUse.name, argumentDigest, sessionId)
                : null;

            if (!grantId) {
              record({
                type: 'error',
                message:
                  'That action could not be offered for approval just now, so nothing was done. Please try again in a moment.',
              });
              results.push(
                errorResult(
                  toolUse.id,
                  'This action needs the user to confirm it, and the approval could not be recorded. It has not run. Do not retry it — tell the user it could not be offered for approval.',
                ),
              );
              ledgerUnavailable = true;
              continue;
            }

            record({
              type: 'confirmation_required',
              grantId,
              confirmationId,
              tool: toolUse.name,
              capabilityId: entry.capability.id,
              description: describeForConfirmation(entry, args),
              args,
            });
            results.push(
              errorResult(
                toolUse.id,
                'This action needs the user to confirm it before it can run. Stop and wait for their answer.',
              ),
            );
            suspended = true;
            continue;
          }
        }

        record({
          type: 'tool_call',
          tool: toolUse.name,
          capabilityId: entry.capability.id,
          tier: entry.capability.tier,
          args,
        });

        toolCalls += 1;
        if (isWrite) writeCalls += 1;

        const result = await this.invoker.invoke({
          capability: entry.capability,
          args,
          authorization: request.authorization,
          agentSessionId: sessionId,
        });

        record({
          type: 'tool_result',
          tool: toolUse.name,
          ok: result.ok,
          status: result.status,
          error: result.error,
        });

        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: !result.ok,
          content: fenceToolResult(toolUse.name, result.ok ? result.body : result.error),
        });
      }

      messages.push({ role: 'user', content: results });

      // Checked BEFORE `suspended`, and after the results have been paired onto
      // the conversation. A turn can both propose one action successfully and
      // fail to record a grant for another; reporting that as
      // `awaiting_confirmation` would tell the client the run is simply waiting,
      // and the action nobody can approve would look like one nobody answered.
      // The `error` event above says what happened; the reason says the run did
      // not do what it was asked.
      if (ledgerUnavailable) {
        return this.finish(sessionId, events, 'failed', messages, usage, record);
      }

      if (suspended) {
        return this.finish(sessionId, events, 'awaiting_confirmation', messages, usage, record);
      }
    }
  }

  /**
   * Spends one of the grants this request offered on the action about to run.
   *
   * The grants arrive as a flat list and nothing tells this service which id
   * belongs to which action — the client ticked boxes, it did not build a
   * mapping — so each candidate is offered to the ledger in turn and the ledger
   * decides. A grant issued for another action, another conversation, another
   * caller, or one already used or expired simply loses its conditional update,
   * which costs a round trip and authorises nothing. The first one to win is the
   * one this dispatch owns, and it is removed from the candidates so the same
   * grant is not offered twice inside one run.
   *
   * A throw is NOT a refusal. `false` is the ledger saying "no such spendable
   * grant"; an exception is the ledger not answering, and the two must not
   * collapse into one outcome — collapsing them would re-propose during an
   * outage, and re-proposing needs a write to the same ledger.
   */
  private async spendApproval(
    scope: GrantScope | undefined,
    offered: Set<string>,
    toolName: string,
    argumentDigest: string,
    sessionId: string,
  ): Promise<SpendOutcome> {
    if (!this.grants) {
      // Not a configuration warning to be found later in a log sample: without a
      // ledger no red-tier action can be approved in this deployment at all.
      this.logger.error(
        `Run ${sessionId}: no approval grant store is wired, so the red-tier action ${toolName} ` +
          `cannot be approved or offered for approval. Provide APPROVAL_GRANT_STORE.`,
      );
      return 'unavailable';
    }

    if (!scope) {
      // The turn is unpersisted: `open()` could not write a conversation row, so
      // there is nothing to scope a grant to. Read and amber work; red does not.
      this.logger.error(
        `Run ${sessionId}: this turn has no conversation row, so the red-tier action ` +
          `${toolName} cannot be offered for approval. Nothing was dispatched.`,
      );
      return 'unavailable';
    }

    const now = new Date();

    for (const grantId of offered) {
      let won: boolean;
      try {
        won = await this.grants.spend({
          grantId,
          conversationId: scope.conversationId,
          userId: scope.userId,
          toolName,
          argumentDigest,
          now,
        });
      } catch (err) {
        this.logger.error(
          `Run ${sessionId}: the approval ledger could not be reached to spend a grant for ` +
            `${toolName}; the action was NOT dispatched: ${(err as Error)?.message}`,
        );
        return 'unavailable';
      }

      if (won) {
        offered.delete(grantId);
        return 'spent';
      }
    }

    if (offered.size > 0) {
      // Ordinary as often as it is adversarial: a stale grant from a reopened
      // tab, an approval already spent on an earlier request, or a model that
      // changed the arguments after the user answered. All of them end the same
      // way — the action is proposed again and the user answers the new one.
      this.logger.warn(
        `Run ${sessionId}: ${offered.size} grant(s) were offered and none of them could be ` +
          `spent on ${toolName}; proposing it again rather than running it.`,
      );
    }

    return 'refused';
  }

  /**
   * Issues the grant that goes out with a `confirmation_required` event.
   *
   * The nonce is minted here rather than derived from anything, so it cannot be
   * computed by a caller holding the action, and a fresh one per proposal is
   * what lets the same action be approved again next week without the ledger
   * having to forget anything.
   *
   * Returns null when the grant could not be recorded, and the caller must then
   * NOT offer the action — an approval nobody can spend is a button that does
   * nothing, and it would arrive looking exactly like one that works.
   */
  private async issueGrant(
    scope: GrantScope | undefined,
    toolName: string,
    argumentDigest: string,
    sessionId: string,
  ): Promise<string | null> {
    if (!this.grants || !scope) return null;

    const now = new Date();
    const grantId = mintGrantId();

    try {
      await this.grants.issue({
        grantId,
        conversationId: scope.conversationId,
        userId: scope.userId,
        toolName,
        argumentDigest,
        proposedOnTurn: scope.turn,
        createdAt: now,
        expiresAt: new Date(now.getTime() + GRANT_TTL_MS),
      });
    } catch (err) {
      // Same inversion as the spend, for the same reason: this write happens
      // before the action, so failing it closed costs a re-ask and failing it
      // open would offer an approval the ledger has no record of.
      this.logger.error(
        `Run ${sessionId}: could not record an approval grant for ${toolName}; the action was ` +
          `not offered for approval: ${(err as Error)?.message}`,
      );
      return null;
    }

    return grantId;
  }

  /**
   * The tool set for this run: the caller's permitted capabilities, restricted to
   * enabled tiers, then narrowed to those relevant to what was asked.
   */
  private registryFor(request: RunRequest): RegistryEntry[] {
    // A procedure run is already bounded by the list a human approved. Narrowing
    // it further by relevance would silently drop steps the procedure needs, so
    // the approved set is used exactly as reviewed.
    if (request.restrictTo) return request.restrictTo;

    const permitted = buildRegistry(
      this.manifest.capabilities(),
      request.user.permissions ?? [],
      this.config.allowedTiers,
    );

    if (permitted.length <= TOOL_BUDGET) return permitted;

    // Defect B, and it is LATENT rather than live. Both current callers append a
    // string user message before calling run() — `msaidizi.controller.ts` and
    // `procedures.controller.ts` — so a string turn always exists today. The
    // original code fell through to `return permitted` when it did not, handing
    // the model the caller's entire permitted set: 474 tools read-only, over a
    // thousand at red. Guarded here so run()'s own contract holds for any future
    // caller rather than depending on what today's two happen to send. Structured
    // content now contributes its text blocks, and a turn carrying no text at all
    // narrows against '' — which lands on the floor of shallowest capabilities
    // rather than on everything.
    const requestText = latestUserText(request.messages) ?? '';

    const relevant = new Set(
      narrowCapabilities(
        permitted.map((e) => e.capability),
        requestText,
        { limit: TOOL_BUDGET, floor: Math.min(20, TOOL_BUDGET) },
      ).map((c) => c.id),
    );

    // Defect A — the confirmation defect. This is why no confirmed red-tier
    // action has ever executed in the history of this project.
    //
    // Narrowing re-derives the tool set from the newest user message on EVERY
    // turn, including the turn that carries `confirmed`. A broad role always
    // exceeds TOOL_BUDGET, so narrowing always runs, and a bare "yes" scores
    // against nothing: measured against the real manifest, "post journal entry
    // 41" yields 24 tools containing JournalEntries_post, while "yes" yields 20
    // that do not. The model re-issues the approved call, hits `if (!entry)` at
    // dispatch, and is told "No such tool" — so the action the user just
    // approved is structurally unable to run.
    //
    // The fix unions the narrowed set with the tools named in the prior turn's
    // tool_use blocks, rather than skipping narrowing entirely when `confirmed`
    // is non-empty. Both close the defect; union was chosen for three reasons.
    // First, blast radius: skipping narrowing sends the *entire* permitted set on
    // the one turn in the whole run that executes an irreversible action — the
    // largest tool payload of the run arriving exactly where precision matters
    // most. Second, scope: the user approved one action, and union keeps the
    // turn's reach at (what this question narrowed to) ∪ (what was actually
    // proposed), whereas skipping hands the model every capability the user
    // holds as a side effect of them saying yes to one. Third, it generalises to
    // one assistant turn proposing several red actions, since all of their
    // tool_use blocks live in that same turn.
    //
    // Note what this deliberately does NOT rely on: the incidental fact that a
    // descriptive confirmation ("Yes — go ahead and delete invoice 41") would
    // probably re-narrow correctly by carrying the right vocabulary. A safety
    // gate that works because of an accident of a lexical scorer is not a safety
    // gate. This holds for a bare "yes", for "ndiyo", and for silence.
    //
    // The union is drawn from `permitted`, never from the manifest, so the two
    // ceilings still bound it structurally: a tool the caller cannot reach or a
    // tier the deployment disabled cannot re-enter here.
    //
    // Note what the union is NOT gated on, since it reads like an oversight. It
    // fires on `confirmed` being non-empty without checking that a single id in
    // it is real, so the string 'grt_totally_made_up' re-admits the prior turn's
    // proposed tools. That is deliberate. Widening decides what the model may
    // SEE; it authorises nothing, because every red-tier tool it re-admits still
    // meets the gate in `run()`, where a grant this server never issued cannot
    // be spent. Gating the union on grant validity would turn an unrecognised
    // approval into "No such tool" — the model told the action does not exist,
    // and the user never asked again — instead of a fresh proposal they can
    // answer. The right answer to a bad grant is to ask again, not to hide the
    // action.
    if ((request.confirmed?.length ?? 0) > 0) {
      const proposed = toolNamesAwaitingConfirmation(request.messages);
      for (const entry of permitted) {
        if (proposed.has(entry.tool.name)) relevant.add(entry.capability.id);
      }
    }

    return permitted.filter((entry) => relevant.has(entry.capability.id));
  }

  /**
   * What this caller's agent can actually reach, and whether narrowing applies.
   *
   * Reports rather than acts, so it deliberately does not check `enabled` — a
   * client must be able to learn the feature is switched off without attempting
   * a run and reading a 503.
   */
  capabilitiesFor(user: AuthUser): MsaidiziCapabilities {
    const permitted = buildRegistry(
      this.manifest.capabilities(),
      user.permissions ?? [],
      this.config.allowedTiers,
    );

    return {
      enabled: this.config.enabled,
      writeMode: this.config.writeMode,
      allowedTiers: this.config.allowedTiers,
      budgets: {
        maxToolCalls: this.config.maxToolCallsPerRun,
        maxWrites: this.config.maxWritesPerRun,
        toolBudget: TOOL_BUDGET,
      },
      narrowing: {
        active: permitted.length > TOOL_BUDGET,
        permitted: permitted.length,
        perRun: Math.min(permitted.length, TOOL_BUDGET),
      },
      capabilities: permitted.map((entry) => ({
        name: entry.tool.name,
        // describeAction(), not entry.tool.description: the tool description has
        // tier and free-form-query notes appended for the model's benefit, which
        // are noise in a step row a manager reads.
        description: describeAction(entry.capability),
        tier: entry.capability.tier,
        path: `${entry.capability.verb} /${entry.capability.path}`,
        capabilityId: entry.capability.id,
      })),
    };
  }

  private tierAllowed(tier: ReversibilityTier): boolean {
    return this.config.allowedTiers.includes(tier);
  }

  private finish(
    sessionId: string,
    events: MsaidiziEvent[],
    reason: DoneReason,
    messages: ModelMessage[],
    usage: RunUsage,
    record: (event: MsaidiziEvent) => void,
    alreadyRecorded = false,
  ): RunResult {
    if (!alreadyRecorded) record({ type: 'done', reason });
    // One line per run, keyed by the session id that also stamps every audit row
    // the run produced — so a cost figure can be joined to what was actually done.
    this.logger.log(
      `Run ${sessionId} ${reason}: ${usage.modelTurns} model turns, ` +
        `${usage.inputTokens} input + ${usage.cacheReadInputTokens} cache read + ` +
        `${usage.cacheCreationInputTokens} cache write, ${usage.outputTokens} output tokens.`,
    );
    return { sessionId, events, reason, messages, usage };
  }
}

/** A content block carrying a `type` we can test, without trusting its shape. */
function blockType(block: unknown): string | undefined {
  if (typeof block !== 'object' || block === null) return undefined;
  const type = (block as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

/**
 * The newest user text in the conversation.
 *
 * Accepts both shapes `ModelMessage.content` allows: a plain string (what both
 * live callers send) and an array of provider content blocks, from which the
 * `text` blocks are joined. Tool results live in user turns as `tool_result`
 * blocks and carry no `text` field, so a resumed conversation's fenced payloads
 * cannot leak into the narrowing input and skew which tools are offered.
 */
function latestUserText(messages: ModelMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'user') continue;

    if (typeof message.content === 'string') {
      if (message.content.trim()) return message.content;
      continue;
    }

    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((block) => blockType(block) === 'text')
        .map((block) => (block as { text?: unknown }).text)
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .trim();
      if (text) return text;
    }
  }
  return undefined;
}

/**
 * Tool names the model proposed in the most recent assistant turn that made any
 * tool calls — the turn a `confirmed` id is answering.
 *
 * A suspended run always ends with that assistant turn followed by the user turn
 * carrying its tool results, so the most recent tool-calling assistant turn is
 * exactly the one that proposed the action awaiting approval. Scoping to a
 * single turn keeps the union bounded: the addition is at most the number of
 * tools named in one turn, not every tool touched across a long conversation.
 */
function toolNamesAwaitingConfirmation(messages: ModelMessage[]): Set<string> {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;

    const names = message.content
      .filter((block) => blockType(block) === 'tool_use')
      .map((block) => (block as { name?: unknown }).name)
      .filter((name): name is string => typeof name === 'string');

    if (names.length > 0) return new Set(names);
  }
  return new Set();
}

function errorResult(toolUseId: string, message: string) {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    is_error: true,
    content: message,
  };
}

/**
 * A stable, injective text for one argument value.
 *
 * Two requirements, and they pull in opposite directions. Stability: the model
 * may emit the same logical arguments with the keys in any order, and the same
 * action must produce the same text every time — so object keys are sorted, at
 * every level. Injectivity: two different argument sets must never produce the
 * same text, because this text is the material the approval id is derived from.
 * Injectivity here is necessary and not sufficient — a lossy encoding of the
 * text into bytes would throw it away again on the way to the digest, which is
 * why `confirmationIdFor` hashes it as UTF-16 rather than UTF-8.
 *
 * How the encoding earns injectivity:
 *
 *   - every value carries a type tag, so `1`, `"1"`, `true`, `null` and
 *     `undefined` are five different texts rather than one;
 *   - strings and object keys are length-prefixed, so a value containing the
 *     encoding's own punctuation cannot forge structure: `{a: '1,1:b=n:2'}`
 *     cannot pass itself off as `{a: 1, b: 2}`;
 *   - `undefined` has its own tag rather than being dropped, so `{memo: undefined}`
 *     and `{}` do not collide the way `JSON.stringify` makes them;
 *   - ARRAYS ARE NOT SORTED. Two journal lines swapped is a different journal
 *     entry, and an approval for one must not authorise the other.
 *
 * What this replaced, and why it mattered: `JSON.stringify(args, Object.keys(args).sort())`.
 * The second argument to `JSON.stringify` is a replacer ARRAY, not an ordering
 * hint, and a replacer array filters property names RECURSIVELY — so every
 * nested object was emptied. `{body:{invoiceId:41}}` and `{body:{invoiceId:42}}`
 * both came out as `{"body":{}}`. `buildToolDefinition` puts every request body
 * under a single `body` property, and `reversibility.ts` makes every write to
 * journal entries, payments, bank accounts, credit notes, period close, roles
 * and permissions red — so the collapse hit exactly the money-movement tier,
 * where one approval authorised any later action of the same tool.
 */
function canonicalise(value: unknown): string {
  if (value === undefined) return 'u';
  if (value === null) return 'z';
  if (typeof value === 'boolean') return value ? 't' : 'f';
  // `Object.is` rather than `===` so `-0` and `0` stay distinguishable; `String`
  // renders both as "0". NaN and the infinities are not JSON-representable but
  // are handled rather than thrown on, because `args` is provider input.
  if (typeof value === 'number') return Object.is(value, -0) ? 'n:-0' : `n:${String(value)}`;
  if (typeof value === 'string') return `s:${value.length}:${value}`;
  if (Array.isArray(value)) return `a[${value.map(canonicalise).join(',')}]`;
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `o{${Object.keys(source)
      .sort()
      .map((key) => `${key.length}:${key}=${canonicalise(source[key])}`)
      .join(',')}}`;
  }
  // bigint, symbol, function: not producible by a JSON tool_use payload, but a
  // tag rather than a throw, so a surprising shape suspends for its own
  // confirmation instead of failing the run.
  return `x:${typeof value}:${String(value)}`;
}

/**
 * The digest a grant is bound to: the exact arguments, and nothing else.
 *
 * Stored on the grant when the action is proposed and recomputed from the
 * arguments actually being DISPATCHED when it is spent, so a grant issued for a
 * TZS 50,000 rent journal loses its conditional update against a TZS 9,000,000
 * payroll one. `canonicalise` is shared with `confirmationIdFor` on purpose: two
 * separate canonicalisers would be two chances to disagree about what "the same
 * arguments" means, and only one of them would be the one guarding the money.
 *
 * The tool name is deliberately NOT folded in — it is its own column on the
 * grant and its own field in the claim, so a mismatch is legible in the ledger
 * rather than hidden inside a hash.
 *
 * Full digest rather than the 128 bits `confirmationIdFor` truncates to: this
 * one is never displayed, so there is nothing to be gained by shortening it and
 * a collision here would be an approval for one action spending on another.
 * 'utf16le' for exactly the reason spelled out below.
 */
export function argumentDigestFor(args: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalise(args), 'utf16le').digest('hex');
}

/**
 * A confirmation id bound to the exact action proposed — a NAME for an action,
 * and deliberately not the approval.
 *
 * Derived from the session, the tool and the arguments, so the same action
 * always renders under the same label and "delete invoice 41" and "delete
 * invoice 42" are never one row. That holds at every level of nesting: it is
 * `{body:{memo:'Rent',lines:[…]}}` in full that names the action, not the fact
 * that a body was present. See `canonicalise` above for how the argument text is
 * built and what it replaced.
 *
 * What the id does NOT carry is how many times it may be used, or that it was
 * ever issued: the same action always has the same name, which also means a
 * caller holding the three public inputs can compute one this server never
 * printed. That is why it no longer authorises anything. Authorisation is the
 * GRANT — a random nonce issued alongside this id and spent once in the ledger
 * (`ApprovalGrantStore`) — and this id rides along as belt and braces: it labels
 * the action, it is stable across turns, and it is what a transcript shows.
 * Sending it in `confirmed` buys nothing, because nothing in the ledger is
 * keyed by it.
 *
 * SHA-256 rather than the 32-bit rolling hash this used to carry. A 32-bit
 * digest is small enough to search offline for a second argument set landing on
 * the same id, and while that no longer authorises anything it would still put
 * two different actions on one label in front of a user deciding whether to
 * approve one of them. Tool results re-enter this conversation as data, so "the
 * model proposes arguments an attacker chose" is inside this file's threat
 * model, not outside it.
 *
 * Ids are recomputed from the live proposal on every turn. A stored transcript
 * keeps the ones it displayed, but only to redraw what was asked. So a deploy
 * that changes this function corrupts nothing — not even an approval in flight,
 * because grants are keyed by nonce and by argument digest, neither of which
 * this function produces.
 */
export function confirmationIdFor(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const material = `${sessionId}|${toolName}|${canonicalise(args)}`;
  // 'utf16le', not 'utf8', and that is not a stylistic choice. UTF-8 encoding
  // has no representation for an unpaired surrogate, so Node substitutes U+FFFD
  // for every one it meets — which means `'Rent \uD800'`, `'Rent \uDC00'` and
  // `'Rent �'` all hash the same bytes, and an injective canonical TEXT
  // still yields a colliding ID. `JSON.parse('"\\ud800"')` produces a lone
  // surrogate, and tool results re-enter this conversation as data, so the
  // model proposing such a string is inside this file's threat model. 'utf16le'
  // writes each UTF-16 code unit as two bytes with no substitution, so the id
  // inherits the injectivity `canonicalise` was written to give it.
  const digest = createHash('sha256').update(material, 'utf16le').digest('hex').slice(0, 32);
  return `cnf_${toolName}_${digest}`;
}

function describeForConfirmation(entry: RegistryEntry, args: Record<string, unknown>): string {
  const argText = Object.entries(args)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(', ');
  return `${entry.tool.description} — ${entry.capability.verb} /${entry.capability.path}${
    argText ? ` with ${argText}` : ''
  }`;
}
