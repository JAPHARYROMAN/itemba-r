'use client';

/**
 * The chat: conversation list, thread, composer.
 *
 * ─── Where the state lives, and why not here ────────────────────────────────
 *
 * All of the conversation logic is in `lib/msaidizi-conversation.ts` — a pure
 * reducer plus a thin orchestrator, with no React in it. This component wraps it
 * in `useReducer` and renders. Two things follow that are worth the indirection:
 * the launcher, the page and the tests drive the same state machine rather than
 * three `useState` soups that diverge, and there are no dependency arrays over
 * conversation state at all, which is how this file sidesteps the React Compiler
 * trap this repo has hit twice (an optional-chained value in a dependency array
 * is a build error — read scope values into plain locals first).
 *
 * Everything that is NOT the running conversation — what this deployment allows,
 * the list of past chats, the standing statement about reach and audit, the two
 * clocks a stored conversation is on, the session handle into the audit trail —
 * comes from `./index`. This file composes those; it does not re-implement them.
 *
 * ─── The one-shot that must stay a one-shot ─────────────────────────────────
 *
 * `confirmed` is never held in state. `handleApprove` receives the approved
 * requests, spends their ids on exactly one request, and forgets them. What the
 * server does with an id it has already honoured is the server's own business
 * and has changed at least once, so nothing here is built on it. The reason is
 * simpler and does not move: parking those ids in component state and re-sending
 * them would put a standing "yes" for that action on every later turn of the
 * run, and this page never asked the user for a standing yes. It asked once,
 * about one proposal, and one request is the whole extent of the answer.
 *
 * ─── One guard on every door that starts a turn ─────────────────────────────
 *
 * There are three of them — the composer, the confirmation gate's Approve and
 * Decline, and the "Ask again" a termination notice offers — and they all reach
 * `ask()`, so they all reach `buildAskRequest`, so they all send whatever
 * `history` currently is. `canContinue()` is the single question they must all
 * ask first: a run that produced events and never reported its `messages` left a
 * hole the thread can no longer describe to the model, and continuing from that
 * point is not a degraded turn, it is a turn built on a history the app has
 * already decided is wrong.
 *
 * The guard's own reasoning lives in `msaidizi-conversation.ts`'s `settled`
 * case, which is where the two facts that lift it are weighed; what matters here
 * is only which door it closes and why the approve door is the one that matters
 * most. `historyComplete` goes false exactly when NEITHER party kept an account
 * of the run: this tab's array is missing what the run did, and the server
 * either never opened a row for the turn or never reported its verdict. Sending
 * an approval from there does not fail cleanly — it succeeds against the wrong
 * conversation. The model receives "Yes — go ahead: delete invoice 41" appended
 * to a history in which it never proposed anything, so if it acts at all it acts
 * on an irreversible action reconstructed from a sentence rather than re-issued
 * from its own proposal, and nothing downstream can tell the two apart.
 *
 * The paragraph that used to sit here blamed the lost `result` frame for taking
 * the session id with it, leaving the server to mint a new one and recompute
 * every confirmation id off it. That is no longer how the id arrives:
 * `msaidizi.controller.ts` sends `session` with `agentSessionId` BEFORE the
 * first model turn, the reducer takes it, and `lostRun` needs a turn that
 * already produced events — so by the time this guard can fire the session id is
 * in state. Continuing an id-mismatch story would have a maintainer relax the
 * guard on the strength of having disproved an argument nobody is making.
 *
 * So `blockedReason` goes to the thread as well as the composer, and the gate
 * renders with its buttons dead and that sentence inside the decision box. What
 * a lost run withdraws is the ability to act, not the gate: the proposal, its
 * arguments and the steps that led to it are the evidence someone reviewing this
 * run needs most, and a decision box that vanishes without a word is how a user
 * concludes they approved something.
 *
 * ─── Which proposal gets a gate at all ──────────────────────────────────────
 *
 * Exactly one: the newest turn's, and only when this tab is the thing that ran
 * it. `pendingConfirmations` is derived from the newest turn alone, and that
 * turn can equally have come out of the store — a conversation reopened from
 * the rail whose last run stopped on a red proposal. That one renders as a
 * record instead, in the past tense it belongs in.
 *
 * Not because the server would refuse it. A conversation continued by id runs on
 * its own stored `agentSessionId` (`conversations.service.ts`, `appendTurn`), and
 * yesterday's grants were issued in exactly that conversation, so an approval
 * sent from here would be honoured for as long as those grants have not lapsed.
 * That is the reason the restraint has to live on this side: nothing downstream
 * would reliably stop it. What is withheld is a live decision box for an
 * irreversible change offered
 * on the strength of a transcript — a run nobody in this tab watched happen, in
 * a conversation whose stored state was read once, when it was opened, and may
 * have moved since. Reopening a thread is reading; deciding is asking again. It
 * is a product decision rather than a mechanical impossibility, and relaxing it
 * is a real option, not a bug fix.
 *
 * The question this page used to ask was "did this thread come from the rail",
 * which gave the same answer only for as long as a reopened conversation could
 * not take a turn at all. Once the server began continuing one by id, a LIVE
 * red proposal became reachable inside a reopened thread — and that question
 * hid its gate: no Approve, no Decline, no sentence saying why, and a record in
 * its place stating the decision may already have been taken, for a decision
 * nobody was ever offered. So what is asked here is about the TURN, not about
 * where the thread came from.
 *
 * ─── Why every failure has a sentence ───────────────────────────────────────
 *
 * `runMsaidiziTurn` never rejects: the transport turns a dead proxy, a 503, an
 * unrecoverable 401, a body that is not a stream and a mid-run disconnect into
 * eleven distinct terminations — the server's seven `DoneReason`s plus
 * `stream_failed`, `disconnected`, `aborted` and `unavailable`. The thread has a
 * sentence for every one of them that nothing else on the screen already
 * answers: `end_turn` with prose is answered by the prose, `awaiting_confirmation`
 * by the gate carrying the proposal, and the other nine get words of their own.
 * Nothing here catches-and-ignores, because the failure mode this codebase's own
 * review named as its top defect class is exactly a swallowed error rendering as
 * a successful empty state.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ui';
import { capabilityIndex, fetchMsaidiziConversation } from '@/lib/msaidizi-client';
import {
  buildAskRequest,
  canContinue,
  classifyTermination,
  composeConfirmationMessage,
  createConversationState,
  createTurnId,
  isRunning,
  latestTurn,
  msaidiziConversationReducer,
  pendingConfirmations as selectPendingConfirmations,
  runMsaidiziTurn,
} from '@/lib/msaidizi-conversation';
import { grantIdOf } from '@/lib/msaidizi-types';
import type { ConfirmationRequest } from '@/lib/msaidizi-types';
import {
  MsaidiziConversationList,
  MsaidiziModeBanner,
  MsaidiziResumabilityNotice,
  MsaidiziSessionHandle,
  msaidiziAvailability,
  useMsaidiziCapabilities,
  useMsaidiziConversations,
} from './index';
import { MsaidiziComposer } from './msaidizi-composer';
import { actionSignature } from './msaidizi-confirmation-gate';
import { MsaidiziThread } from './msaidizi-thread';

export interface MsaidiziChatProps {
  /** A question carried in from the launcher. Runs once, when it may. */
  initialQuestion?: string | null;
}

/**
 * The one sentence the composer shows in place of its input, or null.
 *
 * Ordered by how badly the user needs to know: a stored conversation past its
 * resume clock is the most specific fact about THIS thread, a broken history is
 * the next, an unanswered capabilities check is a fact about the page, and a
 * switched-off module is the most general. The capabilities failure has to be
 * named before `availabilityReason`, because `msaidiziAvailability(null)` cannot
 * tell "not asked yet" from "asked and got nothing" and says the first — which on
 * the error path is a page that reports a check still running that already failed.
 *
 * `storedBlocked` is NOT "this came from the rail". A stored conversation the
 * server still holds resume state for can be picked up from here: the next turn
 * sends its `conversationId` and the server answers from that state, which is the
 * whole point of the id being on the wire. Only one the server has told us it can
 * no longer continue is closed, and the notice above it says which of the two
 * clocks ran out, in the server's own words.
 */
function composerBlockedReason(input: {
  storedBlocked: boolean;
  lostRun: boolean;
  lostApproval: boolean;
  runContinuesOnServer: boolean;
  capabilitiesError: string | null;
  availabilityReason: string | null;
}): string | null {
  if (input.storedBlocked) {
    return 'This saved conversation can no longer be continued — start a new conversation to ask a follow-up.';
  }
  if (input.lostRun) {
    // `historyComplete` goes false for two situations that want opposite
    // sentences, and one sentence for both is wrong for one of them.
    //
    // `runContinuesOnServer` is the run still executing over there — the socket
    // dropped or the user aborted the view, and `run()` takes no `AbortSignal`,
    // so the remaining model turns and tool calls are running right now and the
    // server will record the exchange when they finish. "Msaidizi can no longer
    // be told what happened in it" is simply untrue of that: the server is the
    // one party that WILL know. What is true is that we must not race it — a
    // second question opened against a conversation whose first run has not
    // finished writing is two runs competing to be its stored memory — and that
    // is a reason to wait, not a reason to conclude the exchange is lost.
    //
    // Otherwise the run is genuinely over and nobody holds it: no row was opened
    // for the turn, so the original sentence is exact.
    if (input.runContinuesOnServer) {
      return input.lostApproval
        ? 'The connection to this run was lost while it was still going, and it is still finishing on the server — including the change it asked you to approve, which cannot be approved from here because this page can no longer see what it did. Nothing was approved by losing the connection. Asking again now would start a second run alongside it, so start a new conversation instead.'
        : 'The connection to this run was lost while it was still going, and it is still finishing on the server. Asking again now would start a second run alongside it rather than picking this one up, so start a new conversation instead.';
    }
    // The approval variant is not decoration: the gate that was on screen has
    // just been withdrawn, and a decision box vanishing without a word is how a
    // user concludes they approved something.
    return input.lostApproval
      ? 'Part of a run was lost before it reported back, so Msaidizi can no longer be told what happened in it — including the change it asked you to approve, which can no longer be approved from here. Nothing was approved. Start a new conversation.'
      : 'Part of a run was lost before it reported back, so Msaidizi can no longer be told what happened in it. Start a new conversation.';
  }
  if (input.capabilitiesError) {
    return 'Msaidizi could not be asked what it is allowed to do here, so nothing can be sent yet. Check again above.';
  }
  return input.availabilityReason;
}

export function MsaidiziChat({ initialQuestion = null }: MsaidiziChatProps) {
  const [state, dispatch] = useReducer(
    msaidiziConversationReducer,
    undefined,
    createConversationState,
  );

  const {
    capabilities,
    loading: capabilitiesLoading,
    error: capabilitiesError,
    reload: reloadCapabilities,
  } = useMsaidiziCapabilities();
  const {
    conversations,
    loading: listLoading,
    error: listError,
    reload: reloadConversations,
    remove: removeConversation,
  } = useMsaidiziConversations({ limit: 30 });

  const [storedId, setStoredId] = useState<string | null>(null);
  // The server's own verdict on the stored conversation now open, taken from the
  // detail rather than the list row: the detail is what was actually hydrated,
  // and the list may not hold this conversation at all once it is off page one.
  const [storedBlocked, setStoredBlocked] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  // The newest turn this tab actually ran, or null while everything on screen
  // came out of the store. Minted in `ask` — see `liveProposal` below.
  const [liveTurnId, setLiveTurnId] = useState<string | null>(null);

  const running = isRunning(state);
  const pending = selectPendingConfirmations(state);
  // Whether the proposals above are a decision waiting on this user, or the
  // record of one whose moment has passed. `pendingConfirmations` can only ever
  // be about the newest turn, so this one comparison is the whole question, and
  // it is asked about the turn rather than about the thread — see the header.
  const newest = latestTurn(state);
  const liveProposal = newest !== null && newest.id === liveTurnId;
  // Read into a plain local: it goes into a dependency array below, and this
  // file's rule is that dependency arrays list locals rather than member reads.
  const liveConversationId = state.conversationId;
  // Whether a next turn in this tab would carry the thread's real memory. Every
  // control that can start one is gated on it — see the file header.
  const continuable = canContinue(state);
  const capabilityLookup = useMemo(() => capabilityIndex(capabilities), [capabilities]);
  const writeMode = capabilities ? capabilities.writeMode : null;
  // The error is handed over so the selector reports a failed check as a failed
  // check. The page keeps its own sentence for this case below — it owns the
  // "Check again" button and can point at it, which a shared selector cannot —
  // but the two now agree on which of the two facts null capabilities is.
  const availability = msaidiziAvailability(capabilities, capabilitiesError);
  const canAsk = availability.canAsk;
  const storedSummary = conversations.find((conversation) => conversation.id === storedId) ?? null;

  // The state the next request is built from. Kept in a ref so a handler created
  // once — the launcher's auto-run, a retry from a notice — still reads the
  // conversation as it stands rather than as it was when the closure was made.
  // Written in an effect, never during render.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const ask = useCallback(
    (
      message: string,
      /**
       * The approval this message carries, when it carries one.
       *
       * `confirmed` holds SERVER-ISSUED grant ids and nothing else — see
       * `handleApprove`, which is the only caller that fills it. `signatures`
       * names the same actions as tool-plus-arguments text and is recorded on
       * the turn so the thread can tell an approval that was thrown away from
       * the model simply asking twice; it is passed separately, rather than the
       * requests being handed over whole, so that there is no path by which a
       * grant id reaches the reducer.
       */
      approval?: { confirmed: string[]; signatures: string[] },
    ) => {
      const request = buildAskRequest(stateRef.current, message, {
        confirmed: approval?.confirmed,
      });
      // The turn id is minted here rather than left to the orchestrator because
      // the page has to be able to tell which turn on screen is one it ran. That
      // is the difference between a red proposal awaiting a decision and the
      // same event read back out of a stored transcript, and there is no other
      // way to ask it: a hydrated turn and a live one are the same shape.
      const turnId = createTurnId();
      setLiveTurnId(turnId);
      // Deliberately not awaited and deliberately not `.catch`ed: the orchestrator
      // resolves with a stated termination for every failure and dispatches it
      // into the thread. There is no rejection to handle.
      //
      // The rail is refreshed when it settles, not on mount alone. Every run now
      // writes a conversation row, and a list fetched once leaves the thread the
      // user is looking at missing from the list beside it until a full page
      // reload — which reads as the history not being kept at all. Refreshed on
      // every termination rather than only on success, because a run that failed
      // partway still opened its row and still holds the session id that finds
      // whatever it managed to change.
      void runMsaidiziTurn(request, dispatch, {
        turnId,
        approvedSignatures: approval?.signatures,
      }).then(() => {
        void reloadConversations();
      });
    },
    [reloadConversations],
  );

  // ── The launcher's question ────────────────────────────────────────────────
  // It waits for the capabilities answer rather than firing on mount. Learning
  // the module is switched off by watching your own question fail is the thing
  // that endpoint exists to prevent, and a question handed over from a launcher
  // is no more entitled to find that out the hard way than a typed one.
  const launched = useRef(false);
  useEffect(() => {
    const question = initialQuestion?.trim() ?? '';
    if (!question || launched.current || !canAsk) return;
    launched.current = true;
    ask(question);
  }, [ask, canAsk, initialQuestion]);

  const openConversation = useCallback((id: string) => {
    setOpenError(null);
    fetchMsaidiziConversation(id)
      .then((detail) => {
        setStoredId(detail.id);
        setStoredBlocked(!detail.continuable);
        // The thread on screen is replaced wholesale by the stored one, so no
        // turn in it was run here — including one that stopped on a proposal.
        setLiveTurnId(null);
        dispatch({ type: 'hydrated', conversation: detail });
      })
      .catch(() => {
        setOpenError(
          'That conversation could not be opened. It may have passed its retention window.',
        );
      });
  }, []);

  const startNew = useCallback(() => {
    setStoredId(null);
    setStoredBlocked(false);
    setOpenError(null);
    setLiveTurnId(null);
    dispatch({ type: 'reset' });
  }, []);

  const confirmRemove = useCallback(async () => {
    const id = removing;
    if (!id) return;
    setRemoving(null);
    // `remove` resolves either way and reports through the list's own `error`.
    await removeConversation(id);
    // Whether the thread on screen IS the one just removed has two answers,
    // because a conversation gets here two ways: opened from the rail, which is
    // `storedId`, or created by asking in this tab, where the server's `session`
    // frame is the only place its id was ever written and `storedId` stays null.
    // Removing it destroys the resume state and takes the row out of the list,
    // and the next turn from that thread still carries the dead id — which the
    // server answers "Conversation not found.", for that question and every one
    // after it, with nothing on screen pointing at "New conversation". So the
    // thread goes when its conversation does, rather than being left bricked.
    if (storedId === id || liveConversationId === id) startNew();
  }, [liveConversationId, removeConversation, removing, startNew, storedId]);

  const handleApprove = useCallback(
    (approved: ConfirmationRequest[]) => {
      if (approved.length === 0) return;
      // The only place in the product that fills `confirmed`, and it does so by
      // READING the grant the server issued with each proposal. Nothing here
      // computes, guesses or reconstructs an id: `grantIdOf` returns what
      // arrived or null, and null means the proposal is not approvable. The gate
      // will not let such a row be ticked, so this filter should never drop
      // anything — it is kept because the cost of it being needed once is an
      // approval sent for a proposal nobody could authorise, and because the
      // alternative (falling back to `confirmationId`) is precisely the derived,
      // client-computable id the grant ledger exists to stop accepting.
      const confirmed: string[] = [];
      const approvable: ConfirmationRequest[] = [];
      for (const request of approved) {
        const grant = grantIdOf(request);
        if (grant === null) continue;
        confirmed.push(grant);
        approvable.push(request);
      }
      // Nothing to send. Starting a turn here would post a "yes" naming actions
      // whose approval this page had no id for.
      if (confirmed.length === 0) return;
      // The message is composed from the actions' own descriptions, not sent as
      // a bare "yes". The click is the consent; the message is the record of
      // WHAT was consented to, and it lands in a transcript someone will read
      // later, where "Yes, go ahead." is evidence of nothing. Composed from
      // `approvable` rather than `approved` so the sentence names exactly the
      // actions the ids authorise.
      ask(composeConfirmationMessage(approvable), {
        confirmed,
        signatures: approvable.map((request) => actionSignature(request.tool, request.args)),
      });
    },
    [ask],
  );

  const handleDecline = useCallback(() => {
    // No `confirmed`, and no decline endpoint: the next turn simply goes without
    // the approval. The model sees its own "stop and wait" tool result plus the
    // refusal and moves on. There is nothing on the server to clean up.
    ask(composeConfirmationMessage([]));
  }, [ask]);

  // ── Scroll ─────────────────────────────────────────────────────────────────
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const turnCount = state.turns.length;
  const eventCount = state.turns.reduce((total, turn) => total + turn.events.length, 0);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [turnCount, eventCount]);

  const lostRun = !state.historyComplete && state.turns.length > 0;
  // Read off the NEWEST turn, which is the turn that holed the history: nothing
  // after it can have run, because a holed history blocks the composer. A turn
  // still open reports no termination at all, which is not the case this splits
  // — `lostRun` needs a settled turn — so `false` there is the right reading.
  const latestTermination = latestTurn(state)?.termination ?? null;
  const blockedReason = composerBlockedReason({
    storedBlocked,
    lostRun,
    lostApproval: lostRun && pending.length > 0,
    runContinuesOnServer: latestTermination
      ? classifyTermination(latestTermination).runContinuesOnServer
      : false,
    capabilitiesError,
    availabilityReason: availability.reason,
  });

  return (
    <div className="flex min-h-0 flex-1 gap-6">
      <aside
        className="hidden w-64 flex-shrink-0 border-r pr-4 lg:block"
        style={{ borderColor: 'var(--aurora-border)' }}
      >
        <MsaidiziConversationList
          conversations={conversations}
          selectedId={storedId}
          loading={listLoading}
          error={listError}
          onRetry={() => void reloadConversations()}
          onSelect={openConversation}
          onNew={startNew}
          onRemove={setRemoving}
        />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <MsaidiziModeBanner capabilities={capabilities} error={capabilitiesError} />

        {/*
          The banner states the failure; this re-attempts it. The two are split
          because the banner is a pure statement about a fixture and takes no
          callbacks, and because without a button one dropped request leaves a
          page that can never ask again — the composer stays blocked, the banner
          stays failed, and a browser refresh is the only way out, which nothing
          on screen says. The conversation rail has had its retry since it was
          written; this is the same wiring on the other load.
        */}
        {capabilitiesError && (
          <div>
            <button
              type="button"
              data-testid="msaidizi-capabilities-retry"
              onClick={reloadCapabilities}
              disabled={capabilitiesLoading}
              className="rounded-lg border px-3 py-1.5 text-[12.5px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                borderColor: 'var(--aurora-border)',
                background: 'var(--aurora-card)',
                color: 'var(--aurora-text)',
              }}
            >
              {capabilitiesLoading ? 'Checking…' : 'Check again'}
            </button>
          </div>
        )}

        {storedSummary && <MsaidiziResumabilityNotice conversation={storedSummary} />}

        {openError && (
          <p
            data-testid="msaidizi-open-error"
            className="text-[12px]"
            style={{ color: 'var(--aurora-danger-text)' }}
          >
            {openError}
          </p>
        )}

        <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto py-4">
          {state.turns.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[14px] font-medium" style={{ color: 'var(--aurora-text)' }}>
                Ask Msaidizi about your business.
              </p>
              <p
                className="mx-auto mt-1.5 max-w-sm text-[12.5px]"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                It looks things up with your own permissions, and shows its working as it goes. The
                steps say what it touched; the answer says what it found.
              </p>
            </div>
          ) : (
            <MsaidiziThread
              turns={state.turns}
              capabilities={capabilityLookup}
              // The gate, or the record: a proposal from a turn this tab ran is
              // a decision waiting on the user and gets its buttons; the same
              // event read back out of the store is history, and the thread
              // renders it as a record. See "Which proposal gets a gate at all".
              pendingConfirmations={liveProposal ? pending : []}
              onApprove={handleApprove}
              onDecline={handleDecline}
              // Withheld rather than disabled, because `blockedReason` alone
              // would leave "Ask again" live during a LIVE run — where the
              // composer is held by `busy` and there is no sentence to show —
              // and a second concurrent run is the one thing the disconnected
              // notice spends a paragraph telling the user not to start.
              onRetry={continuable ? (turn) => ask(turn.prompt) : undefined}
              // The same string the composer gets. The gate's Approve, its
              // Decline and a notice's "Ask again" all start a turn exactly as
              // the composer does, so they are closed by the same fact and say
              // the same thing about it.
              blockedReason={blockedReason}
              busy={running}
            />
          )}
        </div>

        <div className="flex-shrink-0 pb-2">
          <MsaidiziComposer onSubmit={ask} busy={running} blockedReason={blockedReason} />
          {running ? (
            <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--aurora-text-muted)' }}>
              This run cannot be stopped from here. Leaving the page loses the view, not the run.
            </p>
          ) : (
            <MsaidiziSessionHandle
              className="mt-1.5"
              sessionId={state.sessionId}
              // Only this state can tell "before the first question" from "a run
              // happened and its id never reached this page". Without it a
              // dropped run says an id is minted when the first question runs,
              // directly under a notice saying that run's changes are on record.
              hasRun={state.turns.length > 0}
              writeMode={writeMode}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={removing !== null}
        title="Remove this conversation?"
        message="It disappears from your list and the part Msaidizi could resume from is destroyed straight away. Anything it changed stays recorded in the audit log — removing the chat changes nothing about what is on record."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
