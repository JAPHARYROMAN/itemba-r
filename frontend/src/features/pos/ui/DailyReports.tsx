'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { backendGet } from '@/lib/api-client';
import { posDaylogDate } from '@/lib/mobile-pos-lite-store';
import { sharePdfDocument } from '../core/pos-receipt';
import { money, pendingTime, terminalHeaders } from '../core/pos-utils';
import { posErrorMessage } from '../core/pos-errors';
import type { PosShellProps } from './PosShell';

export type DailySummary = {
  businessDate: string;
  asOf: string;
  salesCount: number;
  grossTotal: number;
  itemsSoldQuantity: number;
  initialReceipts: number;
  initialCredit: number;
  collectionCount: number;
  collectionTotal: number;
  refundCount: number;
  refundTotal: number;
  netReceipts: number;
  byMethod: Array<{ paymentMethod: string; label: string | null; count: number; amount: number }>;
  collectionByMethod: Array<{ method: string; count: number; amount: number }>;
  items: Array<{ productId: string; name: string; quantity: number; amount: number }>;
  itemsTruncated: boolean;
};

export function DailyReports({ props }: { props: PosShellProps }) {
  const { t, online, binding, pendingSales } = props;
  const id = useId();
  const [date, setDate] = useState(posDaylogDate);
  const [report, setReport] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const loadEpoch = useRef(0);
  const invalidate = useCallback(() => {
    ++loadEpoch.current;
  }, []);
  const request = `/mobile-pos-lite/daily-summary?businessDate=${date}`;
  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    if (!online) return;
    setLoading(true);
    setError('');
    try {
      const value = await backendGet<DailySummary>(request, { headers: terminalHeaders(binding) });
      if (epoch === loadEpoch.current) setReport(value);
    } catch (e) {
      if (epoch === loadEpoch.current) {
        setReport(null);
        setError(posErrorMessage(e instanceof Error ? e.message : '', t));
      }
    } finally {
      if (epoch === loadEpoch.current) setLoading(false);
    }
  }, [request, binding, online, t]);
  useEffect(() => {
    setReport(null);
    setError('');
    setLoading(false);
    void load();
    return invalidate;
  }, [load, invalidate]);
  const current = online && report?.businessDate === date ? report : null;
  const methodName = (code: string) =>
    props.session.paymentMethods.find((method) => method.code === code)?.label ??
    (code === 'CREDIT' ? t('posCredit') : code);
  const days = Array.from({ length: 7 }, (_, index) =>
    posDaylogDate(new Date(Date.now() - index * 86400000)),
  );
  const pending = pendingSales.filter((item) => posDaylogDate(new Date(item.createdAt)) === date);
  async function pdf() {
    if (!current || !online || exporting) return;
    setExporting(true);
    setError('');
    try {
      const result = await sharePdfDocument(
        binding,
        `/api/backend/mobile-pos-lite/daily-summary/pdf?businessDate=${date}`,
        `POS-${binding.terminalCode}-${date}.pdf`,
      );
      if (!result) setError(t('reportPdfFailed'));
    } catch (e) {
      setError(posErrorMessage(e instanceof Error ? e.message : '', t));
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="pos-full pos-records">
      <div className="pos-section-head">
        <div>
          <h1>{t('posReportsTab')}</h1>
          <p className="pos-hint">
            {props.session.branch.name} · {props.session.terminal.name} · {props.session.rep.name}
          </p>
        </div>
        <div className="pos-actions">
          <button
            type="button"
            className="pos-btn"
            disabled={!online || loading}
            onClick={() => void load()}
          >
            {t('refresh')}
          </button>
          <button
            type="button"
            className="pos-btn pos-btn-primary"
            disabled={!current || exporting || loading}
            onClick={() => void pdf()}
          >
            {t(exporting ? 'loading' : 'posExportDailyPdf')}
          </button>
        </div>
      </div>
      <label className="pos-field" htmlFor={id}>
        {t('posBusinessDate')}
        <select
          id={id}
          className="pos-input"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setReport(null);
          }}
        >
          {days.map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </select>
      </label>
      <p className="pos-note">{t('posDailyScope')}</p>
      {!online && (
        <p className="pos-note" data-tone="warn">
          {t('posDailyOffline')}
        </p>
      )}
      {loading && <p role="status">{t('loading')}</p>}
      {error && (
        <p className="pos-note" data-tone="warn" role="alert">
          {error}
        </p>
      )}
      {current && (
        <>
          <p className="pos-hint">{t('posReportAsOf', { time: pendingTime(current.asOf) })}</p>
          <dl className="pos-report-metrics">
            <div>
              <dt>{t('reportGross')}</dt>
              <dd>{money(current.grossTotal)}</dd>
              <small>{t('posSalesCount', { count: current.salesCount })}</small>
            </div>
            <div>
              <dt>{t('posInitialReceipts')}</dt>
              <dd>{money(current.initialReceipts)}</dd>
              <small>
                {t('posInitialCredit')} · {money(current.initialCredit)}
              </small>
            </div>
            <div>
              <dt>{t('posLaterCollections')}</dt>
              <dd>{money(current.collectionTotal)}</dd>
              <small>{current.collectionCount}</small>
            </div>
            <div>
              <dt>{t('posPaidRefunds')}</dt>
              <dd>{money(current.refundTotal)}</dd>
              <small>{current.refundCount}</small>
            </div>
            <div>
              <dt>{t('posNetReceipts')}</dt>
              <dd>{money(current.netReceipts)}</dd>
              <small>{t('posNetReceiptEquation')}</small>
            </div>
          </dl>
          <div className="pos-operation-grid">
            <section className="pos-panel pos-record-detail">
              <h2>{t('posOriginalAllocations')}</h2>
              <dl className="pos-definition">
                {current.byMethod.map((row) => (
                  <div key={row.paymentMethod}>
                    <dt>
                      {row.label ?? methodName(row.paymentMethod)} · {row.count}
                    </dt>
                    <dd>{money(row.amount)}</dd>
                  </div>
                ))}
              </dl>
              <h2>{t('posLaterCollections')}</h2>
              <dl className="pos-definition">
                {current.collectionByMethod.map((row) => (
                  <div key={row.method}>
                    <dt>
                      {methodName(row.method)} · {row.count}
                    </dt>
                    <dd>{money(row.amount)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="pos-panel pos-record-detail">
              <h2>
                {t('reportItemsSold')} · {current.itemsSoldQuantity}
              </h2>
              <dl className="pos-definition">
                {current.items.map((row) => (
                  <div key={row.productId}>
                    <dt>
                      {row.name} · {row.quantity}
                    </dt>
                    <dd>{money(row.amount)}</dd>
                  </div>
                ))}
              </dl>
              {current.itemsTruncated && <p className="pos-hint">{t('posProductsTruncated')}</p>}
            </section>
          </div>
        </>
      )}
      {pending.length > 0 && (
        <section className="pos-panel pos-record-detail">
          <h2>{t('posUnsentSales')}</h2>
          <strong className="pos-num">
            {pending.length} ·{' '}
            {money(pending.reduce((sum, item) => sum + Number(item.totalAmount ?? 0), 0))}
          </strong>
          <p className="pos-hint">{t('posUnsentReportNote')}</p>
        </section>
      )}
    </section>
  );
}
