'use client';

import { useEffect, useId } from 'react';
import type { PosTranslate } from '../core/pos-types';
import { directSupport, type PaperWidth } from '../hardware/printer';
import type { usePosPrinter } from '../hardware/use-pos-printer';

type Printer = ReturnType<typeof usePosPrinter>;

/** Per-device printer settings: paper, an optional direct printer, the drawer. */
export function PrinterPanel({
  printer,
  t,
  onTestPrint,
  onClose,
}: {
  printer: Printer;
  t: PosTranslate;
  onTestPrint: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const support = directSupport();
  const { settings, update, connection, error, busy } = printer;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="pos-sheet-layer">
      <button
        type="button"
        className="pos-sheet-scrim"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
      />
      <section className="pos-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="pos-sheet-grip" aria-hidden="true" />
        <div className="pos-sheet-head">
          <h2 id={titleId}>{t('posPrinter')}</h2>
        </div>

        <fieldset className="pos-reasons">
          <legend className="pos-field-label">{t('posPaper')}</legend>
          <div>
            {(['80', '58'] as PaperWidth[]).map((paper) => (
              <button
                key={paper}
                type="button"
                className="pos-reason"
                aria-pressed={settings.paper === paper}
                onClick={() => update({ ...settings, paper })}
              >
                {paper} mm
              </button>
            ))}
          </div>
        </fieldset>

        {connection ? (
          <div className="pos-field">
            <p className="pos-note" data-tone="ok" role="status">
              {t('posPrinterConnected', { name: connection.label })}
            </p>
            <label className="pos-check">
              <input
                type="checkbox"
                checked={settings.drawer}
                onChange={(event) => update({ ...settings, drawer: event.target.checked })}
              />
              <span>{t('posDrawerAfterCash')}</span>
            </label>
            <button type="button" className="pos-btn" onClick={() => void printer.disconnect()}>
              {t('posDisconnect')}
            </button>
          </div>
        ) : (
          <div className="pos-field">
            <p className="pos-hint">{t('posPrinterBrowser')}</p>
            {support.serial && (
              <button
                type="button"
                className="pos-btn"
                onClick={() => void printer.connect('serial')}
              >
                {t('posConnectUsb')}
              </button>
            )}
            {support.bluetooth && (
              <button
                type="button"
                className="pos-btn"
                onClick={() => void printer.connect('bluetooth')}
              >
                {t('posConnectBluetooth')}
              </button>
            )}
            {(support.serial || support.bluetooth) && (
              <p className="pos-hint">{t('posDrawerNeedsPrinter')}</p>
            )}
          </div>
        )}

        {(support.serial || support.bluetooth) && (
          <p className="pos-note" data-tone="warn">
            {t('posPrinterUncertified')}
          </p>
        )}
        {error && (
          <p className="pos-note" data-tone="bad" role="alert">
            {error}
          </p>
        )}

        <div className="pos-actions">
          <button type="button" className="pos-btn" disabled={busy} onClick={onTestPrint}>
            {busy ? t('posPrinting') : t('posTestPrint')}
          </button>
          <button type="button" className="pos-btn pos-btn-primary" onClick={onClose}>
            {t('posClose')}
          </button>
        </div>
      </section>
    </div>
  );
}
