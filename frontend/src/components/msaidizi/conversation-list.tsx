'use client';

/**
 * The rail down the left — the thing that makes this a chat application rather
 * than a chat box.
 *
 * A chat is a place you return to. The whole reason the assistant got a page
 * instead of a docked panel is that a panel has no history, no way back to
 * yesterday's question, and no address to send anyone. This is that history.
 *
 * ─── What a row is allowed to say ───────────────────────────────────────────
 *
 * `title` is derived server-side from the first prompt, truncated. It is the one
 * plaintext field in the whole store that can name a customer, which is why the
 * oversight projection excludes it and why this list is author-scoped: the
 * server filters on `userId = me`, not on company scope, because a transcript
 * holds exactly what its author was entitled to see and a peer in the same
 * company reading it would be reading past their own permissions. There is no
 * admin read of somebody else's conversation, and that is a decision rather than
 * a gap.
 *
 * The counts come from the summary and are already denormalised, so nothing here
 * decrypts anything or fetches a transcript to render a row.
 *
 * ─── Escaping ───────────────────────────────────────────────────────────────
 *
 * `title` is the user's own words rather than the model's, so it is the least
 * hostile string in this feature — and it still goes through JSX as text like
 * everything else. There is no `dangerouslySetInnerHTML` in this feature and
 * there is no exception for the field that looks safe.
 */

import React, { useMemo } from 'react';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import type { MsaidiziConversationSummary } from '@/lib/msaidizi-types';
import { formatDate } from '@/lib/format';
import { describeResumability, resumeChipLabel } from './resumability';

/** A conversation whose first prompt never produced a title still needs a name. */
export function conversationTitle(conversation: MsaidiziConversationSummary): string {
  const title = conversation.title;
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return trimmed.length > 0 ? trimmed : 'Untitled conversation';
}

/** The timestamp a conversation is ordered and dated by. */
function conversationTime(conversation: MsaidiziConversationSummary): number {
  const last = conversation.lastTurnAt;
  const parsed = last ? Date.parse(last) : Number.NaN;
  if (Number.isFinite(parsed)) return parsed;
  const created = Date.parse(conversation.createdAt);
  return Number.isFinite(created) ? created : 0;
}

/**
 * "today", "yesterday", "3 days ago", then a real date.
 *
 * Counted in calendar days rather than elapsed hours, because a question asked at
 * 11pm and read at 8am is yesterday's question to the person reading it, not a
 * nine-hour-old one.
 */
export function describeConversationWhen(value: string | null, now: number = Date.now()): string {
  const parsed = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return 'never used';

  const startOfDay = (ms: number) => {
    const date = new Date(ms);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };

  const days = Math.round((startOfDay(now) - startOfDay(parsed)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDate(new Date(parsed));
}

/**
 * The second line of a row: when, and how much work it was.
 *
 * Steps rather than questions when there were any, because steps are the thing a
 * person recognises a conversation by — "the one where it looked at four things"
 * — and because a conversation with tool calls is the kind worth returning to.
 */
export function describeConversationActivity(
  conversation: MsaidiziConversationSummary,
  now: number = Date.now(),
): string {
  const when = describeConversationWhen(conversation.lastTurnAt ?? conversation.createdAt, now);
  const steps = conversation.toolCallCount;
  if (steps > 0) return `${when} · ${steps} ${steps === 1 ? 'step' : 'steps'}`;

  const turns = conversation.turnCount;
  if (turns > 0) return `${when} · ${turns} ${turns === 1 ? 'question' : 'questions'}`;
  return when;
}

const TIER_CHIP: Record<string, { label: string; color: string; background: string }> = {
  amber: {
    label: 'Changed something',
    color: 'var(--aurora-warning-text)',
    background: 'var(--aurora-warning-bg)',
  },
  red: {
    label: 'Irreversible change',
    color: 'var(--aurora-danger-text)',
    background: 'var(--aurora-danger-bg)',
  },
};

export interface MsaidiziConversationListProps {
  conversations: MsaidiziConversationSummary[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  /** Omit to hide the control — a launcher-hosted list may not own creation. */
  onNew?: () => void;
  /**
   * Omit to hide the control. Removal soft-deletes the transcript and destroys
   * the resume state immediately; it deletes no evidence, because whatever the
   * agent changed stays in `audit_logs` under the user's own id, joined only by
   * `agentSessionId`. Which is why the word is "Remove" and not "Delete
   * permanently" — both halves of that would be untrue.
   */
  onRemove?: (id: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Injection point for tests. */
  now?: number;
  className?: string;
}

export function MsaidiziConversationList({
  conversations,
  selectedId = null,
  onSelect,
  onNew,
  onRemove,
  loading = false,
  error = null,
  onRetry,
  now,
  className = '',
}: MsaidiziConversationListProps) {
  // The server already orders by `lastTurnAt desc, createdAt desc`. Sorting again
  // costs nothing on a page of twenty and means this component is correct for any
  // caller, including one that concatenated two pages.
  const ordered = useMemo(
    () => [...conversations].sort((a, b) => conversationTime(b) - conversationTime(a)),
    [conversations],
  );
  const clock = now ?? Date.now();

  return (
    <nav
      aria-label="Conversations"
      className={`flex min-h-0 flex-col ${className}`}
      style={{ color: 'var(--aurora-text)' }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2.5"
        style={{ borderBottom: '1px solid var(--aurora-border)' }}
      >
        <h2
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          Conversations
        </h2>
        {onNew && (
          <button
            type="button"
            onClick={onNew}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium transition"
            style={{
              color: 'var(--aurora-accent-text)',
              background: 'var(--aurora-accent-subtle)',
            }}
          >
            <span aria-hidden>+</span> New
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && ordered.length === 0 ? (
          <div className="space-y-2 px-3 py-3" aria-busy="true" aria-label="Loading conversations">
            {[0, 1, 2].map((row) => (
              <div key={row} className="space-y-1.5">
                <Skeleton className="h-3.5" style={{ width: '75%' }} />
                <Skeleton className="h-2.5" style={{ width: '45%' }} />
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : ordered.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            description="Ask Msaidizi something and it will appear here. Your conversations are yours alone — nobody else can read them, not an administrator either."
          />
        ) : (
          <ul className="space-y-0.5 p-2">
            {ordered.map((conversation) => {
              const selected = conversation.id === selectedId;
              const name = conversationTitle(conversation);
              const resume = describeResumability(conversation);
              const chip = resume ? resumeChipLabel(resume.state) : null;
              const tier = TIER_CHIP[conversation.highestTier];

              return (
                <li key={conversation.id} className="relative">
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    aria-current={selected ? 'true' : undefined}
                    className={`w-full cursor-pointer rounded-lg px-3 py-2 text-left transition ${
                      onRemove ? 'pr-9' : ''
                    }`}
                    style={{
                      background: selected ? 'var(--aurora-accent-subtle)' : 'transparent',
                      border: `1px solid ${selected ? 'var(--aurora-border-focus)' : 'transparent'}`,
                    }}
                  >
                    <span
                      className="block truncate text-[13px] font-medium"
                      style={{ color: 'var(--aurora-text)' }}
                    >
                      {name}
                    </span>
                    <span
                      className="mt-0.5 block truncate text-[11px]"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      {describeConversationActivity(conversation, clock)}
                    </span>
                    {(tier || chip) && (
                      <span className="mt-1.5 flex flex-wrap items-center gap-1">
                        {tier && (
                          <span
                            className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ color: tier.color, background: tier.background }}
                          >
                            {tier.label}
                          </span>
                        )}
                        {chip && (
                          <span
                            className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{
                              color: 'var(--aurora-text-muted)',
                              background: 'var(--aurora-bg-muted)',
                            }}
                          >
                            {chip}
                          </span>
                        )}
                      </span>
                    )}
                  </button>

                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(conversation.id)}
                      aria-label={`Remove ${name}`}
                      title="Remove this conversation. What the assistant changed stays in the audit log."
                      className="absolute top-2 right-2 cursor-pointer rounded p-1 text-[11px] leading-none transition"
                      style={{ color: 'var(--aurora-text-disabled)' }}
                    >
                      <svg
                        aria-hidden
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.75}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 7h12M10 7V5h4v2m-7 0 .8 12h8.4L17 7"
                        />
                      </svg>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}
