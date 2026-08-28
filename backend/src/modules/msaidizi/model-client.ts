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

  async createMessage(request: ModelRequest): Promise<ModelResponse> {
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
