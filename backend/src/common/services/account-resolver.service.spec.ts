import { BadRequestException } from '@nestjs/common';
import { AccountResolverService } from './account-resolver.service';

describe('AccountResolverService', () => {
  function makeService(rows: any[]) {
    const prisma = {
      chartOfAccount: {
        findMany: async ({ where }: any) => {
          const subtypeFilter = where.OR?.find((item: any) => item.accountSubType)?.accountSubType;
          const codeFilter = where.OR?.find((item: any) => item.accountCode)?.accountCode;
          return rows.filter((r) => {
            if (r.companyId !== where.companyId) return false;
            if (r.deletedAt) return false;
            if (r.isActive === false) return false;
            const subtypeMatch =
              subtypeFilter?.in?.some(
                (want: string) => r.accountSubType?.toLowerCase() === want.toLowerCase(),
              ) ?? false;
            const codeMatch = codeFilter?.in?.includes(r.accountCode) ?? false;
            return subtypeMatch || codeMatch;
          });
        },
        findFirst: async ({ where }: any) => {
          // Match by accountSubType (case-insensitive) first.
          if (where.accountSubType?.equals) {
            const want = (where.accountSubType.equals as string).toLowerCase();
            return (
              rows.find(
                (r) => r.companyId === where.companyId && r.accountSubType?.toLowerCase() === want,
              ) ?? null
            );
          }
          // Otherwise match by accountCode IN list, sorted asc.
          if (where.accountCode?.in) {
            const codes = where.accountCode.in as string[];
            const matches = rows
              .filter((r) => r.companyId === where.companyId && codes.includes(r.accountCode))
              .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
            return matches[0] ?? null;
          }
          return null;
        },
      },
    } as any;
    return new AccountResolverService(prisma);
  }

  it('resolves by accountSubType when set (preferred path)', async () => {
    const svc = makeService([
      {
        id: 'a1',
        companyId: 'co-1',
        accountCode: '9999',
        accountName: 'Cash A',
        accountSubType: 'cash_on_hand',
      },
    ]);
    const got = await svc.resolve('co-1', 'CASH_ON_HAND');
    expect(got.id).toBe('a1');
  });

  it('falls back to conventional codes when subtype is unset', async () => {
    const svc = makeService([
      {
        id: 'a2',
        companyId: 'co-1',
        accountCode: '1010',
        accountName: 'Cash on hand',
        accountSubType: null,
      },
    ]);
    const got = await svc.resolve('co-1', 'CASH_ON_HAND');
    expect(got.accountCode).toBe('1010');
  });

  it('prefers a subtype match over a conventional-code match', async () => {
    const svc = makeService([
      { id: 'sub', companyId: 'co-1', accountCode: '9999', accountSubType: 'cash_on_hand' },
      { id: 'code', companyId: 'co-1', accountCode: '1010', accountSubType: null },
    ]);
    const got = await svc.resolve('co-1', 'CASH_ON_HAND');
    expect(got.id).toBe('sub');
  });

  it('throws BadRequestException when no account matches', async () => {
    const svc = makeService([]);
    await expect(svc.resolve('co-1', 'CASH_ON_HAND')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('matches subtype case-insensitively', async () => {
    const svc = makeService([
      { id: 'a3', companyId: 'co-1', accountCode: '0', accountSubType: 'CASH_ON_HAND' },
    ]);
    const got = await svc.resolve('co-1', 'CASH_ON_HAND');
    expect(got.id).toBe('a3');
  });

  it('resolveMany returns a record keyed by role', async () => {
    const svc = makeService([
      { id: 'cash', companyId: 'co-1', accountCode: '1010', accountSubType: null },
      { id: 'ar', companyId: 'co-1', accountCode: '1100', accountSubType: null },
    ]);
    const got = await svc.resolveMany('co-1', ['CASH_ON_HAND', 'AR_CONTROL']);
    expect(got.CASH_ON_HAND.id).toBe('cash');
    expect(got.AR_CONTROL.id).toBe('ar');
  });

  it('resolveMany throws if any role is unmappable', async () => {
    const svc = makeService([
      { id: 'cash', companyId: 'co-1', accountCode: '1010', accountSubType: null },
      // No AR account
    ]);
    await expect(svc.resolveMany('co-1', ['CASH_ON_HAND', 'AR_CONTROL'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
