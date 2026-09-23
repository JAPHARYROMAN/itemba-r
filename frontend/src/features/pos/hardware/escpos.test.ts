import { describe, expect, it } from 'vitest';
import {
  ESCPOS,
  encodeDrawerKick,
  encodeReceipt,
  receiptTextLines,
  toPrinterText,
  twoColumns,
} from './escpos';
import type { ReceiptModel } from './receipt';

const LABELS = {
  title: 'RISITI',
  total: 'Jumla',
  received: 'Amepokea',
  change: 'Chenji',
  customer: 'Mteja',
  held: 'Imehifadhiwa kwenye simu - bado haijatumwa',
  thanks: 'Asante',
};

function model(overrides: Partial<ReceiptModel> = {}): ReceiptModel {
  return {
    company: 'Itemba Group',
    branch: 'Kisimani Main',
    terminal: 'Kaunta ya Mbele',
    rep: 'Jofu K.',
    orderNumber: 'SO-2026-000123',
    held: false,
    issuedAt: new Date(2026, 8, 23, 14, 5),
    lines: [
      { name: 'Soda Baridi 500ml', quantity: 4, unitPrice: 1200, total: 4800 },
      { name: 'Mafuta ya Kupikia 5L', quantity: 1, unitPrice: 30500, total: 30500 },
    ],
    total: 35300,
    paymentLabel: 'Taslimu',
    received: 40000,
    change: 4700,
    customer: null,
    ...overrides,
  };
}

function contains(haystack: Uint8Array, needle: readonly number[]) {
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((byte, j) => haystack[i + j] === byte)) return true;
  }
  return false;
}

describe('receipt text for a thermal roll', () => {
  it.each([32, 48] as const)('never exceeds %i columns', (columns) => {
    const lines = receiptTextLines(model(), LABELS, columns);
    for (const line of lines) expect(line.text.length).toBeLessThanOrEqual(columns);
  });

  it('puts every line total and the grand total on the right edge', () => {
    const lines = receiptTextLines(model(), LABELS, 32).map((line) => line.text);
    expect(lines).toContain('  1 x 30,500              30,500');
    expect(lines).toContain('Jumla                 TZS 35,300');
    expect(lines).toContain('Chenji                     4,700');
  });

  it('marks a held sale and prints no order number for it', () => {
    const lines = receiptTextLines(model({ held: true, orderNumber: null }), LABELS, 48).map(
      (line) => line.text,
    );
    expect(lines.join('\n')).toContain('bado haijatumwa');
    expect(lines.join('\n')).not.toContain('SO-');
  });

  it('keeps text printable on any ESC/POS code page', () => {
    expect(toPrinterText('Kahawa · Café “Bora” – 1')).toBe('Kahawa - Cafe "Bora" - 1');
    expect(twoColumns('A very long product name indeed', '99', 12)).toBe('A very lo 99');
  });
});

describe('ESC/POS bytes', () => {
  it('initialises, cuts, and opens the drawer only when asked', () => {
    const plain = encodeReceipt(model(), LABELS, { columns: 48 });
    expect(Array.from(plain.slice(0, 2))).toEqual([...ESCPOS.init]);
    expect(contains(plain, ESCPOS.feedAndCut)).toBe(true);
    expect(contains(plain, ESCPOS.openDrawer)).toBe(false);

    const withDrawer = encodeReceipt(model(), LABELS, { columns: 48, openDrawer: true });
    expect(Array.from(withDrawer.slice(-ESCPOS.openDrawer.length))).toEqual([...ESCPOS.openDrawer]);
  });

  it('sends only 7-bit printable text between commands', () => {
    const bytes = encodeReceipt(model({ customer: 'Asha Duka' }), LABELS, { columns: 32 });
    const text = new TextDecoder().decode(bytes.filter((b) => b >= 0x20 && b < 0x7f));
    expect(text).toContain('Soda Baridi 500ml');
    expect(text).toContain('Asha Duka');
  });

  it('can kick the drawer on its own', () => {
    expect(Array.from(encodeDrawerKick())).toEqual([...ESCPOS.init, ...ESCPOS.openDrawer]);
  });
});
