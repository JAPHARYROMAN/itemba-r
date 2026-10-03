'use client';

import { TransactionActions, type TransactionDetail } from './TransactionActions';
import { useEffect, useId, useState } from 'react';
import type { MobilePosLiteBinding, PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import { usePosSalesHistory } from '../core/hooks/use-pos-history';
import { money, pendingTime } from '../core/pos-utils';
import type { PosTranslate, Session } from '../core/pos-types';
import { usePosPrinter } from '../hardware/use-pos-printer';
import type { ReceiptModel } from '../hardware/receipt';
import { ReceiptPrint } from './ReceiptPrint';
import { sharePdfReceipt } from '../core/pos-receipt';

export function Transactions({
  binding,
  session,
  online,
  pending,
  t,
  openSync,
  owned = true,
}: {
  binding: MobilePosLiteBinding;
  session: Session;
  online: boolean;
  pending: PendingMobilePosLiteSale[];
  t: PosTranslate;
  openSync: () => void;
  owned?: boolean;
}) {
  const id = useId();
  const history = usePosSalesHistory({ binding, active: true });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [printJob, setPrintJob] = useState<ReceiptModel | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const printer = usePosPrinter(t);
  const refresh = history.refresh;
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (printJob) void printer.print(printJob).finally(() => setPrintJob(null));
  }, [printJob, printer]);
  const term = query.trim().toLocaleLowerCase();
  const sales = online ? (history.data?.sales ?? []) : [];
  const saleStatus = (sale: (typeof sales)[number]) =>
    sale.status ?? (sale.paymentMethod === 'CREDIT' ? 'CREDIT' : 'PAID');
  const visibleSales = sales.filter(
    (sale) =>
      (filter === 'all' || saleStatus(sale).toLowerCase() === filter) &&
      [
        sale.salesOrderNumber,
        sale.customerName,
        sale.paymentReference,
        ...sale.lines.map((line) => line.name),
      ].some((v) => v?.toLocaleLowerCase().includes(term)),
  );
  const visiblePending =
    filter === 'all' || filter === 'pending'
      ? pending.filter((item) =>
          [item.lineSummary, item.payload.paymentReference, item.id].some((v) =>
            v?.toLocaleLowerCase().includes(term),
          ),
        )
      : [];
  const selectedSale = sales.find((sale) => sale.id === selected);
  const receipt = selectedSale
    ? ({
        company: session.company.name,
        branch: session.branch.name,
        terminal: session.terminal.name,
        rep: session.rep.name,
        orderNumber: selectedSale.salesOrderNumber,
        held: false,
        issuedAt: new Date(selectedSale.createdAt),
        total: selectedSale.totalAmount,
        lines: selectedSale.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          total: line.lineTotal,
        })),
        ...(detail?.id === selectedSale.id
          ? {
              payments: [
                ...detail.tenders.map((p) => ({ ...p, reference: p.reference ?? undefined })),
                ...detail.collections.map((p) => ({
                  method: p.method,
                  amount: p.amount,
                  reference: p.number,
                })),
              ],
              outstanding: detail.outstanding,
            }
          : {}),
        paymentLabel:
          session.paymentMethods.find((m) => m.code === selectedSale.paymentMethod)?.label ??
          selectedSale.paymentMethod,
        received: null,
        change: null,
        customer: selectedSale.customerName,
      } satisfies ReceiptModel)
    : null;
  return (
    <main className="pos-full pos-records">
      <div className="pos-panel-head">
        <div>
          <h2>{t('posTransactions')}</h2>
          <p className="pos-hint">{t('posHistoryScope')}</p>
        </div>
        <button
          type="button"
          className="pos-btn"
          disabled={!online || history.loading}
          onClick={refresh}
        >
          {t('posRefresh')}
        </button>
      </div>
      <div className="pos-record-filters">
        <label className="pos-field" htmlFor={id + '-search'}>
          {t('posSearch')}
          <input
            id={id + '-search'}
            className="pos-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('posTransactionSearch')}
          />
        </label>
        <label className="pos-field" htmlFor={id + '-status'}>
          {t('posStatus')}
          <select
            id={id + '-status'}
            className="pos-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">{t('posAll')}</option>
            <option value="paid">{t('posPaid')}</option>
            <option value="credit">{t('posCredit')}</option>
            <option value="pending">{t('posPending')}</option>
          </select>
        </label>
      </div>
      {!online && (
        <p className="pos-note" data-tone="warn">
          {t('posHistoryOffline')}
        </p>
      )}
      {history.failed && online && (
        <p role="alert" className="pos-note" data-tone="bad">
          {t('posHistoryFailed')}
        </p>
      )}
      {history.loading && <p role="status">{t('opening')}</p>}
      {history.data && online && (
        <p className="pos-hint">
          {t('posHistoryTotal', {
            count: history.data.count,
            total: money(history.data.totalAmount),
          })}
        </p>
      )}
      <div className="pos-record-grid">
        <section className="pos-panel" aria-label={t('posTransactions')}>
          {visibleSales.map((sale) => (
            <button
              key={sale.id}
              type="button"
              className="pos-record-row"
              aria-pressed={selected === sale.id}
              onClick={() => {
                setSelected(sale.id);
                setError('');
              }}
            >
              <span>
                <strong>{sale.salesOrderNumber}</strong>
                <small>
                  {sale.customerName ?? t('posWalkIn')} · {pendingTime(sale.createdAt)}
                </small>
              </span>
              <span>
                <strong className="pos-num">{money(sale.totalAmount)}</strong>
                <small>{t(saleStatus(sale) === 'CREDIT' ? 'posCredit' : 'posPaid')}</small>
              </span>
            </button>
          ))}
          {visiblePending.map((item) => (
            <button key={item.id} type="button" className="pos-record-row" onClick={openSync}>
              <span>
                <strong>{t('posPending')}</strong>
                <small>
                  {item.lineSummary} · {pendingTime(item.createdAt)}
                </small>
              </span>
              <span>
                <strong className="pos-num">{money(item.totalAmount ?? 0)}</strong>
                <small>
                  {t(item.requiresReview || item.lastError ? 'posNeedsAttention' : 'queueWaiting')}
                </small>
              </span>
            </button>
          ))}
          {!history.loading && visibleSales.length + visiblePending.length === 0 && (
            <p className="pos-empty">{t('posNoTransactions')}</p>
          )}
        </section>
        <section className="pos-panel pos-record-detail" aria-label={t('posReceiptDetails')}>
          {selectedSale && receipt ? (
            <>
              <h3>{selectedSale.salesOrderNumber}</h3>
              <p className="pos-hint">
                {pendingTime(selectedSale.createdAt)} · {receipt.paymentLabel}
              </p>
              {selectedSale.customerName && <p>{selectedSale.customerName}</p>}
              {selectedSale.paymentReference && (
                <p>
                  {t('reference')}: {selectedSale.paymentReference}
                </p>
              )}
              {selectedSale.lines.map((line, index) => (
                <div key={index} className="pos-receipt-line">
                  <span>
                    {line.quantity} {line.unitSymbol} × {line.name}
                  </span>
                  <strong className="pos-num">{money(line.lineTotal)}</strong>
                </div>
              ))}
              <div className="pos-total-row">
                <span>{t('totalLabel')}</span>
                <strong className="pos-num">{money(selectedSale.totalAmount)}</strong>
              </div>
              <p className="pos-hint">{t('posReprintNote')}</p>
              <div className="pos-actions">
                <button
                  type="button"
                  className="pos-btn"
                  disabled={printer.busy || detail?.id !== selectedSale.id}
                  onClick={() => setPrintJob(receipt)}
                >
                  {printer.busy ? t('posPrinting') : t('posReprint')}
                </button>
                <button
                  type="button"
                  className="pos-btn"
                  disabled={!online || exporting}
                  onClick={async () => {
                    setExporting(true);
                    setError('');
                    try {
                      if (
                        !(await sharePdfReceipt(binding, {
                          id: selectedSale.id,
                          salesOrderNumber: selectedSale.salesOrderNumber,
                        }))
                      )
                        setError(t('posReceiptFailed'));
                    } catch {
                      setError(t('posReceiptFailed'));
                    } finally {
                      setExporting(false);
                    }
                  }}
                >
                  {exporting ? t('preparingReceipt') : t('posReceiptPdf')}
                </button>
              </div>
              {(error || printer.error) && (
                <p className="pos-note" data-tone="bad" role="alert">
                  {error || printer.error}
                </p>
              )}
            </>
          ) : (
            <p className="pos-empty">{t('posSelectTransaction')}</p>
          )}
        </section>
      </div>
      <TransactionActions
        binding={binding}
        session={session}
        saleId={selected}
        online={online}
        owned={owned}
        t={t}
        onChanged={refresh}
        onDetail={setDetail}
      />
      {printJob && <ReceiptPrint model={printJob} paper={printer.settings.paper} t={t} />}
    </main>
  );
}
