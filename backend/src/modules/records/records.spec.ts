import 'reflect-metadata';
import { Prisma, RecordEntry } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { RecordsController } from './records.controller';
import { csvCell, presentRecord, recordValues, requestKey } from './records.domain';
import { CreateRecordDto } from './records.dto';
const base = {
  requestId: '0f24076d-7f8e-4f4f-a9c3-bc5cc8983247',
  kind: 'DEBTOR',
  title: ' Advance ',
  counterparty: ' Person ',
  currency: 'TZS',
  amount: '100.30',
  recordDate: '2026-01-01',
  dueDate: '2026-01-15',
};
describe('Independent Records domain and endpoint permissions', () => {
  it('normalises optional organisation without inventing links', () => {
    const value = recordValues(base);
    expect(value.title).toBe('Advance');
    expect(value.counterparty).toBe('Person');
    expect(value.companyId).toBeNull();
    expect(value.divisionId).toBeNull();
    expect(value.amount.toFixed(2)).toBe('100.30');
  });
  it('keeps debt balance precise and marks overdue independently', () => {
    const row = {
      ...recordValues(base),
      settledAmount: new Prisma.Decimal('0.10'),
      voidedAt: null,
    } as RecordEntry;
    expect(presentRecord(row)).toMatchObject({ balance: '100.20', status: 'overdue' });
    expect(presentRecord({ ...row, settledAmount: row.amount })).toMatchObject({
      balance: '0.00',
      status: 'settled',
    });
    expect(presentRecord({ ...row, kind: 'SALE' })).toMatchObject({
      balance: '0.00',
      status: 'recorded',
    });
  });
  it.each([
    { amount: '0' },
    { counterparty: ' ' },
    { title: ' ' },
    { dueDate: '2025-12-31' },
    { kind: 'EXPENSE' },
    { divisionId: 'division' },
    { companyId: 'company', branchId: 'branch' },
    { kind: 'NOTE', amount: '20' },
  ])('rejects invalid record %j', (change) => {
    expect(() => recordValues({ ...base, ...change })).toThrow();
  });
  it('accepts notes without money', () => {
    expect(
      recordValues({ ...base, kind: 'NOTE', amount: '0', dueDate: null }).amount.isZero(),
    ).toBe(true);
  });
  it.each(['1.001', '-20', '1e6', '1000000000000', 'Infinity'])(
    'rejects amount %s at the DTO boundary',
    async (amount) => {
      const errors = await validate(plainToInstance(CreateRecordDto, { ...base, amount }));
      expect(errors.some((e) => e.property === 'amount')).toBe(true);
    },
  );
  it('rejects invalid calendar dates', async () => {
    const errors = await validate(
      plainToInstance(CreateRecordDto, { ...base, recordDate: '2026-02-30' }),
    );
    expect(errors.some((e) => e.property === 'recordDate')).toBe(true);
  });
  it('hashes request payloads independently of property order', () => {
    expect(requestKey({ amount: '10', title: 'x' })).toBe(requestKey({ title: 'x', amount: '10' }));
    expect(requestKey({ amount: '11', title: 'x' })).not.toBe(
      requestKey({ amount: '10', title: 'x' }),
    );
  });
  it('quotes CSV and neutralises formula injection', () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    for (const value of ['=1+1', '+cmd', '-2', '@sum', '\t =evil', '\r+cmd'])
      expect(csvCell(value)).toBe(`"'${value}"`);
  });
  it('uses only Records permissions and protects all mutations and exports', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, RecordsController)).toEqual(['records.view']);
    for (const method of ['create', 'update', 'settle', 'reverse', 'void'] as const)
      expect(Reflect.getMetadata(PERMISSIONS_KEY, RecordsController.prototype[method])).toEqual([
        'records.view',
        'records.manage',
      ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, RecordsController.prototype.export)).toEqual([
      'records.view',
      'records.export',
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, RecordsController.prototype.exportStatement),
    ).toEqual(['records.view', 'records.export']);
  });
});
