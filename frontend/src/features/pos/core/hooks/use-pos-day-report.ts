'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { backendPost } from '@/lib/api-client';
import {
  getDaylogEntry,
  posDaylogDate,
  writeDaylogClose,
  type MobilePosLiteBinding,
  type PendingMobilePosLiteSale,
  type PosDaylogEntry,
  type PosDaylogSent,
} from '@/lib/mobile-pos-lite-store';
import { posDayReportFailureMessage } from '../pos-errors';
import { reject as rejectHaptic, stampSent } from '../pos-haptics';
import { sharePdfDocument } from '../pos-receipt';
import type { DaySummary, PosTranslate } from '../pos-types';
import { newIdempotencyKey, terminalHeaders } from '../pos-utils';

/**
 * Funga Siku — the end-of-day close (spec-history-reports §4). The ONLY write
 * in this module, and it obeys the discipline the purchase and count chains
 * cost five review rounds to learn. `usePosSlip` and `usePosCount.submit` are
 * the reference implementations; this hook is their sibling.
 *
 * THE KEY'S LIFE, as a state machine. Nothing else in this file matters more:
 *
 *   NONE ──FUNGA SIKU whose daylog close write LANDED──▶ FROZEN(key, day)
 *   FROZEN ──2xx──▶ SUBMITTED(reportId): the key is RELEASED, the proof stored
 *   FROZEN ──any failure at all──▶ FROZEN, unchanged
 *   FROZEN ──remount / navigation / app kill / cold start──▶ FROZEN
 *   SUBMITTED ──a deliberate NEW close of the same day──▶ NONE ──▶ FROZEN(new)
 *
 * And running alongside it, THE DAY BEING CLOSED — a separate question with its
 * own states, because the key's life says nothing about WHICH day a rep can
 * still reach, and the first cut of this module could only ever reach a day the
 * phone had already begun closing ONLINE:
 *
 *   NONE ──screen opened with NO SIGNAL──▶ INTENT(day): a close row carrying NO
 *          key. Nothing is being sent, so the freeze-before-send discipline is
 *          satisfied rather than bent — and a day that left no trace at all is
 *          a day the next morning cannot find.
 *   INTENT | WORKED-AND-UNCLOSED ──next morning's enter()──▶ that day is the one
 *          the screen OPENS on, named in the header and in the picker.
 *   ANY DAY ──the rep taps the other chip──▶ that day, under ITS own frozen key
 *          if it has one, and under none if it does not.
 *   CLOSED(reportId) ──▶ still selectable, and disclosed as already closed: a
 *          second close is a legitimate newer snapshot (§8-D case 2).
 *
 * The two machines are deliberately independent: the picker moves the DAY,
 * never the key. Selecting a day ADOPTS whatever key that day already carries
 * and mints nothing, so switching can neither strand a chain nor start one.
 *
 * - The key is minted at the FIRST SEND ATTEMPT, not on screen entry: opening
 *   a screen is not attempting a close, and a key minted per visit would
 *   litter the daylog with chains nobody started.
 * - It is PERSISTED with the local state that backs the submission — the
 *   daylog entry for the day being closed — and never lives in a React ref
 *   alone. A key that dies on remount is how you get a duplicate: the POST
 *   lands, the answer is lost, the next attempt mints a fresh key, and the
 *   office gets two reports for one day with nothing linking them.
 * - `businessDate` is frozen WITH it. A close begun at 23:59 and retried at
 *   00:01 must still close yesterday; if the phone re-derived the day at retry
 *   time, the same key would arrive claiming a different one — which is
 *   exactly what the server's three-way verification refuses (§1.3 step 3).
 * - It is never released by an edit. There is nothing on this screen to edit,
 *   and the frozen date is what keeps that true across midnight.
 * - It is released on 2xx and ONLY on 2xx. A later deliberate close of the
 *   same day mints a fresh key, which is correct: the server recomputes every
 *   figure from SalesOrder rows, so a second close is a genuinely new snapshot
 *   and there is nothing to double-book (§8-D case 2).
 *
 * Replay protection itself is a DATABASE guarantee — `@@unique([companyId,
 * idempotencyKey])` on the insert. No read-then-write twin check lives on this
 * path, and none may be added: Postgres stamps `createdAt` at transaction
 * start, so both racers of a create can conclude they won.
 *
 * Nothing here is ever destroyed or permanently refused. A day report creates
 * no financial fact, no stock movement and no GL entry, so a failure strands
 * no chain: the row simply does not exist, the phone keeps its frozen key, and
 * the identical retry is safe.
 */

/**
 * One day back, in the BUSINESS calendar (`posDaylogDate` reads the business
 * timezone, not the device's), which is the same arithmetic the server's
 * today-or-yesterday window does. EAT has no DST, so 24h back is always the
 * previous business day.
 */
function previousDate(date: Date = new Date()): string {
  return posDaylogDate(new Date(date.getTime() - 24 * 60 * 60 * 1000));
}

/**
 * One of the two days the server will accept a close for — today and yesterday
 * in the business timezone — and everything the screen needs to name it.
 *
 * This is what makes the day EXPLICIT. Before it there was no date control
 * anywhere on Funga Siku: the day was resolved silently, the one case the
 * server's yesterday allowance exists for was unreachable, and a day that ended
 * with no signal could never be closed at all.
 */
export type PosDayReportDay = {
  /** `YYYY-MM-DD` in the business timezone. */
  date: string;
  isToday: boolean;
  /** A close attempt is outstanding: a key is frozen against this day. */
  outstanding: boolean;
  /** This phone submitted a report for this day and the office has it. */
  closed: boolean;
  /**
   * Work this phone knows about that has never reached the office as a report:
   * an outstanding key, an offline INTENT, marks on the day's tally, or a
   * rep-guarded server snapshot with sales in it. This is what stops the phone
   * offering an empty report for a day nobody worked while the day she DID work
   * goes unclosed and unmentioned.
   */
  needsClose: boolean;
  /** Rep-guarded last-known server figures for this day. Null = none on file. */
  cache: PosDaylogSent | null;
};

/** The figures the close screen may honestly show for the day being closed. */
export type PosClosePreview = {
  /** Null means the phone HAS no figure for this day — the screen shows "—". */
  count: number | null;
  totalAmount: number | null;
  /** Epoch ms when the figures are a stored snapshot rather than live. */
  staleAt: number | null;
  /** Live rows for the method breakdown; null when there is no live source. */
  sales: DaySummary['sales'] | null;
};

const NO_PREVIEW: PosClosePreview = {
  count: null,
  totalAmount: null,
  staleAt: null,
  sales: null,
};

/**
 * The figures for THE DAY BEING CLOSED, and never another day's.
 *
 * `my-sales-today` and the shell's `cachedSent` are both keyed to TODAY, so
 * reading them under a header naming yesterday showed a rep one day's money
 * labelled as another's, immediately before she signed it off. Whatever day is
 * being closed, every figure on that screen is that day's — or the screen says
 * plainly that the phone has none for it (`reportNoFiguresForDay`).
 *
 * Pure, exported and unit-testable: the shell hands it the three sources and
 * uses the result for both the preview card and the slab money, so the two can
 * never disagree.
 */
export function resolveClosePreview({
  isToday,
  daySummary,
  cachedSent,
  dayCache,
}: {
  isToday: boolean;
  /** The live `my-sales-today` payload — TODAY's, and only ever today's. */
  daySummary: DaySummary | null;
  /** The shell's rep-guarded daylog snapshot for TODAY. */
  cachedSent: PosDaylogSent | null;
  /** The rep-guarded daylog snapshot for the day being closed. */
  dayCache: PosDaylogSent | null;
}): PosClosePreview {
  if (isToday) {
    if (daySummary) {
      return {
        count: daySummary.count,
        totalAmount: daySummary.totalAmount,
        staleAt: null,
        sales: daySummary.sales,
      };
    }
    if (cachedSent) {
      return {
        count: cachedSent.count,
        totalAmount: cachedSent.totalAmount,
        staleAt: cachedSent.fetchedAt,
        sales: null,
      };
    }
    return NO_PREVIEW;
  }
  // Another day: the ONLY honest local source is that day's own stored
  // snapshot. There is no breakdown for it — the phone caches totals, not rows
  // — so the method rows are absent rather than borrowed from today.
  if (dayCache) {
    return {
      count: dayCache.count,
      totalAmount: dayCache.totalAmount,
      staleAt: dayCache.fetchedAt,
      sales: null,
    };
  }
  return NO_PREVIEW;
}

/** Read one day's daylog row into the screen's vocabulary. */
function readDay(
  entry: PosDaylogEntry | null,
  date: string,
  isToday: boolean,
  repId: string,
): PosDayReportDay {
  const close = entry?.close ?? null;
  // Shared-phone guard (spec-leo §2.5): another rep's cached money is never
  // shown as this rep's, and never counted as her unclosed work either.
  const cache = entry?.sent && entry.sent.repId === repId ? entry.sent : null;
  const outstanding = Boolean(close?.idempotencyKey);
  const closed = Boolean(close?.reportId);
  const worked = (entry?.tallyCount ?? 0) > 0 || (cache?.count ?? 0) > 0;
  return {
    date,
    isToday,
    outstanding,
    closed,
    needsClose: !closed && (outstanding || worked || Boolean(close?.openedOffline)),
    cache,
  };
}

function blankDay(date: string, isToday: boolean): PosDayReportDay {
  return { date, isToday, outstanding: false, closed: false, needsClose: false, cache: null };
}

/** Yesterday first, today second — the two days read left to right. */
function blankDays(): PosDayReportDay[] {
  return [blankDay(previousDate(), false), blankDay(posDaylogDate(), true)];
}

export type PosDayReportMethod = {
  paymentMethod: string;
  /** The terminal's own configured label; null for CREDIT, which has no row. */
  label: string | null;
  count: number;
  amount: number;
};

export type PosDayReportItem = {
  productId: string;
  name: string;
  quantity: number;
  amount: number;
};

/** `POST /mobile-pos-lite/day-reports` — the record, and what the PDF prints. */
export type PosDayReport = {
  id: string;
  businessDate: string;
  reference: string;
  submittedAt: string;
  terminal: { id: string; code: string; name: string };
  branch: { id: string; name: string };
  rep: { id: string; name: string };
  salesCount: number;
  grossTotal: number;
  itemsSoldQuantity: number;
  byMethod: PosDayReportMethod[];
  items: PosDayReportItem[];
  itemsTruncated: boolean;
  /**
   * DECLARED BY THE PHONE, and named so everywhere it appears. Every other
   * figure on this record is recomputed server-side from SalesOrder rows;
   * these two are the one thing the server genuinely cannot know.
   */
  declaredHeldCount: number;
  declaredHeldAmount: number;
};

export type PosDayReportHook = {
  /** The day being closed — today, or a resumed/chosen yesterday (§4-7). */
  businessDate: string;
  /** True when that day is not today: the screen discloses it, calmly. */
  isYesterday: boolean;
  /** Both closable days, yesterday first — the screen's date control. */
  days: PosDayReportDay[];
  /** The day being closed, as an option row (never undefined). */
  selectedDay: PosDayReportDay;
  /** The OTHER closable day — what the screen offers, and warns about. */
  otherDay: PosDayReportDay;
  /**
   * Move the close to one of the two closable days. Adopts that day's own
   * frozen key if it has one and mints nothing; refused while a send is in
   * flight, because the day a request is already carrying cannot change.
   */
  selectDay: (date: string) => void;
  submitting: boolean;
  /** The mapped Swahili sentence for a refused/failed close. Never raw English. */
  notice: string;
  /** A refused write or a failed send: the slab shakes, exactly like a rejection. */
  shake: boolean;
  confirmOpen: boolean;
  report: PosDayReport | null;
  sharing: boolean;
  shareNotice: string;
  /** Screen open: resume an outstanding close, today's or yesterday's. */
  enter: () => void;
  openConfirm: () => void;
  closeConfirm: () => void;
  /** Resolves true ONLY on a 2xx — the sole path to the Ripoti stamp. */
  submit: () => Promise<boolean>;
  share: () => Promise<void>;
};

export function usePosDayReport({
  binding,
  online,
  pendingSales,
  repId,
  t,
}: {
  binding: MobilePosLiteBinding;
  online: boolean;
  /** The live outbox — the declared held pair, and the confirm's trigger. */
  pendingSales: PendingMobilePosLiteSale[];
  /** The signed-in rep — the shared-phone guard on every cached figure. */
  repId: string;
  t: PosTranslate;
}): PosDayReportHook {
  const terminalCode = binding.terminalCode;
  const [businessDate, setBusinessDate] = useState(() => posDaylogDate());
  const [days, setDays] = useState<PosDayReportDay[]>(blankDays);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [shake, setShake] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [report, setReport] = useState<PosDayReport | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareNotice, setShareNotice] = useState('');

  /**
   * The FROZEN key — null in the NONE state, a key in FROZEN. It is a mirror
   * of the daylog row, never the record itself: the row is what survives a
   * remount, and this ref is only what saves the read on the next attempt.
   */
  const keyRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const businessDateRef = useRef(businessDate);
  const submittingRef = useRef(false);
  const sharingRef = useRef(false);
  const reportRef = useRef<PosDayReport | null>(null);
  const onlineRef = useRef(online);
  const pendingRef = useRef(pendingSales);
  const tRef = useRef(t);
  useEffect(() => {
    businessDateRef.current = businessDate;
    onlineRef.current = online;
    pendingRef.current = pendingSales;
    tRef.current = t;
    reportRef.current = report;
  });

  // The shake lives for one animation, then the slab is calm again.
  useEffect(() => {
    if (!shake) return;
    const timer = window.setTimeout(() => setShake(false), 400);
    return () => window.clearTimeout(timer);
  }, [shake]);

  /**
   * Screen open. Read BOTH closable days — today and yesterday in the business
   * timezone, which is exactly the window the server accepts — and open on the
   * one that still needs closing, naming it in the header and offering the
   * other in the picker.
   *
   * The order is the order of obligation:
   *
   *   1. an outstanding key for TODAY — a close already begun here;
   *   2. an outstanding key for YESTERDAY — the resume across midnight;
   *   3. YESTERDAY still needing a close — work this phone knows about that has
   *      never reached the office: an offline INTENT, marks on the tally, or a
   *      rep-guarded snapshot with sales in it. This is the case the first cut
   *      could not reach at all, and the one the server's yesterday allowance
   *      was built for: she finished at 20:00 with no signal, so there was
   *      never an online attempt to leave a key behind;
   *   4. otherwise TODAY.
   *
   * Yesterday outranks today at step 3 because yesterday EXPIRES — tomorrow the
   * server will not accept it — while today can still be closed all day.
   *
   * WITH NO SIGNAL the intent is persisted for the day being opened. Nothing is
   * sent, so the freeze-before-send rule is satisfied rather than bent, and the
   * row carries NO key — but it is what the next morning finds, and without it
   * the day she actually traded was lost to the office forever.
   *
   * Deliberately a no-op once this session already holds a KEY: re-reading
   * then could resurrect a key whose release write failed and turn a
   * deliberate second close into a replay of the first.
   *
   * It does NOT stop for a finished report. The seal is a moment, not a state:
   * this runs only on route ENTRY (KauntaShell's route effect), so it cannot
   * wipe a receipt the rep is still looking at — and guarding on it froze the
   * screen on the closed day for the rest of the session. A rep who closed
   * yesterday morning would find the evening's Funga Siku still headed
   * yesterday, the date chips inert, and FUNGA SIKU filing a second close of a
   * day already closed while the day she actually traded stayed unclosable.
   * That is the exact failure the day picker exists to prevent, so a fresh
   * visit re-derives from the daylog and the stale report is dropped.
   */
  const enter = useCallback(() => {
    if (keyRef.current) return;
    setNotice('');
    setShareNotice('');
    setReport(null);
    reportRef.current = null;
    const today = posDaylogDate();
    const yesterday = previousDate();
    void (async () => {
      // A daylog we cannot read is a day we cannot resume; closing still works
      // — it simply opens a fresh chain on today, which is safe because nothing
      // unreadable was ever sent under an old one that this could double.
      const [todayEntry, yesterdayEntry] = await Promise.all([
        getDaylogEntry(terminalCode, today).catch(() => null),
        getDaylogEntry(terminalCode, yesterday).catch(() => null),
      ]);
      const todayDay = readDay(todayEntry, today, true, repId);
      const yesterdayDay = readDay(yesterdayEntry, yesterday, false, repId);
      const target = todayDay.outstanding
        ? todayDay
        : yesterdayDay.outstanding || yesterdayDay.needsClose
          ? yesterdayDay
          : todayDay;

      const close = (target.isToday ? todayEntry : yesterdayEntry)?.close ?? null;
      keyRef.current = close?.idempotencyKey ?? null;
      startedAtRef.current = close?.startedAt ?? null;
      setBusinessDate(target.date);

      let resolved = [yesterdayDay, todayDay];
      if (!onlineRef.current && !close) {
        // THE INTENT. Best-effort by design: `writeDaylogClose` returns whether
        // it landed and a refusal here refuses NOTHING — nothing is being sent,
        // so there is no send to block. It is only recorded when it lands, so
        // the screen never claims a resume the phone cannot keep.
        const kept = await writeDaylogClose(terminalCode, target.date, {
          businessDate: target.date,
          startedAt: Date.now(),
          openedOffline: true,
        });
        if (kept) {
          resolved = resolved.map((day) =>
            day.date === target.date ? { ...day, needsClose: !day.closed } : day,
          );
        }
      }
      setDays(resolved);
    })();
  }, [repId, terminalCode]);

  /**
   * The date control. It moves the DAY and never the key: the chosen day's own
   * frozen key is adopted if it has one, and nothing is minted if it does not,
   * so switching can neither strand a chain nor start one.
   *
   * Refused while a send is in flight — the day a request is already carrying
   * cannot change under it — and refused for any date that is not one of the
   * two days the server will accept.
   *
   * NOT refused for a finished report, and it clears one when the day moves.
   * This adopts the TARGET day's own close row, so it can resurrect nothing
   * the way a blind re-read could; blocking it instead left the chips rendered
   * enabled and inert after any close, with the other closable day out of
   * reach for the rest of the session.
   */
  const selectDay = useCallback(
    (date: string) => {
      if (submittingRef.current) return;
      if (date === businessDateRef.current) return;
      if (date !== posDaylogDate() && date !== previousDate()) return;
      setNotice('');
      setShareNotice('');
      setReport(null);
      reportRef.current = null;
      void (async () => {
        const entry = await getDaylogEntry(terminalCode, date).catch(() => null);
        const close = entry?.close ?? null;
        keyRef.current = close?.idempotencyKey ?? null;
        startedAtRef.current = close?.startedAt ?? null;
        setBusinessDate(date);
        const fresh = readDay(entry, date, date === posDaylogDate(), repId);
        setDays((current) => current.map((day) => (day.date === date ? fresh : day)));
      })();
    },
    [repId, terminalCode],
  );

  const openConfirm = useCallback(() => setConfirmOpen(true), []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  /**
   * FUNGA SIKU, in two steps that must stay in this order: park the key, then
   * send the report under it.
   *
   * The write is AWAITED before the request, so "ahead" means the row is
   * really down and not merely scheduled — and a write the phone REFUSES
   * (quota, private mode) BLOCKS THE SEND, the same gate `usePosSlip.sendKey`
   * and `usePosCount.submit` carry. A phone that would not keep the key is
   * holding nothing to ask the server with, so posting anyway is the whole
   * failure written out. Nothing is lost by stopping: the screen stands, the
   * numbers stand, the verb is unchanged, and she is TOLD — a badge quietly
   * failing to appear is not telling.
   *
   * The key is adopted into `keyRef` only AFTER the write lands, exactly as
   * the count adopts its key only once it is written down: a refused attempt
   * put nothing on the wire, so there is no chain for the key to be frozen
   * against.
   */
  const submit = useCallback(async (): Promise<boolean> => {
    if (submittingRef.current || !onlineRef.current) return false;
    const date = businessDateRef.current;
    const key = keyRef.current ?? newIdempotencyKey();
    const startedAt = startedAtRef.current ?? Date.now();
    const held = pendingRef.current;
    const heldCount = held.length;
    // The display snapshots the outbox rows already carry — the same numbers
    // Leo and the held card show, so the paper cannot disagree with the screen.
    const heldAmount = held.reduce((sum, item) => sum + Number(item.totalAmount ?? 0), 0);

    submittingRef.current = true;
    setSubmitting(true);
    setNotice('');
    try {
      const kept = await writeDaylogClose(terminalCode, date, {
        idempotencyKey: key,
        businessDate: date,
        startedAt,
      });
      if (!kept) {
        // A verb that did not do what it says is a rejection, whoever refused
        // it: the same haptic and the same slab shake a server refusal gets.
        // NOTHING IS POSTED, and nothing already on the phone is destroyed —
        // whatever close IS stored keeps its own key and its own chain.
        rejectHaptic();
        setShake(true);
        setConfirmOpen(false);
        setNotice(tRef.current('reportKeySaveFailed'));
        return false;
      }
      keyRef.current = key;
      startedAtRef.current = startedAt;

      const response = await backendPost<PosDayReport>(
        '/mobile-pos-lite/day-reports',
        { idempotencyKey: key, businessDate: date, heldCount, heldAmount },
        { headers: terminalHeaders(binding) },
      );

      // RELEASE. The server owns this close now, so the key retires and the
      // proof takes its place. A failed release write is the SAFE direction and
      // is deliberately not surfaced: the stored key would simply be replayed
      // on a later attempt, and the server answers a verified replay with the
      // record it already has — the same numbers the office already read.
      keyRef.current = null;
      await writeDaylogClose(terminalCode, date, {
        businessDate: date,
        startedAt,
        reportId: response.id,
        submittedAt: Date.now(),
      });
      // MUHURI local commit, still inside the tap's gesture continuation. The
      // tally deliberately does NOT move (§3.4): closing the day is ruling the
      // line UNDER the marks, not another entry on the page.
      stampSent();
      setReport(response);
      reportRef.current = response;
      // The day itself is settled now: the picker stops calling it unclosed,
      // and a return visit is disclosed as a second close rather than a first.
      setDays((current) =>
        current.map((day) =>
          day.date === date ? { ...day, outstanding: false, closed: true, needsClose: false } : day,
        ),
      );
      setConfirmOpen(false);
      return true;
    } catch (error) {
      // Everything below chooses WORDS. The key, the daylog row and the screen
      // are untouched either way, and #ripoti is entered only on a 2xx — there
      // is no optimistic stamp and no path on which this screen claims the
      // office has something it does not.
      setConfirmOpen(false);
      rejectHaptic();
      setShake(true);
      setNotice(posDayReportFailureMessage(error, tRef.current));
      return false;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [binding, terminalCode]);

  /**
   * SHIRIKI RIPOTI. The paper is rendered from the STORED RECORD, so the sheet
   * a rep hands over and the record the office reads are the same numbers by
   * construction — and stay the same if she re-shares it a week later.
   *
   * A failed fetch is never a reason to re-submit and never re-keys anything:
   * the record already exists at the office, and the copy says exactly that
   * while the share button stays live.
   */
  const share = useCallback(async () => {
    const current = reportRef.current;
    if (!current || sharingRef.current) return;
    sharingRef.current = true;
    setSharing(true);
    setShareNotice('');
    try {
      const delivered = await sharePdfDocument(
        binding,
        `/api/backend/mobile-pos-lite/day-reports/${current.id}/pdf`,
        `RIPOTI-${current.reference}.pdf`,
      ).catch(() => null);
      if (delivered === null) setShareNotice(tRef.current('reportPdfFailed'));
      // Rendered inline rather than as a toast (the receipt's choice): the
      // share button is what she just pressed, so the answer belongs beside it
      // — a toast over a phone mid-share-sheet is the one place it is not read.
      else if (delivered === 'downloaded') setShareNotice(tRef.current('reportDownloaded'));
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
  }, [binding]);

  // `days` always carries both closable days, so the lookups below cannot miss;
  // the fallbacks exist only so the screen never has to reason about undefined.
  const selectedDay =
    days.find((day) => day.date === businessDate) ??
    blankDay(businessDate, businessDate === posDaylogDate());
  const otherDay =
    days.find((day) => day.date !== businessDate) ??
    blankDay(previousDate(), previousDate() === posDaylogDate());

  return {
    businessDate,
    isYesterday: businessDate !== posDaylogDate(),
    days,
    selectedDay,
    otherDay,
    selectDay,
    submitting,
    notice,
    shake,
    confirmOpen,
    report,
    sharing,
    shareNotice,
    enter,
    openConfirm,
    closeConfirm,
    submit,
    share,
  };
}
