'use client';

/**
 * The session id, on screen and copyable.
 *
 * This is the only durable handle on a run. Everything else about a conversation
 * is a UI artefact that its author can remove; the `ms_…` value is written onto
 * every audit row the run produces and is indexed there, so it survives the
 * conversation being deleted, the resume state being destroyed, and the retention
 * sweeper. When someone asks "what did the assistant actually do under my name",
 * this string is the entire answer to "where do I look".
 *
 * Which is why it is not hidden behind a details drawer. The plan's own test of
 * whether the page is doing its job is that a manager who has used it for a week
 * can answer three questions unprompted, and the third is *where would you look
 * to check what it did*. If the answer is "I don't know", this component failed.
 *
 * ─── The uncomfortable half ─────────────────────────────────────────────────
 *
 * Under a read-only deployment that query returns nothing at all, because reads
 * are not audited — `api_request_logs` exists and nothing in the system writes to
 * it. An affordance that sends someone to an empty screen without warning is
 * worse than no affordance, so when the mode is known and it is `read-only`, this
 * says so before they go looking.
 *
 * ─── Clipboard ──────────────────────────────────────────────────────────────
 *
 * `navigator.clipboard` is absent over plain HTTP, absent in jsdom, and rejects
 * when the document is not focused. All three are ordinary, none of them are
 * exceptional, and the failure is visible rather than swallowed: the id is
 * selectable text either way, so a failed copy costs a double-click and not the
 * information.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MsaidiziWriteMode } from '@/lib/msaidizi-types';

type CopyState = 'idle' | 'copied' | 'failed';

export interface MsaidiziSessionHandleProps {
  /** Null until a run reports one — see `hasRun` for why that is two cases. */
  sessionId: string | null;
  /**
   * Whether a question has already been asked in this conversation.
   *
   * Without it, no id and no id are the same thing here, and they are not. Before
   * the first question there is genuinely nothing to show. After one, the id was
   * minted server-side the moment `run()` started and the run may have called
   * four tools and written four audit rows — this page simply never received it,
   * because on the path without an early `session` frame the id arrives only on
   * the final `result`, and a dropped connection takes that frame with it. Saying
   * "one is minted when the first question runs" at that point sits directly
   * under a notice promising the run's changes are still being recorded, and
   * denies the existence of the one key that finds them.
   */
  hasRun?: boolean;
  /**
   * Drives the honest caveat about there being no rows to find. Omit it and the
   * caveat is left out rather than guessed — an unqualified promise that the
   * audit log has something in it is the failure this prop exists to avoid, and
   * so is an unqualified claim that it does not.
   */
  writeMode?: MsaidiziWriteMode | null;
  className?: string;
}

export function MsaidiziSessionHandle({
  sessionId,
  hasRun = false,
  writeMode = null,
  className = '',
}: MsaidiziSessionHandleProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const flash = useCallback((next: CopyState) => {
    setCopyState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState('idle'), 2500);
  }, []);

  const copy = useCallback(() => {
    if (!sessionId) return;
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) {
      flash('failed');
      return;
    }
    clipboard.writeText(sessionId).then(
      () => flash('copied'),
      () => flash('failed'),
    );
  }, [sessionId, flash]);

  if (!sessionId) {
    // Once a run has been attempted, the honest sentence is about this page and
    // not about the server. Which run it was — one that did four tool calls and
    // lost its `result`, or one a 503 refused before it started — is not knowable
    // from here, so the sentence is conditional on the only thing that is: if it
    // got far enough to change anything, that is on record under an id this page
    // never saw.
    //
    // That frame now exists: the stream writes `session` before the first model
    // turn, and this component's only caller is on the streaming path. So this
    // branch is no longer the ordinary end of a dropped run — it is what remains
    // when the stream died BEFORE its first frame (an unreachable proxy, a 503,
    // a 200 that was not an event stream). A run that reached the model has an
    // id on screen. Narrower than it was, and still not empty, which is why the
    // sentence stays conditional rather than becoming a promise either way.
    return (
      <p className={`text-[11px] ${className}`} style={{ color: 'var(--aurora-text-muted)' }}>
        {hasRun
          ? 'This run’s session id did not reach this page. If it got far enough to change anything, that is still recorded under an id nobody here received — search the audit log by the time of the run and your own name.'
          : 'No session id yet — one is minted when the first question runs.'}
      </p>
    );
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          Session
        </span>
        <code
          className="rounded px-1.5 py-0.5 font-mono text-[11px] break-all"
          style={{ background: 'var(--aurora-bg-muted)', color: 'var(--aurora-text-secondary)' }}
        >
          {sessionId}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy session id ${sessionId}`}
          className="cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium transition"
          style={{
            border: '1px solid var(--aurora-border)',
            background: 'var(--aurora-card)',
            color: 'var(--aurora-text-secondary)',
          }}
        >
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </div>

      <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
        The handle for this conversation in the audit log — filter it by{' '}
        <span className="font-mono">agentSessionId</span>. It survives the conversation being
        removed, because what the assistant changed is recorded separately.
      </p>

      {writeMode === 'read-only' && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
          In this deployment that search will come back empty: the assistant can only read, and
          reads are not written to the audit log yet.
        </p>
      )}

      {copyState === 'failed' && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-danger-text)' }}>
          The browser would not give this page the clipboard. Select the id above and copy it by
          hand.
        </p>
      )}
    </div>
  );
}
