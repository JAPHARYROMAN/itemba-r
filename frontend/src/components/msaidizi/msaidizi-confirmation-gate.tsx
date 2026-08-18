'use client';

/**
 * The red-tier confirmation gate — a checklist inside the thread, not a modal.
 *
 * ─── Why not `ConfirmDialog` ────────────────────────────────────────────────
 *
 * The house primitive (used in 59 files) takes one `message: string` and an
 * `onConfirm: () => void`. This gate needs a LIST of distinct actions, each with
 * its own id and its own arguments, and its "yes" is not a callback that does
 * something — it is a later HTTP request carrying `confirmed: [ids]`. One
 * assistant turn proposing three red actions yields three `confirmation_required`
 * events and one `awaiting_confirmation` verdict, so the shape is a checklist,
 * and three destructive actions cost three deliberate clicks. There is no
 * select-all, on purpose.
 *
 * ─── Why it renders inline, in sequence ─────────────────────────────────────
 *
 * The steps that led here are still visible above it. A reader can see that the
 * agent looked at invoice 41 and then proposed deleting invoice 41 without
 * navigating anywhere. A modal would cover exactly the evidence the decision
 * needs.
 *
 * ─── What is true while this is on screen ───────────────────────────────────
 *
 * Nothing has happened yet, and nothing will if the tab is closed. Confirmation
 * is derived, not stored: there is no row, no cache, no lock and no timer. That
 * is a genuinely reassuring true statement and those are rare, so it is said.
 *
 * One thing it must NOT claim: green and amber tools in the same batch have
 * already run. Suspension stops the run, not the batch. So the reassurance is
 * scoped to the proposed actions, and the steps above show what already happened.
 *
 * ─── What cannot be shown ───────────────────────────────────────────────────
 *
 * There is no pre-image. The backend sends no current state of the record, no
 * diff and no monetary impact beyond what is in `args`, and a generic
 * "fetch the before-state" mechanism would need a capability→read-endpoint map
 * the manifest does not carry and would be confidently wrong often enough to be
 * worse than absent. So the gate shows the arguments and says plainly that the
 * record itself has to be opened to be checked.
 */

import { useState } from 'react';
import type { ConfirmationRequest } from '@/lib/msaidizi-types';
import { SafeText } from './safe-text';

/** `unitPrice` → `Unit price`. The keys are model-authored; the split is not. */
function humaniseKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * An argument value as a string.
 *
 * `JSON.stringify` of anything that is not already a string, because a nested
 * object is still evidence and hiding it would hide the substance of what is
 * being approved. The result goes through `SafeText` like everything else — the
 * values here are model-authored and derived from tool results, so they are as
 * attacker-influenceable as the prose.
 */
function argValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 1);
  } catch {
    // A cyclic or non-serialisable value cannot come off the wire, but saying so
    // beats rendering "[object Object]" on a screen that authorises a change.
    return 'This value could not be displayed.';
  }
}

export interface MsaidiziConfirmationGateProps {
  requests: ConfirmationRequest[];
  onApprove: (approved: ConfirmationRequest[]) => void;
  onDecline: (declined: ConfirmationRequest[]) => void;
  busy?: boolean;
}

export function MsaidiziConfirmationGate({
  requests,
  onApprove,
  onDecline,
  busy = false,
}: MsaidiziConfirmationGateProps) {
  // Local, per-render, and never lifted into conversation state. `confirmed` is
  // a one-shot: the server checks it as a plain set against every red proposal
  // for the whole run, so a client that parks these ids anywhere durable has
  // converted one approval into a standing grant for that action.
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());

  const approved = requests.filter((request) => checked.has(request.confirmationId));

  const toggle = (id: string) => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section
      data-testid="msaidizi-confirmation-gate"
      className="my-3 rounded-xl border px-4 py-3.5"
      style={{
        background: 'var(--aurora-danger-bg)',
        borderColor: 'var(--aurora-danger)',
        color: 'var(--aurora-danger-text)',
      }}
      aria-labelledby="msaidizi-gate-heading"
    >
      <h3 id="msaidizi-gate-heading" className="text-[13px] font-semibold">
        {requests.length === 1
          ? 'Msaidizi is waiting for you to approve this change'
          : `Msaidizi is waiting for you to approve ${requests.length} changes`}
      </h3>
      <p className="mt-1 text-[12.5px] opacity-90">
        Nothing has changed yet. Closing this page leaves everything as it is.
      </p>

      <ul className="mt-3 list-none space-y-2.5">
        {requests.map((request) => {
          const id = request.confirmationId;
          const entries = Object.entries(request.args ?? {});
          return (
            <li
              key={id}
              data-testid="msaidizi-confirmation-row"
              data-confirmation-id={id}
              className="rounded-lg border px-3 py-2.5"
              style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
            >
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-[3px] h-3.5 w-3.5 flex-shrink-0"
                  checked={checked.has(id)}
                  onChange={() => toggle(id)}
                  disabled={busy}
                />
                <SafeText
                  className="block text-[13px] font-medium"
                  style={{ color: 'var(--aurora-text)' }}
                  value={request.description}
                />
              </label>

              {entries.length > 0 && (
                <table className="mt-2 w-full table-fixed border-collapse text-[12px]">
                  <tbody>
                    {entries.map(([key, value]) => (
                      <tr key={key}>
                        <th
                          scope="row"
                          className="w-2/5 py-0.5 pr-3 text-left align-top font-normal"
                          style={{ color: 'var(--aurora-text-muted)' }}
                        >
                          {humaniseKey(key)}
                        </th>
                        <td className="py-0.5 align-top" style={{ color: 'var(--aurora-text)' }}>
                          <SafeText value={argValue(value)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[12.5px] font-medium">
        This cannot be undone by Msaidizi. Reversing it means doing the opposite by hand.
      </p>
      <p className="mt-1 text-[12px] opacity-80">
        Msaidizi cannot show you the record as it stands now. Open it in another tab and look before
        you approve.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="msaidizi-approve"
          disabled={busy || approved.length === 0}
          onClick={() => onApprove(approved)}
          className="rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--aurora-danger)', color: '#fff' }}
        >
          {approved.length <= 1
            ? 'Approve and continue'
            : `Approve ${approved.length} actions and continue`}
        </button>
        <button
          type="button"
          data-testid="msaidizi-decline"
          disabled={busy}
          onClick={() => onDecline(requests)}
          className="rounded-lg border px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
          style={{
            borderColor: 'var(--aurora-border)',
            background: 'var(--aurora-card)',
            color: 'var(--aurora-text)',
          }}
        >
          No — do not do this
        </button>
      </div>
    </section>
  );
}
