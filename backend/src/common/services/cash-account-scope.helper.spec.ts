import { BadRequestException } from '@nestjs/common';
import {
  assertCashAccountForScope,
  assertCashAccountScopeCompatible,
  resolveCashAccountForScope,
} from './cash-account-scope.helper';

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cash-1',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    accountType: 'CASH_ON_HAND',
    accountName: 'Kariakoo Cash',
    currency: 'TZS',
    ...overrides,
  } as any;
}

/** db mock whose findFirst returns a fixed row (or null). */
function dbReturning(row: any) {
  return { cashAccount: { findFirst: jest.fn(async () => row) } } as any;
}

/**
 * db mock that actually interprets the where clause over a roster, so tier
 * ordering and never-cross-branch behaviour are tested against real filter
 * semantics (companyId, currency, accountType.in, branchId, divisionId, OR),
 * with oldest-createdAt-first selection inside a tier.
 */
function dbWithRoster(roster: any[]) {
  const matches = (row: any, where: any): boolean => {
    if (where.companyId && row.companyId !== where.companyId) return false;
    if (where.currency && row.currency !== where.currency) return false;
    if (where.accountType?.in && !where.accountType.in.includes(row.accountType)) return false;
    if ('branchId' in where && row.branchId !== where.branchId) return false;
    if ('divisionId' in where && row.divisionId !== where.divisionId) return false;
    if (where.OR && !where.OR.some((clause: any) => matches(row, clause))) return false;
    return true;
  };
  const findFirst = jest.fn(async ({ where }: any) => {
    const hit = roster
      .filter((row) => row.deletedAt == null && row.isActive !== false && matches(row, where))
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    return hit ? { ...hit } : null;
  });
  return { db: { cashAccount: { findFirst } } as any, findFirst };
}

describe('assertCashAccountScopeCompatible', () => {
  describe('strict mode (sales-orders semantics)', () => {
    const strict = { requireScopeForNonBank: true };

    it('accepts a non-BANK account whose division and branch both match', () => {
      expect(() =>
        assertCashAccountScopeCompatible(
          account(),
          { divisionId: 'division-1', branchId: 'branch-1' },
          strict,
        ),
      ).not.toThrow();
    });

    it('rejects a non-BANK account when the caller has no branch context at all', () => {
      expect(() => assertCashAccountScopeCompatible(account(), {}, strict)).toThrow(
        'Cash account does not belong to the selected division',
      );
    });

    it('rejects a non-BANK account scoped to another division', () => {
      expect(() =>
        assertCashAccountScopeCompatible(
          account({ divisionId: 'division-2' }),
          { divisionId: 'division-1', branchId: 'branch-1' },
          strict,
        ),
      ).toThrow('Cash account does not belong to the selected division');
    });

    it('rejects a non-BANK account scoped to another branch', () => {
      expect(() =>
        assertCashAccountScopeCompatible(
          account({ branchId: 'branch-2' }),
          { divisionId: 'division-1', branchId: 'branch-1' },
          strict,
        ),
      ).toThrow('Cash account does not belong to the selected branch');
    });

    it('rejects an unscoped (NULL-branch) non-BANK account in strict mode', () => {
      expect(() =>
        assertCashAccountScopeCompatible(
          account({ divisionId: null, branchId: null }),
          { divisionId: 'division-1', branchId: 'branch-1' },
          strict,
        ),
      ).toThrow('Cash account does not belong to the selected division');
    });

    it('accepts an unscoped BANK account even in strict mode (company-wide bank)', () => {
      expect(() =>
        assertCashAccountScopeCompatible(
          account({ accountType: 'BANK', divisionId: null, branchId: null }),
          { divisionId: 'division-1', branchId: 'branch-1' },
          strict,
        ),
      ).not.toThrow();
    });

    it('rejects a BANK account only on a set-vs-set mismatch', () => {
      expect(() =>
        assertCashAccountScopeCompatible(
          account({ accountType: 'BANK', branchId: 'branch-2' }),
          { divisionId: 'division-1', branchId: 'branch-1' },
          strict,
        ),
      ).toThrow('Bank account does not belong to the selected branch');
      expect(() =>
        assertCashAccountScopeCompatible(
          account({ accountType: 'BANK', divisionId: 'division-2' }),
          { divisionId: 'division-1', branchId: null },
          strict,
        ),
      ).toThrow('Bank account does not belong to the selected division');
    });
  });

  describe('lenient mode (customer-payments / expenses semantics)', () => {
    it('rejects a cross-branch account when both sides carry a branch', () => {
      expect(() =>
        assertCashAccountScopeCompatible(account({ branchId: 'branch-2' }), {
          branchId: 'branch-1',
        }),
      ).toThrow('Cash account does not belong to the selected branch');
    });

    it('rejects a cross-division account when both sides carry a division', () => {
      expect(() =>
        assertCashAccountScopeCompatible(account({ divisionId: 'division-2' }), {
          divisionId: 'division-1',
        }),
      ).toThrow('Cash account does not belong to the selected division');
    });

    it('accepts an unscoped legacy account regardless of caller context', () => {
      expect(() =>
        assertCashAccountScopeCompatible(account({ divisionId: null, branchId: null }), {
          divisionId: 'division-1',
          branchId: 'branch-1',
        }),
      ).not.toThrow();
    });

    it('accepts a scoped account when the caller carries no context', () => {
      expect(() => assertCashAccountScopeCompatible(account(), {})).not.toThrow();
      expect(() =>
        assertCashAccountScopeCompatible(account(), { divisionId: null, branchId: null }),
      ).not.toThrow();
    });

    it('accepts a matching scoped account', () => {
      expect(() =>
        assertCashAccountScopeCompatible(account(), {
          divisionId: 'division-1',
          branchId: 'branch-1',
        }),
      ).not.toThrow();
    });
  });
});

describe('assertCashAccountForScope (fetching assert mode)', () => {
  it('rejects a missing / deleted / inactive account as not-belonging-to-company', async () => {
    await expect(
      assertCashAccountForScope(dbReturning(null), {
        cashAccountId: 'cash-x',
        companyId: 'company-1',
      }),
    ).rejects.toThrow('Cash account does not belong to this company');
  });

  it('rejects an account from another company', async () => {
    await expect(
      assertCashAccountForScope(dbReturning(account({ companyId: 'company-2' })), {
        cashAccountId: 'cash-1',
        companyId: 'company-1',
      }),
    ).rejects.toThrow('Cash account does not belong to this company');
  });

  it('rejects an account whose type is outside allowedTypes', async () => {
    await expect(
      assertCashAccountForScope(dbReturning(account({ accountType: 'MOBILE_MONEY' })), {
        cashAccountId: 'cash-1',
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        allowedTypes: ['CASH_ON_HAND', 'PETTY_CASH'] as any,
      }),
    ).rejects.toThrow('Cash account type does not match payment method');
  });

  it('skips the type check when allowedTypes is empty (MIXED/OTHER methods)', async () => {
    await expect(
      assertCashAccountForScope(dbReturning(account()), {
        cashAccountId: 'cash-1',
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        allowedTypes: [],
      }),
    ).resolves.toMatchObject({ id: 'cash-1' });
  });

  it('returns the scope snapshot on success and queries only live active rows', async () => {
    const db = dbReturning(account());
    const result = await assertCashAccountForScope(db, {
      cashAccountId: 'cash-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      requireScopeForNonBank: true,
    });
    expect(result).toMatchObject({ id: 'cash-1', branchId: 'branch-1' });
    expect(db.cashAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cash-1', deletedAt: null, isActive: true },
      }),
    );
  });

  it('propagates the strict scope guard (wrong branch rejected)', async () => {
    await expect(
      assertCashAccountForScope(dbReturning(account({ branchId: 'branch-2' })), {
        cashAccountId: 'cash-1',
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        requireScopeForNonBank: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('resolveCashAccountForScope (resolve mode)', () => {
  const base = {
    companyId: 'company-1',
    currency: 'TZS',
    isActive: true,
    deletedAt: null,
  };

  it('with no scope context keeps the legacy order: preferred type oldest-first, then any type', async () => {
    const { db, findFirst } = dbWithRoster([
      {
        ...base,
        id: 'bank-old',
        accountType: 'BANK',
        branchId: 'branch-2',
        divisionId: 'division-2',
        createdAt: 1,
      },
      {
        ...base,
        id: 'cash-new',
        accountType: 'CASH_ON_HAND',
        branchId: null,
        divisionId: null,
        createdAt: 2,
      },
    ]);

    const picked = await resolveCashAccountForScope(db, {
      companyId: 'company-1',
      currency: 'TZS',
      preferredTypes: ['CASH_ON_HAND'] as any,
    });

    // Preferred-type tier wins over an older account of another type…
    expect(picked?.id).toBe('cash-new');
    // …and no query carried a branch/division constraint (legacy behaviour).
    for (const call of findFirst.mock.calls) {
      expect('branchId' in call[0].where).toBe(false);
      expect('divisionId' in call[0].where).toBe(false);
    }
  });

  it('falls through to any type in the same currency when no preferred-type account exists', async () => {
    const { db } = dbWithRoster([
      {
        ...base,
        id: 'bank-only',
        accountType: 'BANK',
        branchId: null,
        divisionId: null,
        createdAt: 1,
      },
    ]);
    const picked = await resolveCashAccountForScope(db, {
      companyId: 'company-1',
      currency: 'TZS',
      preferredTypes: ['MOBILE_MONEY'] as any,
    });
    expect(picked?.id).toBe('bank-only');
  });

  it('prefers the branch-scoped account over an OLDER cross-branch account of the same type', async () => {
    const { db } = dbWithRoster([
      // Kariakoo's account is the company's oldest — the pre-fix resolution
      // would have picked it for a Mwanza receipt.
      {
        ...base,
        id: 'kariakoo-cash',
        accountType: 'CASH_ON_HAND',
        divisionId: 'division-1',
        branchId: 'branch-kariakoo',
        createdAt: 1,
      },
      {
        ...base,
        id: 'mwanza-cash',
        accountType: 'CASH_ON_HAND',
        divisionId: 'division-1',
        branchId: 'branch-mwanza',
        createdAt: 2,
      },
    ]);

    const picked = await resolveCashAccountForScope(db, {
      companyId: 'company-1',
      currency: 'TZS',
      preferredTypes: ['CASH_ON_HAND'] as any,
      divisionId: 'division-1',
      branchId: 'branch-mwanza',
    });
    expect(picked?.id).toBe('mwanza-cash');
  });

  it('falls back to an unscoped company account, never a different branch, when the branch has none', async () => {
    const { db, findFirst } = dbWithRoster([
      {
        ...base,
        id: 'kariakoo-cash',
        accountType: 'CASH_ON_HAND',
        divisionId: 'division-1',
        branchId: 'branch-kariakoo',
        createdAt: 1,
      },
      {
        ...base,
        id: 'company-cash',
        accountType: 'CASH_ON_HAND',
        divisionId: null,
        branchId: null,
        createdAt: 3,
      },
    ]);

    const picked = await resolveCashAccountForScope(db, {
      companyId: 'company-1',
      currency: 'TZS',
      preferredTypes: ['CASH_ON_HAND'] as any,
      divisionId: 'division-1',
      branchId: 'branch-mwanza',
    });

    expect(picked?.id).toBe('company-cash');
    // Every query issued under a branch context constrains branchId to the
    // context branch or NULL — a different branch is never even queryable.
    for (const call of findFirst.mock.calls) {
      expect(['branch-mwanza', null]).toContain(call[0].where.branchId);
    }
  });

  it('returns null (documented no-account behaviour) when only cross-branch accounts exist', async () => {
    const { db } = dbWithRoster([
      {
        ...base,
        id: 'kariakoo-cash',
        accountType: 'CASH_ON_HAND',
        divisionId: 'division-1',
        branchId: 'branch-kariakoo',
        createdAt: 1,
      },
    ]);
    const picked = await resolveCashAccountForScope(db, {
      companyId: 'company-1',
      currency: 'TZS',
      preferredTypes: ['CASH_ON_HAND'] as any,
      divisionId: 'division-1',
      branchId: 'branch-mwanza',
    });
    expect(picked).toBeNull();
  });

  it('prefers a branch-scoped account of the preferred type over the branch drawer of another type', async () => {
    const { db } = dbWithRoster([
      {
        ...base,
        id: 'mwanza-drawer',
        accountType: 'CASH_ON_HAND',
        divisionId: 'division-1',
        branchId: 'branch-mwanza',
        createdAt: 1,
      },
      {
        ...base,
        id: 'company-mpesa',
        accountType: 'MOBILE_MONEY',
        divisionId: null,
        branchId: null,
        createdAt: 2,
      },
    ]);
    // A mobile-money receipt belongs in the mobile-money float even when it is
    // company-wide — the type tier outranks the branch tier.
    const picked = await resolveCashAccountForScope(db, {
      companyId: 'company-1',
      currency: 'TZS',
      preferredTypes: ['MOBILE_MONEY'] as any,
      divisionId: 'division-1',
      branchId: 'branch-mwanza',
    });
    expect(picked?.id).toBe('company-mpesa');
  });

  it('never returns an account in another currency', async () => {
    const { db } = dbWithRoster([
      {
        ...base,
        id: 'usd-cash',
        currency: 'USD',
        accountType: 'CASH_ON_HAND',
        divisionId: 'division-1',
        branchId: 'branch-mwanza',
        createdAt: 1,
      },
    ]);
    const picked = await resolveCashAccountForScope(db, {
      companyId: 'company-1',
      currency: 'TZS',
      preferredTypes: ['CASH_ON_HAND'] as any,
      divisionId: 'division-1',
      branchId: 'branch-mwanza',
    });
    expect(picked).toBeNull();
  });

  it('with only a division context prefers the division, then division-NULL, never another division', async () => {
    const { db } = dbWithRoster([
      {
        ...base,
        id: 'division-2-cash',
        accountType: 'CASH_ON_HAND',
        divisionId: 'division-2',
        branchId: null,
        createdAt: 1,
      },
      {
        ...base,
        id: 'division-1-cash',
        accountType: 'CASH_ON_HAND',
        divisionId: 'division-1',
        branchId: null,
        createdAt: 2,
      },
    ]);
    const picked = await resolveCashAccountForScope(db, {
      companyId: 'company-1',
      currency: 'TZS',
      preferredTypes: ['CASH_ON_HAND'] as any,
      divisionId: 'division-1',
    });
    expect(picked?.id).toBe('division-1-cash');
  });
});
