/**
 * The boundary between the agent loop and Anthropic's API.
 *
 * An interface rather than a direct dependency so the loop — where every
 * security property lives — can be exercised in tests without a network call or
 * an API key. The properties that matter (an unpermitted capability is never
 * offered, a red-tier action never runs unconfirmed, tool output is never
 * treated as instruction) are properties of the loop, and they should be
 * provable without talking to a model.
 */

import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { MsaidiziConfig } from './msaidizi.config';
import { DeclaredTool } from './tool-registry';
import {
  ANTHROPIC_API_ORIGIN,
  FORBIDDEN_ANTHROPIC_SDK_ENVIRONMENT_OVERRIDES,
} from './provider-contract-attestation.protocol';
import { ProviderContractAttestationService } from './provider-contract-attestation.service';

export interface ModelTextBlock {
  type: 'text';
  text: string;
}

export interface ModelToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * The provider can also return signed thinking, redacted thinking, and
 * server-tool trace blocks. They are opaque to our loop but must be preserved
 * byte-for-byte when the assistant turn is sent back with a tool result.
 */
export type ModelContentBlock = ModelTextBlock | ModelToolUseBlock | Record<string, unknown>;

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

export interface ModelRequest {
  system: Array<Record<string, unknown>>;
  messages: ModelMessage[];
  tools: DeclaredTool[];
  maxTokens: number;
  /**
   * A per-turn routing control. It does not alter the declared tool block, so a
   * measured fast path can force one tool and then an answer-only turn without
   * invalidating the cached tool/system prefix.
   */
  toolChoice?: { type: 'tool'; name: string; disableParallelToolUse?: boolean } | { type: 'none' };
  /** Cancels the provider request when the durable job lease or timeout ends. */
  signal?: AbortSignal;
}

/**
 * Token counts for one model turn, as reported by the provider.
 *
 * `inputTokens` is the *uncached remainder* only — the total prompt is
 * `inputTokens + cacheReadInputTokens + cacheCreationInputTokens`. Summing only
 * `inputTokens` under-reports a cached run badly, which is the whole reason the
 * cache fields are carried here rather than discarded: the system prompt is
 * deliberately split into a stable cached prefix and a volatile tail
 * (`prompts.ts`), and until now nothing measured whether that breakpoint ever
 * hits.
 */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens served from the cache, billed at a fraction of input rate. */
  cacheReadInputTokens: number;
  /** Prompt tokens written to the cache, billed at a premium over input rate. */
  cacheCreationInputTokens: number;
}

export interface ModelResponse {
  content: ModelContentBlock[];
  stopReason: string | null;
  usage?: ModelUsage;
}

export abstract class ModelClient {
  abstract createMessage(request: ModelRequest): Promise<ModelResponse>;
}

@Injectable()
export class AnthropicModelClient extends ModelClient {
  private readonly logger = new Logger(AnthropicModelClient.name);
  private client?: Anthropic;
  private clientCredentialKeyId?: string;

  constructor(
    private readonly config: MsaidiziConfig,
    private readonly providerContract: ProviderContractAttestationService,
  ) {
    super();
  }

  private getClient(apiCredentialKeyId: string): Anthropic {
    const credential = this.config.selectProviderCredential(apiCredentialKeyId);
    if (this.client && this.clientCredentialKeyId === credential.keyId) {
      if (this.client.apiKey !== credential.apiKey) {
        throw new Error(
          'MSAIDIZI_PROVIDER_CREDENTIAL_ROTATED_WITHOUT_KEY_ID: Provider credential changed without an attested key-ID rotation.',
        );
      }
      return this.client;
    }
    if (!this.client || this.clientCredentialKeyId !== credential.keyId) {
      assertNoAnthropicSdkEnvironmentOverrides();
      this.client = new Anthropic({
        apiKey: credential.apiKey,
        // All provider-routing and alternative-auth knobs are pinned here.
        // Relying on SDK defaults would let process-level environment values
        // redirect disclosed data or replace the attested account credential.
        baseURL: ANTHROPIC_API_ORIGIN,
        authToken: null,
        webhookKey: null,
        credentials: null,
        config: null,
        profile: null,
        maxRetries: 0,
        logLevel: 'off',
      });
      this.clientCredentialKeyId = credential.keyId;
    }
    return this.client;
  }

  /**
   * One provider turn, retried a bounded number of times on failures that
   * carry no information about the turn.
   *
   * The retry lives here rather than in the SDK, and `maxRetries: 0` above must
   * stay pinned at zero. An SDK-internal retry re-sends the prompt without
   * re-entering this method, so a second disclosure would ride on a contract
   * verified before the first — possibly minutes and one revocation ago. Every
   * attempt here re-reads and re-verifies the contract, so the invariant that no
   * disclosure happens under an unverified contract survives the retry.
   *
   * Retrying is safe from the loop's side because nothing observable has
   * happened yet: `finalMessage()` either returns a whole turn or throws, tool
   * dispatch is downstream of that, and no content has been streamed to the
   * user. What a retry cannot undo is provider-side cost — a turn that
   * generated tokens before failing was billed, and the error carries no usage
   * to add, so `ModelUsage` under-reports a retried turn by whatever the failed
   * attempts produced.
   */
  async createMessage(request: ModelRequest): Promise<ModelResponse> {
    // Coerced rather than trusted: an unset or malformed value must collapse to
    // "attempt once", never to a loop with no terminating attempt number.
    const maxAttempts = Math.max(1, Math.trunc(Number(this.config.modelMaxAttempts)) || 1);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.attemptMessage(request);
      } catch (error) {
        const lastAttempt = attempt >= maxAttempts;
        if (lastAttempt || !isRetryableProviderError(error) || request.signal?.aborted) {
          throw error;
        }
        const delayMs = this.retryDelayMs(attempt, error);
        this.logger.warn(
          `Provider turn failed on attempt ${attempt}/${maxAttempts} ` +
            `(${describeProviderError(error)}); retrying in ${delayMs}ms.`,
        );
        await this.waitBeforeRetry(delayMs, request.signal);
      }
    }
  }

  /**
   * How long to wait before the next attempt: the provider's own `retry-after`
   * when it names one, otherwise exponential backoff. Jittered so a fleet of
   * backends that all hit the same rate limit do not return in lockstep.
   */
  private retryDelayMs(attempt: number, error: unknown): number {
    const ceiling = this.config.modelRetryMaxDelayMs;
    const requested = retryAfterMsFromError(error);
    if (requested !== null) return Math.min(ceiling, requested);
    const backoff = this.config.modelRetryBaseDelayMs * 2 ** (attempt - 1);
    return Math.min(ceiling, Math.round(backoff * (0.5 + Math.random() * 0.5)));
  }

  /** Overridable so specs can exercise the retry policy without real delay. */
  protected async waitBeforeRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (delayMs <= 0) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, delayMs);
      function finish(): void {
        clearTimeout(timer);
        signal?.removeEventListener('abort', finish);
        resolve();
      }
      signal?.addEventListener('abort', finish, { once: true });
    });
  }

  private async attemptMessage(request: ModelRequest): Promise<ModelResponse> {
    // The contract can expire or be revoked while this process is running. It
    // is therefore re-read and cryptographically verified immediately before
    // every disclosure, before the provider SDK is even obtained.
    const verifiedContract = this.providerContract.assertCurrent();
    // Streamed rather than awaited whole: max_tokens here is well above the
    // threshold where a non-streaming request risks an HTTP timeout.
    const stream = this.getClient(
      verifiedContract.artifact.claims.apiCredentialKeyId,
    ).messages.stream(
      {
        model: this.config.model,
        max_tokens: request.maxTokens,
        output_config: { effort: this.config.effort },
        system: request.system as never,
        messages: request.messages as never,
        tools: request.tools as never,
        ...(request.toolChoice
          ? {
              tool_choice:
                request.toolChoice.type === 'tool'
                  ? {
                      type: 'tool',
                      name: request.toolChoice.name,
                      disable_parallel_tool_use: request.toolChoice.disableParallelToolUse ?? false,
                    }
                  : { type: 'none' },
            }
          : {}),
      } as never,
      request.signal ? { signal: request.signal } : undefined,
    );

    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      this.logger.warn('Model declined the request.');
    }

    return {
      // Do not project this down to text/tool_use. In particular, Anthropic
      // requires thinking and redacted_thinking blocks to be returned unchanged
      // when a tool result continues the same assistant turn.
      content: message.content as unknown as ModelContentBlock[],
      stopReason: message.stop_reason,
      usage: {
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
        // Both are `number | null` on the SDK's Usage type — null when the
        // request neither read nor wrote a cache entry.
        cacheReadInputTokens: message.usage?.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: message.usage?.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

/**
 * Whether a failure says nothing about the turn and so may be attempted again.
 *
 * Deliberately a short allowlist rather than "anything that is not a 4xx". A
 * refusal, a validation error, an expired contract, a rotated credential and a
 * forbidden environment override are all settled answers: retrying them burns a
 * user's time to arrive at the same place. Only a request that did not get a
 * decision out of the model is worth repeating.
 */
function isRetryableProviderError(error: unknown): boolean {
  // A caller-cancelled request — a lease that ended, a timeout, a disconnected
  // client. The one thing a retry must never do is outlive its own cancellation.
  if (error instanceof Anthropic.APIUserAbortError) return false;
  // No status at all: the request never completed a round trip, so the model
  // never saw it. Connection resets and timeouts land here.
  if (error instanceof Anthropic.APIConnectionError) return true;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return false;
  // 408 timeout, 409 conflict, 429 rate limit, and the 5xx family (529 included,
  // which is the provider's own "overloaded").
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** A provider-requested delay in milliseconds, if the response named one. */
function retryAfterMsFromError(error: unknown): number | null {
  const headers = (error as { headers?: { get?: unknown } } | null)?.headers;
  if (typeof headers?.get !== 'function') return null;
  const read = (name: string): string | null => {
    try {
      return (headers as Headers).get(name);
    } catch {
      return null;
    }
  };

  // Read before coercing: `Number(null)` is 0, so an absent header would
  // otherwise read as "retry immediately".
  const retryAfterMs = read('retry-after-ms');
  if (retryAfterMs !== null) {
    const milliseconds = Number(retryAfterMs);
    if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
  }

  const retryAfter = read('retry-after');
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  // The header may also be an HTTP date rather than a delay.
  const deadline = Date.parse(retryAfter);
  return Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : null;
}

/** A log-safe description: status and provider error type, never the body. */
function describeProviderError(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  const type = (error as { type?: unknown } | null)?.type;
  const parts = [
    typeof status === 'number' ? `status ${status}` : 'no status',
    typeof type === 'string' && type ? type : null,
  ].filter(Boolean);
  return parts.join(', ');
}

function assertNoAnthropicSdkEnvironmentOverrides(): void {
  const configured = FORBIDDEN_ANTHROPIC_SDK_ENVIRONMENT_OVERRIDES.filter(
    (name) => (process.env[name] ?? '').trim().length > 0,
  );
  if (configured.length > 0) {
    throw new Error(
      `MSAIDIZI_ANTHROPIC_SDK_ENVIRONMENT_OVERRIDE_FORBIDDEN: ${configured.join(', ')}`,
    );
  }
}
