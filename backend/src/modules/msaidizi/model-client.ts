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
import { ToolDefinition } from './tool-registry';

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

export type ModelContentBlock = ModelTextBlock | ModelToolUseBlock;

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

export interface ModelRequest {
  system: Array<Record<string, unknown>>;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
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

  constructor(private readonly config: MsaidiziConfig) {
    super();
  }

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = this.config.apiKey;
      if (!apiKey) {
        // Fail loudly at first use rather than at boot: the rest of the
        // application must start fine without Msaidizi configured.
        throw new Error('ANTHROPIC_API_KEY is not configured; Msaidizi cannot run.');
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async createMessage(request: ModelRequest): Promise<ModelResponse> {
    // Streamed rather than awaited whole: max_tokens here is well above the
    // threshold where a non-streaming request risks an HTTP timeout.
    const stream = this.getClient().messages.stream({
      model: this.config.model,
      max_tokens: request.maxTokens,
      output_config: { effort: this.config.effort },
      system: request.system as never,
      messages: request.messages as never,
      tools: request.tools as never,
    } as never);

    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      this.logger.warn('Model declined the request.');
    }

    return {
      content: (message.content as unknown as ModelContentBlock[]).filter(
        (block) => block.type === 'text' || block.type === 'tool_use',
      ),
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
