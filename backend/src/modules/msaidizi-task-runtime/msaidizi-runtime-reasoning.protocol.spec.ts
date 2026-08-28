import { ModelResponse } from '../msaidizi/model-client';
import {
  parseRuntimeReasoningDecision,
  RuntimeReasoningOutputError,
} from './msaidizi-runtime-reasoning.protocol';

describe('durable runtime reasoning protocol', () => {
  it('accepts the exact bounded REPLAN schema', () => {
    expect(
      parseRuntimeReasoningDecision(
        response({
          decision: 'REPLAN',
          outcome: 'ON_TRACK',
          reasonCode: 'NARROW_TO_MATCHED_CUSTOMER',
          summary: 'Keep the authorized lookup and skip the now-unnecessary fallback.',
          confidence: 0.91,
          replan: {
            orderedPendingStepKeys: ['load-customer'],
            skippedPendingStepKeys: ['load-fallback'],
            readArgumentFills: [
              { stepKey: 'load-customer', values: { query: { customerId: 'customer-1' } } },
            ],
          },
        }),
      ),
    ).toMatchObject({ decision: 'REPLAN', outcome: 'ON_TRACK' });
  });

  it.each([
    [
      'unknown root field',
      {
        decision: 'CONTINUE',
        outcome: 'ON_TRACK',
        reasonCode: 'OK',
        summary: 'Continue.',
        confidence: 1,
        replan: null,
        newStep: { capability: 'Email.send' },
      },
      'RUNTIME_MODEL_SCHEMA_INVALID',
    ],
    [
      'write-looking extra field inside replan',
      {
        decision: 'REPLAN',
        outcome: 'ON_TRACK',
        reasonCode: 'OK',
        summary: 'Continue.',
        confidence: 1,
        replan: {
          orderedPendingStepKeys: [],
          skippedPendingStepKeys: [],
          readArgumentFills: [],
          writeArguments: [{ stepKey: 'pay', values: { amount: 1000 } }],
        },
      },
      'RUNTIME_MODEL_SCHEMA_INVALID',
    ],
    [
      'credential material',
      {
        decision: 'STOP',
        outcome: 'FAILED',
        reasonCode: 'FAILED',
        summary: 'password=hunter2 must be stored',
        confidence: 0.5,
        replan: null,
      },
      'RUNTIME_MODEL_OUTPUT_CONTAINS_SECRET',
    ],
  ])('rejects %s', (_name, value, code) => {
    expect(() => parseRuntimeReasoningDecision(response(value))).toThrow(
      expect.objectContaining({ code }) as RuntimeReasoningOutputError,
    );
  });

  it('rejects tool calls even when their name resembles an existing step', () => {
    expect(() =>
      parseRuntimeReasoningDecision({
        content: [{ type: 'tool_use', id: 'call-1', name: 'existing-read', input: { path: {} } }],
        stopReason: 'tool_use',
      }),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME_MODEL_NON_TEXT_OUTPUT' }));
  });
});

function response(value: unknown): ModelResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    stopReason: 'end_turn',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
  };
}
