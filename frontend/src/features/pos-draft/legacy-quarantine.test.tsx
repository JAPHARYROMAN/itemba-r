import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import { LegacyQuarantine } from './legacy-quarantine';

const h = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    backendList: (...args: unknown[]) => h.list(...args),
    backendGet: (...args: unknown[]) => h.get(...args),
  };
});
const references = [
  { id: 'paused', code: 'MPL-PAUSED', name: 'Earlier till' },
  { id: 'revoked', code: 'MPL-REVOKED', name: 'Replaced till' },
];
const capture = (terminalCode: string, identity: string): PendingMobilePosLiteSale => ({
  id: `local-${identity}`,
  terminalCode,
  createdAt: '2026-10-04T10:00:00Z',
  lineSummary: `Saved ${identity}`,
  totalAmount: 100,
  payload: {
    paymentMethod: 'CASH',
    idempotencyKey: identity,
    expectedTotal: 100,
    lines: [{ productId: 'product', quantity: 1, unitPrice: 100 }],
  },
});

function legacyStorage(rows?: PendingMobilePosLiteSale[]) {
  const close = vi.fn();
  const abort = vi.fn();
  const transaction = vi.fn(() => {
    const tx: any = {
      objectStore: vi.fn(() => ({
        getAll: () => {
          const read: any = { result: rows };
          queueMicrotask(() => {
            read.onsuccess?.();
            tx.oncomplete?.();
          });
          return read;
        },
      })),
    };
    return tx;
  });
  const open = vi.fn(() => {
    const request: any = {
      result: {
        close,
        transaction,
        objectStoreNames: { contains: (name: string) => name === 'outbox' },
      },
      transaction: { abort },
    };
    queueMicrotask(() => {
      if (rows) request.onsuccess?.();
      else {
        request.onupgradeneeded?.();
        request.onerror?.();
      }
    });
    return request;
  });
  vi.stubGlobal('indexedDB', { open });
  return { open, transaction, close, abort };
}

beforeEach(() => {
  h.list.mockReset();
  h.get.mockReset();
  h.list.mockResolvedValue(references);
  h.get.mockResolvedValue({
    state: 'posted',
    postedEntityType: 'SalesOrder',
    postedEntityId: 'sale',
    recordStatus: 'PAID',
  });
});

describe('scoped legacy capture reconciliation', () => {
  it('reads only scoped historical references and retains each saved original identity without replay', async () => {
    const rows = [
      capture('MPL-PAUSED', 'original-paused'),
      capture('MPL-REVOKED', 'original-revoked'),
      capture('MPL-FOREIGN', 'foreign'),
    ];
    const original = JSON.stringify(rows);
    const storage = legacyStorage(rows);
    render(<LegacyQuarantine />);
    await screen.findByText('Saved original-paused');
    expect(screen.getByText('Saved original-revoked')).toBeVisible();
    expect(screen.queryByText('Saved foreign')).not.toBeInTheDocument();
    expect(h.list).toHaveBeenCalledWith(
      '/pos-drafts/legacy-terminals',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(storage.transaction).toHaveBeenCalledWith('outbox', 'readonly');
    expect(
      screen
        .getAllByLabelText('Original request identity')
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['original-paused', 'original-revoked']);
    await userEvent
      .setup()
      .click(screen.getAllByRole('button', { name: 'Check original request' })[0]);
    await screen.findByText('An existing SalesOrder was found. PAID');
    expect(h.get).toHaveBeenCalledWith('/pos-drafts/legacy-outcome', {
      query: { terminalId: 'paused', requestId: 'original-paused' },
    });
    expect(JSON.stringify(rows)).toBe(original);
    expect(storage.close).toHaveBeenCalledOnce();
  });

  it('does not create a legacy database or display a warning on a fresh device', async () => {
    const storage = legacyStorage();
    render(<LegacyQuarantine />);
    await waitFor(() => expect(storage.abort).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Legacy captures requiring reconciliation' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(storage.open).toHaveBeenCalledWith('itemba-mobile-pos-lite');
    expect(storage.transaction).not.toHaveBeenCalled();
  });

  it('preserves local captures without opening their store when terminal access is denied', async () => {
    const rows = [capture('MPL-PAUSED', 'original-paused')];
    const original = JSON.stringify(rows);
    const storage = legacyStorage(rows);
    h.list.mockRejectedValue(new ApiError('Forbidden', 403, null));
    render(<LegacyQuarantine />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Its saved requests remain on this device',
    );
    expect(storage.open).not.toHaveBeenCalled();
    expect(h.get).not.toHaveBeenCalled();
    expect(JSON.stringify(rows)).toBe(original);
  });
});
