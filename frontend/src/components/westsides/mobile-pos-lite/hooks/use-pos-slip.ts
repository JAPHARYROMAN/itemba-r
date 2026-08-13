'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  deletePurchaseDraft,
  readPurchaseDraft,
  savePurchaseDraft,
  type MobilePosLiteBinding,
  type PosPurchaseDraft,
} from '@/lib/mobile-pos-lite-store';
import { reject as rejectHaptic, tick } from '../pos-haptics';
import { newIdempotencyKey } from '../pos-utils';
import type { PurchaseLine, Supplier } from '../pos-types';

/**
 * The kikaratasi — Manunuzi's offline draft (spec-purchases §3.1/§6; Phase 5).
 * Kaunta-shell-only, mounted beside `usePosCount` so the slab can own the
 * HIFADHI KIKARATASI verb while the Pokea form owns the fields.
 *
 * Three rules shape everything here:
 * - Form state, never a transaction queue. A purchase is posted by a human
 *   tapping POKEA online; an outboxed one would replay a stale `unitCost` as a
 *   valuation bug (design direction §9-13). The slip only remembers.
 * - The idempotency key has exactly two lives, and the boundary between them
 *   is the FIRST send attempt (§8 case 1: "the key must NEVER regenerate on
 *   retry — only on success or discard"). Before that attempt the key follows
 *   the content and an edit re-mints it freely: nothing has reached the server,
 *   so there is nothing to collide with. From that attempt until the delivery
 *   posts or the slip is discarded it is FROZEN — whatever the outcome, and
 *   whatever the manager then edits. A dropped response leaves the server's
 *   state UNKNOWN, and neither half of the phone's own guesswork is safe: the
 *   old freeze-across-edits let the server replay the ORIGINAL order and threw
 *   the correction away under a 2xx, while re-minting on the edit made the
 *   marker miss and received the same crates a SECOND time — two GRNs, two
 *   payables, nothing linking them. The server holds the only fact that
 *   settles it, so the frozen key is what asks: it replays an identical
 *   resend, and refuses an edited one (`assertPurchaseMatchesRecordedOrder`)
 *   with copy that names the office.
 * - Nothing is lost silently, and nothing claims custody it does not have.
 *   Auto-persist runs off the edits themselves, not off a button; the
 *   acknowledged save only navigates — and only ticks — once the slip is really
 *   on the phone; and POKEA only sends once the KEY is really on the phone,
 *   because a delivery that leaves under a key the phone was refused permission
 *   to keep is the one that gets received twice. A refused write says so.
 */

/** Long enough that a fast typist writes once, short enough to beat a dead battery. */
const AUTOSAVE_DEBOUNCE_MS = 500;

export type PosSlip = {
  /**
   * The LAST write to this phone succeeded and the form on screen is what it
   * holds — the ribbon's brass badge and the Pokea "saved on this phone" line.
   * Not "a slip exists somewhere in IDB": a refused write clears this while
   * leaving the stored slip and its key alone, because the badge is a promise
   * about the work in hand, and a stale promise is worse than none.
   */
  parked: boolean;
  /** The form holds something worth keeping (the save verb's enable gate). */
  hasContent: boolean;
  /**
   * POKEA: the key this attempt must ride under, once the phone is durably
   * holding it — and taking it is what freezes it for every later attempt on
   * this slip, until success or discard. Resolves NULL when the write was
   * refused, which REFUSES the send: the caller must post nothing and say so.
   */
  sendKey: () => Promise<string | null>;
  /** Pokea opened: restore the parked slip into the form, online or offline. */
  enter: () => void;
  /** HIFADHI KIKARATASI — resolves false when nothing reached the phone. */
  save: () => Promise<boolean>;
  /** A save the phone refused: the slab shakes, exactly like a rejection. */
  shake: boolean;
  /** The delivery posted: the slip's job is done. */
  completed: () => void;
};

/** The slip as the form stands, before it is stamped with a key and a time. */
type SlipBody = Omit<PosPurchaseDraft, 'idempotencyKey' | 'savedAt'>;

/** A slip's identity for change detection; `savedAt` is deliberately excluded. */
function slipSignature(draft: PosPurchaseDraft): string {
  return JSON.stringify([draft.idempotencyKey, draft.supplierId, draft.lines]);
}

/**
 * What the idempotency key stands for: exactly the fields that reach the
 * server (`supplierId`, the lines with their quantities and typed costs, and
 * the notes when the form grows a box for them). Display snapshots — the
 * supplier and product names, the unit symbols — and `savedAt` are deliberately
 * out: a catalog re-sync or an autosave tick is not a different delivery, and
 * re-minting on one would let the same crate be received twice.
 */
function payloadSignature(body: SlipBody): string {
  return JSON.stringify([
    body.supplierId,
    body.lines.map((line) => [line.productId, line.quantity, line.unitCost ?? null]),
    body.notes ?? null,
  ]);
}

/**
 * A stored line back into a form line. The product comes from the slip's own
 * snapshot and never from the catalog: a catalog re-synced between save and
 * restore must not blank a typed line, the screen reads nothing but the name
 * off it, and the server re-resolves every productId (and every fallback cost)
 * at post time regardless.
 */
function restoreLine(line: PosPurchaseDraft['lines'][number]): PurchaseLine {
  return {
    product: {
      id: line.productId,
      name: line.name,
      code: '',
      barcode: null,
      unitId: '',
      unitSymbol: line.unitSymbol,
      sellingPrice: 0,
      availableStock: null,
      trackInventory: true,
      imageUrl: null,
    },
    quantity: line.quantity,
    unitCost: line.unitCost === undefined ? '' : String(line.unitCost),
  };
}

export function usePosSlip({
  binding,
  purchasesEnabled,
  supplier,
  setSupplier,
  purchaseCart,
  setPurchaseCart,
}: {
  binding: MobilePosLiteBinding;
  /** Revoked permission leaves the slip inert (§8 case 13): no read, no badge. */
  purchasesEnabled: boolean;
  supplier: Supplier | null;
  setSupplier: (supplier: Supplier | null) => void;
  purchaseCart: PurchaseLine[];
  setPurchaseCart: Dispatch<SetStateAction<PurchaseLine[]>>;
}): PosSlip {
  const [parked, setParked] = useState(false);
  const [shake, setShake] = useState(false);
  const terminalCode = binding.terminalCode;
  const hasContent = purchaseCart.length > 0 || supplier !== null;

  // Mirrors for the handlers: a save fired mid-edit must read the form as it
  // is now, not as the last render saw it.
  const supplierRef = useRef(supplier);
  const cartRef = useRef(purchaseCart);
  const setSupplierRef = useRef(setSupplier);
  const setPurchaseCartRef = useRef(setPurchaseCart);
  const enabledRef = useRef(purchasesEnabled);
  useEffect(() => {
    supplierRef.current = supplier;
    cartRef.current = purchaseCart;
    setSupplierRef.current = setSupplier;
    setPurchaseCartRef.current = setPurchaseCart;
    enabledRef.current = purchasesEnabled;
  });

  /**
   * The key this delivery rides under, beside the payload signature it was
   * minted for. The signature only matters while the key is still uncommitted
   * — it is what lets an edit before the first tap start a different delivery.
   */
  const keyRef = useRef<{ signature: string; key: string } | null>(null);
  /**
   * True once this slip's key has been handed to a send attempt (or restored
   * from a slip parked by an earlier session, whose attempts this session
   * cannot see). From here the key is frozen: see the key rule at the top.
   */
  const committedRef = useRef(false);
  /**
   * Notes a restored slip carried. The Kaunta form has no notes box yet, so
   * this only ever rides a restore through untouched — but it rides, so the
   * signature above reads the same content on both sides of a restart.
   */
  const notesRef = useRef<string | undefined>(undefined);
  /** The slip as it currently sits in IDB, so a restore needs no second read. */
  const draftRef = useRef<PosPurchaseDraft | null>(null);
  /** Signature of that slip: an open-and-look must not rewrite an unchanged one. */
  const savedSignatureRef = useRef<string | null>(null);
  /** Settles once the boot read has landed; `enter()` waits on it. */
  const loadedRef = useRef<Promise<void> | null>(null);
  /**
   * True between `enter()` and the restore landing. Entering Pokea resets the
   * form first (fresh-form-per-entry, mirroring the classic path), so without
   * this the empty-form discard below would delete the very slip being restored.
   */
  const restoringRef = useRef(false);
  /**
   * Set the instant a delivery posts. `recordPurchase` leaves the lines in
   * state (classic returns to its home screen with the form intact and the
   * next Manunuzi entry is what clears it), so without this the autosave would
   * re-park the slip we just deleted under a brand-new key. Lifted by `enter()`.
   */
  const settledRef = useRef(false);

  useEffect(() => {
    if (!purchasesEnabled) return;
    loadedRef.current = readPurchaseDraft(terminalCode)
      .then((draft) => {
        draftRef.current = draft;
        setParked(Boolean(draft));
      })
      // A slip we cannot read is a slip we cannot restore; receiving still works.
      .catch(() => undefined);
  }, [purchasesEnabled, terminalCode]);

  const forget = useCallback(() => {
    keyRef.current = null;
    // Success and discard are the two events that end a delivery, and both
    // land here: the next slip starts uncommitted, so the manager's next
    // delivery is a new delivery under a new key rather than a resend of this
    // one against an order the server has already recorded.
    committedRef.current = false;
    notesRef.current = undefined;
    draftRef.current = null;
    savedSignatureRef.current = null;
    setParked(false);
    // The slip is already gone from this session; a failed delete costs one
    // dead IDB row that the next save overwrites.
    void deletePurchaseDraft(terminalCode).catch(() => undefined);
  }, [terminalCode]);

  /** The form as it stands right now — the thing a key is minted against. */
  const buildBody = useCallback(
    (): SlipBody => ({
      type: 'purchase',
      terminalCode,
      supplierId: supplierRef.current?.id ?? null,
      supplierName: supplierRef.current?.name ?? null,
      lines: cartRef.current.map((line) => {
        const cost = Number(line.unitCost.replace(/\D/g, ''));
        // The payload's own >0 rule (§8 case 5): an empty or zeroed field is
        // "the manager did not type a cost", never a zero-cost receipt.
        return {
          productId: line.product.id,
          name: line.product.name,
          unitSymbol: line.product.unitSymbol,
          quantity: line.quantity,
          ...(cost > 0 ? { unitCost: cost } : {}),
        };
      }),
      ...(notesRef.current === undefined ? {} : { notes: notesRef.current }),
    }),
    [terminalCode],
  );

  /**
   * The key this slip is riding, minting one when it needs it. Uncommitted, it
   * follows the content: an edit before the first POKEA is a different
   * delivery and gets a different key. Committed, the content is irrelevant —
   * the key is the only thing that can ask the server what actually happened,
   * so it never moves again until success or discard (see the key rule above).
   *
   * Read on every autosave as well as every send, and deliberately without a
   * side effect: parking the slip is not attempting it.
   */
  const keyFor = useCallback((body: SlipBody): string => {
    const signature = payloadSignature(body);
    const held = keyRef.current;
    if (held && (committedRef.current || held.signature === signature)) return held.key;
    const key = newIdempotencyKey();
    keyRef.current = { signature, key };
    return key;
  }, []);

  const buildDraft = useCallback((): PosPurchaseDraft | null => {
    const body = buildBody();
    if (body.lines.length === 0 && !body.supplierId) return null;
    return { ...body, idempotencyKey: keyFor(body), savedAt: Date.now() };
  }, [buildBody, keyFor]);

  const persist = useCallback(async (): Promise<boolean> => {
    const draft = buildDraft();
    if (!draft) return false;
    try {
      await savePurchaseDraft(terminalCode, draft);
    } catch {
      // Storage refused (quota, private mode): the form on screen is still the
      // manager's work, so the honest answer is "not saved" — the caller keeps
      // them on Pokea rather than navigating away from unsaved lines.
      //
      // …and the badge drops with it, even when an EARLIER save succeeded.
      // `parked` is a custody claim about the lines in front of her — the brass
      // ribbon chip and "Kikaratasi kimehifadhiwa kwenye simu hii." — and once
      // a phone that is over quota starts refusing writes, every later edit is
      // work it did not keep. Claiming custody of the best write instead of the
      // last one is how ten lines vanish behind a badge that said they were
      // safe. Nothing is deleted here and `forget()` is deliberately NOT
      // called: whatever version IS on the phone stays, with its frozen key
      // intact, so a later successful save (or a resend) still resumes the same
      // chain rather than opening a second delivery.
      setParked(false);
      return false;
    }
    draftRef.current = draft;
    savedSignatureRef.current = slipSignature(draft);
    setParked(true);
    return true;
  }, [buildDraft, terminalCode]);

  /**
   * POKEA. Taking the key is what commits it — not a 2xx, not even a completed
   * request. The only thing the phone can ever know for certain is that it
   * tried; everything past that point is the server's word, and a key that
   * re-mints on the phone's own guess is how one delivery becomes two.
   *
   * …which only holds while the phone still HOLDS the key, so the write goes
   * out from here rather than being left to the debounced autosave. The two are
   * not interchangeable: the autosave is scheduled off the last EDIT, and the
   * ordinary rhythm at a lorry is to type the final unit cost and tap POKEA on
   * the next beat — inside the 500ms window, where the stored slip still
   * carries the key minted for the PREVIOUS content. A phone killed in that
   * window comes back holding a key the server never saw, mints another, misses
   * the marker, and the branch receives the same crates twice. Writing from here
   * puts the write strictly ahead of the request that depends on it — AWAITED,
   * so "ahead" means the row is really down and not merely scheduled (`persist`
   * re-derives the body from the same refs in the same tick, so the key it
   * writes is the key `keyFor` just returned and the two can never disagree).
   *
   * …and a write the phone REFUSES (quota, private mode) blocks the send, the
   * same way the count's freeze gate does (`usePosCount.submit`). The write is
   * load-bearing, not bookkeeping: a phone that would not keep the key is
   * holding nothing to ask the server with, so sending anyway is the whole
   * failure written out — the POST lands, the answer is lost or the app is
   * evicted, the next entry finds no slip, mints a fresh key, misses the marker
   * and the same lorry is received a SECOND time. Two GRNs, two payables,
   * nothing linking them, and unlike a count (an absolute quantity a later
   * count corrects) a purchase is a delta that never self-heals. Nothing is
   * lost by stopping: the form stands, whatever the phone DOES hold is
   * untouched, the manager keeps the same verb — and she is told, in the
   * caller's words, because a badge quietly failing to appear is not telling.
   *
   * The commit flag is deliberately raised only AFTER the write lands, exactly
   * as the count adopts its key only once it is written down: a refused attempt
   * put nothing on the wire, so there is no marker for the key to be frozen
   * against, and the next edit is free to start a different delivery.
   */
  const sendKey = useCallback(async (): Promise<string | null> => {
    // `persist()` re-derives the body synchronously from the same refs, so the
    // key it writes is the key returned here — the two cannot disagree.
    const key = keyFor(buildBody());
    const saved = await persist();
    if (!saved) {
      // A verb that did not do what it says is a rejection, whoever refused it:
      // the same haptic and the same slab shake a server refusal gets (§4).
      rejectHaptic();
      setShake(true);
      return null;
    }
    committedRef.current = true;
    // The delivery can post while this write is still in flight, and
    // `completed()` deletes the slip the moment it does — a write that lands
    // after that would resurrect a dead one under a spent key. Same guard the
    // autosave timer carries, for the same reason.
    if (settledRef.current) forget();
    return key;
  }, [buildBody, forget, keyFor, persist]);

  // Auto-persist (§3.1): independent of any button, debounced off the edits
  // themselves — battery death must never cost twenty typed lines. This is
  // silent crash insurance; the acknowledged save is `save()` below.
  useEffect(() => {
    if (!purchasesEnabled || restoringRef.current || settledRef.current) return;
    if (!hasContent) {
      // An emptied form IS the discard ritual in v1 (§3.1 as amended by
      // critique D3): the slip goes and the key with it, so the next delivery
      // is a new delivery. A form that never held anything has nothing to drop.
      if (keyRef.current) forget();
      return;
    }
    const timer = window.setTimeout(() => {
      // The delivery posted while this timer was running: nothing changed the
      // effect's inputs, so only the flag can stop it re-parking a dead slip.
      if (settledRef.current) return;
      const draft = buildDraft();
      if (draft && slipSignature(draft) === savedSignatureRef.current) return;
      // A failed autosave costs the crash-recovery net, never the form in
      // hand, so it raises no haptic and no notice — the explicit save is where
      // failure SPEAKS. It is not invisible either: persist() drops `parked`,
      // so the badge and the "saved on this phone" line stop claiming custody
      // of lines this write did not keep.
      void persist();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [buildDraft, forget, hasContent, persist, purchaseCart, purchasesEnabled, supplier]);

  const enter = useCallback(() => {
    if (!enabledRef.current) return;
    settledRef.current = false;
    restoringRef.current = true;
    void (loadedRef.current ?? Promise.resolve()).then(() => {
      restoringRef.current = false;
      const draft = draftRef.current;
      if (!draft) {
        // A fresh Pokea with no slip behind it is a fresh delivery: any key
        // left over from an abandoned form-session must not ride into it.
        keyRef.current = null;
        committedRef.current = false;
        notesRef.current = undefined;
        return;
      }
      // Silent restore (§3.1 as amended by critique D3): no prompt, no expiry
      // gate — the restored form on screen IS the human review, and the
      // manager reviews it and taps POKEA. The parked key comes back so an
      // interrupted attempt resumes its own chain instead of opening a second.
      //
      // A restored slip counts as COMMITTED. Whether the session that parked
      // it ever tapped POKEA is not knowable here — the draft record has no
      // room for the flag and the phone may have died between the tap and the
      // response — and the two mistakes are not symmetric: freezing a key that
      // never left the phone costs nothing at all (no marker exists, so it can
      // carry any content), while re-minting one that did costs the branch a
      // delivery it never received. An unknown resolves to the safe side.
      notesRef.current = draft.notes;
      keyRef.current = { signature: payloadSignature(draft), key: draft.idempotencyKey };
      committedRef.current = true;
      savedSignatureRef.current = slipSignature(draft);
      setSupplierRef.current(
        draft.supplierId ? { id: draft.supplierId, name: draft.supplierName ?? '' } : null,
      );
      setPurchaseCartRef.current(draft.lines.map(restoreLine));
    });
  }, []);

  const save = useCallback(async () => {
    const saved = await persist();
    if (saved) {
      // Saving a slip is routine custody, not a celebration (§4): the 15ms
      // tick and nothing else — no stamp, no seal.
      tick();
      return true;
    }
    // Storage refused the write (quota, private mode). The whole point of the
    // kikaratasi is that offline work is held, so a slip lost in silence is
    // the one outcome this hook exists to prevent: the verb did NOT do what it
    // says, and that is a rejection — same haptic and same slab shake as a
    // server one (§4). The caller keeps the form on screen and says it in words.
    rejectHaptic();
    setShake(true);
    return false;
  }, [persist]);

  // The shake lives for one animation, then the slab is calm again.
  useEffect(() => {
    if (!shake) return;
    const timer = window.setTimeout(() => setShake(false), 400);
    return () => window.clearTimeout(timer);
  }, [shake]);

  const completed = useCallback(() => {
    settledRef.current = true;
    forget();
  }, [forget]);

  return { parked, hasContent, sendKey, enter, save, shake, completed };
}
