/**
 * The agent loop.
 *
 * Every security property of Msaidizi is a property of this file:
 *
 *   - the tool set is derived from the caller's permissions, so an unpermitted
 *     capability is never offered rather than merely refused;
 *   - a tier the deployment has not enabled cannot be invoked even if a tool for
 *     it somehow reached the model;
 *   - a red-tier action suspends the run and returns to the user rather than
 *     executing on the model's say-so;
 *   - every call is bounded, so a permission that allows an action once does not
 *     allow it in a loop;
 *   - tool output re-enters the conversation fenced as data.
 *
 * The loop is written out rather than delegated to the SDK's tool runner
 * because confirmation is not an inline approve/deny — it suspends the run,
 * returns to the caller, and resumes on a later HTTP request. That is a state
 * machine, not a hook.
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ReversibilityTier } from '../../common/capabilities/reversibility';
import { CapabilityInvoker } from './capability-invoker';
import { narrowCapabilities } from './domain-filter';
import { ManifestProvider } from './manifest.provider';
import { ModelClient, ModelMessage, ModelToolUseBlock, ModelUsage } from './model-client';
import { MsaidiziConfig, WriteMode } from './msaidizi.config';
import { buildSystemPrompt, fenceToolResult } from './prompts';
import { buildRegistry, describeAction, indexByToolName, RegistryEntry } from './tool-registry';

/** How many capabilities may reach the model in one run. */
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
   * Confirmation ids the user has explicitly approved. A red-tier call runs only
   * if its deterministic id appears here.
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
  budgets: {
    maxToolCalls: number;
    maxWrites: number;
    /** How many capabilities may reach the model in one run. */
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
    /** The most that can reach the model on a single turn. */
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
    const confirmed = new Set(request.confirmed ?? []);

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

        if (toolCalls >= this.config.maxToolCallsPerSession) {
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
        if (isWrite && writeCalls >= this.config.maxWritesPerSession) {
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
          if (!confirmed.has(confirmationId)) {
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
        maxToolCalls: this.config.maxToolCallsPerSession,
        maxWrites: this.config.maxWritesPerSession,
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
 * A confirmation id bound to the exact action proposed.
 *
 * Derived from the session, the tool and the arguments, so approving "delete
 * invoice 41" cannot be replayed to authorise "delete invoice 42" — the id for
 * a different argument set is simply a different id.
 */
export function confirmationIdFor(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  // Non-cryptographic: this is a binding between an approval and an action, not
  // a secret. It travels alongside the action it describes.
  let hash = 0;
  const material = `${sessionId}|${toolName}|${canonical}`;
  for (let i = 0; i < material.length; i += 1) {
    hash = (hash * 31 + material.charCodeAt(i)) | 0;
  }
  return `cnf_${toolName}_${(hash >>> 0).toString(36)}`;
}

function describeForConfirmation(entry: RegistryEntry, args: Record<string, unknown>): string {
  const argText = Object.entries(args)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(', ');
  return `${entry.tool.description} — ${entry.capability.verb} /${entry.capability.path}${
    argText ? ` with ${argText}` : ''
  }`;
}
