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
import { EphemeralSecretFingerprintRegistry } from '../../common/services';

/** Highest reversibility tier the agent may invoke. */
export type WriteMode = 'read-only' | 'amber' | 'red';

export interface ProviderCredentialSelection {
  /** Opaque operator-controlled secret-manager version/key identifier. */
  keyId: string;
  /** Ephemeral provider credential. Never persist or log this value. */
  apiKey: string;
}

const TIER_CEILING: Record<WriteMode, ReversibilityTier[]> = {
  'read-only': ['green'],
  amber: ['green', 'amber'],
  red: ['green', 'amber', 'red'],
};

@Injectable()
export class MsaidiziConfig {
  constructor(
    private readonly config: ConfigService,
    private readonly ephemeralSecrets: EphemeralSecretFingerprintRegistry,
  ) {
    // Declare the environment-backed secret during provider construction so
    // every backend replica knows it before handling any durable write. The
    // getter repeats this idempotently to cover an in-process operator rotation.
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey?.trim()) this.ephemeralSecrets.register(apiKey);
  }

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
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey?.trim()) {
      // This is the single environment-backed provider-secret ingress. Taint it
      // before returning the bytes so later text/JSON persistence boundaries
      // recognise even short, embedded, or encoded copies.
      this.ephemeralSecrets.register(apiKey);
    }
    return apiKey;
  }

  /**
   * Selects the provider credential only when its operator-controlled key ID
   * equals the ID covered by the freshly verified contract attestation.
   *
   * The current deployment source is environment-backed rather than a secret
   * manager with authenticated metadata. This therefore binds trusted opaque
   * metadata to runtime selection after registering process-local, randomly
   * keyed fingerprints. No raw credential or stable digest is persisted or
   * logged; operators must still label the secret correctly.
   */
  selectProviderCredential(expectedKeyId: string): ProviderCredentialSelection {
    const keyId = this.config.get<string>('MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID')?.trim();
    if (!keyId) {
      throw new Error(
        'MSAIDIZI_PROVIDER_CREDENTIAL_KEY_NOT_CONFIGURED: Provider credential key ID is required.',
      );
    }
    if (keyId !== expectedKeyId) {
      throw new Error(
        'MSAIDIZI_PROVIDER_CREDENTIAL_KEY_MISMATCH: Attested provider credential key ID does not match runtime selection.',
      );
    }
    const apiKey = this.apiKey;
    if (!apiKey?.trim()) {
      throw new Error('ANTHROPIC_API_KEY is not configured; Msaidizi cannot run.');
    }
    return { keyId, apiKey };
  }

  /** Reasoning model for the agent loop. */
  get model(): string {
    return this.config.get<string>('MSAIDIZI_MODEL', 'claude-opus-5').trim();
  }

  /** Cheap model for domain pre-filtering — see MsaidiziService.narrowDomains. */
  get classifierModel(): string {
    return this.config.get<string>('MSAIDIZI_CLASSIFIER_MODEL', 'claude-haiku-4-5').trim();
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
   * Declare a tool-search tool and defer the bulk of the registry, instead of
   * sending a lexically narrowed slice of it.
   *
   * Off by default so both paths can be run against the same questions before
   * either is trusted. It grants no authority either way: search selects from
   * the set `buildRegistry` already filtered by permission ∩ write mode, so the
   * reachable surface is identical — only what the model can SEE at once moves.
   *
   * Worth knowing what switching this on removes as a class rather than as a
   * bug. Narrowing has produced two defects on its own (see `registryFor`): a
   * confirmation turn narrowing away the tool it was approving, and a
   * fall-through that handed over the entire permitted set. Both exist because
   * the declared set is re-derived per turn from the user's words. With search
   * on, every permitted tool is declared on every turn — deferred, not absent —
   * so dispatch always resolves and that class of defect cannot recur.
   */
  get searchEnabled(): boolean {
    return this.config.get<string>('MSAIDIZI_TOOL_SEARCH', 'false') === 'true';
  }

  /**
   * Hard ceiling on write-tier calls in ONE RUN — one HTTP request through
   * `MsaidiziService.run()`. Not one session, and the name used to say session.
   *
   * The counter this feeds (`writeCalls`) is a local declared inside `run()`, so
   * it is reinitialised on every request. Three requests carrying the same
   * session id therefore each spend the full allowance: measured at 10 + 10 + 10
   * red-tier postings under one session id against a configured ceiling of 10.
   * Nothing in this system holds a session-level count of irreversible actions,
   * and this is not it.
   *
   * What it does buy is the runaway-loop backstop it was written for, and that
   * threat is genuinely per-run: a permission that allows an action does not
   * allow the model to emit it fifty times inside one turn, and a model cannot
   * open a new HTTP request. What it does not buy is a bound on what one
   * conversation can post over its life — a deployment that needs that has to
   * bound requests, upstream of this file.
   *
   * `MSAIDIZI_MAX_WRITES_PER_RUN` is the name that says so, and it wins when
   * both are set. `MSAIDIZI_MAX_WRITES_PER_SESSION` is still read because it is
   * the spelling already in `.env.example` and `docker-compose.production.yml`,
   * and silently ignoring a ceiling a deployment configured would be a worse
   * failure than a misleading variable name.
   */
  get maxWritesPerRun(): number {
    const perRun = this.config.get<string>('MSAIDIZI_MAX_WRITES_PER_RUN');
    return Number(perRun ?? this.config.get<string>('MSAIDIZI_MAX_WRITES_PER_SESSION', '10'));
  }

  /**
   * Ceiling on tool calls in ONE RUN, on exactly the same footing as
   * `maxWritesPerRun`: `toolCalls` is a `run()` local too. It bounds a runaway
   * loop inside one request and bounds nothing across requests.
   */
  get maxToolCallsPerRun(): number {
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
