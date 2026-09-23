'use client';

/**
 * Receipt printers for the till (POS_REMAKE_PLAN_2026-09-23.md section 6).
 *
 * Stage 1, always available: the browser's own print dialog with the receipt
 * sized for 58 or 80 mm paper. Works with any printer the OS already has.
 *
 * Stage 2, opt-in per device: ESC/POS bytes straight to the printer, over Web
 * Serial (desktop Chrome/Edge: USB-serial and Bluetooth-serial printers) or Web
 * Bluetooth (Chrome on Android: BLE printers). It also drives the cash drawer
 * through the printer's drawer port. Model certification (D5) is still open,
 * so the UI says it is not yet certified.
 */
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safe-storage';

export type PaperWidth = '80' | '58';
export type DirectKind = 'serial' | 'bluetooth';
export type PrinterSettings = {
  paper: PaperWidth;
  /** Which direct connection this device last used; null = browser printing. */
  direct: DirectKind | null;
  /** Kick the drawer after a completed cash sale (direct connection only). */
  drawer: boolean;
};

const SETTINGS_KEY = 'itemba-pos-printer';
export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  paper: '80',
  direct: null,
  drawer: false,
};

export function readPrinterSettings(): PrinterSettings {
  const raw = safeLocalStorageGet(SETTINGS_KEY);
  if (!raw) return DEFAULT_PRINTER_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<PrinterSettings>;
    return {
      paper: parsed.paper === '58' ? '58' : '80',
      direct: parsed.direct === 'serial' || parsed.direct === 'bluetooth' ? parsed.direct : null,
      drawer: parsed.drawer === true,
    };
  } catch {
    return DEFAULT_PRINTER_SETTINGS;
  }
}

/** Best effort: in private mode the setting just won't survive a reload. */
export function writePrinterSettings(settings: PrinterSettings): void {
  safeLocalStorageSet(SETTINGS_KEY, JSON.stringify(settings));
}

export function columnsFor(paper: PaperWidth): 32 | 48 {
  return paper === '58' ? 32 : 48;
}

/* ---------------- stage 1: the browser print dialog ---------------- */

const PAGE_STYLE_ID = 'pos-receipt-page';

/** Size the printed page to the roll, then open the browser's print dialog. */
export function printInBrowser(paper: PaperWidth): void {
  let style = document.getElementById(PAGE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = PAGE_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${paper}mm auto; margin: 0; }`;
  window.print();
}

/* ---------------- stage 2: direct ESC/POS ---------------- */

export type PrinterConnection = {
  kind: DirectKind;
  label: string;
  write: (bytes: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
};

// Minimal shapes of the Web Serial / Web Bluetooth APIs this file uses; they
// are not in TypeScript's DOM library.
type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  writable: WritableStream<Uint8Array> | null;
  getInfo?: () => { usbVendorId?: number; usbProductId?: number };
};
type SerialLike = {
  requestPort: () => Promise<SerialPortLike>;
  getPorts: () => Promise<SerialPortLike[]>;
};
type CharacteristicLike = {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
  writeValue: (value: BufferSource) => Promise<void>;
};
type ServiceLike = { getCharacteristics: () => Promise<CharacteristicLike[]> };
type BluetoothDeviceLike = {
  name?: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<{ getPrimaryServices: () => Promise<ServiceLike[]> }>;
    disconnect: () => void;
  };
};
type BluetoothLike = {
  requestDevice: (options: {
    acceptAllDevices: boolean;
    optionalServices: string[];
  }) => Promise<BluetoothDeviceLike>;
};

function serialApi(): SerialLike | null {
  return (navigator as unknown as { serial?: SerialLike }).serial ?? null;
}
function bluetoothApi(): BluetoothLike | null {
  return (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth ?? null;
}

export function directSupport(): Record<DirectKind, boolean> {
  if (typeof navigator === 'undefined') return { serial: false, bluetooth: false };
  return { serial: Boolean(serialApi()), bluetooth: Boolean(bluetoothApi()) };
}

async function openSerial(port: SerialPortLike): Promise<PrinterConnection> {
  await port.open({ baudRate: 9600 });
  const info = port.getInfo?.() ?? {};
  return {
    kind: 'serial',
    label:
      info.usbVendorId !== undefined
        ? `USB ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)}`
        : 'Serial',
    async write(bytes) {
      if (!port.writable) throw new Error('The printer is not accepting data.');
      const writer = port.writable.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        writer.releaseLock();
      }
    },
    close: () => port.close(),
  };
}

/** Needs a user gesture: the browser shows its own device picker. */
export async function connectSerialPrinter(): Promise<PrinterConnection> {
  const serial = serialApi();
  if (!serial) throw new Error('This browser cannot connect to a USB or serial printer.');
  return openSerial(await serial.requestPort());
}

/** Reopen a port this site was already allowed to use, without a picker. */
export async function reconnectSerialPrinter(): Promise<PrinterConnection | null> {
  const serial = serialApi();
  const [port] = serial ? await serial.getPorts() : [];
  return port ? openSerial(port) : null;
}

// Services common on BLE receipt printers; a printer outside these lists is
// found only after its own service is added here during certification (D5).
const BLE_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];
const BLE_CHUNK = 180;

/** Needs a user gesture: the browser shows its own device picker. */
export async function connectBluetoothPrinter(): Promise<PrinterConnection> {
  const bluetooth = bluetoothApi();
  if (!bluetooth) throw new Error('This browser cannot connect to a Bluetooth printer.');
  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_PRINTER_SERVICES,
  });
  if (!device.gatt) throw new Error('This Bluetooth device cannot be connected to.');
  const server = await device.gatt.connect();
  let target: CharacteristicLike | null = null;
  for (const service of await server.getPrimaryServices().catch(() => [])) {
    const characteristics = await service.getCharacteristics().catch(() => []);
    target =
      characteristics.find((c) => c.properties.writeWithoutResponse || c.properties.write) ?? null;
    if (target) break;
  }
  if (!target) {
    device.gatt.disconnect();
    throw new Error('No printer channel was found on this Bluetooth device.');
  }
  const channel = target;
  return {
    kind: 'bluetooth',
    label: device.name || 'Bluetooth',
    async write(bytes) {
      for (let offset = 0; offset < bytes.length; offset += BLE_CHUNK) {
        const chunk = bytes.slice(offset, offset + BLE_CHUNK);
        if (channel.properties.writeWithoutResponse && channel.writeValueWithoutResponse) {
          await channel.writeValueWithoutResponse(chunk);
        } else {
          await channel.writeValue(chunk);
        }
      }
    },
    async close() {
      device.gatt?.disconnect();
    },
  };
}
