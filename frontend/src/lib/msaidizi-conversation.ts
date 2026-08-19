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
 * It is not in this state, and no field added later may put it there. A red-tier
 * proposal suspends the run and the client resumes it by sending
 * `confirmed: [grantId]` on a LATER request. Those are the server's own nonces,
 * read off the `confirmation_required` event; the server holds the matching
 * grants in a durable ledger and spends each one atomically at dispatch, so an
 * approval is now a receipt for a proposal that was actually made rather than
 * the client's word for it.
 *
 * That the server remembers does NOT license this file to. The shape of the
 * request is unchanged: the array names ids and cannot name a turn, so a client
 * that parks them in state and re-sends them puts a standing "yes" for that
 * action on every later turn of the run — and the fact that the server would now
 * refuse the second send is a property of another module, arrived at last, and
 * not the thing this rule rests on. So `buildAskRequest` takes them as an
 * argument and forgets them, and there is no action that stores them.
 *
 * `MsaidiziTurn.approvedSignatures` is the near miss and is deliberately not a
 * counter-example: it records tool-plus-arguments text for the actions a turn
 * carried an approval FOR, so the screen can tell the user their approval was
 * not honoured. It holds no grant id and cannot be turned back into one.
 */

import { MSAIDIZI_MESSAGE_LIMIT, asDoneReason, asSequence } from './msaidizi-types';
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
  MsaidiziFrame,
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
  /** Null while running. Branch on `kind`, then on `reason` for the seven states. */
  termination: MsaidiziTermination | null;
  usage: RunUsage | null;
  startedAt: number;
  endedAt: number | null;
  /**
   * Whether the run reported its `result`. False means the answer may be on
   * screen but the transport state behind it is not — see `historyComplete`.
   */
  resultReceived: boolean;
  /**
   * Whether the SERVER opened a row for THIS turn.
   *
   * True once this turn's own `session` frame reported a `conversationId`, which
   * the backend sends only when the turn's row was written and omits for a turn
   * that ran unpersisted — a store that was unavailable, a transaction that
   * rolled back. It is deliberately per-turn and not read back off
   * `state.conversationId`, because a degraded turn does not clear the id this
   * tab already holds: the state-level id says this THREAD is filed somewhere,
   * this flag says this EXCHANGE is, and only the second licenses continuing
   * after the `result` frame was lost. See the `settled` case.
   */
  serverRecorded: boolean;
  /** Frames that arrived and could not be read. Show the count; do not hide it. */
  malformedFrames: number;
  /**
   * Frames this build does not know the name of. Carried through the transport
   * and counted here for the same reason as the line above: an update that went
   * unread is a gap in the trace whether it was unreadable or merely unknown.
   */
  unknownFrames: number;
  /**
   * `actionSignature(tool, args)` for every action this turn's REQUEST carried
   * an approval for. Empty on an ordinary turn, and empty on every hydrated one.
   *
   * Why it exists: a grant that cannot be spent is not an error any more, it is
   * a fresh proposal. Without this, the run comes back asking the identical
   * question with no dispatch between, the screen has no way to tell that from
   * the model simply asking twice, and the user reads a gate that ignored their
   * click. With it the page can say the true thing — your approval was not
   * honoured, this is a new decision — which is the only sentence that stops the
   * user clearing the screen by approving again.
   *
   * Signatures, NOT grant ids, and the distinction is the file header's rule
   * rather than a detail. A grant id parked here would be re-sendable, which is
   * precisely the standing "yes" nothing in this file may create. Tool plus
   * canonical arguments is text already present in `events` several times over
   * and authorises nothing.
   *
   * Empty on a hydrated turn because a stored transcript records what the run
   * did, not what a browser sent: claiming an approval this tab never watched
   * being given would put a sentence about the reader's own click on a screen
   * where nobody clicked.
   */
  approvedSignatures: string[];
}

export interface MsaidiziConversationState {
  /**
   * The server-side conversation this thread is filed under.
   *
   * Arrives on the `session` frame, before the first model turn. Null until one
   * lands, and null for the life of a run the store could not persist — that run
   * still answers the question, it is simply not a place the user can return to.
   */
  conversationId: string | null;
  /**
   * The highest turn sequence this tab has seen on `conversationId`.
   *
   * Sent back on the next turn so the server can answer 409 when the thread has
   * moved on in another window. Null means this tab has no claim to make about
   * where the conversation is, and the server does not check — which is the only
   * correct reading of an unpersisted turn, and never `0`. See `asSequence`.
   */
  sequence: number | null;
  /**
   * Correlates every audit row this conversation produces.
   *
   * It is the SERVER'S id, not this tab's: the server mints it and honours one
   * sent from here only when it resolves to a conversation this caller owns —
   * otherwise it is quietly ignored and a fresh one is minted, because failing a
   * run over a stale id is a worse outcome than re-identifying it. So sending it
   * keeps a thread's audit rows under one key and can never take a run down.
   *
   * It no longer decides whether an approval is honoured. It used to: ids were
   * derived from it, so a resuming turn that omitted it recomputed every id
   * differently and suspended again — an infinite approval loop that looked
   * exactly like the server ignoring the user. Approvals now name server-issued
   * grants bound to the CONVERSATION, so that failure mode is gone and this
   * field must not be treated as load-bearing for one.
   */
  sessionId: string | null;
  /** OPAQUE transport state. See the file header. Never rendered, never mapped. */
  history: ModelMessage[];
  turns: MsaidiziTurn[];
  /**
   * Whether the memory the NEXT turn would be answered from still holds every
   * exchange in this thread.
   *
   * False once a run has ended without returning its `messages` after doing some
   * work AND without the server having a record of that same run — no `result`
   * frame, so this tab's `history` is missing the exchange, and no committed
   * server-side turn either, so there is nowhere left the model's account of it
   * survives. The thread stays readable; it can no longer be continued, because
   * the next request would put the model in front of a question about work it
   * has no record of doing.
   *
   * A lost `result` frame on a turn the server did commit is NOT that case: the
   * server holds the messages and answers the next turn from them. See the
   * `settled` case for the two facts that decide it and for why the pairing is
   * safe against the approval loop.
   */
  historyComplete: boolean;
}

export function createConversationState(
  init: Partial<MsaidiziConversationState> = {},
): MsaidiziConversationState {
  return {
    conversationId: init.conversationId ?? null,
    sequence: init.sequence ?? null,
    sessionId: init.sessionId ?? null,
    history: init.history ?? [],
    turns: init.turns ?? [],
    historyComplete: init.historyComplete ?? true,
  };
}

export type MsaidiziConversationAction =
  | {
      type: 'turn_started';
      turnId: string;
      prompt: string;
      at: number;
      /**
       * The action signatures this turn's request approved, if any. See
       * `MsaidiziTurn.approvedSignatures` — signatures only, never grant ids.
       */
      approvedSignatures?: string[];
    }
  | { type: 'event'; turnId: string; event: MsaidiziEvent }
  /**
   * The `session` frame, with the turn it was written for.
   *
   * `turnId` is not decoration: the frame's `conversationId` reports whether the
   * store opened a row for THAT turn, and a frame that omits it leaves the
   * conversation-level id standing. Without the turn to attach it to there is no
   * way left to tell "this thread is persisted" from "this exchange is".
   */
  | { type: 'session'; turnId: string; session: MsaidiziSessionFrame }
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
            serverRecorded: false,
            malformedFrames: 0,
            unknownFrames: 0,
            approvedSignatures: action.approvedSignatures ?? [],
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
        // The frame carries the sequence the server just assigned this turn, so
        // after a persisted turn this tab's claim is current.
        //
        // Anything that is not a real sequence is HELD, not taken, and the case
        // that matters is `0`. A turn the store could not persist reports no
        // sequence — but it does not clear `conversationId` either, because the
        // id is still true. Take a `0` here and this tab ends up claiming turn
        // zero of a conversation that is on turn five, which the server reads as
        // a second window having moved the thread on: a 409 on every later turn,
        // non-retryable, blaming a window that does not exist, until the user
        // reloads the page. `asSequence` is where "not a real sequence" is
        // decided, and `??` alone is not it — `0 ?? x` is `0`.
        sequence: asSequence(action.session.sequence) ?? state.sequence,
        sessionId:
          action.session.agentSessionId ?? action.session.sessionId ?? state.sessionId ?? null,
        // A conversation id on this frame is the server saying it wrote a row
        // for this turn before the first model turn ran, so it is recorded on
        // the turn and not only on the conversation. A frame without one leaves
        // every turn exactly as it was — including this one, which is the whole
        // point: an unpersisted turn inside a persisted conversation must not
        // inherit the conversation's standing. See `MsaidiziTurn.serverRecorded`.
        turns: action.session.conversationId
          ? mapTurn(state.turns, action.turnId, (turn) => ({ ...turn, serverRecorded: true }))
          : state.turns,
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
        // A result arrived, so this turn is represented in `history` — and when
        // the server answered this turn from its own resume state, so is the
        // exchange this tab lost the frame for, because `messages` comes back
        // whole. What a result cannot do is repair the case the flag is false
        // for: that one is a run NEITHER party kept, and no later turn can
        // recover an account of it. So the flag is carried, never re-raised.
        historyComplete: state.historyComplete,
      };

    case 'settled': {
      const turns = mapTurn(state.turns, action.turnId, (turn) => ({
        ...turn,
        status: 'settled' as const,
        termination: action.outcome.termination,
        endedAt: action.at,
        malformedFrames: action.outcome.malformedFrames,
        unknownFrames: action.outcome.unknownFrames,
      }));
      const turn = turns.find((candidate) => candidate.id === action.turnId);
      // A run that produced events and never reported its `messages` has left a
      // hole in THIS TAB's history: the model did work this array can no longer
      // describe to it. A run that produced nothing (a 503, an instant refusal
      // to start) left the prefix exactly as it was, so continuing is still
      // honest.
      const lostTurn = Boolean(turn && !turn.resultReceived && turn.events.length > 0);
      // ...but this tab's array stopped being the only copy when the server
      // started keeping one. Whether the SERVER can still be told what happened
      // in that run is a different question from whether this tab can, and it
      // takes two facts, both of them about this turn rather than the thread:
      //
      //   1. `serverRecorded` — this turn's own `session` frame carried a
      //      conversation id, so a row was opened for this exchange. A turn that
      //      ran unpersisted inside an otherwise-persisted conversation fails
      //      here: the id this tab holds is true, but the server's stored state
      //      stops one turn short of the run that was lost.
      //
      //      This one is now CONSERVATIVE rather than necessary, and the
      //      distinction is worth keeping straight because the file that made it
      //      so reasons about the same failure from the other end. It used to be
      //      necessary — resuming into a state one turn short would hand the
      //      model an approval for a proposal it never made — but
      //      `continueById` no longer takes the server's copy on sight: it keeps
      //      whichever copy holds more of the conversation. An unpersisted turn
      //      leaves this tab holding the LONGER array, proposal included, so
      //      sending it would in fact recover the run. We do not, because the
      //      recovery is only as good as this tab's array being whole, and that
      //      is precisely what a lost run puts in doubt. Declining a turn we
      //      could probably have run costs one retyped question; running one on
      //      an array we cannot vouch for costs an approval the user did not
      //      give. Relaxing it is a real option, not a bug fix.
      //   2. The run reported its verdict, so it is over. The backend awaits the
      //      transaction that stores the run's `messages` BEFORE it writes the
      //      `result` frame, so a socket that died between those two died after
      //      the server had committed. Without this, an abort and a mid-loop
      //      disconnect would qualify while the run is still executing, and a
      //      second turn opened against a conversation whose first run has not
      //      finished writing is two runs racing to be its stored memory.
      //
      // Both true is exactly "only the last frame was lost", and there the
      // approve path stays live. That does NOT reopen the infinite approval
      // loop. What the loop takes is an approval arriving at a model with no
      // record of the proposal it answers: the messages carrying the suspended
      // `tool_use` are missing from whatever the next request is answered from,
      // the approved grant therefore authorises a call nobody re-issues, and the
      // run proposes the same action over again. This condition is precisely the
      // case where those messages demonstrably survive somewhere. The next
      // request carries `conversationId`, so the server answers it from the
      // conversation's own stored messages — the ones holding the proposal — and
      // the grant the user approved is a row in that same conversation, so it is
      // spendable against the call the model re-issues. Where the server cannot
      // honour it, it says so in a status code with written copy — 404, 409, 410
      // — or, for a grant it will not spend, by proposing again with a new one.
      //
      // The recomputation half of this paragraph is gone on purpose. Approvals
      // used to hang on the session id being the same one the ids were derived
      // from; they now hang on a grant row, which is why the argument above is
      // about the conversation rather than about `agentSessionId`.
      const serverHoldsTurn = Boolean(lostTurn && turn?.serverRecorded && verdictReported(turn));
      return {
        ...state,
        turns,
        // The holed array goes with the turn that holed it. It is not sent on
        // the recovered path — the server's copy is the memory now.
        //
        // The server would reach the same answer on its own: it keeps whichever
        // copy is longer, and `serverHoldsTurn` is exactly the case where the
        // server recorded the turn this array is missing, so the array would
        // lose the comparison. Withholding it is therefore belt-and-braces, and
        // it is kept because it is the honest statement of what this tab knows —
        // this array is not a description of the conversation any more, and
        // offering it as one and relying on a length comparison to reject it is
        // a worse arrangement than not offering it.
        //
        // It also decides the one case the comparison cannot help with. If the
        // server's copy has gone (an expired clock, a failed write), sending the
        // holed array would put the approval in front of a model that never made
        // the proposal, because there is nothing longer for it to lose to.
        // Withheld, that case is a written 410 instead.
        history: serverHoldsTurn ? [] : state.history,
        historyComplete: state.historyComplete && !(lostTurn && !serverHoldsTurn),
      };
    }

    case 'hydrated': {
      const conversation = action.conversation;
      return {
        conversationId: conversation.id,
        // The last sequence this client actually received, not the conversation's
        // reported `turnCount`. They are the same today — the detail endpoint
        // returns every turn — but if it ever returned fewer, claiming the count
        // would assert this tab had seen turns it never got, and the 409 that
        // exists to catch exactly that would be the thing suppressed.
        //
        // Through `asSequence` because the fold's seed is `0` and a detail that
        // carried no turns would otherwise leave this tab claiming turn zero,
        // which is the false-409 poisoning by another door. No turns means no
        // claim, which is `null`.
        sequence: asSequence(
          conversation.turns.reduce(
            (highest, turn) => (turn.sequence > highest ? turn.sequence : highest),
            0,
          ),
        ),
        // Reusing the stored session id keeps this conversation's audit rows
        // under one key. It does NOT restore the model's memory.
        sessionId: conversation.agentSessionId,
        // Empty on purpose. The stored transcript is `events`, which carries no
        // tool_use block ids and no result bodies; `messages` lives encrypted on
        // the server and is not returned by this endpoint. Synthesising a
        // history from the transcript would hand the model invented data to
        // answer from, sounding exactly as confident as before.
        history: [],
        // Empty history no longer means "cannot continue". The next turn sends
        // `conversationId`, and the server answers it from its own stored resume
        // state — the client never needed `messages` for this, which is why the
        // endpoint does not return them. So the question is not whether THIS tab
        // holds the memory, it is whether the SERVER still does, and
        // `continuable` is the server's own answer to exactly that.
        //
        // It is a snapshot taken when the detail was fetched, so a tab left open
        // across the resume window holds a stale `true`. That is survivable
        // because the server refuses a continuation past the clock with a
        // written 410 sentence rather than a generic failure — this moves the
        // message earlier, it does not replace it.
        historyComplete: conversation.continuable,
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
          // It came out of the store, so the store has it. Inert for the rule in
          // the `settled` case — a hydrated turn arrives already settled and is
          // never settled again — and recorded truthfully anyway, because a flag
          // that means "the server has this exchange" must not read false on the
          // turns the server read it out of.
          serverRecorded: true,
          // A stored transcript is what the server wrote down, not what this tab
          // read off a socket: there were no frames here to lose or to fail to
          // recognise, so both counts are zero rather than unknown.
          malformedFrames: 0,
          unknownFrames: 0,
          // Nothing was approved from HERE. The stored turn may well have
          // carried an approval when it ran in some other tab, on some other
          // day, and the transcript does not record that — so the honest value
          // is "this page has no such claim", which is the empty array.
          approvedSignatures: [],
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
 * Whether the RUN said how it ended, as opposed to the transport saying the run
 * stopped being visible.
 *
 * `done` is the only verdict the server itself reports, and the transport reads
 * it off the trace even when the socket then died — a connection lost between
 * `done` and `result` still knows how the run ended. So this is the client's one
 * honest signal that the server-side run is finished rather than still going,
 * which is what the `settled` case needs before it treats the server as holding
 * this turn. Every other kind — `stream_failed`, `disconnected`, `aborted`,
 * `unavailable` — is the transport's own account of a run whose state on the
 * server is either unwritten or still being written.
 */
function verdictReported(turn: MsaidiziTurn): boolean {
  return turn.termination?.kind === 'done';
}

/**
 * A stored turn records only its `reason` string, so a rehydrated turn can say
 * how the run ended and nothing about how the connection behaved. Anything the
 * backend adds to `DoneReason` later arrives here as an unrecognised string, and
 * `asDoneReason` maps it to `failed` — the same coercion the live path applies
 * to the `done` frame, from the same list, so the two halves cannot disagree
 * about what this build knows how to render.
 */
function storedTermination(reason: string): MsaidiziTermination {
  return { kind: 'done', reason: asDoneReason(reason) };
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
 * `awaiting_confirmation`. Once the next turn starts, the answer has been sent
 * and anything still listed from the previous turn would be a stale copy of a
 * decision already made.
 *
 * There IS server-side pending state now — the grant ledger — and this list is
 * still not it. A grant is the server's record that it offered something; this
 * is the screen's record of what it is currently asking. The two come apart in
 * the ordinary case: a grant the server refuses to spend is re-proposed as a new
 * `confirmation_required` on the NEXT turn, and it is that event, not the old
 * grant, that puts a row back in front of the user.
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

/**
 * Whether a next turn would be answered from the thread's real memory.
 *
 * Not "whether this tab holds it": the memory can be here, in `history`, or on
 * the server under `conversationId`, and the next turn carries both. What is
 * refused is a turn asked against a run neither party has an account of — see
 * `historyComplete`.
 */
export function canContinue(state: MsaidiziConversationState): boolean {
  return state.historyComplete && !isRunning(state);
}

/**
 * The request for the next turn.
 *
 * `history` is passed by reference and never touched. `confirmed` is an
 * argument, never state — see the file header. Its entries are server-issued
 * grant ids that the caller read off a `confirmation_required` event; this
 * function does not check them, because there is nothing here to check them
 * against, and it does not manufacture them, because there is no rule by which
 * it could.
 */
export function buildAskRequest(
  state: MsaidiziConversationState,
  message: string,
  options: { confirmed?: string[] } = {},
): MsaidiziAskRequest {
  const request: MsaidiziAskRequest = { message };
  // Once there is a conversation id, it goes on every turn. It is what puts the
  // server's own stored resume state into the running: the server compares its
  // copy against whatever this tab sends and keeps whichever holds more of the
  // conversation, winning ties (conversations.service.ts:continueById). That is
  // the only way a conversation reopened from the rail continues from what
  // actually happened in it — such a tab has no history at all (see the
  // `hydrated` case), so the server's copy is the only copy — and it is what
  // names the conversation an approval's grant belongs to. A grant is bound to
  // the conversation it was issued in, so an approval sent without this id is
  // offered against a thread it was not issued for and earns a re-proposal
  // rather than a dispatch.
  if (state.conversationId) {
    request.conversationId = state.conversationId;
    // Null here is this tab having no claim to make, not a value being dropped:
    // every sequence is read through `asSequence` on the way INTO state (the
    // `session` and `hydrated` cases), so what survives to here is either a real
    // turn number or nothing.
    if (state.sequence !== null) request.sequence = state.sequence;
  }
  // Still sent, and NOT an alternative to the line above. This is a real second
  // copy of the conversation, not a fallback that the server discards on sight:
  // it keeps the LONGER of the two arrays and wins ties, so sending ours costs
  // nothing when the server is current and is the whole recovery when it is not.
  //
  // Both halves of that matter, and dropping this line would lose both. The
  // obvious half is the three cases where the server holds nothing at all — an
  // expired resume clock, a conversation too large to store, a write that failed
  // — where withholding turns a recoverable turn into a 410 on a tab holding a
  // perfectly good history. The less obvious half is the one that made the
  // server stop preferring itself unconditionally: `close()` swallows its own
  // transaction failures, so the store can end a turn BEHIND a run that really
  // happened and really handed this tab its `messages`. A server that ignored
  // this array would resume that conversation from a state that never saw the
  // last turn — on the run that matters most, a red-tier proposal the user is
  // about to approve. Sending it is what makes that survivable.
  //
  // "Perfectly good" is the load-bearing half, and it is not checked here: an
  // array with a turn missing from it never reaches this line, because the
  // `settled` case drops it at the moment the hole appears rather than leaving a
  // holed history to be picked up as somebody's second copy.
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
 *
 * It is also the one message on the page nobody typed, so nothing has already
 * stopped it at `MSAIDIZI_MESSAGE_LIMIT` the way the composer stops the user.
 * The descriptions come from `describeForConfirmation`, which inlines every
 * argument through `JSON.stringify` — one posted journal entry carries its whole
 * line array — and a message over the cap is a 400 from the pipe that reads on
 * screen as a transient network fault. The user retries, gets the identical 400,
 * and the action they approved can never run. So the length is bounded here.
 */
export function composeConfirmationMessage(approved: ConfirmationRequest[]): string {
  if (approved.length === 0) return 'No — do not go ahead with that.';

  const prefix =
    approved.length === 1
      ? 'Yes — go ahead: '
      : `Yes — go ahead with these ${approved.length} actions: `;
  const joiner = '; ';
  const room = MSAIDIZI_MESSAGE_LIMIT - prefix.length - joiner.length * (approved.length - 1);
  // An equal share each, rather than first-come-first-served: every approved
  // action has to stay named in the record, and one action whose arguments run
  // to thousands of characters would otherwise spend the whole budget and leave
  // the ones after it unnamed. Descriptions are cut from the end, which is where
  // the inlined arguments are — the action phrase and the route survive.
  const share = Math.floor(room / approved.length);
  const described = approved.map((request) => truncate(request.description, share));

  // The final clamp is a backstop, not the mechanism: it is what holds if the
  // share arithmetic is ever handed a batch large enough to make it meaningless.
  return truncate(prefix + described.join(joiner), MSAIDIZI_MESSAGE_LIMIT);
}

/** Cut to `limit` characters, marking the cut so nobody reads it as the whole thing. */
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit < 1) return '';
  let cut = text.slice(0, limit - 1);
  // Descriptions carry user data — a supplier name with an emoji in it — and a
  // cut between the two halves of one leaves a lone surrogate that does not
  // survive the round trip to the model as the character it came from.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Mechanics of a termination. The wording belongs to the renderer, not here. */
export interface TerminationTraits {
  /** Stable switch key: the seven verdicts, plus the four the server never saw. */
  key:
    | 'end_turn'
    | 'awaiting_confirmation'
    | 'tool_budget_exhausted'
    | 'write_budget_exhausted'
    | 'refused'
    | 'truncated'
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
  /**
   * Every decoded frame, in arrival order — unknown and malformed ones included.
   *
   * The transport carries a frame it does not recognise rather than dropping it,
   * and this is the hook that keeps that true above the transport: without it
   * the orchestrator subscribes to the three frame kinds it knows and a frame
   * the backend added is silently discarded here instead of there.
   */
  onFrame?: (frame: MsaidiziFrame) => void;
  /**
   * `actionSignature(tool, args)` for each action this request's `confirmed`
   * approves. Recorded on the turn so the screen can tell an approval that was
   * not honoured from the model merely asking twice — see
   * `MsaidiziTurn.approvedSignatures`.
   *
   * Signatures rather than the ids themselves, and the caller passes both
   * separately rather than handing over the requests, so that there is no route
   * by which a grant id reaches the reducer.
   */
  approvedSignatures?: string[];
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
  const {
    turnId: providedId,
    stream,
    now,
    onFrame,
    approvedSignatures,
    ...streamOptions
  } = options;
  const clock = now ?? (() => Date.now());
  const turnId = providedId ?? createTurnId();
  const run = stream ?? streamMsaidiziAsk;

  dispatch({
    type: 'turn_started',
    turnId,
    prompt: request.message,
    at: clock(),
    approvedSignatures,
  });

  const outcome = await run(
    request,
    {
      onFrame,
      onEvent: (event) => dispatch({ type: 'event', turnId, event }),
      onSession: (session) => dispatch({ type: 'session', turnId, session }),
      onResult: (result) => dispatch({ type: 'result', turnId, result }),
    },
    { ...streamOptions, now: clock },
  );

  dispatch({ type: 'settled', turnId, outcome, at: clock() });
  return outcome;
}

/**
 * Load a stored conversation. Always readable; continuable when the SERVER says
 * its resume state is still there — `continuable`, see the `hydrated` case.
 */
export function hydrateFromConversation(
  conversation: MsaidiziConversationDetail,
): MsaidiziConversationState {
  return msaidiziConversationReducer(createConversationState(), {
    type: 'hydrated',
    conversation,
  });
}
