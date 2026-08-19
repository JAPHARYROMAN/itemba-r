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
import type { MsaidiziFrame, MsaidiziStreamOutcome, streamMsaidiziAsk } from './msaidizi-stream';
import { MSAIDIZI_MESSAGE_LIMIT } from './msaidizi-types';
import type {
  ConfirmationRequest,
  MsaidiziConversationDetail,
  MsaidiziEvent,
  MsaidiziRunResult,
  MsaidiziSessionFrame,
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
    unknownFrames: 0,
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

/** A red-tier proposal, as the run emits one, with the description under test. */
function proposalWith(id: string, description: string): ConfirmationRequest {
  return {
    type: 'confirmation_required',
    confirmationId: id,
    tool: 'JournalEntries_create',
    capabilityId: 'cap_je',
    description,
    args: {},
  };
}

/**
 * The `session` frame of a turn the store opened a row for.
 *
 * All three fields, because the backend sends `conversationId` and `sequence`
 * only when the turn's own row was written — a turn that ran unpersisted
 * reports the session id and nothing else. That difference is the whole subject
 * of the four tests below, so the two shapes are kept apart here.
 */
const SESSION_1: MsaidiziSessionFrame = {
  conversationId: 'conv_1',
  agentSessionId: 'ms_A',
  sequence: 1,
};
const SESSION_2: MsaidiziSessionFrame = { ...SESSION_1, sequence: 2 };

/** The same run result, under the session id those frames report. */
const RESULT_A: MsaidiziRunResult = { ...RESULT, sessionId: 'ms_A' };

/** The red-tier proposal a run suspends on, as the event arrives. */
const PROPOSAL: ConfirmationRequest = {
  type: 'confirmation_required',
  confirmationId: 'cnf_Invoices_remove_x1',
  tool: 'Invoices_remove',
  capabilityId: 'cap_del',
  description: 'Delete invoice — DELETE /invoices/:id with id=41',
  args: { id: '41' },
};

const DONE_AWAITING: MsaidiziEvent = { type: 'done', reason: 'awaiting_confirmation' };

/** A run that reports its session, its verdict and its messages, and closes. */
function scriptWholeRun(session: MsaidiziSessionFrame): typeof streamMsaidiziAsk {
  return async (_request, handlers = {}) => {
    handlers.onSession?.(session);
    handlers.onResult?.(RESULT_A);
    return outcome({ result: RESULT_A, session });
  };
}

/**
 * A run whose `result` frame never lands.
 *
 * The session frame goes out before the first model turn, the trace streams, and
 * then the socket dies during the `messages` write — by far the largest of the
 * run. `verdictFrom` reads the verdict back off the trace it already has, so a
 * run that got as far as `done` still terminates as `done` rather than as a
 * disconnection; what is missing is `result`, and with it this tab's copy of the
 * conversation. That is the shape, and it is the shape rather than the assertion
 * that decides what these tests are worth: a lost run scripted without a session
 * frame would exercise none of it.
 */
function scriptLostResult(
  session: MsaidiziSessionFrame,
  events: MsaidiziEvent[],
  termination: MsaidiziStreamOutcome['termination'],
): typeof streamMsaidiziAsk {
  return async (_request, handlers = {}) => {
    handlers.onSession?.(session);
    for (const event of events) handlers.onEvent?.(event);
    return outcome({ termination, events, result: null, session });
  };
}

/** Half of a surrogate pair, left behind by a cut through the middle of a character. */
function hasLoneSurrogate(text: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
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

  /**
   * Opaque here on purpose. The real value is whatever
   * `actionSignature(tool, args)` produces in the gate — this file is the lib
   * half and does not reach into a component for it — and the reducer's whole
   * contract is that it stores the string it was handed without reading it.
   */
  const SIGNATURE = 'Invoices_remove\u0000{\"id\":\"41\"}';

  it('never carries an approved grant into a later turn', () => {
    let state = reduceAll(createConversationState(), [
      { type: 'turn_started', turnId: 't1', prompt: 'Delete invoice 41.', at: 0 },
      { type: 'result', turnId: 't1', result: RESULT },
      { type: 'settled', turnId: 't1', outcome: outcome({ result: RESULT }), at: 1 },
    ]);

    const approving = buildAskRequest(state, 'Yes — go ahead.', {
      confirmed: ['grt_9e41c0b7d2'],
    });
    expect(approving.confirmed).toEqual(['grt_9e41c0b7d2']);

    state = reduceAll(state, [
      {
        type: 'turn_started',
        turnId: 't2',
        prompt: 'Yes — go ahead.',
        at: 2,
        // What the page DOES record about the approval: the action, as text.
        // The turn carrying an approval has to be knowable — a refused grant
        // comes back as a fresh proposal and the screen must be able to say the
        // earlier approval went unused — and this is the shape that fact is
        // allowed to take.
        approvedSignatures: [SIGNATURE],
      },
      { type: 'result', turnId: 't2', result: RESULT },
      { type: 'settled', turnId: 't2', outcome: outcome({ result: RESULT }), at: 3 },
    ]);

    // A standing approval is exactly what must not happen: it was spent on the
    // turn that carried it, and no field added since may smuggle it forward.
    expect(buildAskRequest(state, 'What else is unpaid?').confirmed).toBeUndefined();
    const serialised = JSON.stringify(state);
    expect(serialised).not.toContain('grt_9e41c0b7d2');
    // The recorded signature IS present, and asserting it beside the line
    // above is the point: the rule is not "nothing about the approval is kept",
    // it is "nothing re-sendable is kept". A signature names the tool and the
    // arguments — text already in `events` several times over — and authorises
    // nothing.
    expect(serialised).toContain(JSON.stringify(SIGNATURE).slice(1, -1));
    expect(latestTurn(state)?.approvedSignatures).toEqual([SIGNATURE]);
  });

  it('records no approval for a turn that carried none, or for a stored one', () => {
    const asked = reduceAll(createConversationState(), [
      { type: 'turn_started', turnId: 't1', prompt: 'How much do we owe?', at: 0 },
      { type: 'result', turnId: 't1', result: RESULT },
      { type: 'settled', turnId: 't1', outcome: outcome({ result: RESULT }), at: 1 },
    ]);
    expect(latestTurn(asked)?.approvedSignatures).toEqual([]);

    // A stored transcript records what the RUN did, never what a browser sent.
    // Claiming an approval here would put a sentence about the reader's own
    // click on a screen where nobody clicked.
    const hydrated = hydrateFromConversation({
      id: 'conv_1',
      agentSessionId: 'ms_stored',
      title: 'Overdue invoices',
      companyId: 'c1',
      turnCount: 1,
      toolCallCount: 0,
      writeCallCount: 0,
      highestTier: 'red',
      resumable: true,
      continuable: true,
      lastTurnAt: '2026-08-18T09:00:00.000Z',
      createdAt: '2026-08-18T09:00:00.000Z',
      expiresAt: '2026-11-16T09:00:00.000Z',
      turns: [
        {
          id: 'stored_1',
          sequence: 1,
          prompt: 'Yes — go ahead: Delete invoice with id 41',
          reason: 'awaiting_confirmation',
          toolCallCount: 0,
          writeCallCount: 0,
          procedureId: null,
          startedAt: '2026-08-18T09:00:00.000Z',
          endedAt: '2026-08-18T09:00:04.000Z',
          events: [{ type: 'done', reason: 'awaiting_confirmation' }],
        },
      ],
    });
    expect(hydrated.turns.every((turn) => turn.approvedSignatures.length === 0)).toBe(true);
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

  it('keeps an approval message inside the cap the pipe enforces', () => {
    // `describeForConfirmation` inlines every argument through `JSON.stringify`,
    // and red tier covers any write to `journal_entries` — so one posted payroll
    // journal arrives here carrying its whole line array. Over 8000 characters
    // the pipe rejects the resumed turn with a 400 the thread can only render as
    // "could not be reached", and the action the user approved never runs.
    const body = JSON.stringify(
      Array.from({ length: 200 }, (_, index) => ({
        account: `4${index}`,
        debit: index * 1000,
        credit: 0,
        memo: 'Payroll for August 2026',
      })),
    );
    const proposal = (id: string): ConfirmationRequest =>
      proposalWith(id, `Post a journal entry — POST /journal-entries with body=${body}`);

    const single = composeConfirmationMessage([proposal('cnf_a')]);
    expect(single.length).toBeLessThanOrEqual(MSAIDIZI_MESSAGE_LIMIT);
    // The head of the description is the action and the route; only the inlined
    // arguments are cut, and the cut is marked rather than silent.
    expect(single.startsWith('Yes — go ahead: Post a journal entry — POST /journal-entries')).toBe(
      true,
    );
    expect(single.endsWith('…')).toBe(true);

    const batch = composeConfirmationMessage([proposal('cnf_a'), proposal('cnf_b')]);
    expect(batch.length).toBeLessThanOrEqual(MSAIDIZI_MESSAGE_LIMIT);
    // Both actions stay named: a record of what was consented to that lists only
    // the first of two approvals is not a record of the approval.
    expect(batch.match(/Post a journal entry/g)).toHaveLength(2);
  });

  it('cuts an over-long approval message between characters, never through one', () => {
    // A description carries user data, and user data has emoji in it. Each one is
    // two code units, so a cut landing between them leaves a lone surrogate —
    // half a character, in the message that goes to the model as the record of
    // what was approved.
    const message = composeConfirmationMessage([proposalWith('cnf_a', '🧾'.repeat(6_000))]);

    expect(message.length).toBeLessThanOrEqual(MSAIDIZI_MESSAGE_LIMIT);
    expect(hasLoneSurrogate(message)).toBe(false);
  });

  it('carries a frame this build does not know up to the caller and counts it on the turn', async () => {
    // The transport documents an unrecognised frame as carried rather than
    // dropped. That only holds above the transport if the orchestrator passes
    // `onFrame` on: subscribing to the three frame kinds this build knows is how
    // the frame the backend added next gets discarded here instead.
    const heartbeat: MsaidiziFrame = { kind: 'unknown', name: 'heartbeat', data: { at: 1 } };
    const events: MsaidiziEvent[] = [{ type: 'done', reason: 'end_turn' }];
    const fakeStream: typeof streamMsaidiziAsk = async (_request, handlers = {}) => {
      handlers.onFrame?.(heartbeat);
      for (const event of events) handlers.onEvent?.(event);
      handlers.onResult?.(RESULT);
      return outcome({ events, result: RESULT, unknownFrames: 1 });
    };

    const seen: MsaidiziFrame[] = [];
    let state = createConversationState();
    const dispatch = (action: MsaidiziConversationAction) => {
      state = msaidiziConversationReducer(state, action);
    };

    await runMsaidiziTurn(buildAskRequest(state, 'How much do we owe?'), dispatch, {
      turnId: 't1',
      stream: fakeStream,
      now: () => 5_000,
      onFrame: (frame) => seen.push(frame),
    });

    expect(seen).toEqual([heartbeat]);
    expect(latestTurn(state)?.unknownFrames).toBe(1);
    expect(latestTurn(state)?.events).toEqual(events);
  });

  it('marks the thread uncontinuable when a lost run left no record anywhere', () => {
    // The pre-persistence shape, and the one the guard was written for: no
    // `session` frame at all, so nothing server-side holds this exchange either
    // and this tab's history is the only account of the thread there has ever
    // been. The recorded variant is a different case entirely — see below.
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

  it('keeps a suspended approval answerable when only the result frame was lost', async () => {
    // The whole run is on the server's side of the wire before this fails. The
    // turn's row is opened before the first model turn — which is what the
    // `session` frame's conversation id reports - and the run's messages are
    // committed before the `result` frame is attempted, so a socket that dies
    // during that last, largest write dies AFTER the proposal was stored. This
    // tab's history has a hole in it; the conversation the next request names
    // does not. Withdrawing the gate here tells the user an irreversible action
    // can no longer be approved while the server is holding everything needed
    // to approve it.
    let state = createConversationState();
    const dispatch = (action: MsaidiziConversationAction) => {
      state = msaidiziConversationReducer(state, action);
    };

    await runMsaidiziTurn(buildAskRequest(state, 'How much do we owe suppliers?'), dispatch, {
      turnId: 't1',
      stream: scriptWholeRun(SESSION_1),
      now: () => 1_000,
    });
    expect(state.history).toBe(MESSAGES);

    await runMsaidiziTurn(buildAskRequest(state, 'Delete the duplicate invoice 41.'), dispatch, {
      turnId: 't2',
      stream: scriptLostResult(SESSION_2, [PROPOSAL, DONE_AWAITING], {
        kind: 'done',
        reason: 'awaiting_confirmation',
      }),
      now: () => 2_000,
    });

    expect(state.turns[1].resultReceived).toBe(false);
    expect(state.turns[1].serverRecorded).toBe(true);

    // The decision is still live, and the state behind it is still the state the
    // gate was rendered from.
    expect(pendingConfirmations(state)).toEqual([PROPOSAL]);
    expect(state.historyComplete).toBe(true);
    expect(canContinue(state)).toBe(true);

    // And the approval it produces is one the server can answer from its own
    // record: named by conversation, positioned at the turn the server itself
    // assigned, and on the session id the server itself reported — so the
    // confirmation id recomputed there is the id the user approved here, which
    // is the half of the approval loop a re-minted session id breaks.
    const approval = buildAskRequest(
      state,
      composeConfirmationMessage(pendingConfirmations(state)),
      { confirmed: [PROPOSAL.confirmationId] },
    );
    expect(approval.conversationId).toBe('conv_1');
    expect(approval.sequence).toBe(2);
    expect(approval.sessionId).toBe('ms_A');
    expect(approval.confirmed).toEqual([PROPOSAL.confirmationId]);
  });

  it('drops the holed history rather than letting it stand in for the server copy', async () => {
    // The other half of the fix, and the reason the one above is safe. The
    // server reads a client history only as the fallback for when it has no
    // state of its own — an expired resume clock, a conversation too large to
    // store — and that is exactly the case where an array missing the suspended
    // turn would put "Yes — go ahead: delete invoice 41" in front of a model
    // that never proposed it: the approval loop, or worse, an action rebuilt
    // from a sentence. Withheld, the server answers 410 in its own words
    // instead.
    let state = createConversationState();
    const dispatch = (action: MsaidiziConversationAction) => {
      state = msaidiziConversationReducer(state, action);
    };

    await runMsaidiziTurn(buildAskRequest(state, 'How much do we owe suppliers?'), dispatch, {
      turnId: 't1',
      stream: scriptWholeRun(SESSION_1),
      now: () => 1_000,
    });
    expect(buildAskRequest(state, 'And which are overdue?').history).toBe(MESSAGES);

    await runMsaidiziTurn(buildAskRequest(state, 'Delete the duplicate invoice 41.'), dispatch, {
      turnId: 't2',
      stream: scriptLostResult(SESSION_2, [PROPOSAL, DONE_AWAITING], {
        kind: 'done',
        reason: 'awaiting_confirmation',
      }),
      now: () => 2_000,
    });

    expect(state.history).toEqual([]);
    expect(
      buildAskRequest(state, 'Yes — go ahead.', { confirmed: [PROPOSAL.confirmationId] }).history,
    ).toBeUndefined();
  });

  it('withdraws the approval when the lost turn is one the server has no record of', async () => {
    // The case a check on `state.conversationId` alone gets wrong, and it is not
    // exotic: one turn's row fails to open — a lock timeout, an exhausted pool —
    // inside a conversation whose earlier turns are all stored. The `session`
    // frame carries the session id and neither of the other two, so the id this
    // tab holds is still true about the THREAD while being false about this
    // EXCHANGE. The server's stored state stops one turn short of the proposal,
    // and resuming into it would append an approval to a conversation in which
    // nothing was ever proposed.
    let state = createConversationState();
    const dispatch = (action: MsaidiziConversationAction) => {
      state = msaidiziConversationReducer(state, action);
    };

    await runMsaidiziTurn(buildAskRequest(state, 'How much do we owe suppliers?'), dispatch, {
      turnId: 't1',
      stream: scriptWholeRun(SESSION_1),
      now: () => 1_000,
    });

    await runMsaidiziTurn(buildAskRequest(state, 'Delete the duplicate invoice 41.'), dispatch, {
      turnId: 't2',
      stream: scriptLostResult({ agentSessionId: 'ms_A' }, [PROPOSAL, DONE_AWAITING], {
        kind: 'done',
        reason: 'awaiting_confirmation',
      }),
      now: () => 2_000,
    });

    expect(state.conversationId).toBe('conv_1');
    expect(state.turns[1].serverRecorded).toBe(false);
    expect(state.historyComplete).toBe(false);
    expect(canContinue(state)).toBe(false);
  });

  it('withdraws it when the run never reported a verdict, recorded or not', async () => {
    // A row was opened for this turn, so the server will have something to say
    // about it eventually — but the run never reported how it ended, so it is
    // still executing there. Continuing would open a second turn on a
    // conversation whose first run has not finished writing its memory, and the
    // two would race to be it. "The server has this turn" is not the same claim
    // as "the server is finished with this turn", and only the second is safe to
    // act on.
    let state = createConversationState();
    const dispatch = (action: MsaidiziConversationAction) => {
      state = msaidiziConversationReducer(state, action);
    };

    await runMsaidiziTurn(buildAskRequest(state, 'How much do we owe suppliers?'), dispatch, {
      turnId: 't1',
      stream: scriptLostResult(SESSION_1, [{ type: 'text', text: 'Looking into it.' }], {
        kind: 'disconnected',
        message: 'The connection closed before the assistant reported a result.',
      }),
      now: () => 1_000,
    });

    expect(state.turns[0].serverRecorded).toBe(true);
    expect(state.historyComplete).toBe(false);
    expect(canContinue(state)).toBe(false);
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
    // A run cut off at the token ceiling did not fail and must not be offered a
    // retry: the same question hits the same ceiling, so a retry button here is
    // an invitation to spend the tokens twice for the same fragment.
    expect(classifyTermination({ kind: 'done', reason: 'truncated' })).toMatchObject({
      key: 'truncated',
      serverReported: true,
      retryable: false,
    });
  });

  it('keeps a stored truncated turn truncated when the transcript is reopened', () => {
    // The rehydrated half of the same contract. A stored turn carries its reason
    // as a bare string, read through the same known set as the live `done`
    // frame — so a conversation reopened from the rail draws the same verdict
    // the run drew when it happened. Off the list, `truncated` reads as `failed`
    // here and a transcript of a real answer is relabelled a breakdown.
    const stored: MsaidiziConversationDetail = {
      id: 'conv_cut',
      agentSessionId: 'ms_cut',
      title: 'Supplier balances',
      companyId: 'co_1',
      turnCount: 1,
      toolCallCount: 1,
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
          prompt: 'List every supplier balance',
          reason: 'truncated',
          toolCallCount: 1,
          writeCallCount: 0,
          procedureId: null,
          startedAt: '2026-08-18T08:00:00.000Z',
          endedAt: '2026-08-18T08:00:40.000Z',
          events: [
            { type: 'text', text: 'Three suppliers have unpaid invoices totalling TZS 4,18' },
          ],
        },
      ],
    };

    const state = hydrateFromConversation(stored);

    expect(state.turns[0].termination).toEqual({ kind: 'done', reason: 'truncated' });
  });

  it('hydrates a stored conversation and continues it by id rather than by history', () => {
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
    // The model's own message array is never returned by the read endpoint, and
    // nothing here synthesises one from the transcript — that would hand the
    // model invented data to answer from, sounding exactly as confident.
    expect(state.history).toEqual([]);

    // ...and it does not need one. This assertion used to read `false`, on the
    // reasoning that an empty history is an unusable one. That reasoning predates
    // the server accepting `conversationId` on AskDto and routing it to the one
    // path that reads server-held resume state: the client was never the party
    // that had to hold `messages`, which is why the read endpoint does not return
    // them. What decides it is whether the SERVER still holds them, and
    // `continuable` is the server's own answer.
    expect(canContinue(state)).toBe(true);

    // The wire consequence, and the point of the change: the next turn is
    // identified, not re-narrated. No `history` goes up, so the server answers
    // from its own state rather than from whatever this tab still has.
    const next = buildAskRequest(state, 'And which of those are overdue?');
    expect(next.conversationId).toBe('conv_1');
    expect(next.sequence).toBe(1);
    expect(next.history).toBeUndefined();
    expect(next.sessionId).toBe('ms_stored');

    // The other half of the same fact: when the server says it can no longer be
    // resumed, the transcript stays readable and the thread stays closed.
    expect(canContinue(hydrateFromConversation({ ...stored, continuable: false }))).toBe(false);
  });

  it('holds the last known sequence when a turn reports none, rather than claiming turn zero', () => {
    // The asymmetry that makes this stick: a turn the store could not persist
    // reports no sequence, but it does not clear `conversationId` either — the
    // id is still true. So a state that took the missing sequence as zero goes
    // on sending {conversationId: real, sequence: 0}, and the server reads
    // `0 < turnCount` as a second window having moved the thread on. Every later
    // turn in that tab is a non-retryable 409 saying the conversation continued
    // somewhere it did not, and only a page reload clears it.
    let state = reduceAll(createConversationState(), [
      {
        type: 'session',
        turnId: 't1',
        session: { conversationId: 'conv_1', agentSessionId: 'ms_1', sequence: 1 },
      },
      {
        type: 'session',
        turnId: 't2',
        session: { conversationId: 'conv_1', agentSessionId: 'ms_1', sequence: 3 },
      },
    ]);
    expect(state.sequence).toBe(3);

    // The degraded frame as the backend now writes it: the session id it has,
    // and neither of the two it does not.
    state = msaidiziConversationReducer(state, {
      type: 'session',
      turnId: 't3',
      session: { agentSessionId: 'ms_1' },
    });
    expect(state.conversationId).toBe('conv_1');
    expect(state.sequence).toBe(3);

    // And a literal zero, which is what an older build sends and what a mangled
    // field decodes to. Not nullish, so `??` alone takes it.
    state = msaidiziConversationReducer(state, {
      type: 'session',
      turnId: 't4',
      session: { agentSessionId: 'ms_1', sequence: 0 },
    });
    expect(state.sequence).toBe(3);
    expect(buildAskRequest(state, 'And the next supplier?').sequence).toBe(3);
  });

  it('makes no claim about a stored conversation whose turns did not come back', () => {
    // The same poisoning through the other door: the fold that reads the highest
    // stored sequence seeds at 0, so a detail carrying no turns would leave this
    // tab claiming turn zero of a conversation the server has on turn five.
    const state = hydrateFromConversation({
      id: 'conv_2',
      agentSessionId: 'ms_stored',
      title: null,
      companyId: null,
      turnCount: 5,
      toolCallCount: 0,
      writeCallCount: 0,
      highestTier: 'green',
      resumable: true,
      continuable: true,
      lastTurnAt: null,
      createdAt: '2026-08-18T08:00:00.000Z',
      expiresAt: '2026-11-16T08:00:00.000Z',
      turns: [],
    });

    expect(state.sequence).toBeNull();
    const next = buildAskRequest(state, 'Carry on.');
    expect(next.conversationId).toBe('conv_2');
    expect(next.sequence).toBeUndefined();
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
