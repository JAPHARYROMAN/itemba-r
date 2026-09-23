'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PosTranslate } from '../core/pos-types';
import { encodeDrawerKick, encodeReceipt, type ReceiptLabels } from './escpos';
import {
  DEFAULT_PRINTER_SETTINGS,
  columnsFor,
  connectBluetoothPrinter,
  connectSerialPrinter,
  printInBrowser,
  readPrinterSettings,
  reconnectSerialPrinter,
  writePrinterSettings,
  type DirectKind,
  type PrinterConnection,
  type PrinterSettings,
} from './printer';
import type { ReceiptModel } from './receipt';

// One connection per page, so opening the Kaunta bridge and coming back does
// not drop the printer.
let activeConnection: PrinterConnection | null = null;

export function receiptLabels(t: PosTranslate): ReceiptLabels {
  return {
    title: t('posReceiptTitle'),
    total: t('posReceiptTotal'),
    received: t('posReceiptReceived'),
    change: t('posReceiptChange'),
    customer: t('posReceiptCustomer'),
    held: t('posReceiptHeld'),
    thanks: t('posReceiptThanks'),
  };
}

export function usePosPrinter(t: PosTranslate) {
  const [settings, setSettings] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS);
  const [connection, setConnection] = useState<PrinterConnection | null>(activeConnection);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = readPrinterSettings();
    setSettings(stored);
    // A serial port this site was already allowed can reopen silently;
    // Bluetooth always needs the rep to pick the device again.
    if (stored.direct === 'serial' && !activeConnection) {
      void reconnectSerialPrinter()
        .then((reopened) => {
          if (!reopened) return;
          activeConnection = reopened;
          setConnection(reopened);
        })
        .catch(() => undefined);
    }
  }, []);

  const update = useCallback((next: PrinterSettings) => {
    setSettings(next);
    writePrinterSettings(next);
  }, []);

  const fail = useCallback(
    (caught: unknown) =>
      setError(
        t('posPrinterFailed', {
          reason: caught instanceof Error ? caught.message : String(caught),
        }),
      ),
    [t],
  );

  const connect = useCallback(
    async (kind: DirectKind) => {
      setError(null);
      try {
        const opened =
          kind === 'serial' ? await connectSerialPrinter() : await connectBluetoothPrinter();
        await activeConnection?.close().catch(() => undefined);
        activeConnection = opened;
        setConnection(opened);
        update({ ...settings, direct: kind });
      } catch (caught) {
        fail(caught);
      }
    },
    [fail, settings, update],
  );

  const disconnect = useCallback(async () => {
    await activeConnection?.close().catch(() => undefined);
    activeConnection = null;
    setConnection(null);
    update({ ...settings, direct: null, drawer: false });
  }, [settings, update]);

  /** Direct ESC/POS when connected, otherwise the browser's print dialog. */
  const print = useCallback(
    async (model: ReceiptModel, options: { openDrawer?: boolean } = {}) => {
      setError(null);
      if (!activeConnection) {
        printInBrowser(settings.paper);
        return;
      }
      setBusy(true);
      try {
        await activeConnection.write(
          encodeReceipt(model, receiptLabels(t), {
            columns: columnsFor(settings.paper),
            openDrawer: options.openDrawer,
          }),
        );
      } catch (caught) {
        fail(caught);
      } finally {
        setBusy(false);
      }
    },
    [fail, settings.paper, t],
  );

  const kickDrawer = useCallback(async () => {
    if (!activeConnection) return;
    try {
      await activeConnection.write(encodeDrawerKick());
    } catch (caught) {
      fail(caught);
    }
  }, [fail]);

  return { settings, update, connection, error, busy, connect, disconnect, print, kickDrawer };
}
