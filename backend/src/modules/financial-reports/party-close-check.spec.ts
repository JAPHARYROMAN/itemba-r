import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PartyCloseCheckService } from './party-close-check.service';

/** Party linkage, Phase 3 PR-3: the reconciliation as a close gate, read-only, snapshotted. */
const report = (role: 'AP' | 'AR', rows: any[], untaggedControl = '0.00') => ({
  companyId: 'c1',
  role,
  kind: role === 'AP' ? 'supplier' : 'customer',
  asOf: new Date('2026-09-30T00:00:00.000Z'),
  baseCurrency: 'TZS',
  controlAccount: {
    id: role.toLowerCase(),
    accountCode: role === 'AP' ? '2000' : '1100',
    accountName: role,
  },
  rows,
  untaggedControl,
  totals: { control: '0.00', subLedger: '0.00', difference: '0.00' },
  partiesWithDifference: rows.filter((r) => Number(r.difference) !== 0).length,
});
function setup(ap: any[] = [], ar: any[] = [], untagged: { ap?: string; ar?: string } = {}) {
  const prisma: any = { partyBalanceSnapshot: { findMany: jest.fn(async () => []) } };
  const reports: any = {
    getControlByParty: jest.fn(async (_c: string, role: 'AP' | 'AR') =>
      role === 'AP' ? report('AP', ap, untagged.ap) : report('AR', ar, untagged.ar),
    ),
  };
  const service = new PartyCloseCheckService(prisma, reports);
  return { prisma, reports, service, user: { id: 'u' } as any };
}
const supplierRow = (difference: string) => ({
  partyId: 'sup-1',
  name: 'Mwanjalisi',
  code: 'SUP-1',
  control: '100.00',
  subLedger: (100 - Number(difference)).toFixed(2),
  difference,
  documents: 1,
});

describe('PartyCloseCheckService', () => {
  it('runs both roles as of the given date and reports differences and untagged control', async () => {
    const { service, user, reports } = setup([supplierRow('20.00')], [], { ar: '5.00' });
    const check = await service.check('c1', new Date('2026-09-30T00:00:00.000Z'), user);
    expect(reports.getControlByParty.mock.calls.map((c: any[]) => [c[1], c[2]])).toEqual([
      ['AP', '2026-09-30T00:00:00.000Z'],
      ['AR', '2026-09-30T00:00:00.000Z'],
    ]);
    expect(check.rows).toHaveLength(1);
    expect(check.differences[0]).toMatchObject({ role: 'AP', kind: 'supplier', partyId: 'sup-1' });
    expect(check.untagged).toEqual({ ap: '0.00', ar: '5.00' });
    expect(check.hasDifferences).toBe(true);
  });

  it('agrees when every party reconciles and nothing is untagged', async () => {
    const { service, user } = setup([supplierRow('0.00')]);
    const check = await service.check('c1', new Date(), user);
    expect(check.hasDifferences).toBe(false);
    expect(check.differences).toEqual([]);
    await expect(service.checkOrRefuse('c1', new Date(), user)).resolves.toMatchObject({
      hasDifferences: false,
    });
  });

  it('refuses a close with differences unless acknowledged, naming them', async () => {
    const { service, user } = setup([supplierRow('20.00')], [], { ar: '5.00' });
    const asOf = new Date('2026-09-30T00:00:00.000Z');
    await expect(service.checkOrRefuse('c1', asOf, user)).rejects.toMatchObject({
      response: {
        code: 'PARTY_CONTROL_DIFFERENCES',
        message:
          'Control accounts do not agree with the sub-ledger as of 2026-09-30: 1 party differs from the sub-ledger; AR control without a party 5.00. Review the differences and close with a reason.',
        untagged: { ap: '0.00', ar: '5.00' },
      },
    });
    await expect(service.checkOrRefuse('c1', asOf, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const check = await service.checkOrRefuse('c1', asOf, user, {
      reason: 'Legacy lines await the backfill',
    });
    expect(service.auditMetadata(check, { reason: 'Legacy lines await the backfill' })).toEqual({
      partyControl: expect.objectContaining({
        asOf: '2026-09-30T00:00:00.000Z',
        differences: 1,
        untagged: { ap: '0.00', ar: '5.00' },
        acknowledged: true,
        reason: 'Legacy lines await the backfill',
      }),
    });
  });

  it('snapshots every party row plus a NONE row per untagged role, sharing one snapshotAt', async () => {
    const { service, user } = setup(
      [supplierRow('20.00')],
      [
        {
          partyId: 'cus-1',
          name: 'Westsides',
          code: null,
          control: '50.00',
          subLedger: '50.00',
          difference: '0.00',
          documents: 2,
        },
      ],
      { ap: '7.00' },
    );
    const check = await service.check('c1', new Date(), user);
    const tx: any = {
      partyBalanceSnapshot: {
        createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
      },
    };
    const count = await service.snapshot(
      tx,
      { companyId: 'c1', accountingPeriodId: 'p1', periodCloseId: 'pc1', userId: 'u' },
      check,
    );
    expect(count).toBe(3);
    const { data } = tx.partyBalanceSnapshot.createMany.mock.calls[0][0];
    expect(
      data.map((r: any) => [
        r.role,
        r.partyType,
        r.partyId,
        r.partyName,
        r.control,
        r.subLedger,
        r.difference,
      ]),
    ).toEqual([
      ['AP', 'SUPPLIER', 'sup-1', 'Mwanjalisi', '100.00', '80.00', '20.00'],
      ['AR', 'CUSTOMER', 'cus-1', 'Westsides', '50.00', '50.00', '0.00'],
      ['AP', 'NONE', null, null, '7.00', '0.00', '7.00'],
    ]);
    expect(new Set(data.map((r: any) => r.snapshotAt.getTime())).size).toBe(1);
    expect(data[0]).toMatchObject({
      companyId: 'c1',
      accountingPeriodId: 'p1',
      periodCloseId: 'pc1',
      currency: 'TZS',
      createdById: 'u',
    });
    expect(
      await service.snapshot(
        tx,
        { companyId: 'c1', accountingPeriodId: 'p1', userId: 'u' },
        { ...check, rows: [], untagged: { ap: '0.00', ar: '0.00' } },
      ),
    ).toBe(0);
  });

  it('reads back the latest close as a set and counts the closes recorded', async () => {
    const { service, prisma } = setup();
    const t1 = new Date('2026-10-01T10:00:00.000Z');
    const t0 = new Date('2026-09-30T10:00:00.000Z');
    const row = (
      id: string,
      snapshotAt: Date,
      partyType: string,
      partyId: string | null,
      difference: string,
    ) => ({
      id,
      role: 'AP',
      partyType,
      partyId,
      partyName: partyId ? 'Mwanjalisi' : null,
      currency: 'TZS',
      snapshotAt,
      subLedger: new Prisma.Decimal('80'),
      control: new Prisma.Decimal('100'),
      difference: new Prisma.Decimal(difference),
    });
    prisma.partyBalanceSnapshot.findMany.mockResolvedValue([
      row('a', t1, 'SUPPLIER', 'sup-1', '20'),
      row('b', t1, 'NONE', null, '7'),
      row('c', t0, 'SUPPLIER', 'sup-1', '0'),
    ]);
    const result = await service.snapshots('p1');
    expect(result).toMatchObject({
      accountingPeriodId: 'p1',
      snapshotAt: t1,
      closes: 2,
      currency: 'TZS',
      differences: 2,
    });
    expect(result.rows).toEqual([
      expect.objectContaining({
        id: 'a',
        kind: 'supplier',
        partyId: 'sup-1',
        subLedger: '80.00',
        control: '100.00',
        difference: '20.00',
      }),
      expect.objectContaining({ id: 'b', kind: null, partyType: 'NONE', difference: '7.00' }),
    ]);
    prisma.partyBalanceSnapshot.findMany.mockResolvedValue([]);
    expect(await service.snapshots('p2')).toMatchObject({
      snapshotAt: null,
      closes: 0,
      rows: [],
      differences: 0,
    });
  });
});
