import { describe, expect, it } from 'vitest';
import {
  buildAskRequest,
  canContinue,
  classifyTermination,
  composeConfirmationMessage,
  createConversationState,
  hydrateFromConversation,
  isRunning,
  latestTurn,
  msaidiziConversationReducer,
  pendingConfirmations,
  runMsaidiziTurn,
  type MsaidiziConversationAction,
  type MsaidiziConversationState,
} from './msaidizi-conversation';
import type { MsaidiziStreamOutcome, streamMsaidiziAsk } from './msaidizi-stream';
import type {
  MsaidiziConversationDetail,
  MsaidiziEvent,
  MsaidiziRunResult,
  ModelMessage,
} from './msaidizi-types';

/**
 * An assistant turn carrying the provider fields the API requires echoed back.
 * If anything in this layer maps, clones or re-types `messages`, the round-trip
 * assertion below is what notices.
 */
const MESSAGES: ModelMessage[] = [
  { role: 'user', content: 'How much do we owe suppliers right now?' },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Let me look.' },
      {
        type: 'tool_use',
        id: 'toolu_01AbCdEf',
        name: 'SupplierInvoices_findAll',
        input: { status: 'unpaid' },
        cache_control: { type: 'ephemeral' },
        provider_extension: { keep: 'me', nested: [{ deep: null }] },
      },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'toolu_01AbCdEf', content: '```json\n{"data":[]}\n```' },
    ],
  },
];

const RESULT: MsaidiziRunResult = {
  sessionId: 'ms_7f3c',
  events: [{ type: 'done', reason: 'end_turn' }],
  reason: 'end_turn',
  messages: MESSAGES,
  usage: {
    inputTokens: 400,
    outputTokens: 120,
    cacheReadInputTokens: 1042,
    cacheCreationInputTokens: 0,
    modelTurns: 2,
  },
};

function outcome(partial: Partial<MsaidiziStreamOutcome>): MsaidiziStreamOutcome {
  return {
    termination: { kind: 'done', reason: 'end_turn' },
    events: [],
    result: null,
    session: null,
    malformedFrames: 0,
    durationMs: 1200,
    ...partial,
  };
}

function reduceAll(
  state: MsaidiziConversationState,
  actions: MsaidiziConversationAction[],
): MsaidiziConversationState {
  return actions.reduce(msaidiziConversationReducer, state);
}

describe('msaidizi conversation state', () => {
  it('records a turn, its trace and its verdict', () => {
    const events: MsaidiziEvent[] = [
      { type: 'text', text: 'Looking into it.' },
      {
        type: 'tool_call',
        tool: 'SupplierInvoices_findAll',
        capabilityId: 'cap_1',
        tier: 'green',
        args: { status: 'unpaid' },
      },
      { type: 'tool_result', tool: 'SupplierInvoices_findAll', ok: true, status: 200 },
      { type: 'done', reason: 'end_turn' },
    ];

    const state = reduceAll(createConversationState(), [
      { type: 'turn_started', turnId: 't1', prompt: 'How much do we owe?', at: 1_000 },
      ...events.map(
        (event): MsaidiziConversationAction => ({ type: 'event', turnId: 't1', event }),
      ),
      { type: 'result', turnId: 't1', result: RESULT },
      { type: 'settled', turnId: 't1', outcome: outcome({ events, result: RESULT }), at: 4_200 },
    ]);

    const turn = latestTurn(state);
    expect(turn?.events).toHaveLength(4);
    expect(turn?.status).toBe('settled');
    expect(turn?.usage?.modelTurns).toBe(2);
    expect(turn?.endedAt).toBe(4_200);
    expect(state.sessionId).toBe('ms_7f3c');
    expect(isRunning(state)).toBe(false);
  });

  it('echoes history back byte-identically on the next turn', () => {
    const state = reduceAll(createConversationState(), [
      { type: 'turn_started', turnId: 't1', prompt: 'How much do we owe?', at: 0 },
      { type: 'result', turnId: 't1', result: RESULT },
      { type: 'settled', turnId: 't1', outcome: outcome({ result: RESULT }), at: 1 },
    ]);

    const next = buildAskRequest(state, 'And which of them are overdue?');

    // Same array, not a copy: nothing between the response and the next request
    // is permitted to rebuild it.
    expect(next.history).toBe(RESULT.messages);
    expect(JSON.stringify(next.history)).toBe(JSON.stringify(MESSAGES));
    expect(next.sessionId).toBe('ms_7f3c');
    expect(next.confirmed).toBeUndefined();
  });

  it('omits history and sessionId on a first turn', () => {
    expect(buildAskRequest(createConversationState(), 'Hello')).toEqual({ message: 'Hello' });
  });

  it('never carries confirmed ids into a later turn', () => {
    let state = reduceAll(createConversationState(), [
      { type: 'turn_started', turnId: 't1', prompt: 'Delete invoice 41.', at: 0 },
      { type: 'result', turnId: 't1', result: RESULT },
      { type: 'settled', turnId: 't1', outcome: outcome({ result: RESULT }), at: 1 },
    ]);

    const approving = buildAskRequest(state, 'Yes — go ahead.', { confirmed: ['cnf_a'] });
    expect(approving.confirmed).toEqual(['cnf_a']);

    state = reduceAll(state, [
      { type: 'turn_started', turnId: 't2', prompt: 'Yes — go ahead.', at: 2 },
      { type: 'result', turnId: 't2', result: RESULT },
      { type: 'settled', turnId: 't2', outcome: outcome({ result: RESULT }), at: 3 },
    ]);

    // A standing grant is exactly what must not happen: the approval was spent
    // on the turn that carried it.
    expect(buildAskRequest(state, 'What else is unpaid?').confirmed).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain('cnf_a');
  });

  it('lists the pending confirmations only while the run is suspended on them', () => {
    const confirmation: MsaidiziEvent = {
      type: 'confirmation_required',
      confirmationId: 'cnf_Invoices_remove_1a2b',
      tool: 'Invoices_remove',
      capabilityId: 'cap_del',
      description: 'DELETE /invoices/41',
      args: { id: '41' },
    };

    let state = reduceAll(createConversationState(), [
      { type: 'turn_started', turnId: 't1', prompt: 'Delete invoice 41.', at: 0 },
      { type: 'event', turnId: 't1', event: confirmation },
      { type: 'event', turnId: 't1', event: { type: 'done', reason: 'awaiting_confirmation' } },
      {
        type: 'settled',
        turnId: 't1',
        outcome: outcome({
          termination: { kind: 'done', reason: 'awaiting_confirmation' },
          result: RESULT,
        }),
        at: 1,
      },
    ]);

    expect(pendingConfirmations(state)).toEqual([confirmation]);
    expect(composeConfirmationMessage(pendingConfirmations(state))).toContain(
      'DELETE /invoices/41',
    );

    state = msaidiziConversationReducer(state, {
      type: 'turn_started',
      turnId: 't2',
      prompt: 'Yes — go ahead: DELETE /invoices/41',
      at: 2,
    });
    expect(pendingConfirmations(state)).toEqual([]);
  });

  it('marks the thread uncontinuable when a run did work and never returned its messages', () => {
    const state = reduceAll(createConversationState(), [
      { type: 'turn_started', turnId: 't1', prompt: 'How much do we owe?', at: 0 },
      { type: 'event', turnId: 't1', event: { type: 'text', text: 'Looking into it.' } },
      {
        type: 'settled',
        turnId: 't1',
        outcome: outcome({
          termination: { kind: 'disconnected', message: 'The connection dropped.' },
          events: [{ type: 'text', text: 'Looking into it.' }],
        }),
        at: 9,
      },
    ]);

    expect(state.historyComplete).toBe(false);
    expect(canContinue(state)).toBe(false);
  });

  it('leaves the thread continuable when nothing ran at all', () => {
    const state = reduceAll(createConversationState(), [
      { type: 'turn_started', turnId: 't1', prompt: 'How much do we owe?', at: 0 },
      {
        type: 'settled',
        turnId: 't1',
        outcome: outcome({
          termination: {
            kind: 'unavailable',
            status: 503,
            cause: 'http',
            message: 'Msaidizi is not enabled in this deployment.',
          },
        }),
        at: 1,
      },
    ]);

    expect(state.historyComplete).toBe(true);
    expect(canContinue(state)).toBe(true);
  });

  it('classifies the terminations that must not offer a retry', () => {
    expect(classifyTermination({ kind: 'done', reason: 'refused' })).toMatchObject({
      key: 'refused',
      retryable: false,
    });
    expect(classifyTermination({ kind: 'done', reason: 'failed' }).retryable).toBe(true);
    expect(classifyTermination({ kind: 'disconnected', message: 'dropped' })).toMatchObject({
      runContinuesOnServer: true,
      retryable: false,
    });
    expect(classifyTermination({ kind: 'aborted' }).runContinuesOnServer).toBe(true);
    expect(
      classifyTermination({ kind: 'unavailable', status: 503, cause: 'http', message: 'off' }),
    ).toMatchObject({ runContinuesOnServer: false, retryable: true });
  });

  it('hydrates a stored conversation as readable but not continuable', () => {
    const stored: MsaidiziConversationDetail = {
      id: 'conv_1',
      agentSessionId: 'ms_stored',
      title: 'Supplier balances',
      companyId: 'co_1',
      turnCount: 1,
      toolCallCount: 2,
      writeCallCount: 0,
      highestTier: 'green',
      resumable: true,
      continuable: true,
      lastTurnAt: '2026-08-18T09:00:00.000Z',
      createdAt: '2026-08-18T08:00:00.000Z',
      expiresAt: '2026-11-16T08:00:00.000Z',
      turns: [
        {
          id: 'turn_1',
          sequence: 1,
          prompt: 'How much do we owe suppliers?',
          reason: 'end_turn',
          toolCallCount: 2,
          writeCallCount: 0,
          procedureId: null,
          startedAt: '2026-08-18T08:00:00.000Z',
          endedAt: '2026-08-18T08:00:04.000Z',
          events: [{ type: 'text', text: 'Three suppliers have unpaid invoices.' }],
        },
      ],
    };

    const state = hydrateFromConversation(stored);

    expect(state.conversationId).toBe('conv_1');
    expect(state.sessionId).toBe('ms_stored');
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].termination).toEqual({ kind: 'done', reason: 'end_turn' });
    // The model's own message array is never returned by the read endpoint, so
    // there is nothing to resume from and the state says so rather than
    // synthesising a history the model would then answer from.
    expect(state.history).toEqual([]);
    expect(canContinue(state)).toBe(false);
  });

  it('drives a full turn through the transport without re-rendering result.events', async () => {
    const events: MsaidiziEvent[] = [
      { type: 'text', text: 'Looking into it.' },
      { type: 'done', reason: 'end_turn' },
    ];
    const fakeStream: typeof streamMsaidiziAsk = async (_request, handlers = {}) => {
      for (const event of events) handlers.onEvent?.(event);
      handlers.onResult?.(RESULT);
      return outcome({ events, result: RESULT });
    };

    let state = createConversationState();
    const dispatch = (action: MsaidiziConversationAction) => {
      state = msaidiziConversationReducer(state, action);
    };

    const settled = await runMsaidiziTurn(buildAskRequest(state, 'How much do we owe?'), dispatch, {
      turnId: 't1',
      stream: fakeStream,
      now: () => 5_000,
    });

    expect(settled.termination).toEqual({ kind: 'done', reason: 'end_turn' });
    // Exactly the streamed frames — `result.events` repeats all of them and
    // rendering both would double the whole run.
    expect(latestTurn(state)?.events).toEqual(events);
    expect(state.history).toBe(MESSAGES);
    expect(canContinue(state)).toBe(true);
  });
});
