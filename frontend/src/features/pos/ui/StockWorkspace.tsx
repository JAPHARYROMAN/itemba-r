'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import type { usePosStock } from '../core/hooks/use-pos-stock';
import type { PosShellProps } from './PosShell';
import type { PosStep } from './use-pos-step';
import { pendingTime } from '../core/pos-utils';

export function StockWorkspace({
  props,
  active,
  go,
  snapshot,
  loading,
  loadFailed,
  refresh,
}: ReturnType<typeof usePosStock> & {
  props: PosShellProps;
  active: boolean;
  go: (step: PosStep) => void;
}) {
  const { t, online, session } = props;
  const id = useId();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [active]);
  const items = useMemo(
    () =>
      (snapshot?.items ?? []).filter(
        (item) =>
          [item.name, item.code, item.barcode].some((value) =>
            value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
          ) &&
          (filter === 'all' ||
            (filter === 'low'
              ? item.status === 'LOW_STOCK'
              : item.status === 'OUT_OF_STOCK' || item.status === 'OVERSOLD')),
      ),
    [snapshot, query, filter],
  );
  const detail = snapshot?.items.find((item) => item.productId === selected);
  const stale = !online || !snapshot || now - snapshot.fetchedAt >= 10 * 60 * 1000 || loadFailed;
  return (
    <section className="pos-full pos-records">
      <div className="pos-section-head">
        <div>
          <h1>{t('posBranchStock')}</h1>
          <p className="pos-hint">
            {session.branch.name} · {t('posStockDescription')}
          </p>
        </div>
        <div className="pos-actions">
          {session.purchasesEnabled && (
            <button
              type="button"
              className="pos-btn pos-btn-primary"
              onClick={() => go('receiving')}
            >
              {t('posReceiveStock')}
            </button>
          )}
          {session.stockCountsEnabled && (
            <button
              type="button"
              className="pos-btn"
              disabled={props.pendingCount > 0 || !snapshot}
              onClick={() => go('counts')}
            >
              {t('countStart')}
            </button>
          )}
        </div>
      </div>
      <div className="pos-control-strip" role="status">
        <span>
          {snapshot
            ? `${t(stale ? 'posSnapshotStale' : 'posSnapshotCurrent')} · ${pendingTime(snapshot.asOf)}`
            : t('stockLoadError')}
        </span>
        <button type="button" className="pos-btn" disabled={!online || loading} onClick={refresh}>
          {loading ? t('loading') : t('refresh')}
        </button>
      </div>
      {props.pendingCount > 0 && (
        <p className="pos-note" data-tone="warn">
          {t('countQueueGate')}
        </p>
      )}
      <div className="pos-record-filters">
        <label className="pos-field" htmlFor={id + '-query'}>
          {t('posSearchStock')}
          <input
            id={id + '-query'}
            className="pos-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
          />
        </label>
        <label className="pos-field" htmlFor={id + '-filter'}>
          {t('posStockStatus')}
          <select
            id={id + '-filter'}
            className="pos-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">{t('all')}</option>
            <option value="low">{t('posLowStockFilter')}</option>
            <option value="out">{t('posUnavailableFilter')}</option>
          </select>
        </label>
      </div>
      {!snapshot ? (
        <p className="pos-note" data-tone="warn">
          {t(loading ? 'loading' : loadFailed ? 'stockLoadError' : 'posNoStockSnapshot')}
        </p>
      ) : (
        <div className="pos-record-grid">
          <div className="pos-panel">
            <div className="pos-panel-head">
              <strong>{t('posStockProducts', { count: items.length })}</strong>
            </div>
            {items.map((item) => (
              <button
                key={item.productId}
                type="button"
                className="pos-record-row"
                aria-pressed={selected === item.productId}
                onClick={() => setSelected(item.productId)}
              >
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.code} ·{' '}
                    {t(
                      item.status === 'IN_STOCK'
                        ? 'posStockAvailable'
                        : item.status === 'LOW_STOCK'
                          ? 'posLowStockFilter'
                          : 'posUnavailableFilter',
                    )}
                  </small>
                </span>
                <span>
                  <strong className="pos-num">
                    {session.stockCountsEnabled
                      ? item.available.toLocaleString()
                      : Math.max(0, item.available).toLocaleString()}
                  </strong>
                  <small>{item.unitSymbol}</small>
                </span>
              </button>
            ))}
            {!items.length && <p className="pos-empty">{t('noProducts')}</p>}
          </div>
          <aside className="pos-panel pos-record-detail" aria-label={t('posStockDetails')}>
            {detail ? (
              <>
                <h2>{detail.name}</h2>
                <p className="pos-hint">
                  {detail.code} {detail.barcode ? `· ${detail.barcode}` : ''}
                </p>
                <dl className="pos-definition">
                  <div>
                    <dt>{t('posAvailable')}</dt>
                    <dd>
                      {Math.max(0, detail.available).toLocaleString()} {detail.unitSymbol}
                    </dd>
                  </div>
                  {session.stockCountsEnabled && (
                    <>
                      <div>
                        <dt>{t('posOnHand')}</dt>
                        <dd>
                          {detail.quantityOnHand.toLocaleString()} {detail.unitSymbol}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('posReserved')}</dt>
                        <dd>
                          {detail.quantityReserved.toLocaleString()} {detail.unitSymbol}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
                <p className="pos-hint">{t('posSnapshotNote')}</p>
              </>
            ) : (
              <p className="pos-empty">{t('posSelectStock')}</p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
