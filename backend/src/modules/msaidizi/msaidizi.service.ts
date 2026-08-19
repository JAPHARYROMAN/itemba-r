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
 *     executing on the model's say-so; the approval that comes back must NAME an
 *     action this conversation actually contains a proposal for, and it is spent
 *     on one dispatch — the same action proposed again inside the run suspends
 *     again rather than riding the first approval. What no check in this file
 *     can establish is that a human answered the proposal; `RunRequest.confirmed`
 *     states exactly what the gate proves and what it does not;
 *   - every call is bounded, so a permission that allows an action once does not
 *     allow it in a loop — bounded per RUN, though, not per session, and
 *     `msaidizi.config.ts` says what that does and does not cap;
 *   - tool output re-enters the conversation fenced as data.
 *
 * Elsewhere, and not to be looked for here: the author-only read gate and the
 * encryption of retrieved records (`conversations.service.ts`), the permission
 * guard and the shape pin on the session id (`msaidizi.controller.ts`,
 * `procedures.controller.ts`), and the audit stamping every tool call produces
 * (`capability-invoker.ts`). A reader auditing "can user A read user B's
 * conversation" will find nothing in this file, because the answer is not here.
 *
 * The loop is written out rather than delegated to the SDK's tool runner
 * because confirmation is not an inline approve/deny — it suspends the run,
 * returns to the caller, and resumes on a later HTTP request. That is a state
 * machine, not a hook.
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ReversibilityTier } from '../../common/capabilities/reversibility';
import { CapabilityInvoker } from './capability-invoker';
import { narrowCapabilities } from './domain-filter';
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
  /** Correlates this run in the audit trail. Generated per run if absent. */
  sessionId?: string;
  /**
   * Confirmation ids the CALLER is sending as approved for this request.
   *
   * Not "ids the user approved", which is what this said and which nothing on
   * this path can establish. What the field IS: a list of names for actions,
   * each computable by anyone holding `confirmationIdFor`'s three public inputs.
   * `run()` checks every one of them against the proposals the conversation
   * actually contains before any of them can authorise a dispatch.
   *
   * What the gate PROVES when a red-tier call runs:
   *
   *   - the conversation this run was given contains an assistant turn
   *     proposing that exact tool with those exact arguments under this session
   *     id — so a request can no longer authorise an action the model never
   *     asked for and the user was never shown. Before that check, `confirmed`
   *     was a pre-authorisation channel: a first-turn request could carry a
   *     computed id and execute a red action with zero `confirmation_required`
   *     events anywhere in the run;
   *   - the id bought exactly ONE dispatch within this run. It is spent at
   *     dispatch, so a second proposal of the same action suspends for its own
   *     confirmation and listing the same id twice does not buy two executions.
   *
   * What it does NOT prove, said plainly because the field's name invites the
   * opposite reading — this is not a receipt:
   *
   *   - that a human saw the proposal, or answered it. This server keeps no
   *     pending-approval record to consult; a matching proposal is evidence the
   *     action was OFFERED, never that anyone accepted it.
   *   - that the proposal came from this server. `messages` is whatever
   *     `MsaidiziConversationsService.open()` settled on, and that is the
   *     store's own resume state only on the paths where the store's copy wins.
   *     The CALLER's array is used whenever it holds more of the conversation
   *     than the store does, whenever a turn is continued by session id with a
   *     history attached, on a conversation's first turn, and whenever the store
   *     could not be read at all. On any of those a caller that fabricates the
   *     proposal turn satisfies this check. See `continueById` for the rule.
   *   - anything across requests. `confirmationIdFor` is deterministic and the
   *     spent set dies with the request, so an id kept and re-sent on a later
   *     request is a fresh grant against a proposal that is still standing in
   *     the history. Send only the ids approved for this request.
   *
   * The boundary all three share: exploiting any of them needs the caller's own
   * bearer token, which already reaches the underlying route directly, so no
   * privilege boundary moves. The threat this gate was built against — the MODEL
   * approving its own action — cannot reach this field at all, because nothing
   * derives it from model output or from tool results.
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

@Injectable()
export class MsaidiziService {
  private readonly logger = new Logger(MsaidiziService.name);

  constructor(
    private readonly config: MsaidiziConfig,
    private readonly manifest: ManifestProvider,
    private readonly model: ModelClient,
    private readonly invoker: CapabilityInvoker,
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
     * The approvals this request may spend, and what is left of them.
     *
     * TWO reductions of `request.confirmed`, answering different questions, and
     * both are load-bearing.
     *
     * BOUND: an id survives only if this conversation contains an assistant
     * turn proposing that exact tool with those exact arguments. Without it,
     * `confirmed` was a pre-authorisation channel rather than an answer to
     * anything: all three inputs to `confirmationIdFor` — session, tool, args —
     * are supplied by the same caller on the same request, so a first-turn
     * request could carry a computed id and a red-tier action would execute with
     * no `confirmation_required` event anywhere in the run. Read
     * `approvalsForProposals` for what the check does and does not establish;
     * `RunRequest.confirmed` states the residual in full.
     *
     * A SET, so an id repeated inside `request.confirmed` collapses to one
     * grant: the gate raised one row for that id and the user ticked one box, so
     * a client listing it twice must not buy two executions. And a set that is
     * DRAINED rather than consulted — see the block at the red gate for why
     * "this exact action was approved" needs the word "once" in it.
     */
    const { bound: unspentApprovals, unbound } = approvalsForProposals(
      sessionId,
      request.confirmed,
      request.messages,
    );

    if (unbound.length > 0) {
      // Warn rather than fail the request. A discarded id costs nothing but a
      // second ask: the action it named is proposed again and the user answers
      // it, which is the correct outcome for both an attempt to pre-authorise
      // and the ordinary case of a stale id from a tab whose conversation moved
      // on. Failing the whole turn would take the rest of the question with it.
      this.logger.warn(
        `Run ${sessionId}: ${unbound.length} confirmation id(s) named no proposal in this ` +
          `conversation and cannot authorise anything: ${unbound.join(', ')}. Any red-tier ` +
          `action they matched will be proposed again rather than run.`,
      );
    }

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

          // The approval is SPENT here, at the moment of dispatch, not merely
          // consulted. `Set.delete` reports whether the id was there and removes
          // it in one step, so the check and the spend cannot come apart: past
          // this line the id is gone and this dispatch owns it.
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
          // What this line establishes: the id names an action this conversation
          // contains a proposal for (`approvalsForProposals` filtered the set
          // before the loop), it names THIS action rather than a neighbouring
          // one, and it has not already been spent in this run. What it does not
          // establish is that a person answered the proposal — there is no
          // stored approval to compare against, and this file could not
          // manufacture one. It is a check that the action was OFFERED, not a
          // receipt that it was ACCEPTED.
          //
          // The spend lives in this Set, which lives for this one `run()`. It
          // does not outlive the request. `confirmed` arrives from the client on
          // every request and `confirmationIdFor` is deterministic, so a client
          // that keeps an id and sends it again on a later request buys one more
          // execution per request it sends — the proposal it binds to is still
          // sitting in the history, so the binding above does not close that.
          // Inside a run the approval is one-shot; across runs the one-shot is
          // still only the client's discipline, and no code here enforces it.
          // Making it durable needs a store this service is not given and, more
          // importantly, a design decision this file cannot make alone: because
          // ids are deterministic, an id marked spent FOREVER would make a
          // legitimately repeated identical action — the same weekly journal,
          // posted again next week in the same session — permanently
          // unapprovable, since re-approving it can only ever produce the same
          // id. A durable ledger therefore has to count grants against spends
          // rather than remember ids. Per-run is what is built here.
          if (!unspentApprovals.delete(confirmationId)) {
            record({
              type: 'confirmation_required',
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

      if (suspended) {
        return this.finish(sessionId, events, 'awaiting_confirmation', messages, usage, record);
      }
    }
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
    // it is real, so the string 'cnf_totally_made_up' re-admits the prior turn's
    // proposed tools. That is deliberate. Widening decides what the model may
    // SEE; it authorises nothing, because every red-tier tool it re-admits still
    // meets the gate in `run()`, where an id naming no proposal has already been
    // discarded. Gating the union on id validity would turn an unrecognised
    // approval into "No such tool" — the model told the action does not exist,
    // and the user never asked again — instead of a fresh proposal they can
    // answer. The right answer to a bad id is to ask again, not to hide the
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

/**
 * Splits the ids a request sent into the ones that name a proposal this
 * conversation contains and the ones that name nothing.
 *
 * The gap this closes. `confirmationIdFor(sessionId, toolName, args)` takes
 * three arguments, and on a resumed turn the caller supplies all three on the
 * same request that carries `confirmed` — so the id is a NAME the caller can
 * compute, never a token this server issued and can recognise. Nothing else
 * stood between a request and a red-tier dispatch: measured, a brand-new
 * conversation whose first user turn was "post the payroll journal entry",
 * carrying one client-computed id and no proposal of any kind, executed a
 * TZS 9,000,000 journal entry with zero `confirmation_required` events in the
 * whole run. A reader of that transcript sees an irreversible action with no
 * gate above it and nothing anywhere able to say a gate was skipped.
 *
 * What matching PROVES: the run was given a conversation in which the model
 * proposed that exact tool with those exact arguments. So an approval can no
 * longer run ahead of the proposal it claims to answer, and a run that executes
 * a red action has a proposal in its own history to point at.
 *
 * What it does NOT prove, and the distinction is the whole reason this doc is
 * long:
 *
 *   - NOT that a human answered. There is no stored approval to check against.
 *     A proposal is evidence the action was offered; acceptance is not
 *     represented anywhere in this process.
 *   - NOT that the proposal is the server's. Where the store's own resume state
 *     is what `open()` returned, the caller cannot have written it. That is the
 *     usual chat path and it is not every path: the caller's own array is used
 *     when it is the longer of the two, when a turn is continued by session id
 *     with a history attached, on a first turn, and whenever the store could not
 *     be read — and there a fabricated assistant turn matches. `RunRequest.
 *     confirmed` carries the same list; `conversations.service.ts` owns the rule.
 *   - NOT that the proposal was GATED rather than already executed. An action
 *     approved and dispatched earlier in the conversation leaves its tool_use
 *     block in the history for good, so its id stays matchable. Requiring the
 *     block to be paired with this file's own confirmation refusal would be
 *     tighter, and was rejected: a turn that ends on a budget stop returns
 *     without pairing its results, so the tighter rule would discard a genuine
 *     approval and re-ask for an action the user already answered.
 *
 * The whole history is searched rather than only the newest tool-calling turn,
 * and that is the deliberately permissive choice. The tighter scope would also
 * reject an approval arriving a turn later than expected, and the cost of a
 * wrong rejection is an approval loop the user cannot break, while the cost of
 * the wider scope is a residual already stated on `RunRequest.confirmed`: an id
 * re-sent on a later request binds to a proposal that is still standing.
 */
function approvalsForProposals(
  sessionId: string,
  confirmed: string[] | undefined,
  messages: ModelMessage[],
): { bound: Set<string>; unbound: string[] } {
  if (!confirmed?.length) return { bound: new Set(), unbound: [] };

  const proposed = proposedConfirmationIds(sessionId, messages);
  const bound = new Set<string>();
  const unbound: string[] = [];

  for (const id of confirmed) {
    if (proposed.has(id)) bound.add(id);
    else unbound.push(id);
  }

  return { bound, unbound };
}

/**
 * Every confirmation id this conversation holds a proposal for.
 *
 * Derived rather than remembered, exactly as the dispatch does it: this server
 * keeps no pending-approval state, so the only record that an action was
 * proposed is the `tool_use` block sitting in the message array, and the id is
 * recomputed from it. Green- and amber-tier blocks are hashed too — they simply
 * never produce an id anyone needs, since only the red branch consults the set.
 */
function proposedConfirmationIds(sessionId: string, messages: ModelMessage[]): Set<string> {
  const ids = new Set<string>();

  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if (blockType(block) !== 'tool_use') continue;
      const proposal = block as { name?: unknown; input?: unknown };
      if (typeof proposal.name !== 'string') continue;
      // The same coercion the dispatch applies (`toolUse.input ?? {}`). If the
      // two ever disagreed, a block carrying no input would hash here to a
      // different id than the one the gate computes for it, and a legitimate
      // approval of a no-argument action would be discarded.
      const args = (proposal.input ?? {}) as Record<string, unknown>;
      ids.add(confirmationIdFor(sessionId, proposal.name, args));
    }
  }

  return ids;
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
 * A confirmation id bound to the exact action proposed.
 *
 * Derived from the session, the tool and the arguments, so approving "delete
 * invoice 41" cannot be replayed to authorise "delete invoice 42" — the id for
 * a different argument set is simply a different id. That holds at every level
 * of nesting: it is `{body:{memo:'Rent',lines:[…]}}` in full that is approved,
 * not the fact that a body was present. See `canonicalise` above for how the
 * argument text is built and what it replaced.
 *
 * What the id does NOT carry is how many times it may be used, or that it was
 * ever issued: it is a name for an action, not a token, and the same action
 * always has the same name — which also means a caller holding the three public
 * inputs can compute one this server never printed. Both gaps are closed in
 * `run()` rather than here: use is counted by spending the id on dispatch, and
 * issuance by requiring the id to name a proposal the conversation actually
 * contains (`approvalsForProposals`). Deliberately, because a one-use,
 * unforgeable id would have to be unpredictable, and an unpredictable id could
 * not be recomputed from the proposal on the resumed turn, which is the whole
 * mechanism by which this server keeps no pending approval state.
 *
 * SHA-256 rather than the 32-bit rolling hash this used to carry. The id is not
 * a secret — it travels alongside the action it describes — but it IS the whole
 * binding between an approval and an action, and a 32-bit digest is small enough
 * to search offline for a second argument set that lands on an already-approved
 * id. Tool results re-enter this conversation as data, so "the model proposes
 * arguments an attacker chose" is inside this file's threat model, not outside
 * it. 128 bits of the digest is far past the reach of that search.
 *
 * Ids are recomputed from the live proposal on every turn. A stored transcript
 * keeps the ones it displayed, but only to redraw what was asked — nothing is
 * ever authorised by comparing against a stored id. So a deploy that changes
 * this function corrupts nothing: an approval in flight across it simply fails
 * to match, and the action is proposed again.
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
