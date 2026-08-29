import { BadRequestException } from '@nestjs/common';
import { CashAccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Branch-aware CashAccount validation and resolution, shared by every module
 * that receives or pays money through a CashAccount (sales-orders,
 * customer-payments, external-payments, expenses).
 *
 * Why this exists: `CashAccount.currentBalance` is a live per-drawer subledger
 * cache that Funga Siku (the branch daily close) reconciles against physical
 * cash, per branch. Posting a receipt onto a cash account scoped to a
 * DIFFERENT branch inflates one branch's drawer with money that is physically
 * 1,100 km away — a phantom surplus on one close and a phantom shortage on the
 * other. The strongest guard in the system lived only in sales-orders
 * (`assertReferencesBelongToCompany`); this helper lifts it so every
 * cash-touching flow can share it.
 *
 * Scope rules (both modes):
 * - BANK accounts legitimately serve the whole company: a NULL division/branch
 *   scope is always acceptable, and a set scope only conflicts when the caller
 *   also has one set and it differs.
 * - Non-BANK accounts (CASH_ON_HAND / MOBILE_MONEY / PETTY_CASH / OTHER) are
 *   physical drawers/floats. In STRICT mode (sales orders) the caller's
 *   division AND branch must be present and match exactly. In LENIENT mode
 *   (customer payments, expenses) a conflict is only raised when both sides
 *   carry a value and they differ — legacy accounts with NULL scope (created
 *   before the 20260517143000 branch-scoping migration, which had no backfill)
 *   keep working exactly as they do today.
 */

/** The fields every scope-aware caller needs from a CashAccount row. */
export const CASH_ACCOUNT_SCOPE_SELECT = {
  id: true,
  companyId: true,
  divisionId: true,
  branchId: true,
  accountType: true,
  accountName: true,
  currency: true,
} as const;

export type ScopedCashAccount = Prisma.CashAccountGetPayload<{
  select: typeof CASH_ACCOUNT_SCOPE_SELECT;
}>;

/** The division/branch context a payment, order or expense carries. */
export type CashAccountScopeExpectation = {
  divisionId?: string | null;
  branchId?: string | null;
};

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Pure scope check between an already-fetched cash account and the caller's
 * division/branch context. Throws `BadRequestException` with the sales-orders
 * wording on a mismatch; returns silently when compatible.
 *
 * `requireScopeForNonBank` selects STRICT mode: a non-BANK account must match
 * a PRESENT division and branch (the original sales-orders behaviour). Without
 * it (LENIENT mode) a mismatch is only raised when both the expectation and
 * the account carry a value and they differ — an unscoped (NULL-branch)
 * account is never rejected, and a caller with no branch context never
 * rejects a scoped account.
 */
export function assertCashAccountScopeCompatible(
  account: Pick<ScopedCashAccount, 'accountType' | 'divisionId' | 'branchId'>,
  expected: CashAccountScopeExpectation,
  opts: { requireScopeForNonBank?: boolean } = {},
): void {
  if (account.accountType === CashAccountType.BANK) {
    // Bank accounts may be company-wide (NULL scope); only a set-vs-set
    // mismatch is a conflict.
    if (account.divisionId && expected.divisionId && account.divisionId !== expected.divisionId) {
      throw new BadRequestException('Bank account does not belong to the selected division');
    }
    if (account.branchId && expected.branchId && account.branchId !== expected.branchId) {
      throw new BadRequestException('Bank account does not belong to the selected branch');
    }
    return;
  }

  if (opts.requireScopeForNonBank) {
    // STRICT: physical cash/mobile-money must land in the drawer of the
    // caller's own division AND branch, both of which must be present.
    if (!expected.divisionId || account.divisionId !== expected.divisionId) {
      throw new BadRequestException('Cash account does not belong to the selected division');
    }
    if (!expected.branchId || account.branchId !== expected.branchId) {
      throw new BadRequestException('Cash account does not belong to the selected branch');
    }
    return;
  }

  // LENIENT: never silently cross-branch, but tolerate missing scope on either
  // side (legacy NULL-scope accounts, or callers with no branch context).
  if (account.divisionId && expected.divisionId && account.divisionId !== expected.divisionId) {
    throw new BadRequestException('Cash account does not belong to the selected division');
  }
  if (account.branchId && expected.branchId && account.branchId !== expected.branchId) {
    throw new BadRequestException('Cash account does not belong to the selected branch');
  }
}

/**
 * ASSERT MODE — the caller already chose a cash account (dto/stored id);
 * validate it against the expected company, allowed types and division/branch
 * scope, and return the row's scope snapshot.
 *
 * Checks run in the original sales-orders order so its error surface is
 * byte-for-byte unchanged:
 *   1. account exists, not deleted, active, and belongs to `companyId`
 *      → 'Cash account does not belong to this company'
 *   2. accountType is one of `allowedTypes` (skipped when the list is empty)
 *      → 'Cash account type does not match payment method'
 *   3. division/branch scope per {@link assertCashAccountScopeCompatible}
 */
export async function assertCashAccountForScope(
  db: Db,
  input: {
    cashAccountId: string;
    companyId: string;
    divisionId?: string | null;
    branchId?: string | null;
    /** Account types acceptable for the payment method; empty/omitted = any. */
    allowedTypes?: CashAccountType[];
    /** STRICT non-BANK scope matching (sales-orders behaviour). */
    requireScopeForNonBank?: boolean;
  },
): Promise<ScopedCashAccount> {
  const account = await (db as PrismaService).cashAccount.findFirst({
    where: { id: input.cashAccountId, deletedAt: null, isActive: true },
    select: CASH_ACCOUNT_SCOPE_SELECT,
  });
  if (!account || account.companyId !== input.companyId) {
    throw new BadRequestException('Cash account does not belong to this company');
  }

  if (input.allowedTypes?.length && !input.allowedTypes.includes(account.accountType)) {
    throw new BadRequestException('Cash account type does not match payment method');
  }

  assertCashAccountScopeCompatible(account, input, {
    requireScopeForNonBank: input.requireScopeForNonBank,
  });
  return account;
}

/**
 * RESOLVE MODE — pick the cash account that should receive (or pay) money for
 * a company + currency + payment-method-type + division/branch context, or
 * return null when no compatible account exists (callers keep their documented
 * no-account behaviour: the GL leg still posts by role, no balance cache is
 * bumped).
 *
 * Fallback order (first tier with a match wins; every tier is filtered to the
 * company, active, non-deleted rows of the SAME currency and ordered oldest
 * `createdAt` first for determinism):
 *
 * With a branch context:
 *   1. preferred type, scoped to that exact branch (and division, when given)
 *   2. preferred type, unscoped (branchId NULL; division NULL or matching)
 *   3. any type, scoped to that exact branch
 *   4. any type, unscoped
 * An account scoped to a DIFFERENT branch is never eligible — cross-branch
 * cash posting is exactly the bug this helper exists to close.
 *
 * With only a division context: the same shape, division-scoped then
 * division-NULL, never a different division.
 *
 * With no scope context (legacy callers): preferred type then any type,
 * company-wide oldest-first — byte-for-byte the historical behaviour.
 *
 * The type preference outranks the branch preference deliberately: a
 * MOBILE_MONEY receipt belongs in the mobile-money float (even a company-wide
 * one) rather than in the branch's physical cash drawer — Funga Siku counts
 * per (method, account), so a type mismatch corrupts the method row on the
 * close as surely as a branch mismatch corrupts the branch.
 */
export async function resolveCashAccountForScope(
  db: Db,
  input: {
    companyId: string;
    currency: string;
    preferredTypes?: CashAccountType[];
    divisionId?: string | null;
    branchId?: string | null;
  },
): Promise<ScopedCashAccount | null> {
  const scopeTiers: Prisma.CashAccountWhereInput[] = [];
  if (input.branchId) {
    scopeTiers.push({
      branchId: input.branchId,
      ...(input.divisionId ? { divisionId: input.divisionId } : {}),
    });
    scopeTiers.push({
      branchId: null,
      ...(input.divisionId ? { OR: [{ divisionId: null }, { divisionId: input.divisionId }] } : {}),
    });
  } else if (input.divisionId) {
    scopeTiers.push({ divisionId: input.divisionId });
    scopeTiers.push({ divisionId: null });
  } else {
    scopeTiers.push({});
  }

  const typeTiers: Prisma.CashAccountWhereInput[] = [];
  if (input.preferredTypes?.length) {
    typeTiers.push({ accountType: { in: input.preferredTypes } });
  }
  typeTiers.push({});

  for (const typeTier of typeTiers) {
    for (const scopeTier of scopeTiers) {
      const account = await (db as PrismaService).cashAccount.findFirst({
        where: {
          companyId: input.companyId,
          deletedAt: null,
          isActive: true,
          currency: input.currency as never,
          ...typeTier,
          ...scopeTier,
        },
        orderBy: { createdAt: 'asc' },
        select: CASH_ACCOUNT_SCOPE_SELECT,
      });
      if (account) return account;
    }
  }
  return null;
}
