'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, backendPost } from '@/lib/api-client';
import {
  bumpDaylogTally,
  clearCountDraft,
  readCountDraft,
  sweepOrphanDrafts,
  writeCountDraft,
  type MobilePosLiteBinding,
  type PosCountDraft,
} from '@/lib/mobile-pos-lite-store';
import { reject as rejectHaptic, stampSent, tick } from '../pos-haptics';
import { posErrorKey } from '../pos-errors';
import { isConnectionProblem, newIdempotencyKey, terminalHeaders } from '../pos-utils';

/**
 * Hesabu — the count sheet's state machine (spec-inventory §3; Phase 5).
 * Kaunta-shell-only, mounted beside `usePosStock` so the slab can own the
 * verbs (KAGUA HESABU → TUMA HESABU) while the screen owns the rows.
 *
 * Three rules shape everything here:
 * - Capture is offline, submission is online. The sheet autosaves to IDB on
 *   every committed edit (storerooms have no signal), and a count NEVER enters
 *   the sales outbox — a queued count would post against a balance that moved
 *   since capture with no human in the loop (spec-inventory §0).
 * - The client sends counted quantities and nothing else. No systemQuantity,
 *   no variance, no cost, no branch: the server reads the live balance at post
 *   time, which is what makes blind entry safe.
 * - Nothing is lost on failure. The draft is cleared on 2xx and only on 2xx,
 *   and the key that makes a retry safe is cleared with it (see below).
 * - The phone never claims custody it does not have. Every write to IDB is
 *   answered, the last answer is what `draftKept` reports, and the one write
 *   the safety mechanism depends on — the FREEZE — is allowed to stop the send
 *   (see `submit`).
 * - Every line in the payload was on the review. The sheet outlives the stock
 *   snapshot it was typed against (products get deactivated mid-count), and a
 *   counted line the screen cannot render is a line the manager can neither
 *   check nor delete — so it never reaches the server (see `unresolved`).
 *
 * THE IDEMPOTENCY KEY IS THE SAFETY MECHANISM, and its lifecycle is the one
 * thing in this file that must not be reasoned about case by case. It is a
 * two-state machine, identical to the kikaratasi's (use-pos-slip.ts):
 *
 *   NONE ──TUMA HESABU whose freeze write LANDED──▶ FROZEN
 *   FROZEN ──2xx / the manager ends this count──▶ NONE
 *
 * - NONE: no attempt has been made, so no server row can exist under any key.
 *   Nothing is stored and edits cost nothing.
 * - FROZEN: entered by the FIRST send attempt — not by a 2xx, not even by a
 *   completed request, because the only thing the phone can ever know for
 *   certain is that it tried. While frozen it moves for NOTHING: not an edit,
 *   not a rejection, not a timeout, not a 5xx, not a guess about whether the
 *   request landed. A dropped response leaves the server's state unknown and
 *   the frozen key is what asks — the marker either matches (the server
 *   resumes its own chain) or it does not (a fresh chain under this key). A
 *   key that re-mints instead re-posts the sheet's ABSOLUTE quantities against
 *   a baseline that moved in between, inventing stock that was sold and
 *   leaving two unlinked adjustments on one shelf.
 * - The transition is the WRITE, not the tap. A key that lives only in a ref
 *   dies with the process, and the window it protects is exactly the one where
 *   the phone may be killed, evicted or remounted: a request sent under a key
 *   the phone did not keep comes back after a restart with no key at all, mints
 *   a fresh one, misses the marker, and posts the sheet a second time. So the
 *   draft carrying the key is written BEFORE the request leaves, the write is
 *   ANSWERED, and a refused one stops the send instead of proceeding without
 *   the safety mechanism (`submit`, and `draftKept` on the screen). Every later
 *   autosave rewrites the same key, so it survives app kill and cold start.
 * - Back to NONE on exactly two kinds of event, both of which mean this count
 *   is over: a 2xx (the server owns it now, draft deleted), or the manager
 *   ending the sheet — the resume/discard sheet's Futa rasimu, the deliberate
 *   ANZA HESABU MPYA (`startNewCount`), or emptying the last counted line,
 *   which is the same ritual spread over several taps.
 *
 * Failure CLASSIFICATION (`classifyRefusal`) exists only to choose wording and
 * which control the card offers. It never decides what is stored, which key is
 * used, or whether work is kept.
 */

/**
 * The most lines one count may carry — the client's half of the backend DTO's
 * `@ArrayMaxSize` on `lines`. The DTO is the SOURCE OF TRUTH: it is
 * `MOBILE_POS_LITE_STOCK_COUNT_MAX_LINES` in
 * backend/src/modules/mobile-pos-lite/dto/mobile-pos-lite-stock-count.dto.ts,
 * and kaunta-hesabu.test.tsx (HESABU-17) reads that file and fails if this
 * number drifts from it — the two constants have no shared module across the
 * boundary, and last round they were set to different values by different
 * hands, which made the phone refuse counts the server would have taken.
 *
 * The phone mirrors the number because the server's answer to a longer sheet
 * is a ValidationPipe rejection raised before the wrapper is ever reached: the
 * manager would count hundreds of shelves, review them all, tap TUMA, and be
 * told only "call a supervisor" — identically, on every retry, forever. Keep
 * it EQUAL to the DTO; a client cap below the server's refuses counts the
 * server would take, and one above it puts that dead end back.
 */
export const COUNT_MAX_LINES = 500;

/**
 * How close to the ceiling the sheet starts naming it. The point is that the
 * manager learns the limit while she can still act on it — a limit she first
 * meets on the line that breaks the sheet is a limit announced too late. With
 * COUNT_MAX_LINES at 500 the sheet starts naming it at 480.
 */
export const COUNT_LIMIT_WARN_WINDOW = 20;

export type PosCountResultLine = {
  productId: string;
  systemQuantity: number;
  countedQuantity: number;
  varianceQuantity: number;
};

export type PosCountResult = {
  id: string;
  adjustmentNumber: string;
  /**
   * The adjustment's state as the SERVER reports it — deliberately not
   * narrowed to the two documented outcomes. With the auto-post escape flag
   * off, the wrapper returns whatever state the marker-matched chain rests at,
   * so a resumed send can legitimately answer 'APPROVED'. Every reader must
   * therefore test the POSITIVE (`=== 'POSTED'`): a status nobody predicted is
   * a count that has moved no stock, and it must never read as a finished one.
   */
  status: string;
  lines: PosCountResultLine[];
};

/** entry = blind capture · review = variance preview · done = the MUHURI. */
export type PosCountStep = 'entry' | 'review' | 'done';

/**
 * A counted line whose product is GONE from a stock snapshot that did load —
 * deactivated between capture and submit (§7 case 5). `name` comes from the
 * draft's own name snapshot or from a snapshot this session saw, falling back
 * to the productId only when neither ever named it.
 */
export type PosCountUnresolvedLine = {
  productId: string;
  name: string;
  countedQuantity: number;
};

export type PosCount = {
  step: PosCountStep;
  /** productId → counted quantity. An ABSENT key is "not counted"; 0 is counted. */
  lines: Record<string, number>;
  countedCount: number;
  /** First edit of this sheet — the confirm screen shows it. */
  capturedAt: number | null;
  /** Bumped when the sheet is replaced wholesale; remounts the inputs by key. */
  revision: number;
  /**
   * Counted lines whose product left a snapshot that DID load — deactivated
   * between capture and submit (spec-inventory §7 case 5). They are still in
   * `lines`, so they would still be POSTed: the review and the submit refuse
   * to run while any exists, and the screen lists them with a remove control
   * so the manager can do what §7 case 5 promises — take the line out and
   * resubmit.
   *
   * EMPTY when there is no snapshot at all (see `stockUnavailable`). The two
   * situations look identical to `lines` and are opposites to the manager: one
   * says a product is gone and removing the line is the fix; the other says
   * the stoo did not load, in which case removing lines destroys her count and
   * fixes nothing.
   */
  unresolved: PosCountUnresolvedLine[];
  /**
   * There is no stock snapshot on the phone at all while the sheet holds lines
   * — the cache was evicted, the fetch failed, or both. Nothing about the
   * count is wrong; the screen simply cannot show it, so the honest remedy is
   * the retry, never a delete.
   */
  stockUnavailable: boolean;
  /** More counted lines than one count may carry (COUNT_MAX_LINES). */
  overLimit: boolean;
  /**
   * The review and the send are both dead. One flag for the three reasons so
   * no call site can gate on two of them and forget the third.
   */
  blocked: boolean;
  /** A saved sheet found on entry, awaiting resume/discard. */
  draftOffer: PosCountDraft | null;
  /**
   * Did the LAST write to this phone land? `null` until one has resolved —
   * nothing to claim yet — then the truth about the most recent attempt, never
   * about the best one. It is a custody claim about the sheet in her hands
   * ("Rasimu imehifadhiwa kwenye simu hii"), and a phone that has started
   * refusing writes is keeping none of the lines typed since: claiming custody
   * of the last write that happened to succeed is how three hundred counted
   * numbers vanish behind a sentence that said they were safe. It is also the
   * screen's only way to say why a send was refused before it left (`submit`).
   */
  draftKept: boolean | null;
  confirmOpen: boolean;
  submitting: boolean;
  /** Raw backend rejection text; the screen maps it through posErrorMessage(). */
  errorRaw: string | null;
  /**
   * What the last failed send leaves her able to do — see `PosCountRefusal`.
   * One field for the four cases so no call site can answer two of them and
   * silently give the third the wrong instruction.
   */
  refusal: PosCountRefusal;
  /** The last attempt died on the network, not on the count. */
  needsNetwork: boolean;
  shake: boolean;
  result: PosCountResult | null;
  enter: () => void;
  setLine: (productId: string, value: number | null) => void;
  resumeDraft: () => void;
  discardDraft: () => void;
  /**
   * ANZA HESABU MPYA — the deliberate, confirmed end of the sheet in hand.
   * This exists because the screen was telling the manager to "anza hesabu
   * mpya" while the only way to obey was to clear several hundred counted
   * fields one at a time: the resume/discard sheet is unreachable once a line
   * is counted, and the key is released only when the LAST one is deleted. It
   * is the same ritual as Futa rasimu — the sheet ends, the draft goes, the key
   * goes with it — reachable with a sheet in hand and behind a confirm, because
   * it destroys counted work.
   */
  startNewCount: () => void;
  openReview: () => void;
  backToEntry: () => void;
  openConfirm: () => void;
  closeConfirm: () => void;
  submit: () => Promise<void>;
};

/**
 * The counted productIds with no row on the screen. `null` (no snapshot at
 * all) makes EVERY counted line unshowable, which is the honest reading: a
 * screen with no rows showed the manager nothing.
 *
 * This answers "can the sheet be shown whole", which is what the review and
 * the submit gate on. It is NOT the same question as "which products have
 * left the stoo" — see `PosCount.unresolved`.
 */
function unshowableIds(
  lines: Record<string, number>,
  visible: ReadonlyMap<string, string> | null,
): string[] {
  return Object.keys(lines).filter((productId) => !visible?.has(productId));
}

/**
 * The whole-sheet gate behind KAGUA HESABU and TUMA HESABU: the review is the
 * human check on a destructive write, so it may never open over a sheet the
 * screen cannot show whole, and a sheet the server will reject outright may
 * never be sent at all.
 */
function sheetBlocked(
  lines: Record<string, number>,
  visible: ReadonlyMap<string, string> | null,
): boolean {
  return Object.keys(lines).length > COUNT_MAX_LINES || unshowableIds(lines, visible).length > 0;
}

/**
 * Did the server REFUSE this attempt, or merely fail to answer it? Everything
 * unproven answers `null`, because only a refusal is evidence:
 * - a shape with no status at all (a thrown TypeError, a string, anything the
 *   fetch layer did not produce) proves nothing;
 * - 5xx, and a proxy's 502/504, prove nothing about the count — post() budgets
 *   tens of seconds under one transaction, and a gateway that gives up first
 *   says only that IT gave up, possibly over a request that committed;
 * - 408/429 are the server asking for the same request again, which is the
 *   opposite of a refusal.
 */
function refusalStatus(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null;
  const { status } = error;
  if (status < 400 || status >= 500) return null;
  if (status === 408 || status === 429) return null;
  return status;
}

/**
 * What a failed send leaves the manager able to DO — the only question the
 * rejection card has to answer, and the one a boolean got wrong. A screen may
 * never print an instruction the app cannot obey, so the classification is by
 * REMEDY, not by severity:
 *
 * - `unproven` — nothing refused the attempt: no status at all, a 5xx, a
 *   gateway 502/504 over a post transaction that budgets tens of seconds,
 *   408/429 asking for the same request again. Nothing is known to be wrong
 *   with the count, so the card reports and waits.
 * - `refused` — the server refused, and its own sentence is the whole answer.
 *   The card adds nothing, because there is nothing to add.
 * - `sheet` — refused because of THIS body: unknown product, duplicate line,
 *   non-stock item, unpriced count-up, an over-long sheet. An edit is a real
 *   remedy, so the card names it.
 * - `recount` — the capture is older than the server's window
 *   (STOCK_COUNT_MAX_CAPTURE_AGE_HOURS), on either side of the freeze. No
 *   resend of THIS sheet can ever post: neither the row's createdAt nor the
 *   draft's capture stamp gets younger, and an edit rides the same frozen key
 *   into the same 409. "Go back and fix it" is FALSE here — the numbers may be
 *   perfect; it is the shelf that has moved on — and the only true remedy is a
 *   fresh count, so the card carries that control rather than naming a ritual
 *   with no button behind it.
 *
 *   This replaced `closed`, which classified round 3's retired-chain sentence.
 *   That sentence has no throw site (the retirement went in round 4) and no
 *   deployed build that can emit it (the stock-count route has never shipped),
 *   so the ONLY control on the rejection card was wired to a state no server
 *   could produce — while the one permanent refusal a live server DOES produce
 *   had no control at all. The state moved to the refusal that exists.
 *
 * `sheet` is the narrow one, and the boundary is the SERVER'S OWN, stated in
 * its words: "the only place that can honestly say 'this can never succeed as
 * it stands' is this wrapper's OWN pre-create validation — resolveStockCountLines
 * and assertCountUpsCanBeValued — and it runs before anything exists". Those
 * refusals, plus the DTO's `@ArrayMaxSize` (raised by the ValidationPipe before
 * the service is reached), are the ones a corrected sheet really answers,
 * because nothing was recorded and the frozen key opens a fresh chain carrying
 * the correction. Everything else that refuses a count has a ROW behind it:
 * - a 400 out of `post()` — a company with no inventory-adjustment-variance
 *   account, a count-down that lost a race with a sale, an inactive branch —
 *   leaves the chain alive and resumable (the wrapper stopped retiring counts
 *   this round, which is right), so the sheet is now RECORDED under this key
 *   and going back to change a line earns the 409 below, not a fresh chain;
 * - 409 is never about the lines at all. It is a statement about the CHAIN or
 *   about the CAPTURE, and an edit answers neither:
 *     · assertCountMatchesRecordedAdjustment refusing to replay a marker hit
 *       whose recorded numbers differ from the ones just sent. Under a frozen
 *       key an edit still mismatches, and editing BACK replays the very numbers
 *       she came to correct — this is the count's half of the purchase's
 *       errSlipAlreadyReceived, and the office holds both documents;
 *     · the capture-age refusal, which is `recount` above rather than `refused`
 *       because it is the one 409 with a control behind it;
 *     · the deployed build's twin-detect conflict, which asks for the SAME
 *       request again (the current wrapper settles that race in the database
 *       instead and refuses nobody);
 * - 401/403 judge the CALLER: expired session, suspended terminal, device
 *   unbound. No edit to a counted line answers those either.
 *
 * The set below is therefore not a list of sentences to exclude — the thing
 * that kept going stale — but the client's mirror of that pre-create boundary,
 * and it fails SAFE: a pre-create refusal that later grows a mapping row loses
 * a true instruction until it is added here, where the alternative is printing
 * a false one under every rejection raised after a row exists.
 *
 * This changes WORDING and which control is offered. The sheet, the draft and
 * the frozen key are identical whatever it returns.
 */
export type PosCountRefusal = 'unproven' | 'refused' | 'sheet' | 'recount';

const PRE_CREATE_REFUSAL_KEYS: ReadonlySet<string> = new Set([
  // resolveStockCountLines: unknown product, or one outside this terminal's scope
  'errProductNotInBranch',
  // resolveStockCountLines: a product the branch does not hold in stock
  'errNotStockItem',
  // resolveStockCountLines: one shelf, two contradictory counts
  'errDuplicateLine',
  // assertCountUpsCanBeValued: a count-UP on a product nothing has ever priced
  'errNoBuyingPrice',
  // the DTO's @ArrayMaxSize, answered by the ValidationPipe before the service
  'errCountTooLong',
]);

function classifyRefusal(error: unknown): PosCountRefusal {
  const status = refusalStatus(error);
  if (status === null) return 'unproven';
  const mapped = posErrorKey((error as ApiError).message);
  // Asked first: a capture too old is too old whatever status carries the news,
  // and it is the only refusal here whose remedy is a control rather than a
  // sentence (`startNewCount` on the rejection card). Both endings of the
  // server's sentence land here — the resume side also names the office, which
  // is the copy's business, not the classification's.
  if (mapped === 'errCountTooOld' || mapped === 'errCountTooOldRecorded') return 'recount';
  if (status === 401 || status === 403 || status === 409) return 'refused';
  return PRE_CREATE_REFUSAL_KEYS.has(mapped) ? 'sheet' : 'refused';
}

export function usePosCount({
  binding,
  online,
  visibleProducts,
}: {
  binding: MobilePosLiteBinding;
  online: boolean;
  /**
   * productId → name for everything the count screen can currently render —
   * the stock snapshot's items, or null when there is no snapshot. Owned by
   * the shell (it mounts `usePosStock` beside this hook, and both outlive the
   * screen across route moves) because the slab reads the verbs from here.
   */
  visibleProducts: ReadonlyMap<string, string> | null;
}): PosCount {
  const [step, setStep] = useState<PosCountStep>('entry');
  const [lines, setLines] = useState<Record<string, number>>({});
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [draftOffer, setDraftOffer] = useState<PosCountDraft | null>(null);
  const [draftKept, setDraftKept] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorRaw, setErrorRaw] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<PosCountRefusal>('unproven');
  const [needsNetwork, setNeedsNetwork] = useState(false);
  const [shake, setShake] = useState(false);
  const [result, setResult] = useState<PosCountResult | null>(null);

  // Mirrors for the handlers: an edit committed mid-flight must read the sheet
  // as it is now, not as the last render saw it.
  const linesRef = useRef(lines);
  const capturedAtRef = useRef(capturedAt);
  const stepRef = useRef(step);
  const draftOfferRef = useRef(draftOffer);
  const submittingRef = useRef(false);
  const onlineRef = useRef(online);
  const visibleRef = useRef(visibleProducts);
  useEffect(() => {
    onlineRef.current = online;
    stepRef.current = step;
    visibleRef.current = visibleProducts;
  });

  // Every product name this sheet knows: the snapshots this session has seen,
  // plus the names the resumed draft carried. A line's product can leave the
  // snapshot while the sheet still holds it, and the manager must be told
  // WHICH line to remove — so names are remembered here, never re-derived from
  // a snapshot that no longer has the row. The ref is the store (autosave
  // reads it inside a handler); the state is the render mirror. It only ever
  // grows, and a re-render happens only when something was actually learned,
  // so the ten-minute refetch costs nothing.
  const knownNamesRef = useRef<Map<string, string>>(new Map());
  const [knownNames, setKnownNames] = useState<ReadonlyMap<string, string>>(() => new Map());
  const learnNames = useCallback((entries: Iterable<readonly [string, string]>) => {
    let learned = false;
    for (const [productId, name] of entries) {
      if (knownNamesRef.current.get(productId) === name) continue;
      knownNamesRef.current.set(productId, name);
      learned = true;
    }
    if (learned) setKnownNames(new Map(knownNamesRef.current));
  }, []);
  useEffect(() => {
    if (!visibleProducts) return;
    learnNames(visibleProducts);
  }, [visibleProducts, learnNames]);

  // Only a product that left a snapshot which LOADED is "gone from the stoo".
  // With no snapshot at all nothing is known to be gone, so nothing here
  // invites a delete — `stockUnavailable` owns that state instead.
  const unresolved = useMemo(
    () =>
      visibleProducts === null
        ? []
        : unshowableIds(lines, visibleProducts).map((productId) => ({
            productId,
            name: knownNames.get(productId) ?? productId,
            countedQuantity: lines[productId],
          })),
    [lines, visibleProducts, knownNames],
  );
  const countedCount = Object.keys(lines).length;
  const stockUnavailable = visibleProducts === null && countedCount > 0;
  const overLimit = countedCount > COUNT_MAX_LINES;

  // "Sending a count needs a network" is advice, not history: once the signal
  // is back the note must go, or the review contradicts an enabled slab.
  useEffect(() => {
    if (online) setNeedsNetwork(false);
  }, [online]);

  /**
   * The frozen idempotency key — `null` in the NONE state, a key in FROZEN
   * (the state machine is documented at the top of this file). It is a ref
   * because nothing renders it, and it is mirrored into the DRAFT because a
   * ref dies with the component and the window this key protects is exactly
   * the one where the phone may be killed, evicted or remounted.
   */
  const keyRef = useRef<string | null>(null);

  // Boot-time orphan sweep (spec-purchases §8 case 7): a terminal revoked and
  // re-activated under a new code strands its old drafts — rows no screen can
  // reach and this device can never submit.
  useEffect(() => {
    // A sweep that fails costs a dead IDB row, never user work.
    void sweepOrphanDrafts(binding.terminalCode).catch(() => undefined);
  }, [binding.terminalCode]);

  // The shake lives for one animation, then the slab is calm again.
  useEffect(() => {
    if (!shake) return;
    const timer = window.setTimeout(() => setShake(false), 400);
    return () => window.clearTimeout(timer);
  }, [shake]);

  const writeLines = useCallback((next: Record<string, number>, captured: number | null) => {
    linesRef.current = next;
    capturedAtRef.current = captured;
    setLines(next);
    setCapturedAt(captured);
  }, []);

  /**
   * The sheet as it stands, written to IDB under this terminal's count key —
   * with the frozen key when there is one. Every caller passes the key it
   * holds rather than reading state, so an autosave can never drop a key a
   * send attempt has already committed (that is the whole point of freezing
   * it), and no caller can invent one.
   *
   * It ANSWERS. A refused write used to be swallowed here under a comment
   * saying it "costs the restart safety net, never the count in hand" — true of
   * an ordinary autosave, and false of the one call that matters, because the
   * write this swallowed on the way out of `submit` IS the idempotency
   * guarantee. Nothing is deleted on failure and the stored draft (with
   * whatever key it already carries) is left exactly as it is: a later
   * successful write, or a resend, still resumes the same chain rather than
   * opening a second one.
   */
  const persistDraft = useCallback(
    async (
      lines: Record<string, number>,
      captured: number,
      key: string | null,
    ): Promise<boolean> => {
      // Snapshot the names alongside the quantities (the kikaratasi has done
      // this since Phase 5 for the same reason): a sheet resumed after a cold
      // restart must be able to NAME a line whose product has left the stoo,
      // or the manager is asked to delete a bare UUID.
      const names: Record<string, string> = {};
      for (const id of Object.keys(lines)) {
        const name = knownNamesRef.current.get(id);
        if (name !== undefined) names[id] = name;
      }
      const draft: PosCountDraft = {
        type: 'count',
        lines,
        names,
        ...(key === null ? {} : { idempotencyKey: key }),
        capturedAt: captured,
        updatedAt: Date.now(),
      };
      try {
        await writeCountDraft(binding.terminalCode, draft);
      } catch {
        // Storage refused (quota, private mode, an evicted origin). The count
        // on screen is still the manager's work, so nothing here touches it —
        // but the phone is no longer holding it, and the screen must stop
        // saying that it is.
        setDraftKept(false);
        return false;
      }
      setDraftKept(true);
      return true;
    },
    [binding.terminalCode],
  );

  /**
   * The events that end a count and release its key (see the state machine): a
   * 2xx, and the manager ending the sheet. Nothing else — a rejection, a
   * timeout or an edit all leave the key exactly where it is.
   */
  const releaseKey = useCallback(() => {
    keyRef.current = null;
    // No sheet, nothing on the phone to claim custody of.
    setDraftKept(null);
    // The sheet is already gone from this session; a failed delete costs one
    // stale resume offer, which the next entry lets the manager discard.
    return clearCountDraft(binding.terminalCode).catch(() => undefined);
  }, [binding.terminalCode]);

  const enter = useCallback(() => {
    setErrorRaw(null);
    setRefusal('unproven');
    setNeedsNetwork(false);
    setConfirmOpen(false);
    // A finished count stays on screen until the manager leaves it; entering
    // Hesabu again always opens a fresh sheet. Its key was released on the 2xx
    // that finished it — this is belt and braces, not the release point.
    if (stepRef.current === 'done') {
      writeLines({}, null);
      setStep('entry');
      setResult(null);
      keyRef.current = null;
      setDraftKept(null);
      setRevision((current) => current + 1);
      return;
    }
    // Stepping out to Stoo and back continues the sheet in hand; only an empty
    // sheet (app restart, cold start) asks the resume/discard question.
    if (Object.keys(linesRef.current).length > 0) return;
    readCountDraft(binding.terminalCode)
      .then((draft) => {
        if (draft && Object.keys(draft.lines).length > 0) {
          draftOfferRef.current = draft;
          setDraftOffer(draft);
        }
      })
      // A draft we cannot read is a draft we cannot offer; counting still works.
      .catch(() => undefined);
  }, [binding.terminalCode, writeLines]);

  const setLine = useCallback(
    (productId: string, value: number | null) => {
      const next = { ...linesRef.current };
      if (value === null) delete next[productId];
      else next[productId] = value;
      const emptied = Object.keys(next).length === 0;
      const captured = emptied ? null : (capturedAtRef.current ?? Date.now());
      writeLines(next, captured);
      if (emptied) {
        // Every counted line taken back out IS the discard ritual, one tap at a
        // time (the kikaratasi's emptied form does the same): there is no sheet
        // left, so the next count is a NEW count and the key goes with the
        // draft. Nothing else in this handler touches the key — an edit is not
        // a different count once an attempt has been made, and re-minting on
        // one is how a lost response becomes a second adjustment.
        void releaseKey();
        return;
      }
      // Autosave per committed edit, carrying the frozen key when one exists so
      // a sheet corrected after a failed send still resumes ITS OWN chain
      // across a restart.
      void persistDraft(next, captured ?? Date.now(), keyRef.current);
    },
    [persistDraft, releaseKey, writeLines],
  );

  const resumeDraft = useCallback(() => {
    const draft = draftOfferRef.current;
    if (!draft) return;
    // The draft's own names come back first: on a cold restart they are the
    // ONLY thing that can name a line whose product is no longer in the stoo.
    // A draft written before the field existed simply teaches nothing.
    learnNames(Object.entries(draft.names ?? {}));
    // …and so does its key. A draft carrying one was already handed to a send
    // attempt by some earlier session, and whether that attempt reached the
    // server is not knowable here — the response may have died on the link, or
    // the phone may have been killed between the tap and the answer. Resuming
    // under the SAME key is what lets the server settle it: the marker either
    // matches (it resumes its own chain) or it does not (this key opens a
    // fresh one). A draft written before the field existed carries no attempt,
    // so it resumes in the NONE state, exactly as it was left.
    keyRef.current = draft.idempotencyKey ?? null;
    writeLines({ ...draft.lines }, draft.capturedAt);
    draftOfferRef.current = null;
    setDraftOffer(null);
    // This sheet came OFF the phone, so the phone is holding it — the custody
    // claim is a fact here, not an intention.
    setDraftKept(true);
    setRevision((current) => current + 1);
  }, [learnNames, writeLines]);

  const discardDraft = useCallback(() => {
    draftOfferRef.current = null;
    setDraftOffer(null);
    // The manager said discard: the sheet ends here and its key ends with it.
    // A failed delete only means the offer returns.
    void releaseKey();
  }, [releaseKey]);

  /**
   * The same ending, reachable with a sheet in hand. `discardDraft` lives on
   * the resume/discard sheet, which `enter()` only opens over an EMPTY sheet,
   * so before this the only way to obey "anza hesabu mpya" was to clear every
   * counted field until the last one tripped the release in `setLine`. The
   * screen puts a confirm in front of it: this deletes counted work, and the
   * manager — not a failure downstream — is the one choosing that.
   */
  const startNewCount = useCallback(() => {
    writeLines({}, null);
    setStep('entry');
    setResult(null);
    setConfirmOpen(false);
    setErrorRaw(null);
    setRefusal('unproven');
    setNeedsNetwork(false);
    setRevision((current) => current + 1);
    void releaseKey();
  }, [releaseKey, writeLines]);

  const openReview = useCallback(() => {
    if (Object.keys(linesRef.current).length === 0) return;
    // The review is the human check on a destructive write, so it may never
    // open over a sheet it cannot show whole (spec-inventory §3/§7 case 5):
    // the variance total behind the threshold double-confirm is summed from
    // the rows on screen, and a hidden line would silently shrink it. A sheet
    // longer than the server accepts stops here too — reviewing 250 lines to
    // earn a ValidationPipe rejection is the manager's time thrown away.
    if (sheetBlocked(linesRef.current, visibleRef.current)) return;
    // The note and the rejection belong to the attempt that produced them; a
    // sheet edited since must not carry them onto the corrected review.
    setErrorRaw(null);
    setRefusal('unproven');
    setNeedsNetwork(false);
    setStep('review');
  }, []);

  const backToEntry = useCallback(() => {
    setConfirmOpen(false);
    setErrorRaw(null);
    setRefusal('unproven');
    setNeedsNetwork(false);
    setStep('entry');
  }, []);

  const openConfirm = useCallback(() => setConfirmOpen(true), []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  const submit = useCallback(async () => {
    if (submittingRef.current || !onlineRef.current) return;
    const entries = Object.entries(linesRef.current);
    if (entries.length === 0) return;
    // Backstop for the same rule openReview() enforces: whatever the slab
    // believes, a line that was never on the review never reaches the server,
    // and a sheet the server would reject on length never leaves the phone.
    if (sheetBlocked(linesRef.current, visibleRef.current)) return;
    const captured = capturedAtRef.current ?? Date.now();
    const countedAt = new Date(captured).toISOString();
    // Both readings come from THIS phone's clock, so the difference is the real
    // elapsed time even when the device clock is hours off the server's. The
    // server bounds a capture's age on this; sending only `countedAt` would
    // hand it two clocks and let a slow device refuse counts taken minutes ago.
    const capturedAgoMs = Math.max(0, Date.now() - captured);
    const payloadLines = entries.map(([productId, countedQuantity]) => ({
      productId,
      countedQuantity,
    }));

    submittingRef.current = true;
    setSubmitting(true);
    setErrorRaw(null);
    setRefusal('unproven');
    setNeedsNetwork(false);
    try {
      // FREEZE. The first attempt mints the key; every later one — identical,
      // corrected, or a resume from another session — rides the one already
      // held. The write lands BEFORE the request goes out, because the window
      // this key protects opens the instant the request does: a phone killed
      // while the POST is in flight must come back holding the key that can
      // ask the server what happened.
      const idempotencyKey = keyRef.current ?? newIdempotencyKey();
      const kept = await persistDraft(linesRef.current, captured, idempotencyKey);
      if (!kept) {
        // The phone would not keep the key, so this request must not go out
        // under it. Sending anyway is the whole failure written out: the POST
        // lands, the response is lost or the app is killed, and the next cold
        // start finds a draft with no key, mints a fresh one, misses the marker
        // and posts the same absolute quantities a second time over a baseline
        // that moved. Nothing is lost by stopping — the sheet is on screen, the
        // ref still holds whatever key an EARLIER attempt froze (the assignment
        // below is deliberately after this gate, so a fresh key is adopted only
        // once it has been written down) — and the manager is told, with the
        // same reject ritual a server refusal gets, because a verb that did not
        // do what it says is a rejection whoever refused it.
        rejectHaptic();
        setShake(true);
        setConfirmOpen(false);
        return;
      }
      keyRef.current = idempotencyKey;

      const response = await backendPost<PosCountResult>(
        '/mobile-pos-lite/stock-counts',
        { idempotencyKey, countedAt, capturedAgoMs, lines: payloadLines },
        { headers: terminalHeaders(binding) },
      );
      // RELEASE: the server owns this count now. The draft dies on 2xx and
      // only on 2xx, and the key dies with it.
      await releaseKey();
      // MUHURI local commit (design direction §5), still inside the confirm
      // tap's gesture continuation. Both halves are gated on the POSITIVE
      // `=== 'POSTED'`: the stamp haptic and the tally are the marks of a
      // FINISHED job, and a count resting at PENDING_APPROVAL (the auto-post
      // escape flag) or APPROVED (a resumed chain) has moved no stock. The
      // seal two inches above says it is waiting for the office, and Leo's
      // "kazi zimekamilika leo" must not count it. A non-posted send still
      // did something, so it gets the routine 15ms tick rather than silence.
      if (response.status === 'POSTED') {
        stampSent();
        // The daylog write never blocks the screen.
        void bumpDaylogTally(binding.terminalCode).catch(() => undefined);
      } else {
        tick();
      }
      setResult(response);
      setConfirmOpen(false);
      setStep('done');
    } catch (error) {
      setConfirmOpen(false);
      if (isConnectionProblem(error)) {
        // The network died, not the count: same truth the offline slab tells,
        // and the frozen key makes the blind retry safe even if the server did
        // post before the response was lost.
        setNeedsNetwork(true);
        return;
      }
      // Everything below chooses WORDS. The sheet, the draft and the key are
      // untouched either way. The reject ritual belongs to an answer that
      // REFUSED the attempt; a 502 over a perfectly good count no longer
      // shakes the slab, and the "go back and fix it" line is narrower still
      // (see classifyRefusal) because it is an instruction, not a report.
      if (refusalStatus(error) !== null) {
        rejectHaptic();
        setShake(true);
      }
      setRefusal(classifyRefusal(error));
      setErrorRaw(error instanceof Error ? error.message : String(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [binding, persistDraft, releaseKey]);

  return {
    step,
    lines,
    countedCount,
    capturedAt,
    revision,
    unresolved,
    stockUnavailable,
    overLimit,
    blocked: unresolved.length > 0 || stockUnavailable || overLimit,
    draftOffer,
    draftKept,
    confirmOpen,
    submitting,
    errorRaw,
    refusal,
    needsNetwork,
    shake,
    result,
    enter,
    setLine,
    resumeDraft,
    discardDraft,
    startNewCount,
    openReview,
    backToEntry,
    openConfirm,
    closeConfirm,
    submit,
  };
}
