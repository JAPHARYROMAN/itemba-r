import { receiptAmount, receiptTime, type ReceiptModel } from './receipt';

/**
 * ESC/POS encoding for 58 mm (32 columns) and 80 mm (48 columns) thermal
 * printers. Only the commands every ESC/POS printer shares are used; model
 * certification is owner decision D5 and still open, so nothing here is
 * claimed to work on a specific printer until it has been tried on one.
 */
export type ReceiptLabels = {
  title: string;
  total: string;
  received: string;
  change: string;
  customer: string;
  held: string;
  thanks: string;
};

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const ESCPOS = {
  init: [ESC, 0x40],
  alignLeft: [ESC, 0x61, 0],
  alignCenter: [ESC, 0x61, 1],
  boldOn: [ESC, 0x45, 1],
  boldOff: [ESC, 0x45, 0],
  doubleHeight: [GS, 0x21, 0x01],
  normalSize: [GS, 0x21, 0x00],
  /** Feed three lines, then a partial cut. */
  feedAndCut: [GS, 0x56, 0x42, 0x03],
  /** Pulse drawer pin 2 for 50 ms on, 500 ms off: the common kick. */
  openDrawer: [ESC, 0x70, 0x00, 0x19, 0xfa],
} as const;

/** Printable ASCII only; accents are folded and anything else becomes '?'. */
export function toPrinterText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[·•]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?');
}

/** Left text and right text on one line, the left cut to fit. */
export function twoColumns(left: string, right: string, columns: number): string {
  const room = Math.max(columns - right.length - 1, 1);
  const cut = left.length > room ? left.slice(0, room) : left;
  return cut + ' '.repeat(columns - cut.length - right.length) + right;
}

function wrap(text: string, columns: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word.slice(0, columns);
    else if (current.length + 1 + word.length <= columns) current += ` ${word}`;
    else {
      lines.push(current);
      current = word.slice(0, columns);
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function receiptTextLines(
  model: ReceiptModel,
  labels: ReceiptLabels,
  columns: 32 | 48,
): Array<{ text: string; bold?: boolean; center?: boolean; big?: boolean }> {
  const rule = '-'.repeat(columns);
  const out: Array<{ text: string; bold?: boolean; center?: boolean; big?: boolean }> = [];
  out.push({ text: model.company, bold: true, center: true });
  out.push({ text: model.branch, center: true });
  out.push({ text: labels.title, bold: true, center: true });
  if (model.orderNumber) out.push({ text: model.orderNumber, center: true });
  out.push({ text: receiptTime(model.issuedAt), center: true });
  if (model.held) out.push(...wrap(labels.held, columns).map((text) => ({ text, center: true })));
  out.push({ text: rule });
  for (const line of model.lines) {
    out.push(...wrap(line.name, columns).map((text) => ({ text })));
    out.push({
      text: twoColumns(
        `  ${line.quantity} x ${receiptAmount(line.unitPrice)}`,
        receiptAmount(line.total),
        columns,
      ),
    });
  }
  out.push({ text: rule });
  out.push({
    text: twoColumns(labels.total, `TZS ${receiptAmount(model.total)}`, columns),
    bold: true,
    big: true,
  });
  out.push({ text: twoColumns(model.paymentLabel, receiptAmount(model.total), columns) });
  if (model.received !== null) {
    out.push({ text: twoColumns(labels.received, receiptAmount(model.received), columns) });
    out.push({ text: twoColumns(labels.change, receiptAmount(model.change ?? 0), columns) });
  }
  if (model.customer) out.push({ text: twoColumns(labels.customer, model.customer, columns) });
  out.push({ text: rule });
  out.push({ text: `${model.rep} - ${model.terminal}`, center: true });
  out.push({ text: labels.thanks, center: true });
  return out.map((line) => ({ ...line, text: toPrinterText(line.text) }));
}

export function encodeReceipt(
  model: ReceiptModel,
  labels: ReceiptLabels,
  { columns, openDrawer = false }: { columns: 32 | 48; openDrawer?: boolean },
): Uint8Array {
  const bytes: number[] = [...ESCPOS.init];
  for (const line of receiptTextLines(model, labels, columns)) {
    bytes.push(...(line.center ? ESCPOS.alignCenter : ESCPOS.alignLeft));
    if (line.bold) bytes.push(...ESCPOS.boldOn);
    if (line.big) bytes.push(...ESCPOS.doubleHeight);
    for (const char of line.text) bytes.push(char.charCodeAt(0));
    bytes.push(LF);
    if (line.big) bytes.push(...ESCPOS.normalSize);
    if (line.bold) bytes.push(...ESCPOS.boldOff);
  }
  bytes.push(...ESCPOS.alignLeft, ...ESCPOS.feedAndCut);
  if (openDrawer) bytes.push(...ESCPOS.openDrawer);
  return Uint8Array.from(bytes);
}

/** Just the drawer pulse, for a cash sale that prints nothing. */
export function encodeDrawerKick(): Uint8Array {
  return Uint8Array.from([...ESCPOS.init, ...ESCPOS.openDrawer]);
}
