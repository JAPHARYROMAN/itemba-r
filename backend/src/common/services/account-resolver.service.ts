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
      account = await db.chartOfAccount.findFirst({
        where: {
          companyId,
          deletedAt: null,
          isActive: true,
          accountCode: { in: codes },
        },
        // Prefer the first listed code if multiple match.
        orderBy: { accountCode: 'asc' },
      });
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
    const entries = await Promise.all(
      roles.map(async (r) => [r, await this.resolve(companyId, r, tx)] as const),
    );
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
  | 'INVENTORY'
  | 'INTERCOMPANY_RECEIVABLE'
  | 'INTERCOMPANY_PAYABLE'
  | 'FIXED_ASSET_COST'
  | 'DEPRECIATION_EXPENSE'
  | 'ACCUMULATED_DEPRECIATION'
  | 'LOAN_PRINCIPAL_PAYABLE'
  | 'LOAN_INTEREST_EXPENSE'
  | 'TAX_VAT_PAYABLE'
  | 'TAX_VAT_RECEIVABLE'
  | 'TAX_WITHHOLDING_PAYABLE'
  | 'GENERAL_REVENUE'
  | 'GENERAL_EXPENSE'
  | 'RETAINED_EARNINGS'
  | 'INCOME_SUMMARY';

/**
 * Conventional Tanzanian SME chart codes — used when accountSubType isn't set.
 * Each role can list multiple codes; the first match wins.
 */
const CONVENTIONAL_CODES: Record<AccountRole, string[]> = {
  CASH_ON_HAND: ['1010', '1000'],
  BANK: ['1020', '1021', '1100'], // 1100 also used for AR in some legacy charts
  AR_CONTROL: ['1100', '1110', '1200'],
  AP_CONTROL: ['2000', '2010', '2100'],
  INVENTORY: ['1300', '1310', '1400'], // raw materials / merchandise / WIP
  INTERCOMPANY_RECEIVABLE: ['1390', '1395'],
  INTERCOMPANY_PAYABLE: ['2390', '2395', '2300'],
  FIXED_ASSET_COST: ['1500', '1510', '1600'],
  DEPRECIATION_EXPENSE: ['5500', '6500'],
  ACCUMULATED_DEPRECIATION: ['1599', '1690'], // contra-asset, near fixed-asset block
  LOAN_PRINCIPAL_PAYABLE: ['2400', '2500'],
  LOAN_INTEREST_EXPENSE: ['7100', '7200'],
  TAX_VAT_PAYABLE: ['2200', '2210'],
  TAX_VAT_RECEIVABLE: ['1400', '1410'],
  TAX_WITHHOLDING_PAYABLE: ['2220', '2230'],
  GENERAL_REVENUE: ['4000', '4100'],
  GENERAL_EXPENSE: ['6000', '6100'],
  RETAINED_EARNINGS: ['3100', '3000'],
  INCOME_SUMMARY: ['3900'],
};
