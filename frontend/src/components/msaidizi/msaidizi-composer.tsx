'use client';

/**
 * The composer.
 *
 * Two things it deliberately does not have.
 *
 * **No Stop button.** `MsaidiziService.run()` takes no `AbortSignal`. Closing
 * the stream only makes the server's `send()` a no-op; the remaining model turns
 * and tool calls execute to completion and their audit rows land. A button
 * labelled Stop that does not stop is worse than no button, and under a write
 * mode it would be a lie about whether a change happened. On a page rather than
 * a panel there is nothing to hide, so the control is simply absent and the
 * thread says the run will finish on its own.
 *
 * **No "continue" after a budget stop.** Both budget counters are local
 * variables initialised per `run()` call — per HTTP request, not per
 * conversation. A "continue" button resets them to 0/0 and hands the user an
 * unbounded loop one turn at a time. The user can ask again; that is deliberate.
 */

import { useEffect, useRef, useState } from 'react';
import { SendHorizontal } from 'lucide-react';

/** `AskDto.message` is `@MaxLength(8000)`. Stopping here beats a 400 from the pipe. */
const MAX_MESSAGE = 8000;

export interface MsaidiziComposerProps {
  onSubmit: (message: string) => void;
  /** True while a run is live. */
  busy?: boolean;
  /**
   * Set when this thread cannot take another turn, with the reason in the user's
   * words. A disabled box with no explanation is the thing this prop exists to
   * prevent — a rehydrated conversation and a lost turn are both silent
   * otherwise.
   */
  blockedReason?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
}

export function MsaidiziComposer({
  onSubmit,
  busy = false,
  blockedReason = null,
  placeholder = 'Ask Msaidizi…',
  autoFocus = false,
}: MsaidiziComposerProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const disabled = busy || Boolean(blockedReason);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    const message = value.trim();
    if (!message || disabled) return;
    setValue('');
    onSubmit(message);
  };

  return (
    <div className="w-full">
      {blockedReason && (
        <p
          data-testid="msaidizi-composer-blocked"
          className="mb-2 text-[12px]"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          {blockedReason}
        </p>
      )}
      <form
        className="flex items-end gap-2 rounded-xl border px-3 py-2"
        style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="msaidizi-composer-input">
          Ask Msaidizi
        </label>
        <textarea
          id="msaidizi-composer-input"
          ref={inputRef}
          rows={1}
          value={value}
          maxLength={MAX_MESSAGE}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. A run can take minutes, so
            // a stray Enter mid-sentence is expensive — but a chat that needs a
            // mouse to send is worse.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          className="max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent text-[13.5px] outline-none disabled:opacity-60"
          style={{ color: 'var(--aurora-text)' }}
        />
        <button
          type="submit"
          disabled={disabled || value.trim() === ''}
          className="mb-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--aurora-primary)', color: '#fff' }}
          aria-label="Send"
        >
          <SendHorizontal size={15} aria-hidden />
        </button>
      </form>
    </div>
  );
}
