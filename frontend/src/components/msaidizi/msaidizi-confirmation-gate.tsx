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
 * ─── One checkbox per PROPOSAL, never per id ────────────────────────────────
 *
 * The list is keyed and ticked by POSITION, not by `confirmationId`. Keying the
 * tick state on the id made the checklist a select-all the moment two proposals
 * carried the same one: a single click set both boxes, the button read "Approve
 * 2 actions and continue", and `onApprove` handed back both irreversible
 * actions. The ids are computed elsewhere, on the server, from the session, the
 * tool and the arguments — whether that computation is injective is a property
 * of another file, and the one screen in the product that authorises
 * irreversible change must not be correct only for as long as some other file
 * is. So nothing here assumes the ids it was handed are distinct: a proposal is
 * a row because it is a row.
 *
 * Positions are stable for the life of this gate. It renders only for the newest
 * SETTLED turn, whose event list no longer changes, and it unmounts the moment
 * the next turn starts — which is also the moment the tick state must be
 * forgotten.
 *
 * ─── When two proposals do share an id ──────────────────────────────────────
 *
 * Two independent rows are necessary but not sufficient. The answer this page
 * sends is `confirmed: [ids]` — a list of IDS, with no way to name a row — so an
 * id carried by two proposals cannot be answered for one of them and not the
 * other, whatever the boxes say. What the server then DOES with an id it has
 * honoured is the server's own business and has changed before; the thing this
 * file relies on is only that the wire cannot express the distinction, which is
 * a property of the request shape rather than of any policy. Independent rows
 * over a shared id would be a NEW falsehood — a separation the message cannot
 * make.
 *
 * The collision is therefore shown rather than absorbed: the gate says it above
 * the list, every affected row says it, and a group sharing an id is
 * all-or-nothing — ticking part of one withdraws Approve and says why. Each
 * action still costs its own deliberate click, and no click approves anything
 * the user did not tick.
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
 * None of the PROPOSALS below has run, and none will if the tab is closed.
 * Confirmation is derived, not stored: there is no row, no cache, no lock and no
 * timer. That is a genuinely reassuring true statement and those are rare, so it
 * is said — in exactly those terms, about exactly those proposals.
 *
 * Two things it must NOT claim.
 *
 * Not that nothing has changed: green and amber tools in the same batch have
 * already run. Suspension stops the run, not the batch. So the reassurance is
 * scoped to the proposed actions, and the steps above show what already happened.
 *
 * And not that the ACTION a proposal describes has never happened. A proposal
 * can repeat an action this same conversation already carried out — the user
 * asks for the same thing twice, or the model re-issues a call whose first
 * attempt timed out, or an approval that has already been used is not honoured a
 * second time. The row then looks exactly like the one the user ticked ten
 * seconds ago, and "nothing below has happened" reads as "the entry you approved
 * did not post". So `priorAttempts` carries what became of an identical action
 * earlier in the thread, and a repeat says so above the list and on its own row,
 * in the three different sentences the three outcomes deserve: carried out;
 * attempted and never reported back; attempted and answered with an error. None
 * of them tells the user what to do — a second posting is sometimes exactly what
 * was wanted — they only stop the screen from reading as a duplicate or a stuck
 * gate.
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

/**
 * The arguments of one proposal, as a table.
 *
 * Exported because the thread renders a proposal in two places — here, where it
 * is a decision, and as a read-only record once it is not — and the substance of
 * what was proposed must be identical in both. Two implementations of this table
 * is two chances for the record to be softer than the decision was.
 */
export function ConfirmationArgs({ args }: { args: Record<string, unknown> | undefined }) {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return null;

  return (
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
  );
}

/**
 * The ids carried by more than one proposal in this batch.
 *
 * Normally empty. It is not this component's job to explain why it might not be
 * — only to stop being silently wrong when it is not. See the header.
 */
function sharedConfirmationIds(requests: ConfirmationRequest[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const request of requests) {
    if (seen.has(request.confirmationId)) shared.add(request.confirmationId);
    else seen.add(request.confirmationId);
  }
  return shared;
}

/** Every position in `requests` holding this id. */
function positionsFor(requests: ConfirmationRequest[], id: string): number[] {
  const positions: number[] = [];
  requests.forEach((request, position) => {
    if (request.confirmationId === id) positions.push(position);
  });
  return positions;
}

// ─── A proposal that repeats something the thread already attempted ───────────

/**
 * What became of an action identical to a proposal, earlier in the same thread.
 *
 *   carried-out   it ran and came back done. Approving now does it AGAIN.
 *   unreported    it was dispatched and the outcome never arrived — a timeout,
 *                 a dropped socket, a run that stopped mid-invoke. Whether it
 *                 went through is not knowable from this screen, which is
 *                 exactly the case where a second approval is most dangerous.
 *   failed        it was dispatched and came back with an error rather than as
 *                 done. Approving is a retry, which is usually what was meant.
 *
 * Three values rather than one flag because the sentence the user needs is
 * different in each, and a single "this has happened before" would be false for
 * the middle one and alarmist for the last.
 */
export type PriorAttempt = 'carried-out' | 'unreported' | 'failed';

/** Ranked by how much a reader needs to know it, strongest first. */
const ATTEMPT_RANK: Record<PriorAttempt, number> = {
  'carried-out': 3,
  unreported: 2,
  failed: 1,
};

/**
 * The stronger of two accounts of the same action.
 *
 * A signature can have several attempts behind it — a failed one and then a
 * successful one, most obviously — and reporting only the latest would let "it
 * came back with an error" stand in for a conversation in which the action also
 * demonstrably ran. So the account that most affects the decision wins,
 * regardless of order.
 */
export function strongerAttempt(
  a: PriorAttempt | null,
  b: PriorAttempt | null,
): PriorAttempt | null {
  if (!a) return b;
  if (!b) return a;
  return ATTEMPT_RANK[b] > ATTEMPT_RANK[a] ? b : a;
}

/**
 * A canonical text for a value, used only to decide whether two actions are the
 * same action.
 *
 * Object keys are sorted, so a re-issued call whose JSON came back with its
 * properties in another order still matches. `undefined` members are dropped
 * because they cannot survive the wire and their presence is not a difference.
 *
 * This is deliberately NOT a reimplementation of the server's confirmation-id
 * derivation and must not be read as one: the id binds an approval to an action
 * and has to be injective, whereas this decides whether to show a sentence. A
 * miss costs the sentence; there is no authority here to get wrong. The reason
 * it is computed at all is that `tool_call` carries no confirmation id — see
 * `msaidizi-types.ts` — so tool plus arguments is the only handle this page has
 * on "the same action".
 */
function canonicalise(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalise(member)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** The handle this page has on "the same action": the tool and the arguments. */
export function actionSignature(tool: string, args: Record<string, unknown> | undefined): string {
  return `${tool} ${canonicalise(args ?? {})}`;
}

/**
 * What a repeated proposal says on its own row, in two halves.
 *
 * `happened` is a statement about the past and is true whatever this gate can
 * still do. `ifApproved` is about a button, and a gate whose answer can no
 * longer be sent has no such button — the same split `noticeFor`'s `advise()`
 * makes in the thread, for the same reason: a sentence recommending, or even
 * describing, an action the page has withdrawn outlives the button by exactly as
 * long as it takes to read it.
 */
const REPEAT_ROW_COPY: Record<PriorAttempt, { happened: string; ifApproved: string }> = {
  'carried-out': {
    happened:
      'An action identical to this one was already carried out in this conversation. This is a ' +
      'request to do it again, not to re-confirm the first one.',
    ifApproved: 'Approving makes it happen a second time.',
  },
  unreported: {
    happened:
      'An action identical to this one was already attempted in this conversation and never ' +
      'reported back, so whether it went through cannot be told from here.',
    ifApproved: 'Approving may make it happen a second time.',
  },
  failed: {
    happened:
      'An action identical to this one was already attempted in this conversation and came back ' +
      'with an error rather than as done.',
    ifApproved: 'Approving tries it again.',
  },
};

export interface MsaidiziConfirmationGateProps {
  requests: ConfirmationRequest[];
  onApprove: (approved: ConfirmationRequest[]) => void;
  onDecline: (declined: ConfirmationRequest[]) => void;
  busy?: boolean;
  /**
   * Why neither answer can be sent from here, or null when they can.
   *
   * Approving and declining BOTH start a turn — there is no decline endpoint, a
   * decline is a message like any other — so anything that closes the composer
   * closes this too. A page that says "Part of a run was lost… start a new
   * conversation" underneath a live Approve button is asserting both at once,
   * and the button is the one the user believes.
   */
  blockedReason?: string | null;
  /**
   * `actionSignature(tool, args)` → what became of an identical action attempted
   * BEFORE the proposal carrying that signature, anywhere earlier in the thread.
   * Built by the thread, which is the only component that holds every turn, and
   * resolved there in arrival order — this gate is given the answer, not the
   * evidence, because "already" is a claim about order and this component sees
   * one turn's worth of proposals with no idea what preceded them.
   *
   * Absent means "not looked up", not "nothing repeats": a caller that does not
   * pass it gets a gate that simply says nothing on the subject, which is the
   * behaviour this gate had before and is still honest.
   */
  priorAttempts?: ReadonlyMap<string, PriorAttempt>;
}

export function MsaidiziConfirmationGate({
  requests,
  onApprove,
  onDecline,
  busy = false,
  blockedReason = null,
  priorAttempts,
}: MsaidiziConfirmationGateProps) {
  // Positions, not ids — see the header. Local, per-render, and never lifted
  // into conversation state: an approval is answered on exactly one request and
  // then forgotten. Parking the ids anywhere durable would put a standing "yes"
  // for that action on every later turn of the run — a grant this page never
  // asked the user for, whatever the server would make of it.
  const [checked, setChecked] = useState<ReadonlySet<number>>(() => new Set());

  const shared = sharedConfirmationIds(requests);
  const approved = requests.filter((_request, position) => checked.has(position));
  const blocked = Boolean(blockedReason);
  const disabled = busy || blocked;

  // What became of an identical action earlier in the thread, per proposal.
  const repeats = requests.map(
    (request) => priorAttempts?.get(actionSignature(request.tool, request.args)) ?? null,
  );
  const repeatCount = repeats.filter((attempt) => attempt !== null).length;
  // Blocked, not `disabled`: `busy` is a live run and the buttons come back when
  // it settles, so a sentence about approving is still true then. A blocked gate
  // is never going to offer one.
  const repeatCopy = (attempt: PriorAttempt): string =>
    blocked
      ? REPEAT_ROW_COPY[attempt].happened
      : `${REPEAT_ROW_COPY[attempt].happened} ${REPEAT_ROW_COPY[attempt].ifApproved}`;

  // A group of proposals sharing one id is all-or-nothing, because the wire
  // cannot say anything narrower. Ticking part of one is not refused at the
  // checkbox — the user is entitled to work through the group in either order —
  // it withdraws Approve until the group agrees with itself.
  const splitGroup = [...shared].some((id) => {
    const positions = positionsFor(requests, id);
    const ticked = positions.filter((position) => checked.has(position)).length;
    return ticked > 0 && ticked < positions.length;
  });

  const toggle = (position: number) => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(position)) next.delete(position);
      else next.add(position);
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
        {/* Nothing is waiting once the answer cannot be sent. The server keeps
            no pending state of its own — confirmation is derived — so a heading
            that says it is waiting, above a dead Approve button, is the same
            contradiction as leaving the button live. */}
        {blockedReason
          ? requests.length === 1
            ? 'Msaidizi proposed this change and stopped'
            : `Msaidizi proposed ${requests.length} changes and stopped`
          : requests.length === 1
            ? 'Msaidizi is waiting for you to approve this change'
            : `Msaidizi is waiting for you to approve ${requests.length} changes`}
      </h3>
      {/* Scoped to the PROPOSALS, and only to them — see the header. Suspension
          stops the run, not the batch: a green or amber tool in the same batch
          has already executed, and amber is always live wherever this gate is,
          because the gate needs `MSAIDIZI_WRITE_MODE=red` and that mode is
          ['green','amber','red']. "Nothing has changed yet" is therefore a
          sentence this box cannot say — an amber update that ran two steps ago
          would still be standing after the user closed the tab on its strength.
          The steps above are where what already happened is written down, so
          this points at them rather than talking over them.

          "None of the proposals below has run" rather than the older "nothing
          below has happened", which was ambiguous in the one state that matters:
          a proposal repeating an action this conversation already carried out
          reads identically to the row the user ticked a moment ago, and about
          THAT action the older sentence was simply false. The repeat notice
          under this one names those rows; this sentence stays about the
          proposals it is actually about. */}
      <p className="mt-1 text-[12.5px] opacity-90">
        None of the proposals below has run, and closing this page leaves them that way. That is
        about these proposals and nothing else — it does not undo anything Msaidizi already did in
        this conversation, and the steps above are the record of that.
      </p>

      {/* Said before the list, because it changes what the list means. */}
      {shared.size > 0 && (
        <p data-testid="msaidizi-gate-shared-ids" className="mt-2 text-[12.5px] font-medium">
          Some of these proposals were given the same confirmation id. The answer this page sends
          names ids, not rows, so it cannot say yes to one of them and no to another. They are
          marked below and can only be ticked together. If they are not the same action, decline and
          ask for them one at a time.
        </p>
      )}

      {/* Also before the list, and for the same reason: without it the screen
          reads as a duplicate of a decision already taken, or as a gate that did
          not notice the answer. It does not tell the user which way to go — a
          second posting is sometimes exactly what was asked for. */}
      {repeatCount > 0 && (
        <p data-testid="msaidizi-gate-repeat" className="mt-2 text-[12.5px] font-medium">
          {repeatCount === 1
            ? 'One of these proposals repeats an action Msaidizi already attempted in this conversation.'
            : `${repeatCount} of these proposals repeat an action Msaidizi already attempted in this conversation.`}{' '}
          {blocked
            ? 'Being asked again was not the earlier question coming back. Each one is marked below with what became of the earlier attempt.'
            : 'Being asked again is not the earlier question coming back — approving now does the action another time. Each one is marked below with what became of the earlier attempt.'}
        </p>
      )}

      <ul className="mt-3 list-none space-y-2.5">
        {requests.map((request, position) => {
          const id = request.confirmationId;
          const collides = shared.has(id);
          const repeated = repeats[position];
          return (
            <li
              // Position first: two proposals sharing an id must not share a
              // React key either, on the one list in the product that
              // authorises irreversible change.
              key={`${position}:${id}`}
              data-testid="msaidizi-confirmation-row"
              data-confirmation-id={id}
              data-shared-id={collides ? 'true' : undefined}
              data-repeats={repeated ?? undefined}
              className="rounded-lg border px-3 py-2.5"
              style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
            >
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-[3px] h-3.5 w-3.5 flex-shrink-0"
                  checked={checked.has(position)}
                  onChange={() => toggle(position)}
                  disabled={disabled}
                />
                <SafeText
                  className="block text-[13px] font-medium"
                  style={{ color: 'var(--aurora-text)' }}
                  value={request.description}
                />
              </label>

              <ConfirmationArgs args={request.args} />

              {repeated && (
                <p
                  data-testid="msaidizi-confirmation-row-repeat"
                  className="mt-2 text-[12px] font-medium"
                  style={{ color: 'var(--aurora-danger-text)' }}
                >
                  {repeatCopy(repeated)}
                </p>
              )}

              {collides && (
                <p
                  data-testid="msaidizi-confirmation-row-shared"
                  className="mt-2 text-[12px] font-medium"
                  style={{ color: 'var(--aurora-danger-text)' }}
                >
                  This proposal shares its confirmation id with another one in this list. There is
                  no way to answer for one and not the other — read both before ticking either.
                </p>
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

      {blockedReason && (
        <p data-testid="msaidizi-gate-blocked" className="mt-3 text-[12.5px] font-medium">
          {blockedReason}
        </p>
      )}

      {/* Why Approve went away, next to where it went away from. Without it the
          button just reads as disabled and the user re-reads the rows looking
          for a tick they did not miss. Suppressed when the whole gate is
          already dead: `blockedReason` above it is the reason then, and two
          explanations for one disabled button is one too many. */}
      {splitGroup && !disabled && (
        <p data-testid="msaidizi-gate-split-group" className="mt-3 text-[12.5px] font-medium">
          Proposals sharing a confirmation id have to be ticked together or left alone. Approving
          part of a group would send an answer that approves all of it.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="msaidizi-approve"
          disabled={disabled || approved.length === 0 || splitGroup}
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
          disabled={disabled}
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
