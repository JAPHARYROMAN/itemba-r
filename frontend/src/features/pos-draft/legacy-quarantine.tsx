'use client';
import { useEffect, useState } from 'react';
import { backendGet, backendList } from '@/lib/api-client';
import type { PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import { money } from './types';

// Cutover never runs the former outbox or changes its original request identities.
export async function readLegacyCaptures(
  authorizedCodes: Set<string>,
): Promise<PendingMobilePosLiteSale[]> {
  if (!('indexedDB' in globalThis)) return [];
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('itemba-mobile-pos-lite');
    let absent = false;
    request.onupgradeneeded = () => {
      absent = true;
      request.transaction?.abort();
    };
    request.onerror = () => (absent ? resolve([]) : reject(request.error));
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('outbox')) {
        database.close();
        resolve([]);
        return;
      }
      const tx = database.transaction('outbox', 'readonly');
      const read = tx.objectStore('outbox').getAll();
      read.onsuccess = () =>
        resolve(
          (read.result as PendingMobilePosLiteSale[]).filter((row) =>
            authorizedCodes.has(row.terminalCode),
          ),
        );
      read.onerror = () => reject(read.error);
      tx.oncomplete = () => database.close();
    };
  });
}
export function LegacyQuarantine() {
  const [rows, setRows] = useState<PendingMobilePosLiteSale[]>([]);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(false);
  const [terminals, setTerminals] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [busy, setBusy] = useState('');
  const [outcomes, setOutcomes] = useState<
    Record<
      string,
      { state: string; postedEntityType?: string; postedEntityId?: string; recordStatus?: string }
    >
  >({});
  useEffect(() => {
    const controller = new AbortController();
    void backendList<{ id: string; code: string; name: string }>('/mobile-pos-lite/terminals', {
      signal: controller.signal,
    })
      .then((terminals) => {
        if (!controller.signal.aborted) setTerminals(terminals);
        return readLegacyCaptures(new Set(terminals.map((terminal) => terminal.code)));
      })
      .then((values) => {
        if (!controller.signal.aborted) {
          setRows(values);
          setChecked(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'The legacy queue could not be checked. Its saved requests remain on this device.',
          );
      });
    return () => controller.abort();
  }, []);
  async function check(row: PendingMobilePosLiteSale) {
    const terminal = terminals.find((terminal) => terminal.code === row.terminalCode);
    if (!terminal) return;
    setBusy(row.id);
    setError('');
    try {
      const outcome = await backendGet<{
        state: string;
        postedEntityType?: string;
        postedEntityId?: string;
        recordStatus?: string;
      }>('/pos-drafts/legacy-outcome', {
        query: { terminalId: terminal.id, requestId: row.payload.idempotencyKey || row.id },
      });
      setOutcomes((current) => ({ ...current, [row.id]: outcome }));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not check the original identity.');
    } finally {
      setBusy('');
    }
  }
  if (!rows.length && checked) return null;
  return (
    <section className="pd-legacy-queue" aria-label="Legacy captures requiring reconciliation">
      <h3>Earlier captures on this device</h3>
      <p className="pd-notice">
        These requests are held for admin reconciliation. Check the original request identity
        against the existing posted sale before capturing anything again.
      </p>
      {error ? (
        <p role="alert" className="pd-error">
          {error}
        </p>
      ) : !checked ? (
        <p role="status">Checking the earlier queue…</p>
      ) : (
        rows.map((row) => (
          <article className="pd-local-request" key={row.id}>
            <strong>
              {row.lineSummary ?? `Sale · ${row.itemCount ?? row.payload.lines.length} items`}
            </strong>
            <span>
              {money(row.totalAmount ?? row.payload.expectedTotal)} ·{' '}
              {new Date(row.createdAt).toLocaleString()}
            </span>
            <small>
              Terminal ·{' '}
              {terminals.find((terminal) => terminal.code === row.terminalCode)?.name ??
                row.terminalCode}
            </small>
            <label className="pd-field">
              Original request identity
              <input
                readOnly
                value={row.payload.idempotencyKey || row.id}
                onFocus={(event) => event.target.select()}
              />
            </label>
            {row.lastError && <p className="pd-muted">{row.lastError}</p>}
            {outcomes[row.id] && (
              <p role="status" className="pd-notice">
                {outcomes[row.id].state === 'posted'
                  ? `An existing ${outcomes[row.id].postedEntityType ?? 'document'} was found. ${outcomes[row.id].recordStatus ?? ''}`
                  : outcomes[row.id].state === 'not_found'
                    ? 'No posted record was found for this identity. Reconcile this saved capture before entering it again.'
                    : `Status: ${outcomes[row.id].state.replaceAll('_', ' ')}. Review the existing records before entering it again.`}
              </p>
            )}
            <button className="pd-button" disabled={!!busy} onClick={() => void check(row)}>
              {busy === row.id ? 'Checking…' : 'Check original request'}
            </button>
            <a href="/sales-desk?view=sales" className="pd-button">
              Review existing sales
            </a>
          </article>
        ))
      )}
    </section>
  );
}
