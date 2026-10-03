'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePosSlip } from '../core/hooks/use-pos-slip';
import { usePosPurchaseHistory } from '../core/hooks/use-pos-history';
import { usePosWindowGuard } from '../core/use-pos-window-guard';
import { money, pendingTime } from '../core/pos-utils';
import { posErrorMessage } from '../core/pos-errors';
import type { PurchaseResult } from '../core/pos-types';
import type { PosStep } from './use-pos-step';
import type { PosShellProps } from './PosShell';
import { OperationReview } from './OperationReview';

export function ReceivingWorkspace({
  props,
  active,
  onBusy,
  onReceived,
  go,
}: {
  props: PosShellProps;
  active: boolean;
  onBusy: (busy: boolean) => void;
  onReceived: () => void;
  go: (step: PosStep) => void;
}) {
  const { t, online, supplier, setSupplier, purchaseCart, setPurchaseCart, purchaseTotal } = props;
  const id = useId();
  const slip = usePosSlip({
    binding: props.binding,
    purchasesEnabled: true,
    supplier,
    setSupplier,
    purchaseCart,
    setPurchaseCart,
  });
  const entered = useRef(false);
  const [opening, setOpening] = useState(true);
  const [review, setReview] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const enter = slip.enter;
  const begin = props.beginPurchase;
  useEffect(() => {
    if (!active || entered.current) return;
    entered.current = true;
    begin();
    void enter().finally(() => setOpening(false));
  }, [active, begin, enter]);
  useEffect(() => {
    onBusy(sending || (!result && slip.hasContent));
    return () => onBusy(false);
  }, [sending, slip.hasContent, result, onBusy]);
  usePosWindowGuard(sending || (!result && slip.hasContent && !slip.parked));
  const valid =
    supplier &&
    purchaseCart.length > 0 &&
    purchaseCart.every(
      (line) => Number.isFinite(line.quantity) && line.quantity > 0 && line.quantity <= 1000000,
    );
  async function receive() {
    if (!valid || sending || !online || opening) return;
    setSending(true);
    setNotice('');
    try {
      const key = await slip.sendKey();
      if (!key) {
        setNotice(t('slipSaveFailed'));
        return;
      }
      const recorded = await props.recordPurchase(key);
      if (recorded) {
        slip.completed();
        setResult(recorded);
        setReview(false);
        onReceived();
      }
    } catch (e) {
      setNotice(posErrorMessage(e instanceof Error ? e.message : '', t));
    } finally {
      setSending(false);
    }
  }
  async function save() {
    setNotice((await slip.save()) ? t('posReceivingSaved') : t('slipSaveFailed'));
  }
  function nextDelivery() {
    props.beginPurchase();
    void slip.enter();
    setResult(null);
    setNotice('');
  }
  return (
    <section className="pos-full pos-records">
      <div className="pos-section-head">
        <div>
          <h1>{t('posReceiveStock')}</h1>
          <p className="pos-hint">
            {props.session.branch.name} · {t('posReceivingDescription')}
          </p>
        </div>
        <button type="button" className="pos-btn" onClick={() => go('deliveries')}>
          {t('posDeliveryHistory')}
        </button>
      </div>
      {result ? (
        <section className="pos-panel pos-record-detail" role="status">
          <h2>{t(result.grnNumber ? 'posDeliveryReceived' : 'posDeliveryRecorded')}</h2>
          <dl className="pos-definition">
            <div>
              <dt>{t('posPurchaseOrder')}</dt>
              <dd>{result.purchaseOrderNumber}</dd>
            </div>
            <div>
              <dt>{t('posGoodsReceived')}</dt>
              <dd>{result.grnNumber ?? t('posWaitingOffice')}</dd>
            </div>
          </dl>
          <p className="pos-hint">{t('purchaseStockNote')}</p>
          <button type="button" className="pos-btn pos-btn-primary" onClick={nextDelivery}>
            {t('posNextDelivery')}
          </button>
        </section>
      ) : (
        <>
          {opening && (
            <p className="pos-note" role="status">
              {t('posDraftOpening')}
            </p>
          )}
          {!online && (
            <p className="pos-note" data-tone="warn">
              {t('purchaseOfflineNote')}
            </p>
          )}
          <p className="pos-hint" role="status">
            {t(slip.parked ? 'posReceivingSaved' : 'posReceivingUnsaved')}
          </p>
          {slip.attempted && (
            <p className="pos-note" data-tone="warn">
              {t('posOriginalStockRequest')}
            </p>
          )}
          <fieldset className="pos-operation-fieldset" disabled={opening || sending || props.busy}>
            <fieldset className="pos-operation-fieldset" disabled={slip.attempted}>
              <div className="pos-operation-grid">
                <section className="pos-panel pos-record-detail">
                  <h2>{t('supplier')}</h2>
                  {supplier ? (
                    <div className="pos-actions">
                      <strong>{supplier.name}</strong>
                      <button
                        type="button"
                        className="pos-btn"
                        onClick={() => {
                          setSupplier(null);
                          props.setSupplierQuery('');
                        }}
                      >
                        {t('change')}
                      </button>
                    </div>
                  ) : (
                    <label className="pos-field" htmlFor={id + '-supplier'}>
                      {t('supplierSearchPlaceholder')}
                      <input
                        id={id + '-supplier'}
                        className="pos-input"
                        value={props.supplierQuery}
                        disabled={!online}
                        onChange={(e) => props.setSupplierQuery(e.target.value)}
                      />
                    </label>
                  )}
                  {props.suppliers.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="pos-record-row"
                      onClick={() => {
                        setSupplier(entry);
                        props.setSuppliers([]);
                      }}
                    >
                      <span>
                        <strong>{entry.name}</strong>
                        <small>{entry.supplierCode}</small>
                      </span>
                    </button>
                  ))}
                  <h2>{t('posAddDeliveryProducts')}</h2>
                  <label className="pos-field" htmlFor={id + '-search'}>
                    {t('posSearchStock')}
                    <input
                      id={id + '-search'}
                      className="pos-input"
                      type="search"
                      value={props.purchaseQuery}
                      onChange={(e) => props.setPurchaseQuery(e.target.value)}
                    />
                  </label>
                  <div className="pos-product-results">
                    {props.purchaseMatches.map((product) => (
                      <button
                        type="button"
                        key={product.id}
                        className="pos-record-row"
                        onClick={() => props.addPurchaseProduct(product)}
                      >
                        <span>
                          <strong>{product.name}</strong>
                          <small>{product.code}</small>
                        </span>
                        <span aria-hidden="true">+</span>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="pos-panel pos-record-detail">
                  <h2>{t('purchaseItems')}</h2>
                  {!purchaseCart.length && <p className="pos-empty">{t('posDeliveryEmpty')}</p>}
                  {purchaseCart.map((line) => (
                    <div className="pos-delivery-line" key={line.product.id}>
                      <div className="pos-section-head">
                        <strong>{line.product.name}</strong>
                        <button
                          type="button"
                          className="pos-btn"
                          aria-label={`${t('remove')} ${line.product.name}`}
                          onClick={() => props.setPurchaseQuantity(line.product.id, 0)}
                        >
                          {t('remove')}
                        </button>
                      </div>
                      <div className="pos-operation-grid">
                        <label className="pos-field" htmlFor={id + line.product.id + '-qty'}>
                          {t('quantity')} · {line.product.unitSymbol}
                          <input
                            id={id + line.product.id + '-qty'}
                            className="pos-input"
                            type="number"
                            inputMode="decimal"
                            min="0.0001"
                            max="1000000"
                            step="0.0001"
                            value={line.quantity}
                            onChange={(e) => {
                              const quantity = Number(e.target.value);
                              setPurchaseCart((rows) =>
                                rows.map((row) =>
                                  row.product.id === line.product.id ? { ...row, quantity } : row,
                                ),
                              );
                            }}
                          />
                        </label>
                        <label className="pos-field" htmlFor={id + line.product.id + '-cost'}>
                          {t('posTypedUnitCost')}
                          <input
                            id={id + line.product.id + '-cost'}
                            className="pos-input"
                            inputMode="numeric"
                            value={line.unitCost}
                            maxLength={10}
                            placeholder={t('posOfficeDefaultCost')}
                            onChange={(e) =>
                              setPurchaseCart((rows) =>
                                rows.map((row) =>
                                  row.product.id === line.product.id
                                    ? { ...row, unitCost: e.target.value.replace(/\D/g, '') }
                                    : row,
                                ),
                              )
                            }
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                  <p className="pos-hint">{t('posTypedCostNote')}</p>
                  <div className="pos-total-row">
                    <span>{t('posTypedCostsTotal')}</span>
                    <strong className="pos-num">{money(purchaseTotal)}</strong>
                  </div>
                </section>
              </div>
            </fieldset>
            <div className="pos-actions pos-operation-actions">
              <button
                type="button"
                className="pos-btn"
                disabled={!slip.hasContent || slip.attempted}
                onClick={() => setDiscard(true)}
              >
                {t('countDiscardDraft')}
              </button>
              <button
                type="button"
                className="pos-btn"
                disabled={!slip.hasContent}
                onClick={() => void save()}
              >
                {t('posSaveDelivery')}
              </button>
              <button
                type="button"
                className="pos-btn pos-btn-primary"
                disabled={!valid || !online}
                onClick={() => setReview(true)}
              >
                {t('posReviewDelivery')}
              </button>
            </div>
          </fieldset>
          {(notice || props.notice) && (
            <p className="pos-note" data-tone="warn" role="status">
              {notice || props.notice}
            </p>
          )}
          {discard && (
            <OperationReview title={t('countDiscardDraft')} onClose={() => setDiscard(false)}>
              <p>{t('posDiscardDelivery')}</p>
              <div className="pos-actions">
                <button type="button" className="pos-btn" onClick={() => setDiscard(false)}>
                  {t('back')}
                </button>
                <button
                  type="button"
                  className="pos-btn"
                  onClick={() => {
                    slip.completed();
                    nextDelivery();
                    setDiscard(false);
                  }}
                >
                  {t('countDiscardDraft')}
                </button>
              </div>
            </OperationReview>
          )}
          {review && (
            <OperationReview
              title={t('posReviewDelivery')}
              onClose={() => setReview(false)}
              busy={sending}
            >
              <p>
                {supplier?.name} · {props.session.branch.name}
              </p>
              <ul>
                {purchaseCart.map((line) => (
                  <li key={line.product.id}>
                    {line.product.name} · {line.quantity} {line.product.unitSymbol} ·{' '}
                    {line.unitCost ? money(Number(line.unitCost)) : t('posOfficeDefaultCost')}
                  </li>
                ))}
              </ul>
              <p className="pos-note" data-tone="warn">
                {t('posReceiveConfirmation')}
              </p>
              {(notice || props.notice) && <p role="alert">{notice || props.notice}</p>}
              <div className="pos-actions">
                <button
                  type="button"
                  className="pos-btn"
                  disabled={sending}
                  onClick={() => setReview(false)}
                >
                  {t('back')}
                </button>
                <button
                  type="button"
                  className="pos-btn pos-btn-primary"
                  disabled={sending || !online}
                  onClick={() => void receive()}
                >
                  {t(sending ? 'sending' : 'posConfirmReceive')}
                </button>
              </div>
            </OperationReview>
          )}
        </>
      )}
    </section>
  );
}

export function DeliveryHistory({ props }: { props: PosShellProps }) {
  const { t, online } = props;
  const history = usePosPurchaseHistory({
    binding: props.binding,
    purchasesEnabled: true,
    active: true,
  });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId();
  const refresh = history.refresh;
  useEffect(() => {
    refresh();
  }, [refresh]);
  const rows = online
    ? (history.data?.purchases ?? []).filter((row) =>
        [row.purchaseOrderNumber, row.grnNumber, row.supplierName].some((value) =>
          value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        ),
      )
    : [];
  const detail = rows.find((row) => row.id === selected);
  return (
    <section className="pos-full pos-records">
      <div className="pos-section-head">
        <div>
          <h1>{t('posDeliveryHistory')}</h1>
          <p className="pos-hint">{t('posDeliveryHistoryScope')}</p>
        </div>
        <button
          type="button"
          className="pos-btn"
          disabled={!online || history.loading}
          onClick={refresh}
        >
          {t('refresh')}
        </button>
      </div>
      <label className="pos-field" htmlFor={id}>
        {t('posSearchDeliveries')}
        <input
          className="pos-input"
          id={id}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
        />
      </label>
      {(!online || history.failed) && (
        <p className="pos-note" data-tone="warn">
          {t(online ? 'purchaseHistoryLoadError' : 'posOnlineHistory')}
        </p>
      )}
      <div className="pos-record-grid">
        <div className="pos-panel">
          {rows.map((row) => (
            <button
              type="button"
              className="pos-record-row"
              key={row.id}
              aria-pressed={selected === row.id}
              onClick={() => setSelected(row.id)}
            >
              <span>
                <strong>{row.supplierName}</strong>
                <small>
                  {row.purchaseOrderNumber} · {pendingTime(row.recordedAt)}
                </small>
              </span>
              <span>
                {t(row.status === 'COMPLETE' ? 'posDeliveryReceived' : 'posWaitingOffice')}
              </span>
            </button>
          ))}
          {online && !rows.length && (
            <p className="pos-empty">{t(history.loading ? 'loading' : 'purchaseHistoryEmpty')}</p>
          )}
          {history.data && history.data.count > history.data.purchases.length && (
            <p className="pos-hint">{t('posHistoryTruncated')}</p>
          )}
        </div>
        <aside className="pos-panel pos-record-detail" aria-label={t('posDeliveryDetails')}>
          {detail ? (
            <>
              <h2>{detail.purchaseOrderNumber}</h2>
              <p>{detail.supplierName}</p>
              <p className="pos-hint">{detail.grnNumber ?? t('posWaitingOffice')}</p>
              <dl className="pos-definition">
                {detail.lines.map((line) => (
                  <div key={line.productId}>
                    <dt>{line.name}</dt>
                    <dd>
                      {line.quantity} {line.unitSymbol}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="pos-hint">{t('purchaseNoCostsNote')}</p>
            </>
          ) : (
            <p className="pos-empty">{t('posSelectDelivery')}</p>
          )}
        </aside>
      </div>
    </section>
  );
}
