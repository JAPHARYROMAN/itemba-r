'use client';

import type { MobilePosLiteBinding, PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import type { DaySummary, PosScreen, PosTranslate } from '../pos-types';
import { MySalesScreen } from './MySalesScreen';
import { QueueScreen } from './QueueScreen';

/** The anchor the `#leo/foleni` deep link (and slab sync token) scrolls to. */
export const LEO_FOLENI_ANCHOR_ID = 'leo-foleni';

/**
 * Leo — the Kaunta day-book, minimal Phase 2b wrapper (design direction §3:
 * home's contents move here). Composes the extracted screens unchanged:
 * MySalesScreen (day summary + sent list) with the QueueScreen pending group
 * as the `#leo/foleni` anchor target beneath it, hidden entirely when the
 * outbox is clean (a clean book shows no empty pending shelf — spec-leo §1.4).
 * The full day-book ritual visuals (ruled lines, tally row, reconciliation
 * line, pending-before-sent ordering via the daylog store) are Phase 3.
 */
export function LeoScreen({
  shellClass,
  binding,
  online,
  dayLoading,
  daySummary,
  syncing,
  pendingSales,
  pendingCount,
  confirmRemoveId,
  setConfirmRemoveId,
  syncPendingSales,
  removePending,
  t,
  setScreen,
}: {
  shellClass: string;
  binding: MobilePosLiteBinding;
  online: boolean;
  dayLoading: boolean;
  daySummary: DaySummary | null;
  syncing: boolean;
  pendingSales: PendingMobilePosLiteSale[];
  pendingCount: number;
  confirmRemoveId: string | null;
  setConfirmRemoveId: (id: string | null) => void;
  syncPendingSales: (current: MobilePosLiteBinding) => Promise<void>;
  removePending: (id: string) => Promise<void>;
  t: PosTranslate;
  setScreen: (screen: PosScreen) => void;
}) {
  return (
    <main
      className={`min-h-screen px-4 py-4${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
      <MySalesScreen
        slabMode
        shellClass=""
        online={online}
        dayLoading={dayLoading}
        daySummary={daySummary}
        t={t}
        setScreen={setScreen}
      />
      {pendingCount > 0 && (
        <section id={LEO_FOLENI_ANCHOR_ID} className="mt-8">
          <QueueScreen
            slabMode
            shellClass=""
            binding={binding}
            online={online}
            syncing={syncing}
            pendingSales={pendingSales}
            pendingCount={pendingCount}
            confirmRemoveId={confirmRemoveId}
            setConfirmRemoveId={setConfirmRemoveId}
            syncPendingSales={syncPendingSales}
            removePending={removePending}
            t={t}
            setScreen={setScreen}
          />
        </section>
      )}
    </main>
  );
}
