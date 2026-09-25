import { describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook } from '@testing-library/react';
import { emptyScanBuffer, feedScanKey, productForCode, useScanner } from './scanner';

function feed(keys: Array<[string, number]>) {
  let buffer = emptyScanBuffer();
  const codes: string[] = [];
  for (const [key, at] of keys) {
    const result = feedScanKey(buffer, key, at);
    buffer = result.buffer;
    if (result.code) codes.push(result.code);
  }
  return codes;
}

const burst = (text: string, start = 1000, gap = 8): Array<[string, number]> => [
  ...text.split('').map((char, index): [string, number] => [char, start + index * gap]),
  ['Enter', start + text.length * gap],
];

describe('feedScanKey', () => {
  it('reads a fast burst ending in Enter as one scan', () => {
    expect(feed(burst('6200001234567'))).toEqual(['6200001234567']);
  });

  it('ignores a person typing the same keys', () => {
    expect(feed(burst('6200', 1000, 180))).toEqual([]);
  });

  it('ignores a burst too short to be a barcode', () => {
    expect(feed(burst('62'))).toEqual([]);
  });

  it('starts over after a pause, so typed keys never prefix a scan', () => {
    const keys: Array<[string, number]> = [['9', 0], ['9', 200], ...burst('4006381333931', 900)];
    expect(feed(keys)).toEqual(['4006381333931']);
  });

  it('drops the burst on a non-character key', () => {
    const keys: Array<[string, number]> = [
      ['1', 0],
      ['2', 8],
      ['Shift', 16],
      ['3', 24],
      ['Enter', 32],
    ];
    expect(feed(keys)).toEqual([]);
  });
});

describe('productForCode', () => {
  const catalog = [
    { id: 'a', name: 'Soda', code: 'SODA', barcode: '6200001', sellingPrice: 1200 },
    { id: 'b', name: 'Maji', code: 'MAJI-15', barcode: null, sellingPrice: 1000 },
  ] as never[];

  it('matches a barcode exactly, then a product code, ignoring case and spaces', () => {
    expect(productForCode(catalog, ' 6200001 ')).toMatchObject({ id: 'a' });
    expect(productForCode(catalog, 'maji-15')).toMatchObject({ id: 'b' });
  });

  it('never matches a partial code', () => {
    expect(productForCode(catalog, '62000')).toBeUndefined();
    expect(productForCode(catalog, '')).toBeUndefined();
  });
});

it('does not add scanner input belonging to another desktop window', () => {
  const scan = vi.fn();
  let time = 0;
  const now = () => (time += 8);
  const { rerender } = renderHook(
    ({ active }) => useScanner(scan, { now, acceptEvent: () => active }),
    { initialProps: { active: false } },
  );
  const send = () => [...'6200001', 'Enter'].forEach((key) => fireEvent.keyDown(window, { key }));
  send();
  expect(scan).not.toHaveBeenCalled();
  rerender({ active: true });
  send();
  expect(scan).toHaveBeenCalledExactlyOnceWith('6200001');
});
