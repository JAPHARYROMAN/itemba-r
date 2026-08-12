/**
 * pos-receipt — the letterhead PDF share path (owner request, 2026-08-12).
 * Covers: terminal headers + no-store on the fetch, Content-Disposition
 * filename with the RISITI fallback, the null contract on a failed fetch
 * (which is what sends the orchestrator to the text share), the share-sheet /
 * download split, and the dismissed-sheet-still-counts rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobilePosLiteBinding } from '@/lib/mobile-pos-lite-store';
import {
  canShareReceiptFile,
  downloadReceiptFile,
  fetchReceiptPdf,
  sharePdfReceipt,
} from './pos-receipt';

const BINDING: MobilePosLiteBinding = {
  terminalCode: 'MPL-TEST',
  deviceSecret: 'secret-1',
  activatedAt: '2026-08-12T08:00:00.000Z',
};
const SALE = { id: 'sale-1', salesOrderNumber: 'SO-123', totalAmount: 2900 };

const fetchMock = vi.fn();

function pdfResponse(disposition?: string) {
  return {
    ok: true,
    headers: new Headers(disposition ? { 'Content-Disposition': disposition } : {}),
    blob: async () => new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, 'share');
  Reflect.deleteProperty(window.navigator, 'canShare');
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

/** jsdom has no object-URL support; patch the pair onto the real URL object. */
function stubObjectUrls() {
  const createObjectURL = vi.fn(() => 'blob:receipt');
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  return { createObjectURL, revokeObjectURL };
}

describe('fetchReceiptPdf', () => {
  it('requests the receipt with the terminal headers and no-store', async () => {
    fetchMock.mockResolvedValue(pdfResponse('inline; filename="RISITI-SO-123.pdf"'));
    const file = await fetchReceiptPdf(BINDING, SALE);
    expect(fetchMock).toHaveBeenCalledWith('/api/backend/mobile-pos-lite/sales/sale-1/receipt', {
      headers: { 'x-mobile-pos-terminal': 'MPL-TEST', 'x-mobile-pos-device': 'secret-1' },
      cache: 'no-store',
    });
    expect(file?.name).toBe('RISITI-SO-123.pdf');
    expect(file?.type).toBe('application/pdf');
  });

  it('falls back to a RISITI-<number>.pdf name without a disposition header', async () => {
    fetchMock.mockResolvedValue(pdfResponse());
    const file = await fetchReceiptPdf(BINDING, SALE);
    expect(file?.name).toBe('RISITI-SO-123.pdf');
  });

  it('returns null on a non-ok response so the caller can fall back to text', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, headers: new Headers() });
    await expect(fetchReceiptPdf(BINDING, SALE)).resolves.toBeNull();
  });
});

describe('canShareReceiptFile', () => {
  const file = new File(['%PDF'], 'RISITI.pdf', { type: 'application/pdf' });

  it('is false without navigator.share', () => {
    expect(canShareReceiptFile(file)).toBe(false);
  });

  it('is true with share but no canShare probe (older Androids)', () => {
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: vi.fn() });
    expect(canShareReceiptFile(file)).toBe(true);
  });

  it('honours a canShare probe that rejects files', () => {
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: vi.fn() });
    Object.defineProperty(window.navigator, 'canShare', {
      configurable: true,
      value: () => false,
    });
    expect(canShareReceiptFile(file)).toBe(false);
  });
});

describe('sharePdfReceipt', () => {
  it("hands the file to the share sheet and reports 'shared'", async () => {
    fetchMock.mockResolvedValue(pdfResponse('inline; filename="RISITI-SO-123.pdf"'));
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: share });
    await expect(sharePdfReceipt(BINDING, SALE)).resolves.toBe('shared');
    const call = share.mock.calls[0]?.[0] as { files: File[]; title: string };
    expect(call.files[0]?.name).toBe('RISITI-SO-123.pdf');
    expect(call.title).toBe('RISITI-SO-123.pdf');
  });

  it("still reports 'shared' when the user dismisses the sheet", async () => {
    fetchMock.mockResolvedValue(pdfResponse());
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new DOMException('canceled', 'AbortError')),
    });
    await expect(sharePdfReceipt(BINDING, SALE)).resolves.toBe('shared');
  });

  it("downloads and reports 'downloaded' where files cannot be shared", async () => {
    fetchMock.mockResolvedValue(pdfResponse());
    const { createObjectURL } = stubObjectUrls();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(sharePdfReceipt(BINDING, SALE)).resolves.toBe('downloaded');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('returns null when the PDF fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, headers: new Headers() });
    await expect(sharePdfReceipt(BINDING, SALE)).resolves.toBeNull();
  });
});

describe('downloadReceiptFile', () => {
  it('clicks a temporary object-URL anchor and schedules the revoke', () => {
    vi.useFakeTimers();
    const { revokeObjectURL } = stubObjectUrls();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadReceiptFile(new File(['%PDF'], 'RISITI-SO-9.pdf', { type: 'application/pdf' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:receipt');
    click.mockRestore();
    vi.useRealTimers();
  });
});
