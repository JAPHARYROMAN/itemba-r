/**
 * The conversation state model.
 *
 * A pure reducer plus a thin orchestrator, deliberately with no React in it: the
 * page, the launcher and the tests all drive the same state machine, and a
 * `useState` soup in a component is how the two renderers the plan spent a
 * section rejecting get built by accident.
 *
 * ─── The one contract that has already been broken once ─────────────────────
 *
 * `history` is the previous run's `messages`, echoed back UNCHANGED. It is held
 * here by reference, handed to the transport by reference, and serialised
 * without a `map`, a `filter`, a sort, a clone or a type assertion anywhere in
 * between. It carries provider content blocks whose fields the API requires
 * echoed back exactly, and the last time something well-meaning normalised them
 * multi-turn stopped working entirely — which is why the backend DTO's `content`
 * is a bare `@IsDefined()` with a comment saying so. Treat this array as opaque.
 * Never render it: it holds the fenced tool_result payloads the trace
 * deliberately excludes.
 *
 * ─── What `confirmed` is, and what it must never become ─────────────────────
 *
 * It is not in this state. A red-tier proposal suspends the run and the client
 * resumes it by sending `confirmed: [id]` on a LATER request; the server checks
 * that array as a plain set against every red proposal for the whole run and
 * keeps no pending state of its own. A client that parks the ids in state and
 * re-sends them has converted one approval into a standing grant for that action
 * for the rest of the session. So `buildAskRequest` takes them as an argument
 * and forgets them, and there is no action that stores them.
 */

import type {
  ConfirmationRequest,
  MsaidiziAskRequest,
  MsaidiziConversationDetail,
  MsaidiziEvent,
  MsaidiziRunResult,
  MsaidiziSessionFrame,
  ModelMessage,
  RunUsage,
} from './msaidizi-types';
import { streamMsaidiziAsk } from './msaidizi-stream';
import type {
  MsaidiziStreamOptions,
  MsaidiziStreamOutcome,
  MsaidiziTermination,
} from './msaidizi-stream';

/** One question and the run it produced. */
export interface MsaidiziTurn {
  id: string;
  /** The user's own words. Still render as text — it is echoed back in places. */
  prompt: string;
  /** The trace, in arrival order, `done` included. Carries no result bodies. */
  events: MsaidiziEvent[];
  status: 'running' | 'settled';
  /** Null while running. Branch on `kind`, then on `reason` for the six states. */
  termination: MsaidiziTermination | null;
  usage: RunUsage | null;
  startedAt: number;
  endedAt: number | null;
  /**
   * Whether the run reported its `result`. False means the answer may be on
   * screen but the transport state behind it is not — see `historyComplete`.
   */
  resultReceived: boolean;
  /** Frames that arrived and could not be read. Show the count; do not hide it. */
  malformedFrames: number;
}

export interface MsaidiziConversationState {
  /**
   * The server-side conversation, once the stream carries a `session` frame.
   * Null today: the backend has the persistence surface but `POST /ask` does not
   * yet mint or return a conversation id.
   */
  conversationId: string | null;
  /**
   * Correlates every audit row this conversation produces, and — on the path
   * without server-side resume — the value the red-tier confirmation ids are
   * derived from. Omit it on a resuming turn and every id is recomputed
   * differently, so the run suspends again: an infinite approval loop that looks
   * exactly like the server ignoring the user.
   */
  sessionId: string | null;
  /** OPAQUE transport state. See the file header. Never rendered, never mapped. */
  history: ModelMessage[];
  turns: MsaidiziTurn[];
  /**
   * False once a run has ended without returning its `messages` after doing some
   * work. The thread stays readable; it can no longer be continued in this tab,
   * because the next request would echo a history missing that exchange and the
   * model would answer as though it never happened.
   */
  historyComplete: boolean;
}

export function createConversationState(
  init: Partial<MsaidiziConversationState> = {},
): MsaidiziConversationState {
  return {
    conversationId: init.conversationId ?? null,
    sessionId: init.sessionId ?? null,
    history: init.history ?? [],
    turns: init.turns ?? [],
    historyComplete: init.historyComplete ?? true,
  };
}

export type MsaidiziConversationAction =
  | { type: 'turn_started'; turnId: string; prompt: string; at: number }
  | { type: 'event'; turnId: string; event: MsaidiziEvent }
  | { type: 'session'; session: MsaidiziSessionFrame }
  | { type: 'result'; turnId: string; result: MsaidiziRunResult }
  | { type: 'settled'; turnId: string; outcome: MsaidiziStreamOutcome; at: number }
  /** Load a stored conversation for reading. See `hydrateFromConversation`. */
  | { type: 'hydrated'; conversation: MsaidiziConversationDetail }
  | { type: 'reset' };

export function msaidiziConversationReducer(
  state: MsaidiziConversationState,
  action: MsaidiziConversationAction,
): MsaidiziConversationState {
  switch (action.type) {
    case 'turn_started':
      return {
        ...state,
        turns: [
          ...state.turns,
          {
            id: action.turnId,
            prompt: action.prompt,
            events: [],
            status: 'running',
            termination: null,
            usage: null,
            startedAt: action.at,
            endedAt: null,
            resultReceived: false,
            malformedFrames: 0,
          },
        ],
      };

    case 'event':
      return {
        ...state,
        turns: mapTurn(state.turns, action.turnId, (turn) => ({
          ...turn,
          events: [...turn.events, action.event],
        })),
      };

    case 'session':
      return {
        ...state,
        conversationId: action.session.conversationId ?? state.conversationId,
        sessionId:
          action.session.agentSessionId ?? action.session.sessionId ?? state.sessionId ?? null,
      };

    case 'result':
      return {
        ...state,
        sessionId: action.result.sessionId,
        // Wholesale replacement, by reference. Not merged with what is already
        // here, not appended to, not reconciled — the run returns the entire
        // conversation as the API needs to receive it back, and any arithmetic
        // performed on it here is arithmetic performed on the API's own state.
        history: action.result.messages,
        turns: mapTurn(state.turns, action.turnId, (turn) => ({
          ...turn,
          usage: action.result.usage ?? turn.usage,
          resultReceived: true,
        })),
        // A result arrived, so this turn is represented in `history`. It does not
        // repair an earlier gap: once a turn is missing, it stays missing.
        historyComplete: state.historyComplete,
      };

    case 'settled': {
      const turns = mapTurn(state.turns, action.turnId, (turn) => ({
        ...turn,
        status: 'settled' as const,
        termination: action.outcome.termination,
        endedAt: action.at,
        malformedFrames: action.outcome.malformedFrames,
      }));
      const turn = turns.find((candidate) => candidate.id === action.turnId);
      // A run that produced events and never reported its `messages` has left a
      // hole: the model did work this thread can no longer describe to it. A run
      // that produced nothing (a 503, an instant refusal to start) left the
      // prefix exactly as it was, so continuing is still honest.
      const lostTurn = Boolean(turn && !turn.resultReceived && turn.events.length > 0);
      return {
        ...state,
        turns,
        historyComplete: state.historyComplete && !lostTurn,
      };
    }

    case 'hydrated': {
      const conversation = action.conversation;
      return {
        conversationId: conversation.id,
        // Reusing the stored session id keeps this conversation's audit rows
        // under one key. It does NOT restore the model's memory.
        sessionId: conversation.agentSessionId,
        // Empty on purpose. The stored transcript is `events`, which carries no
        // tool_use block ids and no result bodies; `messages` lives encrypted on
        // the server and is not returned by this endpoint. Synthesising a
        // history from the transcript would hand the model invented data to
        // answer from, sounding exactly as confident as before.
        history: [],
        historyComplete: false,
        turns: conversation.turns.map((turn) => ({
          id: turn.id,
          prompt: turn.prompt,
          events: turn.events,
          status: 'settled' as const,
          termination: storedTermination(turn.reason),
          usage: null,
          startedAt: Date.parse(turn.startedAt),
          endedAt: turn.endedAt ? Date.parse(turn.endedAt) : null,
          resultReceived: false,
          malformedFrames: 0,
        })),
      };
    }

    case 'reset':
      return createConversationState();

    default:
      return state;
  }
}

function mapTurn(
  turns: MsaidiziTurn[],
  turnId: string,
  update: (turn: MsaidiziTurn) => MsaidiziTurn,
): MsaidiziTurn[] {
  return turns.map((turn) => (turn.id === turnId ? update(turn) : turn));
}

/**
 * A stored turn records only its `reason` string, so a rehydrated turn can say
 * how the run ended and nothing about how the connection behaved. Anything the
 * backend adds to `DoneReason` later arrives here as an unrecognised string, and
 * `failed` is the honest reading of a verdict this build cannot name.
 */
function storedTermination(reason: string): MsaidiziTermination {
  const known: ReadonlySet<string> = new Set([
    'end_turn',
    'awaiting_confirmation',
    'tool_budget_exhausted',
    'write_budget_exhausted',
    'refused',
    'failed',
  ]);
  return known.has(reason)
    ? { kind: 'done', reason: reason as MsaidiziRunResult['reason'] }
    : { kind: 'done', reason: 'failed' };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function latestTurn(state: MsaidiziConversationState): MsaidiziTurn | null {
  return state.turns.length > 0 ? state.turns[state.turns.length - 1] : null;
}

export function isRunning(state: MsaidiziConversationState): boolean {
  return state.turns.some((turn) => turn.status === 'running');
}

/**
 * The red-tier actions waiting on this user, if any.
 *
 * Derived from the newest settled turn and only while that turn's verdict is
 * `awaiting_confirmation`. Once the next turn starts, the approval has been
 * spent — there is no server-side pending state, so anything still listed here
 * afterwards would be a stale copy of a decision already made.
 */
export function pendingConfirmations(state: MsaidiziConversationState): ConfirmationRequest[] {
  const turn = latestTurn(state);
  if (!turn || turn.status !== 'settled') return [];
  const termination = turn.termination;
  if (!termination || termination.kind !== 'done') return [];
  if (termination.reason !== 'awaiting_confirmation') return [];
  return turn.events.filter(
    (event): event is ConfirmationRequest => event.type === 'confirmation_required',
  );
}

/** Whether a next turn in this tab would carry the thread's real memory. */
export function canContinue(state: MsaidiziConversationState): boolean {
  return state.historyComplete && !isRunning(state);
}

/**
 * The request for the next turn.
 *
 * `history` is passed by reference and never touched. `confirmed` is an
 * argument, never state — see the file header.
 */
export function buildAskRequest(
  state: MsaidiziConversationState,
  message: string,
  options: { confirmed?: string[] } = {},
): MsaidiziAskRequest {
  const request: MsaidiziAskRequest = { message };
  if (state.history.length > 0) request.history = state.history;
  if (state.sessionId) request.sessionId = state.sessionId;
  if (options.confirmed && options.confirmed.length > 0) request.confirmed = options.confirmed;
  return request;
}

/**
 * The message that carries an approval.
 *
 * Composed from the action's own description rather than sent as a bare "yes",
 * for two reasons that are not style. The click is the consent; the message is
 * the record of WHAT was consented to, and it lands in a transcript someone will
 * read later, where `"Yes, go ahead."` is evidence of nothing. And the server
 * re-derives the tool set from the newest user message on every turn, so a bare
 * "yes" has been measured to narrow the confirmed tool straight back out of the
 * registry — a defect the backend fixes by unioning the prior turn's tools, and
 * which nothing here may rely on being fixed.
 */
export function composeConfirmationMessage(approved: ConfirmationRequest[]): string {
  if (approved.length === 0) return 'No — do not go ahead with that.';
  if (approved.length === 1) return `Yes — go ahead: ${approved[0].description}`;
  return `Yes — go ahead with these ${approved.length} actions: ${approved
    .map((request) => request.description)
    .join('; ')}`;
}

/** Mechanics of a termination. The wording belongs to the renderer, not here. */
export interface TerminationTraits {
  /** Stable switch key: the six verdicts, plus the four the server never saw. */
  key:
    | 'end_turn'
    | 'awaiting_confirmation'
    | 'tool_budget_exhausted'
    | 'write_budget_exhausted'
    | 'refused'
    | 'failed'
    | 'stream_failed'
    | 'disconnected'
    | 'aborted'
    | 'unavailable';
  /** Whether the run itself reported this, as opposed to the transport. */
  serverReported: boolean;
  /**
   * Whether the run is still executing on the server. `run()` takes no
   * `AbortSignal`, so losing the connection loses the view and nothing else:
   * the remaining model turns and tool calls run to completion and their audit
   * rows land.
   */
  runContinuesOnServer: boolean;
  /**
   * Whether offering "try again" is honest.
   *
   * False for `refused` — the plan is explicit that a refusal is never
   * auto-retried — and false for every case where the first run is still going,
   * because a retry there starts a SECOND run rather than resuming the first.
   */
  retryable: boolean;
}

export function classifyTermination(termination: MsaidiziTermination): TerminationTraits {
  switch (termination.kind) {
    case 'done':
      return {
        key: termination.reason,
        serverReported: true,
        runContinuesOnServer: false,
        retryable: termination.reason === 'failed',
      };
    case 'stream_failed':
      return {
        key: 'stream_failed',
        serverReported: true,
        runContinuesOnServer: false,
        retryable: true,
      };
    case 'disconnected':
      return {
        key: 'disconnected',
        serverReported: false,
        runContinuesOnServer: true,
        retryable: false,
      };
    case 'aborted':
      return {
        key: 'aborted',
        serverReported: false,
        runContinuesOnServer: true,
        retryable: false,
      };
    case 'unavailable':
      return {
        key: 'unavailable',
        serverReported: false,
        runContinuesOnServer: false,
        retryable: true,
      };
  }
}

// ─── Orchestration ────────────────────────────────────────────────────────────

let turnCounter = 0;

export function createTurnId(): string {
  turnCounter += 1;
  return `turn_${Date.now().toString(36)}_${turnCounter}`;
}

export interface RunTurnOptions extends MsaidiziStreamOptions {
  turnId?: string;
  /** Injection point for tests. Defaults to the real transport. */
  stream?: typeof streamMsaidiziAsk;
}

/**
 * Run one turn, dispatching into the reducer as frames arrive.
 *
 * Frames are dispatched individually and `result.events` is ignored, because
 * `result.events` repeats every event already streamed, `done` included — a
 * client that renders both double-renders the entire run.
 *
 * Resolves with the outcome and never rejects: the transport turns every failure
 * into a stated termination, which is the point of it.
 */
export async function runMsaidiziTurn(
  request: MsaidiziAskRequest,
  dispatch: (action: MsaidiziConversationAction) => void,
  options: RunTurnOptions = {},
): Promise<MsaidiziStreamOutcome> {
  const { turnId: providedId, stream, now, ...streamOptions } = options;
  const clock = now ?? (() => Date.now());
  const turnId = providedId ?? createTurnId();
  const run = stream ?? streamMsaidiziAsk;

  dispatch({ type: 'turn_started', turnId, prompt: request.message, at: clock() });

  const outcome = await run(
    request,
    {
      onEvent: (event) => dispatch({ type: 'event', turnId, event }),
      onSession: (session) => dispatch({ type: 'session', session }),
      onResult: (result) => dispatch({ type: 'result', turnId, result }),
    },
    { ...streamOptions, now: clock },
  );

  dispatch({ type: 'settled', turnId, outcome, at: clock() });
  return outcome;
}

/** Load a stored conversation for reading. Readable, not continuable — see the reducer. */
export function hydrateFromConversation(
  conversation: MsaidiziConversationDetail,
): MsaidiziConversationState {
  return msaidiziConversationReducer(createConversationState(), {
    type: 'hydrated',
    conversation,
  });
}
