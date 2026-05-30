import { BadRequestException, Injectable } from '@nestjs/common';
import { ChartOfAccount, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Semantic chart-of-accounts lookup.
 *
 * Many posting paths (intercompany transfers, depreciation, payroll, etc.)
 * need to find the "AR control account" or "Cash on hand" for a company.
 * Hardcoding numeric account codes ('1100', '1010', etc.) into business logic
 * is brittle: a different chart layout breaks every poster silently.
 *
 * This service resolves accounts by **role** rather than by literal code:
 *   1. First tries to match `accountSubType` (case-insensitive) against the
 *      role's canonical key. Set this in the seed / chart maintenance UI.
 *   2. Falls back to a list of conventional Tanzanian SME chart codes.
 *   3. Throws a descriptive `BadRequestException` if neither resolves.
 *
 * Adding a new role: add it to {@link AccountRole}, then list a fallback
 * code mapping in CONVENTIONAL_CODES.  Existing data does not need migration.
 */
@Injectable()
export class AccountResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Look up the company's account for a given semantic role.
   * Optional `tx` lets callers pass a Prisma TransactionClient.
   */
  async resolve(
    companyId: string,
    role: AccountRole,
    tx?: Prisma.TransactionClient,
  ): Promise<ChartOfAccount> {
    const db = tx ?? this.prisma;
    const subtypeKey = role.toLowerCase();

    // 1. Match by accountSubType — preferred path.
    let account = await db.chartOfAccount.findFirst({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        accountSubType: { equals: subtypeKey, mode: 'insensitive' },
      },
    });
    if (account) return account;

    // 2. Fallback: try each conventional code in priority order.
    const codes = CONVENTIONAL_CODES[role];
    if (codes && codes.length) {
      const accounts = await db.chartOfAccount.findMany({
        where: {
          companyId,
          deletedAt: null,
          isActive: true,
          accountCode: { in: codes },
        },
      });
      account =
        codes.map((code) => accounts.find((row) => row.accountCode === code)).find(Boolean) ??
        null;
      if (account) return account;
    }

    throw new BadRequestException(
      `Cannot resolve chart-of-accounts entry for role "${role}" on company ${companyId}. ` +
        `Set accountSubType="${subtypeKey}" on the relevant account, or create one with code in [${codes?.join(', ') ?? 'n/a'}].`,
    );
  }

  /** Resolve many roles in parallel — fails loudly if any are missing. */
  async resolveMany(
    companyId: string,
    roles: AccountRole[],
    tx?: Prisma.TransactionClient,
  ): Promise<Record<AccountRole, ChartOfAccount>> {
    const db = tx ?? this.prisma;
    const uniqueRoles = [...new Set(roles)];
    const subtypeKeys = uniqueRoles.map((role) => role.toLowerCase());
    const fallbackCodes = [
      ...new Set(uniqueRoles.flatMap((role) => CONVENTIONAL_CODES[role] ?? [])),
    ];
    const accounts = await db.chartOfAccount.findMany({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        OR: [
          { accountSubType: { in: subtypeKeys, mode: 'insensitive' } },
          ...(fallbackCodes.length ? [{ accountCode: { in: fallbackCodes } }] : []),
        ],
      },
    });
    const bySubtype = new Map(
      accounts
        .filter((account) => account.accountSubType)
        .map((account) => [account.accountSubType!.toLowerCase(), account]),
    );
    const byCode = new Map(accounts.map((account) => [account.accountCode, account]));

    const entries = uniqueRoles.map((role) => {
      const subtypeKey = role.toLowerCase();
      const account =
        bySubtype.get(subtypeKey) ??
        (CONVENTIONAL_CODES[role] ?? []).map((code) => byCode.get(code)).find(Boolean);
      if (!account) {
        throw new BadRequestException(
          `Cannot resolve chart-of-accounts entry for role "${role}" on company ${companyId}. ` +
            `Set accountSubType="${subtypeKey}" on the relevant account, or create one with code in [${CONVENTIONAL_CODES[role]?.join(', ') ?? 'n/a'}].`,
        );
      }
      return [role, account] as const;
    });
    return Object.fromEntries(entries) as Record<AccountRole, ChartOfAccount>;
  }
}

/**
 * Canonical roles for the resolver. New code should reference these constants
 * rather than literal account codes.
 */
export type AccountRole =
  | 'CASH_ON_HAND'
  | 'BANK'
  | 'AR_CONTROL'
  | 'AP_CONTROL'
  | 'INVENTORY_ASSET'
  | 'SALES_REVENUE'
  | 'COST_OF_GOODS_SOLD'
  | 'FIXED_ASSET'
  | 'INTERCOMPANY_RECEIVABLE'
  | 'INTERCOMPANY_PAYABLE'
  | 'GENERAL_EXPENSE'
  | 'PURCHASE_VARIANCE'
  | 'DEPRECIATION_EXPENSE'
  | 'ACCUMULATED_DEPRECIATION'
  | 'LOAN_PRINCIPAL_PAYABLE'
  | 'LOAN_INTEREST_EXPENSE'
  | 'TAX_VAT_PAYABLE'
  | 'TAX_VAT_RECEIVABLE'
  | 'TAX_WITHHOLDING_PAYABLE'
  | 'RETAINED_EARNINGS'
  | 'INCOME_SUMMARY';

/**
 * Conventional Tanzanian SME chart codes — used when accountSubType isn't set.
 * Each role can list multiple codes; the first match wins.
 */
const CONVENTIONAL_CODES: Record<AccountRole, string[]> = {
  CASH_ON_HAND: ['1000', '1010'],
  BANK: ['1010', '1020', '1021', '1100'], // 1100 also used for AR in some legacy charts
  AR_CONTROL: ['1100', '1110', '1200'],
  AP_CONTROL: ['2000', '2010', '2100'],
  INVENTORY_ASSET: ['1200'],
  SALES_REVENUE: ['4000', '4100', '4900'],
  COST_OF_GOODS_SOLD: ['5000', '5100', '5200', '5300'],
  FIXED_ASSET: ['1500'],
  INTERCOMPANY_RECEIVABLE: ['1300', '1390', '1100'],
  INTERCOMPANY_PAYABLE: ['2300', '2390', '2000'],
  GENERAL_EXPENSE: ['6900', '6500', '6400', '6200', '6100', '6000'],
  PURCHASE_VARIANCE: ['6900', '5000'],
  DEPRECIATION_EXPENSE: ['5500', '6500'],
  ACCUMULATED_DEPRECIATION: ['1599', '1690'], // contra-asset, near fixed-asset block
  LOAN_PRINCIPAL_PAYABLE: ['2400', '2500'],
  LOAN_INTEREST_EXPENSE: ['7100', '7200'],
  TAX_VAT_PAYABLE: ['2200', '2210'],
  TAX_VAT_RECEIVABLE: ['1400', '1410'],
  TAX_WITHHOLDING_PAYABLE: ['2220', '2230'],
  RETAINED_EARNINGS: ['3100', '3000'],
  INCOME_SUMMARY: ['3900', '4900', '4100', '4000'],
};
