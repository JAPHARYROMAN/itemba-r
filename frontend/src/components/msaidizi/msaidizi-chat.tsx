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
 * requests, spends their ids on exactly one request, and forgets them. The
 * server checks that array as a plain set against every red proposal for the
 * whole run and keeps no pending state of its own, so a client that parked those
 * ids in component state and re-sent them on later turns would have converted
 * one approval into a standing grant for that action for the rest of the run.
 *
 * ─── Why every failure has a sentence ───────────────────────────────────────
 *
 * `runMsaidiziTurn` never rejects: the transport turns a dead proxy, a 503, an
 * unrecoverable 401, a body that is not a stream and a mid-run disconnect into
 * ten distinct terminations, each of which the thread renders with its own
 * words. Nothing here catches-and-ignores, because the failure mode this
 * codebase's own review named as its top defect class is exactly a swallowed
 * error rendering as a successful empty state.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ui';
import { capabilityIndex, fetchMsaidiziConversation } from '@/lib/msaidizi-client';
import {
  buildAskRequest,
  composeConfirmationMessage,
  createConversationState,
  isRunning,
  msaidiziConversationReducer,
  pendingConfirmations as selectPendingConfirmations,
  runMsaidiziTurn,
} from '@/lib/msaidizi-conversation';
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
import { MsaidiziThread } from './msaidizi-thread';

export interface MsaidiziChatProps {
  /** A question carried in from the launcher. Runs once, when it may. */
  initialQuestion?: string | null;
}

export function MsaidiziChat({ initialQuestion = null }: MsaidiziChatProps) {
  const [state, dispatch] = useReducer(
    msaidiziConversationReducer,
    undefined,
    createConversationState,
  );

  const { capabilities, error: capabilitiesError } = useMsaidiziCapabilities();
  const {
    conversations,
    loading: listLoading,
    error: listError,
    reload: reloadConversations,
    remove: removeConversation,
  } = useMsaidiziConversations({ limit: 30 });

  const [storedId, setStoredId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const running = isRunning(state);
  const pending = selectPendingConfirmations(state);
  const capabilityLookup = useMemo(() => capabilityIndex(capabilities), [capabilities]);
  const writeMode = capabilities ? capabilities.writeMode : null;
  const availability = msaidiziAvailability(capabilities);
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

  const ask = useCallback((message: string, confirmed?: string[]) => {
    const request = buildAskRequest(stateRef.current, message, { confirmed });
    // Deliberately not awaited and deliberately not `.catch`ed: the orchestrator
    // resolves with a stated termination for every failure and dispatches it
    // into the thread. There is no rejection to handle.
    void runMsaidiziTurn(request, dispatch);
  }, []);

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
    setOpenError(null);
    dispatch({ type: 'reset' });
  }, []);

  const confirmRemove = useCallback(async () => {
    const id = removing;
    if (!id) return;
    setRemoving(null);
    // `remove` resolves either way and reports through the list's own `error`.
    await removeConversation(id);
    if (storedId === id) startNew();
  }, [removeConversation, removing, startNew, storedId]);

  const handleApprove = useCallback(
    (approved: ConfirmationRequest[]) => {
      if (approved.length === 0) return;
      // The message is composed from the actions' own descriptions, not sent as
      // a bare "yes". The click is the consent; the message is the record of
      // WHAT was consented to, and it lands in a transcript someone will read
      // later, where "Yes, go ahead." is evidence of nothing.
      ask(
        composeConfirmationMessage(approved),
        approved.map((request) => request.confirmationId),
      );
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

  // Ordered by how badly the user needs to know. A stored conversation is the
  // most specific fact; a switched-off module is the most general.
  const blockedReason = storedId
    ? 'This is a saved conversation. Msaidizi cannot pick it up from here — start a new conversation to ask a follow-up.'
    : !state.historyComplete && state.turns.length > 0
      ? 'Part of a run was lost before it reported back, so Msaidizi can no longer be told what happened in it. Start a new conversation.'
      : availability.reason;

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
                It looks things up with your own permissions, and shows you every record it touched
                on the way to the answer.
              </p>
            </div>
          ) : (
            <MsaidiziThread
              turns={state.turns}
              capabilities={capabilityLookup}
              pendingConfirmations={storedId ? [] : pending}
              onApprove={handleApprove}
              onDecline={handleDecline}
              onRetry={storedId ? undefined : (turn) => ask(turn.prompt)}
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
