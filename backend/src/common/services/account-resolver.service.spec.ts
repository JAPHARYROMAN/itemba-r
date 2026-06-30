import { BadRequestException } from '@nestjs/common';
import { AccountResolverService, AccountRole, CONVENTIONAL_CODES } from './account-resolver.service';

describe('AccountResolverService', () => {
  function makeService(rows: any[]) {
    const prisma = {
      chartOfAccount: {
        findMany: async ({ where }: any) => {
          const subtypeFilter = where.OR?.find((item: any) => item.accountSubType)?.accountSubType;
          const codeFilter = where.OR?.find((item: any) => item.accountCode)?.accountCode;
          const directCodeFilter = where.accountCode;
          return rows.filter((r) => {
            if (r.companyId !== where.companyId) return false;
            if (r.deletedAt) return false;
            if (r.isActive === false) return false;
            const subtypeMatch =
              subtypeFilter?.in?.some(
                (want: string) => r.accountSubType?.toLowerCase() === want.toLowerCase(),
              ) ?? false;
            const codeMatch = codeFilter?.in?.includes(r.accountCode) ?? false;
            const directCodeMatch = directCodeFilter?.in?.includes(r.accountCode) ?? false;
            return subtypeMatch || codeMatch || directCodeMatch;
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

  it('uses conventional code priority instead of lexical ordering', async () => {
    const svc = makeService([
      { id: 'bank', companyId: 'co-1', accountCode: '1010', accountSubType: null },
      { id: 'cash', companyId: 'co-1', accountCode: '1000', accountSubType: null },
    ]);
    const got = await svc.resolve('co-1', 'CASH_ON_HAND');
    expect(got.id).toBe('cash');
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
      { id: 'cash', companyId: 'co-1', accountCode: '1000', accountSubType: null },
      { id: 'bank', companyId: 'co-1', accountCode: '1020', accountSubType: null },
      { id: 'ar', companyId: 'co-1', accountCode: '1100', accountSubType: null },
    ]);
    const got = await svc.resolveMany('co-1', ['CASH_ON_HAND', 'BANK', 'AR_CONTROL']);
    expect(got.CASH_ON_HAND.id).toBe('cash');
    expect(got.BANK.id).toBe('bank');
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

  // --- Finding #23: fallback codes must not overlap across AP / expense / cash roles ---

  it('conventional fallback codes are disjoint across all roles', () => {
    const seen = new Map<string, AccountRole>();
    for (const role of Object.keys(CONVENTIONAL_CODES) as AccountRole[]) {
      for (const code of CONVENTIONAL_CODES[role]) {
        const clash = seen.get(code);
        expect(clash).toBeUndefined();
        seen.set(code, role);
      }
    }
  });

  it('keeps AP / expense / cash families on distinct codes (no cross-family overlap)', () => {
    const ap = new Set(CONVENTIONAL_CODES.AP_CONTROL);
    const cash = new Set([...CONVENTIONAL_CODES.CASH_ON_HAND, ...CONVENTIONAL_CODES.BANK]);
    const expense = new Set([
      ...CONVENTIONAL_CODES.GENERAL_EXPENSE,
      ...CONVENTIONAL_CODES.PURCHASE_VARIANCE,
      ...CONVENTIONAL_CODES.COST_OF_GOODS_SOLD,
    ]);
    for (const code of ap) {
      expect(cash.has(code)).toBe(false);
      expect(expense.has(code)).toBe(false);
    }
    for (const code of cash) {
      expect(expense.has(code)).toBe(false);
    }
  });

  it('resolveMany maps the AP / expense / cash trio to three distinct accounts', async () => {
    const svc = makeService([
      { id: 'exp', companyId: 'co-1', accountCode: '6900', accountSubType: null },
      { id: 'ap', companyId: 'co-1', accountCode: '2000', accountSubType: null },
      { id: 'cash', companyId: 'co-1', accountCode: '1000', accountSubType: null },
    ]);
    const got = await svc.resolveMany('co-1', ['GENERAL_EXPENSE', 'AP_CONTROL', 'CASH_ON_HAND']);
    const ids = [got.GENERAL_EXPENSE.id, got.AP_CONTROL.id, got.CASH_ON_HAND.id];
    expect(new Set(ids).size).toBe(3);
  });

  it('resolveMany throws when two roles collapse onto the same account (mis-seeded chart)', async () => {
    // One physical account carries GENERAL_EXPENSE's subtype AND AP_CONTROL's fallback
    // code 2000, so GENERAL_EXPENSE resolves by subtype and AP_CONTROL by code onto the
    // SAME row. The guard must reject this rather than emit a self-cancelling JE.
    const svc = makeService([
      {
        id: 'shared',
        companyId: 'co-1',
        accountCode: '2000',
        accountSubType: 'general_expense',
      },
    ]);
    await expect(
      svc.resolveMany('co-1', ['GENERAL_EXPENSE', 'AP_CONTROL']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolveMany allows the same role requested twice (dedup, not a collision)', async () => {
    const svc = makeService([
      { id: 'ap', companyId: 'co-1', accountCode: '2000', accountSubType: null },
    ]);
    const got = await svc.resolveMany('co-1', ['AP_CONTROL', 'AP_CONTROL']);
    expect(got.AP_CONTROL.id).toBe('ap');
  });
});
