import Anthropic from '@anthropic-ai/sdk';
import { AnthropicModelClient } from './model-client';
import {
  ANTHROPIC_API_ORIGIN,
  FORBIDDEN_ANTHROPIC_SDK_ENVIRONMENT_OVERRIDES,
} from './provider-contract-attestation.protocol';

describe('AnthropicModelClient cancellation', () => {
  const apiCredentialKeyId = 'anthropic-test/key-v1';
  const verifiedContract = {
    artifact: { claims: { apiCredentialKeyId } },
  };
  const providerContract = { assertCurrent: jest.fn() };

  const modelConfig = (apiKey = 'test-key', keyId = apiCredentialKeyId) => ({
    model: 'test-model',
    effort: 'high',
    selectProviderCredential: jest.fn((expectedKeyId: string) => {
      if (expectedKeyId !== keyId) {
        throw new Error('MSAIDIZI_PROVIDER_CREDENTIAL_KEY_MISMATCH');
      }
      return { keyId, apiKey };
    }),
  });

  beforeEach(() => {
    providerContract.assertCurrent.mockReset();
    providerContract.assertCurrent.mockReturnValue(verifiedContract);
  });

  it('forwards the durable job AbortSignal to the streaming provider request', async () => {
    const finalMessage = jest.fn().mockResolvedValue({
      content: [],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
    const stream = jest.fn().mockReturnValue({ finalMessage });
    const client = new AnthropicModelClient(modelConfig() as never, providerContract as never);
    Object.assign(client as unknown as Record<string, unknown>, {
      client: { apiKey: 'test-key', messages: { stream } },
      clientCredentialKeyId: apiCredentialKeyId,
    });
    const execution = new AbortController();

    await client.createMessage({
      system: [],
      messages: [],
      tools: [],
      maxTokens: 16,
      signal: execution.signal,
    });

    expect(stream).toHaveBeenCalledWith(expect.any(Object), { signal: execution.signal });
    expect(stream.mock.calls[0][0]).not.toHaveProperty('tool_choice');
    expect(providerContract.assertCurrent).toHaveBeenCalledTimes(1);
  });

  it('translates measured exact-tool and answer-only choices without changing tools', async () => {
    const opaqueBlocks = [
      { type: 'thinking', thinking: 'opaque reasoning', signature: 'signed-thinking' },
      { type: 'redacted_thinking', data: 'encrypted-redaction' },
      { type: 'server_tool_use', id: 'srv_1', name: 'tool_search', input: { query: 'expense' } },
    ];
    const finalMessage = jest.fn().mockResolvedValue({
      content: opaqueBlocks,
      stop_reason: 'end_turn',
      usage: {},
    });
    const stream = jest.fn().mockReturnValue({ finalMessage });
    const client = new AnthropicModelClient(modelConfig() as never, providerContract as never);
    Object.assign(client as unknown as Record<string, unknown>, {
      client: { apiKey: 'test-key', messages: { stream } },
      clientCredentialKeyId: apiCredentialKeyId,
    });
    const tools = [{ name: 'Expenses_findAll', description: 'read', input_schema: {} }] as never;

    const exactResponse = await client.createMessage({
      system: [],
      messages: [],
      tools,
      maxTokens: 16,
      toolChoice: {
        type: 'tool',
        name: 'Expenses_findAll',
        disableParallelToolUse: true,
      },
    });
    await client.createMessage({
      system: [],
      messages: [],
      tools,
      maxTokens: 16,
      toolChoice: { type: 'none' },
    });

    expect(stream.mock.calls[0][0]).toMatchObject({
      tools,
      tool_choice: {
        type: 'tool',
        name: 'Expenses_findAll',
        disable_parallel_tool_use: true,
      },
    });
    expect(stream.mock.calls[1][0]).toMatchObject({ tools, tool_choice: { type: 'none' } });
    expect(exactResponse.content).toEqual(opaqueBlocks);
    expect(providerContract.assertCurrent).toHaveBeenCalledTimes(2);
  });

  it('never calls the provider SDK after provider-contract rejection', async () => {
    const stream = jest.fn();
    providerContract.assertCurrent.mockImplementationOnce(() => {
      throw new Error('PROVIDER_CONTRACT_EXPIRED');
    });
    const client = new AnthropicModelClient(modelConfig() as never, providerContract as never);
    Object.assign(client as unknown as Record<string, unknown>, {
      client: { apiKey: 'test-key', messages: { stream } },
      clientCredentialKeyId: apiCredentialKeyId,
    });

    await expect(
      client.createMessage({ system: [], messages: [], tools: [], maxTokens: 16 }),
    ).rejects.toThrow('PROVIDER_CONTRACT_EXPIRED');
    expect(stream).not.toHaveBeenCalled();
  });

  it('pins the official origin and disables SDK retries, logging and alternate credentials', () => {
    const client = new AnthropicModelClient(modelConfig() as never, providerContract as never);

    const sdk = (
      client as unknown as { getClient(apiCredentialKeyId: string): Anthropic }
    ).getClient(apiCredentialKeyId);

    expect(sdk.baseURL).toBe(ANTHROPIC_API_ORIGIN);
    expect(sdk.maxRetries).toBe(0);
    expect(sdk.authToken).toBeNull();
    expect(sdk.webhookKey).toBeNull();
    expect(sdk.credentials).toBeNull();
    expect(sdk.logLevel).toBe('off');
  });

  it('fails a runtime key-ID mismatch and rebuilds only after an explicit key-ID rotation', async () => {
    let selected = { keyId: apiCredentialKeyId, apiKey: 'test-key-v1' };
    const config = {
      model: 'test-model',
      effort: 'high',
      selectProviderCredential: jest.fn((expectedKeyId: string) => {
        if (expectedKeyId !== selected.keyId) {
          throw new Error('MSAIDIZI_PROVIDER_CREDENTIAL_KEY_MISMATCH');
        }
        return selected;
      }),
    };
    const client = new AnthropicModelClient(config as never, providerContract as never);
    const getClient = (
      client as unknown as {
        getClient(apiCredentialKeyId: string): Anthropic;
      }
    ).getClient.bind(client);
    const first = getClient(apiCredentialKeyId);

    expect(() => getClient('anthropic-test/key-v2')).toThrow(
      'MSAIDIZI_PROVIDER_CREDENTIAL_KEY_MISMATCH',
    );

    selected = { keyId: apiCredentialKeyId, apiKey: 'silently-replaced-key' };
    expect(() => getClient(apiCredentialKeyId)).toThrow(
      'MSAIDIZI_PROVIDER_CREDENTIAL_ROTATED_WITHOUT_KEY_ID',
    );

    selected = { keyId: 'anthropic-test/key-v2', apiKey: 'test-key-v2' };
    const rotated = getClient('anthropic-test/key-v2');
    expect(rotated).not.toBe(first);
    expect(rotated.apiKey).toBe('test-key-v2');

    providerContract.assertCurrent.mockReturnValueOnce({
      artifact: { claims: { apiCredentialKeyId: 'unselected/key-v3' } },
    });
    const stream = jest.fn();
    await expect(
      client.createMessage({ system: [], messages: [], tools: [], maxTokens: 16 }),
    ).rejects.toThrow('MSAIDIZI_PROVIDER_CREDENTIAL_KEY_MISMATCH');
    expect(stream).not.toHaveBeenCalled();
  });

  it.each(FORBIDDEN_ANTHROPIC_SDK_ENVIRONMENT_OVERRIDES)(
    'rejects %s before constructing a provider client',
    (name) => {
      const previous = process.env[name];
      process.env[name] = 'forbidden-test-value';
      try {
        const client = new AnthropicModelClient(modelConfig() as never, providerContract as never);

        expect(() =>
          (client as unknown as { getClient(apiCredentialKeyId: string): Anthropic }).getClient(
            apiCredentialKeyId,
          ),
        ).toThrow(`MSAIDIZI_ANTHROPIC_SDK_ENVIRONMENT_OVERRIDE_FORBIDDEN: ${name}`);
        expect((client as unknown as { client?: Anthropic }).client).toBeUndefined();
      } finally {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }
    },
  );
});

/**
 * A provider turn is retried only when the failure says nothing about the turn.
 *
 * The property under test is not "we retry" — it is that a retry cannot smuggle
 * a second disclosure past a contract check, cannot outlive its own
 * cancellation, and cannot turn a settled answer into a slower settled answer.
 */
describe('AnthropicModelClient provider retry', () => {
  const apiCredentialKeyId = 'anthropic-test/key-v1';
  const verifiedContract = { artifact: { claims: { apiCredentialKeyId } } };
  const providerContract = { assertCurrent: jest.fn() };

  const retryConfig = (overrides: Record<string, unknown> = {}) => ({
    model: 'test-model',
    effort: 'high',
    modelMaxAttempts: 3,
    modelRetryBaseDelayMs: 500,
    modelRetryMaxDelayMs: 8000,
    selectProviderCredential: jest.fn(() => ({ keyId: apiCredentialKeyId, apiKey: 'test-key' })),
    ...overrides,
  });

  const okTurn = () => ({
    content: [{ type: 'text', text: 'answered' }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 3,
      output_tokens: 4,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  });

  /** Builds a client whose retry wait is instant and observable. */
  const clientWith = (stream: jest.Mock, config = retryConfig()) => {
    const client = new AnthropicModelClient(config as never, providerContract as never);
    Object.assign(client as unknown as Record<string, unknown>, {
      client: { apiKey: 'test-key', messages: { stream } },
      clientCredentialKeyId: apiCredentialKeyId,
    });
    const waited: number[] = [];
    jest
      .spyOn(
        client as unknown as { waitBeforeRetry: (ms: number) => Promise<void> },
        'waitBeforeRetry',
      )
      .mockImplementation(async (ms: number) => {
        waited.push(ms);
      });
    return { client, waited };
  };

  const request = { system: [], messages: [], tools: [], maxTokens: 16 };

  beforeEach(() => {
    providerContract.assertCurrent.mockReset();
    providerContract.assertCurrent.mockReturnValue(verifiedContract);
  });

  it('retries an overloaded provider and re-verifies the contract on every attempt', async () => {
    const stream = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Anthropic.InternalServerError(529, undefined, 'overloaded', new Headers());
      })
      .mockReturnValue({ finalMessage: jest.fn().mockResolvedValue(okTurn()) });
    const { client } = clientWith(stream);

    const response = await client.createMessage(request as never);

    expect(response.stopReason).toBe('end_turn');
    expect(stream).toHaveBeenCalledTimes(2);
    // The point of retrying here rather than inside the SDK: a revoked contract
    // must be able to stop the second disclosure.
    expect(providerContract.assertCurrent).toHaveBeenCalledTimes(2);
  });

  it('stops disclosing when the contract is revoked between attempts', async () => {
    const stream = jest.fn().mockImplementation(() => {
      throw new Anthropic.InternalServerError(529, undefined, 'overloaded', new Headers());
    });
    const { client } = clientWith(stream);
    providerContract.assertCurrent.mockReturnValueOnce(verifiedContract).mockImplementation(() => {
      throw new Error('PROVIDER_CONTRACT_REVOKED');
    });

    await expect(client.createMessage(request as never)).rejects.toThrow(
      'PROVIDER_CONTRACT_REVOKED',
    );
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('does not retry a settled refusal or validation failure', async () => {
    const stream = jest.fn().mockImplementation(() => {
      throw new Anthropic.BadRequestError(400, undefined, 'invalid request', new Headers());
    });
    const { client } = clientWith(stream);

    await expect(client.createMessage(request as never)).rejects.toThrow('invalid request');
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('does not retry a cancelled request', async () => {
    const stream = jest.fn().mockImplementation(() => {
      throw new Anthropic.APIUserAbortError({ message: 'lease ended' });
    });
    const { client } = clientWith(stream);

    await expect(client.createMessage(request as never)).rejects.toThrow('lease ended');
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('does not retry once the caller has aborted, even on a retryable failure', async () => {
    const execution = new AbortController();
    const stream = jest.fn().mockImplementation(() => {
      execution.abort();
      throw new Anthropic.APIConnectionError({ message: 'socket reset' });
    });
    const { client } = clientWith(stream);

    await expect(
      client.createMessage({ ...request, signal: execution.signal } as never),
    ).rejects.toThrow('socket reset');
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured attempts and reports the last failure', async () => {
    const stream = jest.fn().mockImplementation(() => {
      throw new Anthropic.APIConnectionError({ message: 'socket reset' });
    });
    const { client, waited } = clientWith(stream);

    await expect(client.createMessage(request as never)).rejects.toThrow('socket reset');
    expect(stream).toHaveBeenCalledTimes(3);
    expect(waited).toHaveLength(2);
  });

  it('honours a provider retry-after, clamped to the configured ceiling', async () => {
    const headers = new Headers({ 'retry-after': '600' });
    const stream = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Anthropic.RateLimitError(429, undefined, 'slow down', headers);
      })
      .mockReturnValue({ finalMessage: jest.fn().mockResolvedValue(okTurn()) });
    const { client, waited } = clientWith(stream, retryConfig({ modelRetryMaxDelayMs: 8000 }));

    await client.createMessage(request as never);

    // 600s is longer than anyone holds a page open for; the ceiling wins.
    expect(waited).toEqual([8000]);
  });

  it('treats an unset attempt budget as a single attempt', async () => {
    const stream = jest.fn().mockImplementation(() => {
      throw new Anthropic.APIConnectionError({ message: 'socket reset' });
    });
    const { client } = clientWith(stream, retryConfig({ modelMaxAttempts: undefined }));

    await expect(client.createMessage(request as never)).rejects.toThrow('socket reset');
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
