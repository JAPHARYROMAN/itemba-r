'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { backendGet } from '@/lib/api-client';
import {
  posDaylogDate,
  type MobilePosLiteBinding,
  type PendingMobilePosLiteSale,
} from '@/lib/mobile-pos-lite-store';
import { terminalHeaders } from '../pos-utils';

/**
 * Historia — the two 7-day read surfaces (spec-history-reports §1.1/§1.2/§3).
 * Kaunta-shell-only; the classic shell never calls either endpoint.
 *
 * NO SNAPSHOT STORE for either list, deliberately (§6). A cached sales or
 * purchase list is a storage cost with no offline story: the only part of the
 * sales history a rep can act on offline is her own outbox, which she already
 * has, and the purchase book has no local source at all. So offline shows what
 * is locally TRUE and says so, rather than showing yesterday's server answer
 * dressed as today's.
 *
 * THE COST-BLINDNESS LAW (§0) reaches this file too. The purchase payload type
 * below is the EXACT and COMPLETE key set the endpoint sends — 4 top-level
 * keys, 7 per purchase, 4 per line — and it carries no cost, total or value
 * field because there is none to carry. Do not widen it, do not sum a
 * quantity into money, and do not add a client-side total: a stolen manager's
 * phone must still reveal nothing about what this business pays its suppliers.
 */

/** The window is a SERVER constant; this mirror only bounds the local rows. */
export const POS_HISTORY_DAYS = 7;

/* ─── Payload shapes (the endpoint contracts, §1.1/§1.2) ──────────────────── */

export type PosSalesHistoryLine = {
  productId: string;
  name: string;
  quantity: number;
  unitSymbol: string;
  /**
   * Selling prices ride here ON PURPOSE: they are the same numbers the catalog
   * already caches on this phone and the receipt already prints, so this is no
   * new exposure — and a rep who cannot see what she charged cannot answer the
   * customer standing in front of her. `unitCostAtSale`, `cogsAmount`,
   * `grossProfitAmount` and `grossMarginPct` are never selected server-side and
   * have no place here.
   */
  unitPrice: number;
  lineTotal: number;
};

export type PosSalesHistorySale = {
  id: string;
  salesOrderNumber: string;
  createdAt: string;
  paymentMethod: string;
  paymentReference: string | null;
  customerName: string | null;
  totalAmount: number;
  lines: PosSalesHistoryLine[];
};

export type PosSalesHistory = {
  days: number;
  from: string;
  /** Exact and unbounded — from the server aggregate, never from `sales`. */
  count: number;
  totalAmount: number;
  /** Newest first, bounded server-side; truncation drops the OLDEST rows. */
  sales: PosSalesHistorySale[];
};

export type PosPurchaseHistoryLine = {
  productId: string;
  name: string;
  quantity: number;
  unitSymbol: string;
};

export type PosPurchaseHistoryPurchase = {
  id: string;
  purchaseOrderNumber: string;
  /** Null while the chain is INCOMPLETE — no GRN has been posted for it. */
  grnNumber: string | null;
  supplierName: string;
  /** PurchaseOrder.createdAt — the moment she tapped POKEA, which she remembers. */
  recordedAt: string;
  status: 'COMPLETE' | 'INCOMPLETE';
  lines: PosPurchaseHistoryLine[];
};

export type PosPurchaseHistory = {
  days: number;
  from: string;
  count: number;
  purchases: PosPurchaseHistoryPurchase[];
};

export type PosHistoryResource<T> = {
  data: T | null;
  loading: boolean;
  /** True after an online fetch failed; only meaningful without data. */
  failed: boolean;
  /** Screen open / online event / post-flush: always refetches when online. */
  refresh: () => void;
  /** Module pre-warm: fetches only when nothing has landed yet. */
  ensure: () => void;
};

/**
 * The first BUSINESS DAY in the window, as a `YYYY-MM-DD` key: six days back,
 * so "siku 7" means today plus the six before it.
 *
 * It is a day KEY rather than an instant on purpose. The server cuts its window
 * at midnight in the business timezone (§1.0.1) and `posDaylogDate` reads that
 * same zone, so comparing keys is comparing the same calendar the server used —
 * where device-local midnight would put the phone's held rows on a different
 * boundary from the server's sent rows in one merged list. Zero-padded
 * `YYYY-MM-DD` sorts as a date, so a string compare IS a date compare.
 */
export function historyWindowStart(now: Date = new Date()): string {
  return posDaylogDate(new Date(now.getTime() - (POS_HISTORY_DAYS - 1) * 24 * 60 * 60 * 1000));
}

/**
 * One row of the merged sales list — this is the whole answer to "is it still
 * queued locally?", and the answer is a CLIENT one: the server cannot know
 * what is sitting in a phone's outbox and its payload never pretends to.
 */
export type PosHistoryRow =
  | { kind: 'sent'; at: number; sale: PosSalesHistorySale }
  | { kind: 'held'; at: number; item: PendingMobilePosLiteSale };

/**
 * Merge the server's sent rows with this phone's outbox, newest first.
 *
 * Held rows are bounded to the same window and are NEVER counted into the
 * server's totals — the server's numbers are the server's, and the phone's are
 * labelled as the phone's. Exported as a pure function so the merge is
 * testable without a screen.
 */
export function mergeHistoryRows(
  sales: PosSalesHistorySale[],
  pending: PendingMobilePosLiteSale[],
  windowStart: string = historyWindowStart(),
): PosHistoryRow[] {
  const rows: PosHistoryRow[] = [];
  for (const sale of sales) {
    const at = new Date(sale.createdAt).getTime();
    rows.push({ kind: 'sent', at: Number.isNaN(at) ? 0 : at, sale });
  }
  for (const item of pending) {
    const at = new Date(item.createdAt).getTime();
    // An unparseable stamp is kept rather than dropped: a held sale is money in
    // custody, and hiding it because its clock is unreadable is the one
    // outcome the merge must not produce. It sorts to the bottom.
    if (!Number.isNaN(at) && posDaylogDate(new Date(at)) < windowStart) continue;
    rows.push({ kind: 'held', at: Number.isNaN(at) ? 0 : at, item });
  }
  return rows.sort((a, b) => b.at - a.at);
}

/** Held rows' declared money, from their frozen display snapshots. */
export function heldRowsTotal(pending: PendingMobilePosLiteSale[]): number {
  return pending.reduce((sum, item) => sum + Number(item.totalAmount ?? 0), 0);
}

/* ─── The fetchers ─────────────────────────────────────────────────────────── */

function useHistoryResource<T>({
  binding,
  path,
  enabled,
  active,
}: {
  binding: MobilePosLiteBinding;
  path: string;
  /** Permission gate: a route the session forbids is never called at all. */
  enabled: boolean;
  /** Whether the screen this backs is the one on the counter right now. */
  active: boolean;
}): PosHistoryResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const dataRef = useRef<T | null>(null);
  const inFlightRef = useRef(false);
  const enabledRef = useRef(enabled);
  const activeRef = useRef(active);
  useEffect(() => {
    enabledRef.current = enabled;
    activeRef.current = active;
  });

  const load = useCallback(
    async (force: boolean) => {
      if (!enabledRef.current) return;
      // Offline never fetches. There is no snapshot to fall back on, and the
      // screens say so in words rather than spinning at a dead network.
      if (!navigator.onLine) return;
      if (inFlightRef.current) return;
      if (!force && dataRef.current) return;
      inFlightRef.current = true;
      setLoading(true);
      setFailed(false);
      try {
        const response = await backendGet<T>(path, { headers: terminalHeaders(binding) });
        dataRef.current = response;
        setData(response);
      } catch {
        // Screen-level policy (§3.1/§3.2): online ⇒ the inline load-error card
        // with the shared Jaribu tena, refetching in place. Nothing stale is
        // ever shown in its stead, because nothing stale is kept.
        setFailed(true);
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [binding, path],
  );

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);
  const ensure = useCallback(() => {
    void load(false);
  }, [load]);

  // The `online` listener is the refetch offline is missing — which is why
  // neither screen carries a Retry button while offline: the network coming
  // back does it, and the ribbon already names the condition (spec-leo §2.3).
  useEffect(() => {
    const onOnline = () => {
      if (activeRef.current) void load(true);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [load]);

  return { data, loading, failed, refresh, ensure };
}

/** `GET /mobile-pos-lite/sales` — this rep's own 7 days (`.use`). */
export function usePosSalesHistory({
  binding,
  active,
}: {
  binding: MobilePosLiteBinding;
  active: boolean;
}): PosHistoryResource<PosSalesHistory> {
  return useHistoryResource<PosSalesHistory>({
    binding,
    path: '/mobile-pos-lite/sales',
    enabled: true,
    active,
  });
}

/**
 * `GET /mobile-pos-lite/purchases` — the BRANCH's 7-day receiving book, cost
 * free (`mobile_pos_lite.purchase`, the same manager gate that guards
 * recording a delivery). `enabled` is that gate: a rep's phone never issues
 * the request, so the screen behind it can never be reached by a 403.
 */
export function usePosPurchaseHistory({
  binding,
  purchasesEnabled,
  active,
}: {
  binding: MobilePosLiteBinding;
  purchasesEnabled: boolean;
  active: boolean;
}): PosHistoryResource<PosPurchaseHistory> {
  return useHistoryResource<PosPurchaseHistory>({
    binding,
    path: '/mobile-pos-lite/purchases',
    enabled: purchasesEnabled,
    active,
  });
}
