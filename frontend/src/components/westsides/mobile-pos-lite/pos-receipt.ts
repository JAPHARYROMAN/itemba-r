/**
 * Letterhead PDF receipt sharing (owner request, 2026-08-12): a completed sale
 * that the server has confirmed can be shared as a branded PDF fetched from
 * GET /mobile-pos-lite/sales/:id/receipt. Held (offline-queued) sales have no
 * server id yet, so the orchestrator falls back to the plain-text share — the
 * text path remains the custody-safe default whenever this module returns null.
 *
 * Raw fetch (not backendGet) because the response is PDF bytes, not the JSON
 * envelope — same pattern as lib/export-download.ts.
 */
import { filenameFromDisposition } from '@/lib/export-download';
import type { MobilePosLiteBinding } from '@/lib/mobile-pos-lite-store';
import type { SaleResult } from './pos-types';
import { terminalHeaders } from './pos-utils';

export async function fetchReceiptPdf(
  binding: MobilePosLiteBinding,
  sale: SaleResult,
): Promise<File | null> {
  const res = await fetch(`/api/backend/mobile-pos-lite/sales/${sale.id}/receipt`, {
    headers: terminalHeaders(binding),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const fallback = `RISITI-${sale.salesOrderNumber ?? sale.receiptNumber ?? sale.id}.pdf`;
  const name = filenameFromDisposition(res.headers.get('Content-Disposition'), fallback);
  return new File([await res.blob()], name, { type: 'application/pdf' });
}

/** File-capable native share sheet (WhatsApp/SMS attachments on Android). */
export function canShareReceiptFile(file: File) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  return !navigator.canShare || navigator.canShare({ files: [file] });
}

export function downloadReceiptFile(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

/**
 * Deliver the letterhead PDF via the share sheet, or download it where files
 * can't be shared (desktop browsers). Returns null when the PDF could not be
 * fetched so the caller can fall back to the text receipt; a share sheet the
 * user dismissed still counts as 'shared' (nothing to surface).
 */
export async function sharePdfReceipt(
  binding: MobilePosLiteBinding,
  sale: SaleResult,
): Promise<'shared' | 'downloaded' | null> {
  const file = await fetchReceiptPdf(binding, sale);
  if (!file) return null;
  if (canShareReceiptFile(file)) {
    await navigator.share({ files: [file], title: file.name }).catch(() => undefined);
    return 'shared';
  }
  downloadReceiptFile(file);
  return 'downloaded';
}
