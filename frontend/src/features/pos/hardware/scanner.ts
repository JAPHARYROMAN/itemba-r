'use client';

import { useEffect, useRef } from 'react';
import type { MobilePosLiteProduct } from '@/lib/mobile-pos-lite-store';

/**
 * Hardware barcode scanners (USB or Bluetooth "keyboard wedge") type the code
 * as keystrokes and finish with Enter. A person cannot type that fast, so a
 * burst is told apart from typing by its speed alone
 * (POS_REMAKE_PLAN_2026-09-23.md section 6). Camera scanning stays excluded by
 * owner ruling D4.
 */
export const SCAN_MAX_KEY_GAP_MS = 50;
export const SCAN_MIN_LENGTH = 4;

export type ScanBuffer = { chars: string; lastAt: number; slow: boolean };

export function emptyScanBuffer(): ScanBuffer {
  return { chars: '', lastAt: 0, slow: false };
}

/**
 * Feed one key. Returns the next buffer and, on the terminating Enter of a
 * fast enough burst, the scanned code. Pure, so it is tested with exact times.
 */
export function feedScanKey(
  buffer: ScanBuffer,
  key: string,
  at: number,
): { buffer: ScanBuffer; code: string | null } {
  const gap = buffer.chars ? at - buffer.lastAt : 0;
  if (key === 'Enter') {
    const done = buffer.chars.length >= SCAN_MIN_LENGTH && !buffer.slow;
    return { buffer: emptyScanBuffer(), code: done ? buffer.chars : null };
  }
  if (key.length !== 1) return { buffer: emptyScanBuffer(), code: null };
  if (buffer.chars && gap > SCAN_MAX_KEY_GAP_MS) {
    // A pause: whatever came before was a person; start again from this key.
    return { buffer: { chars: key, lastAt: at, slow: false }, code: null };
  }
  return { buffer: { chars: buffer.chars + key, lastAt: at, slow: buffer.slow }, code: null };
}

/** An exact barcode (or product code) match, ignoring case and spaces. */
export function productForCode(
  catalog: readonly MobilePosLiteProduct[],
  code: string,
): MobilePosLiteProduct | undefined {
  const wanted = code.trim().toLocaleLowerCase();
  if (!wanted) return undefined;
  return (
    catalog.find((product) => product.barcode?.trim().toLocaleLowerCase() === wanted) ??
    catalog.find((product) => product.code.trim().toLocaleLowerCase() === wanted)
  );
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Listens for scanner bursts while focus is NOT in a text field. (In the POS
 * search box a scan is just typing that ends in Enter, which the search
 * handles itself; in any other field the scanner's keys belong to that field.)
 */
const performanceNow = () => performance.now();

export function useScanner(
  onScan: (code: string) => void,
  {
    enabled = true,
    now = performanceNow,
    acceptEvent,
  }: {
    enabled?: boolean;
    now?: () => number;
    acceptEvent?: (target: EventTarget | null) => boolean;
  } = {},
) {
  const buffer = useRef<ScanBuffer>(emptyScanBuffer());
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  });

  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      if (
        (acceptEvent && !acceptEvent(event.target)) ||
        isEditable(event.target) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        buffer.current = emptyScanBuffer();
        return;
      }
      const result = feedScanKey(buffer.current, event.key, now());
      buffer.current = result.buffer;
      if (result.code) {
        event.preventDefault();
        handler.current(result.code);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled, now, acceptEvent]);
}
