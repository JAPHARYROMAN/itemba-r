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
import { ModelClient, ModelMessage, ModelToolUseBlock } from './model-client';
import { MsaidiziConfig } from './msaidizi.config';
import { buildSystemPrompt, fenceToolResult } from './prompts';
import { buildRegistry, indexByToolName, RegistryEntry } from './tool-registry';

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

export interface RunResult {
  sessionId: string;
  events: MsaidiziEvent[];
  reason: DoneReason;
  /** Conversation state to send back on the next turn. */
  messages: ModelMessage[];
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
        return this.finish(sessionId, events, 'failed', messages, record);
      }

      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          record({ type: 'text', text: block.text });
        }
      }

      if (response.stopReason === 'refusal') {
        return this.finish(sessionId, events, 'refused', messages, record);
      }

      const toolUses = response.content.filter(
        (block): block is ModelToolUseBlock => block.type === 'tool_use',
      );

      messages.push({ role: 'assistant', content: response.content });

      if (toolUses.length === 0) {
        return this.finish(sessionId, events, 'end_turn', messages, record);
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
          return this.finish(sessionId, events, 'tool_budget_exhausted', messages, record, true);
        }

        const isWrite = entry.capability.tier !== 'green';
        if (isWrite && writeCalls >= this.config.maxWritesPerSession) {
          results.push(errorResult(toolUse.id, 'Write budget for this run is exhausted.'));
          record({ type: 'done', reason: 'write_budget_exhausted' });
          return this.finish(sessionId, events, 'write_budget_exhausted', messages, record, true);
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
        return this.finish(sessionId, events, 'awaiting_confirmation', messages, record);
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

    const latestUserText = [...request.messages]
      .reverse()
      .find((m) => m.role === 'user' && typeof m.content === 'string');

    if (!latestUserText || permitted.length <= TOOL_BUDGET) return permitted;

    const relevant = new Set(
      narrowCapabilities(
        permitted.map((e) => e.capability),
        String(latestUserText.content),
        { limit: TOOL_BUDGET, floor: Math.min(20, TOOL_BUDGET) },
      ).map((c) => c.id),
    );

    return permitted.filter((entry) => relevant.has(entry.capability.id));
  }

  private tierAllowed(tier: ReversibilityTier): boolean {
    return this.config.allowedTiers.includes(tier);
  }

  private finish(
    sessionId: string,
    events: MsaidiziEvent[],
    reason: DoneReason,
    messages: ModelMessage[],
    record: (event: MsaidiziEvent) => void,
    alreadyRecorded = false,
  ): RunResult {
    if (!alreadyRecorded) record({ type: 'done', reason });
    return { sessionId, events, reason, messages };
  }
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
