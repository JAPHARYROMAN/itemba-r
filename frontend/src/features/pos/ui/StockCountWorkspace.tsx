'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { backendGet } from '@/lib/api-client';
import { usePosCount, COUNT_MAX_LINES, COUNT_LIMIT_WARN_WINDOW } from '../core/hooks/use-pos-count';
import type { usePosStock } from '../core/hooks/use-pos-stock';
import { usePosWindowGuard } from '../core/use-pos-window-guard';
import { terminalHeaders, pendingTime } from '../core/pos-utils';
import { posErrorMessage } from '../core/pos-errors';
import type { PosShellProps } from './PosShell';
import { OperationReview } from './OperationReview';

type CountHistory = {
  count: number;
  truncated: boolean;
  counts: Array<{
    id: string;
    adjustmentNumber: string;
    status: string;
    createdAt: string;
    lines: Array<{
      productId: string;
      systemQuantity: number;
      countedQuantity: number;
      varianceQuantity: number;
    }>;
  }>;
};

export function StockCountWorkspace({
  props,
  active,
  stock,
  visibleProducts,
  onBusy,
}: {
  props: PosShellProps;
  active: boolean;
  stock: ReturnType<typeof usePosStock>;
  visibleProducts: ReadonlyMap<string, string> | null;
  onBusy: (busy: boolean) => void;
}) {
  const { t, online, pendingCount } = props;
  const count = usePosCount({ binding: props.binding, online, visibleProducts });
  const id = useId();
  const entered = useRef(false);
  const [opening, setOpening] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [discard, setDiscard] = useState(false);
  const [largeConfirmed, setLargeConfirmed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CountHistory | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const enter = count.enter;
  useEffect(() => {
    if (!active || entered.current) return;
    entered.current = true;
    void enter().finally(() => setOpening(false));
  }, [active, enter]);
  useEffect(() => {
    onBusy(count.submitting || (count.step !== 'done' && count.countedCount > 0));
    return () => onBusy(false);
  }, [count.submitting, count.step, count.countedCount, onBusy]);
  usePosWindowGuard(
    count.submitting ||
      (count.step !== 'done' && count.countedCount > 0 && count.draftKept !== true),
  );
  const sorted = useMemo(
    () => [...(stock.snapshot?.items ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [stock.snapshot],
  );
  const visible = sorted.filter((item) =>
    [item.name, item.code, item.barcode].some((value) =>
      value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ),
  );
  const counted = sorted.filter((item) => item.productId in count.lines);
  const variance = counted.reduce(
    (sum, item) => sum + Math.abs(count.lines[item.productId] - item.quantityOnHand),
    0,
  );
  const blocked = count.blocked || pendingCount > 0 || opening || !!count.draftOffer;
  async function loadHistory() {
    if (!online || historyLoading) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      setHistory(
        await backendGet<CountHistory>('/mobile-pos-lite/stock-counts', {
          headers: terminalHeaders(props.binding),
        }),
      );
    } catch (error) {
      setHistoryError(posErrorMessage(error instanceof Error ? error.message : '', t));
    } finally {
      setHistoryLoading(false);
    }
  }
  return (
    <section className="pos-full pos-records">
      <div className="pos-section-head">
        <div>
          <h1>{t('countTitle')}</h1>
          <p className="pos-hint">
            {props.session.branch.name} · {t('posBlindCount')}
          </p>
        </div>
        <button
          type="button"
          className="pos-btn"
          disabled={count.submitting}
          onClick={() => {
            setHistoryOpen((value) => !value);
            if (!historyOpen) void loadHistory();
          }}
        >
          {t('posCountHistory')}
        </button>
      </div>
      {historyOpen ? (
        <section className="pos-panel pos-record-detail">
          <div className="pos-section-head">
            <h2>{t('posCountHistory')}</h2>
            <button
              className="pos-btn"
              type="button"
              disabled={!online || historyLoading}
              onClick={() => void loadHistory()}
            >
              {t('refresh')}
            </button>
          </div>
          {!online && (
            <p className="pos-note" data-tone="warn">
              {t('posOnlineHistory')}
            </p>
          )}
          {historyError && <p role="alert">{historyError}</p>}
          {online &&
            history?.counts.map((row) => (
              <details key={row.id} className="pos-delivery-line">
                <summary>
                  {row.adjustmentNumber} ·{' '}
                  {row.status === 'POSTED'
                    ? t('countDone')
                    : row.status === 'PENDING_APPROVAL'
                      ? t('countPendingApproval')
                      : row.status}{' '}
                  · {pendingTime(row.createdAt)}
                </summary>
                <dl className="pos-definition">
                  {row.lines.map((line) => (
                    <div key={line.productId}>
                      <dt>{visibleProducts?.get(line.productId) ?? line.productId}</dt>
                      <dd>
                        {line.countedQuantity} · {t('countVariance')}{' '}
                        {line.varianceQuantity > 0 ? '+' : ''}
                        {line.varianceQuantity}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
          {online && !history?.counts.length && (
            <p>{t(historyLoading ? 'loading' : 'posNoCounts')}</p>
          )}
          {history?.truncated && <p className="pos-hint">{t('posHistoryTruncated')}</p>}
        </section>
      ) : (
        <>
          {opening && (
            <p className="pos-note" role="status">
              {t('posDraftOpening')}
            </p>
          )}
          {count.draftOffer && (
            <section className="pos-panel pos-record-detail">
              <h2>{t('countResumeDraft')}</h2>
              <p>
                {t('countCapturedAt', {
                  time: pendingTime(new Date(count.draftOffer.capturedAt).toISOString()),
                })}
              </p>
              <div className="pos-actions">
                <button
                  className="pos-btn pos-btn-primary"
                  type="button"
                  onClick={count.resumeDraft}
                >
                  {t('countResumeDraft')}
                </button>
                <button
                  type="button"
                  className="pos-btn"
                  disabled={!!count.draftOffer.idempotencyKey}
                  onClick={() => setDiscard(true)}
                >
                  {t('countDiscardDraft')}
                </button>
              </div>
            </section>
          )}
          {pendingCount > 0 && (
            <p className="pos-note" data-tone="warn">
              {t('countQueueGate')}
            </p>
          )}
          {!online && (
            <p className="pos-note" data-tone="warn">
              {t('posCountOffline')}
            </p>
          )}
          {count.attempted && count.step !== 'done' && (
            <p className="pos-note" data-tone="warn">
              {t('posOriginalStockRequest')}
            </p>
          )}
          {count.draftKept !== null && (
            <p className="pos-note" data-tone={count.draftKept ? 'ok' : 'warn'} role="status">
              {t(count.draftKept ? 'posCountSaved' : 'countDraftSaveFailed')}
            </p>
          )}
          {count.countedCount >= COUNT_MAX_LINES - COUNT_LIMIT_WARN_WINDOW && (
            <p className="pos-note" data-tone="warn">
              {t(count.overLimit ? 'countLimitReached' : 'countLimitNear', {
                count: COUNT_MAX_LINES,
              })}
            </p>
          )}
          {!stock.snapshot && (
            <div className="pos-control-strip">
              <span>{t('countStockNotLoaded')}</span>
              <button
                type="button"
                className="pos-btn"
                disabled={!online || stock.loading}
                onClick={stock.refresh}
              >
                {t(stock.loading ? 'loading' : 'tryAgain')}
              </button>
            </div>
          )}
          {count.unresolved.length > 0 && (
            <section className="pos-panel pos-record-detail">
              <p className="pos-note" data-tone="warn">
                {t('countLinesGone')}
              </p>
              {count.unresolved.map((line) => (
                <div key={line.productId} className="pos-section-head">
                  <strong>
                    {line.name} · {line.countedQuantity}
                  </strong>
                  <button
                    type="button"
                    className="pos-btn"
                    disabled={count.submitting || count.attempted}
                    onClick={() => count.setLine(line.productId, null)}
                  >
                    {t('remove')}
                  </button>
                </div>
              ))}
            </section>
          )}
          {count.step === 'done' && count.result ? (
            <section className="pos-panel pos-record-detail" role="status">
              <h2>{t(count.result.status === 'POSTED' ? 'countDone' : 'countPendingApproval')}</h2>
              <p>
                {count.result.adjustmentNumber} · {count.result.status}
              </p>
              <dl className="pos-definition">
                {count.result.lines.map((line) => (
                  <div key={line.productId}>
                    <dt>{visibleProducts?.get(line.productId) ?? line.productId}</dt>
                    <dd>
                      {line.countedQuantity} · {t('countVariance')} {line.varianceQuantity}
                    </dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                className="pos-btn"
                onClick={() => {
                  count.startNewCount();
                  stock.refresh();
                }}
              >
                {t('countStartNew')}
              </button>
            </section>
          ) : (
            <>
              {count.step === 'entry' && (
                <label className="pos-field" htmlFor={id + '-search'}>
                  {t('posSearchStock')}
                  <input
                    className="pos-input"
                    type="search"
                    id={id + '-search'}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0);
                    }}
                  />
                </label>
              )}
              <fieldset
                className="pos-operation-fieldset"
                disabled={opening || !!count.draftOffer || count.submitting || pendingCount > 0}
              >
                <section className="pos-panel">
                  <div className="pos-panel-head">
                    <strong>{t('countProgress', { count: count.countedCount })}</strong>
                    <span>
                      {count.step === 'review' ? t('countPreviewNote') : t('posCountEmptyNote')}
                    </span>
                  </div>
                  {count.step === 'entry'
                    ? visible.slice(page * 50, (page + 1) * 50).map((item) => (
                        <div className="pos-count-row" key={count.revision + item.productId}>
                          <span>
                            <strong>{item.name}</strong>
                            <small>
                              {item.code} · {item.unitSymbol}
                            </small>
                          </span>
                          <label className="pos-field" htmlFor={id + item.productId}>
                            <span className="pos-sr">
                              {t('posCountQuantity')} {item.name}
                            </span>
                            <input
                              id={id + item.productId}
                              className="pos-input pos-num"
                              type="number"
                              inputMode="numeric"
                              min="0"
                              max="1000000"
                              step="1"
                              placeholder={t('countNotCounted')}
                              disabled={count.attempted}
                              value={count.lines[item.productId] ?? ''}
                              onChange={(e) => {
                                const text = e.target.value;
                                if (text === '') count.setLine(item.productId, null);
                                else {
                                  const value = Number(text);
                                  if (Number.isInteger(value) && value >= 0 && value <= 1000000)
                                    count.setLine(item.productId, value);
                                }
                              }}
                            />
                          </label>
                        </div>
                      ))
                    : counted.map((item) => (
                        <div className="pos-count-row" key={item.productId}>
                          <span>
                            <strong>{item.name}</strong>
                            <small>
                              {t('posOnHand')} {item.quantityOnHand} · {t('countVariance')}{' '}
                              {count.lines[item.productId] - item.quantityOnHand}
                            </small>
                          </span>
                          <strong className="pos-num">
                            {count.lines[item.productId]} {item.unitSymbol}
                          </strong>
                        </div>
                      ))}
                  {count.step === 'entry' && visible.length > 50 && (
                    <div className="pos-actions pos-operation-actions">
                      <button
                        type="button"
                        className="pos-btn"
                        disabled={page === 0}
                        onClick={() => setPage((value) => value - 1)}
                      >
                        {t('posPreviousProducts')}
                      </button>
                      <span>
                        {page + 1} / {Math.ceil(visible.length / 50)}
                      </span>
                      <button
                        type="button"
                        className="pos-btn"
                        disabled={(page + 1) * 50 >= visible.length}
                        onClick={() => setPage((value) => value + 1)}
                      >
                        {t('posNextProducts')}
                      </button>
                    </div>
                  )}
                </section>
                {count.capturedAt && (
                  <p className="pos-hint">
                    {t('countCapturedAt', {
                      time: pendingTime(new Date(count.capturedAt).toISOString()),
                    })}
                  </p>
                )}
                <div className="pos-actions pos-operation-actions">
                  <button
                    type="button"
                    className="pos-btn"
                    disabled={count.countedCount === 0 || count.attempted}
                    onClick={() => setDiscard(true)}
                  >
                    {t('countStartNew')}
                  </button>
                  {count.step === 'review' ? (
                    <>
                      <button type="button" className="pos-btn" onClick={count.backToEntry}>
                        {t('back')}
                      </button>
                      <button
                        type="button"
                        className="pos-btn pos-btn-primary"
                        disabled={blocked || !online}
                        onClick={() => {
                          setLargeConfirmed(false);
                          count.openConfirm();
                        }}
                      >
                        {t('countSubmit')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="pos-btn pos-btn-primary"
                      disabled={blocked || !count.countedCount}
                      onClick={count.openReview}
                    >
                      {t('countReview')}
                    </button>
                  )}
                </div>
              </fieldset>
            </>
          )}
          {count.needsNetwork && (
            <p role="alert" className="pos-note" data-tone="warn">
              {t('countNeedsNetwork')}
            </p>
          )}
          {count.errorRaw && (
            <p role="alert" className="pos-note" data-tone="warn">
              {posErrorMessage(count.errorRaw, t)}{' '}
              {t(
                count.refusal === 'sheet'
                  ? 'posCountCorrectSheet'
                  : count.refusal === 'recount'
                    ? 'posCountRecount'
                    : 'countSendFailedRetry',
              )}
            </p>
          )}
          {count.confirmOpen && (
            <OperationReview
              title={t('countSubmit')}
              onClose={count.closeConfirm}
              busy={count.submitting}
            >
              <p className="pos-note" data-tone="warn">
                {t('posCountConfirm')}
              </p>
              <p>
                {t('countProgress', { count: count.countedCount })} · {props.session.branch.name}
              </p>
              {variance > 20 && (
                <label className="pos-checkbox">
                  <input
                    type="checkbox"
                    checked={largeConfirmed}
                    onChange={(e) => setLargeConfirmed(e.target.checked)}
                  />
                  {t('countBigVariance')}
                </label>
              )}
              <div className="pos-actions">
                <button
                  type="button"
                  className="pos-btn"
                  disabled={count.submitting}
                  onClick={count.closeConfirm}
                >
                  {t('back')}
                </button>
                <button
                  type="button"
                  className="pos-btn pos-btn-primary"
                  disabled={
                    count.submitting || blocked || !online || (variance > 20 && !largeConfirmed)
                  }
                  onClick={() => void count.submit().then(() => stock.refresh())}
                >
                  {t(count.submitting ? 'countSubmitting' : 'countConfirmAnyway')}
                </button>
              </div>
            </OperationReview>
          )}
          {discard && (
            <OperationReview title={t('countStartNew')} onClose={() => setDiscard(false)}>
              <p>{t('countStartNewBody')}</p>
              <div className="pos-actions">
                <button type="button" className="pos-btn" onClick={() => setDiscard(false)}>
                  {t('back')}
                </button>
                <button
                  type="button"
                  className="pos-btn"
                  onClick={() => {
                    if (count.draftOffer) count.discardDraft();
                    else count.startNewCount();
                    setDiscard(false);
                  }}
                >
                  {t('countStartNewConfirm')}
                </button>
              </div>
            </OperationReview>
          )}
        </>
      )}
    </section>
  );
}
