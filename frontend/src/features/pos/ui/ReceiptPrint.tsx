'use client';

import type { PosTranslate } from '../core/pos-types';
import type { PaperWidth } from '../hardware/printer';
import { receiptAmount, receiptTime, type ReceiptModel } from '../hardware/receipt';

/**
 * The receipt as the browser prints it. Hidden on screen; the print
 * stylesheet shows only this, sized for the chosen roll.
 */
export function ReceiptPrint({
  model,
  paper,
  t,
}: {
  model: ReceiptModel;
  paper: PaperWidth;
  t: PosTranslate;
}) {
  return (
    <div className="pos-receipt" data-paper={paper} aria-hidden="true">
      <p className="pos-receipt-center pos-receipt-strong">{model.company}</p>
      <p className="pos-receipt-center">{model.branch}</p>
      <p className="pos-receipt-center pos-receipt-strong">{t('posReceiptTitle')}</p>
      {model.orderNumber && <p className="pos-receipt-center">{model.orderNumber}</p>}
      <p className="pos-receipt-center">{receiptTime(model.issuedAt)}</p>
      {model.held && <p className="pos-receipt-center">{t('posReceiptHeld')}</p>}
      <hr />
      {model.lines.map((line, index) => (
        <div key={index} className="pos-receipt-line">
          <p>{line.name}</p>
          <p className="pos-receipt-row">
            <span>
              {line.quantity} x {receiptAmount(line.unitPrice)}
            </span>
            <span>{receiptAmount(line.total)}</span>
          </p>
        </div>
      ))}
      <hr />
      <p className="pos-receipt-row pos-receipt-total">
        <span>{t('posReceiptTotal')}</span>
        <span>TZS {receiptAmount(model.total)}</span>
      </p>
      <p className="pos-receipt-row">
        <span>{model.paymentLabel}</span>
        <span>{receiptAmount(model.total)}</span>
      </p>
      {model.received !== null && (
        <>
          <p className="pos-receipt-row">
            <span>{t('posReceiptReceived')}</span>
            <span>{receiptAmount(model.received)}</span>
          </p>
          <p className="pos-receipt-row">
            <span>{t('posReceiptChange')}</span>
            <span>{receiptAmount(model.change ?? 0)}</span>
          </p>
        </>
      )}
      {model.customer && (
        <p className="pos-receipt-row">
          <span>{t('posReceiptCustomer')}</span>
          <span>{model.customer}</span>
        </p>
      )}
      <hr />
      <p className="pos-receipt-center">
        {model.rep} - {model.terminal}
      </p>
      <p className="pos-receipt-center">{t('posReceiptThanks')}</p>
    </div>
  );
}
