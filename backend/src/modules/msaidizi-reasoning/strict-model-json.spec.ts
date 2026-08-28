import { MsaidiziEffect, MsaidiziExecutionTarget } from '@prisma/client';
import { ModelResponse } from '../msaidizi/model-client';
import type { ProposedPlanDraft } from './msaidizi-reasoning.types';
import {
  applyStrictReadEnrichment,
  parseStrictPlanResponse,
  StructuredModelOutputError,
} from './strict-model-json';

describe('strict reasoning model JSON', () => {
  it('accepts one bare, exact plan object', () => {
    expect(parseStrictPlanResponse(response(plan()))).toEqual(plan());
  });

  it.each([
    ['markdown fence', `\`\`\`json\n${JSON.stringify(plan())}\n\`\`\``],
    ['malformed JSON', '{"title":'],
    ['unknown root field', JSON.stringify({ ...plan(), commentary: 'hello' })],
  ])('rejects %s', (_name, text) => {
    expect(() => parseStrictPlanResponse(response(text))).toThrow(StructuredModelOutputError);
  });

  it('rejects tool use and truncated provider output', () => {
    expect(() =>
      parseStrictPlanResponse({
        content: [{ type: 'tool_use', id: 'x', name: 'anything', input: {} }],
        stopReason: 'tool_use',
      }),
    ).toThrow('exactly one JSON text block');
    expect(() =>
      parseStrictPlanResponse({
        content: [{ type: 'text', text: '{}' }],
        stopReason: 'max_tokens',
      }),
    ).toThrow('token ceiling');
  });

  it('rejects credential-like material emitted by the model', () => {
    const unsafe = plan();
    unsafe.summary = 'authorization: Bearer eyJabcdefgh.abcdefgh.abcdefgh';
    expect(() => parseStrictPlanResponse(response(unsafe))).toThrow('credential-like data');
  });

  it('lets untrusted enrichment alter an existing read argument only', () => {
    const enriched = applyStrictReadEnrichment(
      response({
        readArguments: [{ key: 'read-expenses', arguments: { path: {}, query: { page: '2' } } }],
      }),
      plan(),
    );
    expect(enriched.steps[0].arguments).toEqual({ path: {}, query: { page: '2' } });
    expect(enriched.steps[0].capability).toBe('ExpensesController.findAll');
  });

  it('parses an authority-declared immutable input binding in structured output', () => {
    const bound = plan();
    bound.steps[0].arguments = { path: {}, query: { page: null } };
    bound.steps[0].inputBindings = [
      {
        targetPath: '/query/page',
        source: { kind: 'PLAN_INPUT', path: '/page' },
        dataClass: 'internal',
        expectedType: 'integer',
        expectedSchema: { type: 'integer', minimum: 1, maximum: 100 },
        transform: { name: 'IDENTITY', version: '1' },
      },
    ];

    expect(parseStrictPlanResponse(response(bound)).steps[0].inputBindings).toEqual(
      bound.steps[0].inputBindings,
    );
  });

  it('rejects untrusted enrichment that changes an authority-bound null target', () => {
    const bound = plan();
    bound.steps[0].arguments = { path: {}, query: { page: null } };
    bound.steps[0].inputBindings = [
      {
        targetPath: '/query/page',
        source: { kind: 'PLAN_INPUT', path: '/page' },
        dataClass: 'internal',
        expectedType: 'integer',
        expectedSchema: { type: 'integer', minimum: 1, maximum: 100 },
        transform: { name: 'IDENTITY', version: '1' },
      },
    ];

    expect(() =>
      applyStrictReadEnrichment(
        response({
          readArguments: [{ key: 'read-expenses', arguments: { path: {}, query: { page: 99 } } }],
        }),
        bound,
      ),
    ).toThrow('changed bound target');
  });
});

function plan(): ProposedPlanDraft {
  return {
    title: 'Review expenses',
    summary: 'Read the current expense list.',
    steps: [
      {
        key: 'read-expenses',
        name: 'Read expenses',
        target: MsaidiziExecutionTarget.ERP,
        capability: 'ExpensesController.findAll',
        capabilityVersion: '1',
        arguments: { path: {}, query: {} },
        dependsOn: [],
        inputBindings: [],
        expectedEffect: MsaidiziEffect.READ,
        dataClass: 'internal',
        preconditions: {},
        recovery: null,
        budgets: {},
        stopConditions: { stopAfterOnePage: true },
        idempotent: true,
        mutation: false,
      },
    ],
  };
}

function response(value: unknown): ModelResponse {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    stopReason: 'end_turn',
  };
}
