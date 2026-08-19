/**
 * Readable, or continuable — and saying which, before the send button lies.
 *
 * Persistence stores two payloads on two clocks, and this component exists
 * because of the gap between them. The transcript — the user's words, the model's
 * prose, the fact of every tool call — is kept for the retention window, in days.
 * The resume state — the model's own `messages` array, the only place retrieved
 * business records are stored — is destroyed within a day. So there is a long
 * middle in a conversation's life where it reads perfectly and cannot be added
 * to, which is exactly what a chat application does when a session ages out.
 *
 * The failure to avoid is discovering that at send time. The server is honest
 * about it — a continuation past the clock returns a 410 with a written sentence
 * rather than a generic error — but a user who types a follow-up, waits, and then
 * reads "expired" has been misled by the composer being open. So the state is
 * shown while they are still deciding what to type.
 *
 * ─── Three reasons a conversation is not continuable, and they are different ──
 *
 *   `resumable: false`  the run's `messages` exceeded MSAIDIZI_RESUME_MAX_BYTES
 *                       and nothing was stored. Truncating the array would break
 *                       tool_use/tool_result pairing and surface later as a
 *                       generic `failed`, so the server stores nothing and says
 *                       so. Permanent for this conversation.
 *
 *   past the clock      `resumable: true`, resume state destroyed on schedule.
 *                       Ordinary ageing, and the common case.
 *
 *   no completed turn   the conversation row was written before the loop began —
 *                       deliberately, so a run that crashes still leaves the
 *                       `agentSessionId` needed to find what it changed — and no
 *                       turn ever closed. The row is evidence, not a chat.
 *
 * ─── The one thing this does not know ────────────────────────────────────────
 *
 * `continuable` is computed on the server against `Date.now()` at the moment the
 * list or the detail was fetched. It is a snapshot, and a tab left open across
 * the resume window will hold a stale `true`. That is survivable precisely
 * because the server refuses with a written sentence rather than a generic
 * failure — this component moves the message earlier, it does not replace it.
 * When the refusal does arrive, `msaidizi-thread.tsx` renders that sentence as
 * the body of the notice, under a heading that says the server answered rather
 * than that it could not be reached; the two screens have to agree, because a
 * user who was told this page was continuable is owed the real reason it was
 * not.
 *
 * ─── And the other clock, which lives in the state model ─────────────────────
 *
 * There is a second way to be readable-not-continuable, and it is client-side:
 * `historyComplete` in `msaidizi-conversation.ts` goes false when a turn produced
 * events and never returned its `messages`, so the next request would echo a
 * history missing that exchange. A composer must consult both — this for the
 * stored conversation, `canContinue()` for the live tab.
 */

import React from 'react';
import type { MsaidiziConversationSummary } from '@/lib/msaidizi-types';

export type MsaidiziResumeState = 'continuable' | 'expired' | 'too_long' | 'unfinished';

export interface MsaidiziResumeDescription {
  state: MsaidiziResumeState;
  /** Whether a follow-up in this conversation would reach the server at all. */
  canContinue: boolean;
  /** Whether the transcript is worth rendering. True in every state here. */
  readable: boolean;
  headline: string;
  detail: string | null;
}

/**
 * Which of the two clocks this conversation is on.
 *
 * The wording of `expired` and `too_long` is deliberately the server's own
 * sentence, so the message a user reads before typing and the message they would
 * read after a refused send are the same message.
 */
export function describeResumability(
  conversation: MsaidiziConversationSummary | null | undefined,
): MsaidiziResumeDescription | null {
  if (!conversation) return null;

  if (conversation.continuable) {
    return {
      state: 'continuable',
      canContinue: true,
      readable: true,
      headline: 'This conversation can be continued.',
      detail: null,
    };
  }

  if (!conversation.resumable) {
    return {
      state: 'too_long',
      canContinue: false,
      readable: true,
      headline: 'This conversation is too long to continue — start a new one.',
      detail:
        'Its history is still readable. There was more working state behind it than can be ' +
        'kept, and storing part of it would have produced a conversation the assistant could ' +
        'not read back.',
    };
  }

  if (conversation.turnCount === 0) {
    return {
      state: 'unfinished',
      canContinue: false,
      readable: true,
      headline: 'This conversation has no completed turns.',
      detail:
        'The run that started it did not finish. Its record is kept anyway, so that whatever ' +
        'it did before it stopped can still be found in the audit log by its session id.',
    };
  }

  return {
    state: 'expired',
    canContinue: false,
    readable: true,
    headline: 'This conversation can no longer be continued — its working state has expired.',
    detail:
      'Its history is still readable; start a new conversation to carry on. The assistant’s own ' +
      'memory of it is destroyed within a day of the last question, because that is the one ' +
      'place the records it looked up are kept.',
  };
}

/** The short form for a list row, where there is space for two words and no more. */
export function resumeChipLabel(state: MsaidiziResumeState): string | null {
  switch (state) {
    case 'continuable':
      return null;
    case 'unfinished':
      return 'Unfinished';
    default:
      return 'History only';
  }
}

export interface MsaidiziResumabilityNoticeProps {
  conversation: MsaidiziConversationSummary | null | undefined;
  className?: string;
}

/**
 * Renders nothing when the conversation can be continued.
 *
 * A banner saying "everything is fine" is noise that trains people to stop
 * reading banners, and the banner that matters here is the one that appears
 * rarely.
 */
export function MsaidiziResumabilityNotice({
  conversation,
  className = '',
}: MsaidiziResumabilityNoticeProps) {
  const description = describeResumability(conversation);
  if (!description || description.canContinue) return null;

  return (
    <div
      role="status"
      className={`rounded-xl px-4 py-3 ${className}`}
      style={{
        background: 'var(--aurora-bg-muted)',
        border: '1px solid var(--aurora-border-strong)',
      }}
    >
      <p className="text-[13px] font-medium" style={{ color: 'var(--aurora-text)' }}>
        {description.headline}
      </p>
      {description.detail && (
        <p className="mt-1 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
          {description.detail}
        </p>
      )}
    </div>
  );
}
