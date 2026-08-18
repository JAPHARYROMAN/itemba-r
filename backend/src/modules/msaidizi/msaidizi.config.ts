/**
 * Msaidizi configuration.
 *
 * Every knob defaults to the safe end: the feature is off, writes are off, and
 * the agent's spend is bounded. Turning Msaidizi on is a deliberate act of
 * configuration, not a consequence of deploying the code.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReversibilityTier } from '../../common/capabilities/reversibility';

/** Highest reversibility tier the agent may invoke. */
export type WriteMode = 'read-only' | 'amber' | 'red';

const TIER_CEILING: Record<WriteMode, ReversibilityTier[]> = {
  'read-only': ['green'],
  amber: ['green', 'amber'],
  red: ['green', 'amber', 'red'],
};

@Injectable()
export class MsaidiziConfig {
  constructor(private readonly config: ConfigService) {}

  /**
   * Master switch. Off unless explicitly enabled — deploying this module must
   * not, on its own, put an agent in front of anyone's data.
   */
  get enabled(): boolean {
    return this.config.get<string>('MSAIDIZI_ENABLED', 'false') === 'true';
  }

  /**
   * Anthropic API key. Read from the environment and never persisted, logged,
   * or echoed through any endpoint — it is the one credential in this system
   * that is not scoped to a tenant.
   */
  get apiKey(): string | undefined {
    return this.config.get<string>('ANTHROPIC_API_KEY');
  }

  /** Reasoning model for the agent loop. */
  get model(): string {
    return this.config.get<string>('MSAIDIZI_MODEL', 'claude-opus-5');
  }

  /** Cheap model for domain pre-filtering — see MsaidiziService.narrowDomains. */
  get classifierModel(): string {
    return this.config.get<string>('MSAIDIZI_CLASSIFIER_MODEL', 'claude-haiku-4-5');
  }

  /**
   * Effort level. `medium` rather than the API default of `high`: the agent's
   * work is mostly tool orchestration over a large capability set, not deep
   * reasoning, and this is the primary cost lever.
   */
  get effort(): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
    return this.config.get<'low' | 'medium' | 'high' | 'xhigh' | 'max'>(
      'MSAIDIZI_EFFORT',
      'medium',
    );
  }

  /**
   * How far up the reversibility ladder the agent may act. Phase 1 ships
   * read-only; amber and red are unlocked per-deployment once their
   * confirmation paths are in place.
   */
  get writeMode(): WriteMode {
    return this.config.get<WriteMode>('MSAIDIZI_WRITE_MODE', 'read-only');
  }

  /** Tiers the agent may invoke under the current write mode. */
  get allowedTiers(): ReversibilityTier[] {
    return TIER_CEILING[this.writeMode] ?? TIER_CEILING['read-only'];
  }

  /**
   * Hard ceiling on write-tier calls in one session. A permission that allows
   * an action does not allow it fifty times; this is the loop backstop that the
   * permission system cannot express.
   */
  get maxWritesPerSession(): number {
    return Number(this.config.get<string>('MSAIDIZI_MAX_WRITES_PER_SESSION', '10'));
  }

  /** Ceiling on tool calls in one session, to bound a runaway loop. */
  get maxToolCallsPerSession(): number {
    return Number(this.config.get<string>('MSAIDIZI_MAX_TOOL_CALLS', '40'));
  }

  /** Output token ceiling per request. Streaming is used, so this can be generous. */
  get maxTokens(): number {
    return Number(this.config.get<string>('MSAIDIZI_MAX_TOKENS', '32000'));
  }

  /**
   * Base URL the loopback invoker calls. The agent reaches the API the same way
   * any other client does, so it is subject to the same guards, pipes and
   * interceptors rather than a parallel in-process path that could skip them.
   */
  get loopbackBaseUrl(): string {
    const explicit = this.config.get<string>('MSAIDIZI_LOOPBACK_URL');
    if (explicit) return explicit.replace(/\/+$/, '');
    const port = this.config.get<string>('PORT', '3001');
    const prefix = this.config.get<string>('API_PREFIX', 'api/v1').replace(/^\/+|\/+$/g, '');
    return `http://127.0.0.1:${port}/${prefix}`;
  }

  /** Per-tool-call timeout for the loopback invoker. */
  get invokeTimeoutMs(): number {
    return Number(this.config.get<string>('MSAIDIZI_INVOKE_TIMEOUT_MS', '30000'));
  }

  /**
   * How long a conversation stays *continuable*.
   *
   * This is the clock on the resume state — the model's own message array, and
   * the only place retrieved business records are stored. Short by design: a
   * manager who asks at 5pm and comes back at 9am can still continue, and an
   * APP_ENCRYPTION_KEY rotation orphans at most one day of resumability rather
   * than becoming a re-encryption project.
   */
  get resumeTtlHours(): number {
    return Number(this.config.get<string>('MSAIDIZI_RESUME_TTL_HOURS', '24'));
  }

  /**
   * How long a conversation stays *readable*. Slides on every turn, so an
   * actively-used conversation does not age out from under its author.
   */
  get conversationRetentionDays(): number {
    return Number(this.config.get<string>('MSAIDIZI_CONVERSATION_RETENTION_DAYS', '90'));
  }

  /**
   * Ceiling on the resume state, measured on the plaintext before encryption.
   *
   * Tool results are stringified response bodies and the tool budget is 40 per
   * run, so a conversation that lists customers a few times is megabytes. Over
   * the cap the resume state is dropped whole rather than truncated: dropping
   * arbitrary blocks breaks tool_use/tool_result pairing and produces a request
   * the API rejects, which would surface as a generic failure indistinguishable
   * from an outage.
   */
  get resumeMaxBytes(): number {
    return Number(this.config.get<string>('MSAIDIZI_RESUME_MAX_BYTES', '1048576'));
  }

  /**
   * Rows touched per opportunistic retention sweep. Bounded because the sweep
   * rides a user's request; it is allowed to be slow to converge, never allowed
   * to be slow once.
   */
  get sweepBatchSize(): number {
    return Number(this.config.get<string>('MSAIDIZI_SWEEP_BATCH_SIZE', '200'));
  }

  /**
   * How long a soft-deleted conversation survives before the sweep destroys it.
   * A short grace window, not an archive: the audit trail is what explains what
   * the agent did, and it is untouched by any of this.
   */
  get deletedGraceHours(): number {
    return Number(this.config.get<string>('MSAIDIZI_DELETED_GRACE_HOURS', '24'));
  }
}
