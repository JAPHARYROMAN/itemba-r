import { Prisma } from '@prisma/client';
import { cashDate, checkDailyBalances, payloadKey } from './cash-desk.domain';
import { CashDeskController } from './cash-desk.controller';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
const d = (x: string) => new Prisma.Decimal(x);
describe('Cash Desk ledger', () => {
  it('preserves exact cents across large amounts', () => {
    expect(
      checkDailyBalances(
        [{ businessDate: new Date('2026-01-01'), amount: d('9999999999999999.99') }],
        new Date('2026-01-02'),
        d('-0.10'),
      ).toFixed(2),
    ).toBe('9999999999999999.89');
  });
  it('rejects a backdated withdrawal funded only by a later receipt', () => {
    expect(() =>
      checkDailyBalances(
        [{ businessDate: new Date('2026-01-10'), amount: d('100') }],
        new Date('2026-01-01'),
        d('-20'),
      ),
    ).toThrow('negative balance on 2026-01-01');
  });
  it('checks all subsequent days when reversing an earlier receipt', () => {
    expect(() =>
      checkDailyBalances(
        [
          { businessDate: new Date('2026-01-01'), amount: d('100') },
          { businessDate: new Date('2026-01-02'), amount: d('-80') },
          { businessDate: new Date('2026-01-03'), amount: d('100') },
        ],
        new Date('2026-01-01'),
        d('-50'),
      ),
    ).toThrow('2026-01-02');
  });
  it('allows receipts and payments within the same business day', () => {
    expect(
      checkDailyBalances(
        [{ businessDate: new Date('2026-01-01'), amount: d('0.30') }],
        new Date('2026-01-01'),
        d('-0.20'),
      ).toFixed(2),
    ).toBe('0.10');
  });
  it.each(['2026-02-30', '2099-01-01', 'garbage', '2026-01-01T12:00:00Z'])(
    'rejects invalid/future business date %s',
    (value) => expect(() => cashDate(value)).toThrow(),
  );
  it('fingerprints retries independent of JSON property order', () => {
    expect(payloadKey({ amount: '20', reference: 'A' })).toBe(
      payloadKey({ reference: 'A', amount: '20' }),
    );
    expect(payloadKey({ amount: '20' })).not.toBe(payloadKey({ amount: '21' }));
  });
  it('requires app access with each write permission', () => {
    for (const [method, permission] of [
      ['create', 'manage'],
      ['record', 'record'],
      ['reverse', 'reverse'],
    ] as const)
      expect(Reflect.getMetadata(PERMISSIONS_KEY, CashDeskController.prototype[method])).toEqual([
        'cash_desk.view',
        `cash_desk.${permission}`,
      ]);
  });
});
