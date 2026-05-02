import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * TaxCalculatorService — given a transaction (sales/purchase/payroll), compute
 * the tax amount and the post-tax breakdown.
 *
 * Tax rate resolution policy (in priority order):
 *   1. If the caller supplies an explicit `taxRateId`, use that rate.
 *   2. Otherwise, find the most-recently-effective TaxRate where
 *        - taxTypeId matches the requested category, AND
 *        - companyId matches OR is null (group-level fallback), AND
 *        - effectiveFrom <= transactionDate < effectiveTo (or no effectiveTo).
 *      If multiple match, prefer company-specific over group-level.
 *
 * Computation rules:
 *   - PERCENTAGE: `tax = base × (rate / 100)`. Rates are stored as percentage
 *     values (e.g. 18.0 for TZ standard VAT), not as fractions.
 *   - FIXED:      `tax = rate` (a flat per-transaction amount, e.g. for stamp duty).
 *   - INCLUSIVE / EXCLUSIVE for VAT-style:
 *       * exclusive: caller passes net-of-tax; output is gross = net + tax.
 *       * inclusive: caller passes gross-of-tax; output is net = gross - tax,
 *                    where tax is back-calculated as `gross × rate / (100 + rate)`.
 *
 * Defaults assume TZ practice — VAT is normally 18% standard-rated, with 0%
 * for exempt/zero-rated supplies. Withholding rates vary by service type and
 * are configured per TaxRate row.
 */
@Injectable()
export class TaxCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  /** Compute tax on an exclusive (net-of-tax) base amount. */
  async computeExclusive(input: TaxComputeInput): Promise<TaxComputeResult> {
    const { rate, calculation } = await this.resolveRate(input);
    const base = input.baseAmount;
    let tax: number;
    if (calculation === 'PERCENTAGE') {
      tax = round(base * (rate / 100));
    } else {
      tax = round(rate);
    }
    const gross = round(base + tax);
    return {
      base,
      tax,
      gross,
      rate,
      method: 'EXCLUSIVE',
      calculation,
    };
  }

  /** Compute tax on an inclusive (gross-of-tax) base amount. */
  async computeInclusive(input: TaxComputeInput): Promise<TaxComputeResult> {
    const { rate, calculation } = await this.resolveRate(input);
    const gross = input.baseAmount;
    let tax: number;
    if (calculation === 'PERCENTAGE') {
      tax = round((gross * rate) / (100 + rate));
    } else {
      tax = round(rate);
    }
    const net = round(gross - tax);
    return {
      base: net,
      tax,
      gross,
      rate,
      method: 'INCLUSIVE',
      calculation,
    };
  }

  /**
   * Find the applicable tax rate for the given category/company at a date.
   * Caller can also pre-supply taxRateId to bypass resolution.
   */
  private async resolveRate(input: TaxComputeInput): Promise<{ rate: number; calculation: 'PERCENTAGE' | 'FIXED' }> {
    if (input.taxRateId) {
      const r = await this.prisma.taxRate.findUniqueOrThrow({ where: { id: input.taxRateId } });
      return {
        rate: Number(r.rate),
        calculation: r.calculationMethod === 'FIXED_AMOUNT' ? 'FIXED' : 'PERCENTAGE',
      };
    }
    if (!input.taxTypeId) {
      throw new BadRequestException('Either taxRateId or taxTypeId is required');
    }

    const date = input.transactionDate ?? new Date();
    const candidates = await this.prisma.taxRate.findMany({
      where: {
        taxTypeId: input.taxTypeId,
        deletedAt: null,
        status: 'ACTIVE',
        effectiveFrom: { lte: date },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: date } },
        ],
        AND: [
          {
            OR: [
              { companyId: input.companyId },
              { companyId: null }, // group-level fallback
            ],
          },
        ],
      },
      orderBy: [
        // Prefer company-scoped rate over group-level when both exist.
        { companyId: 'desc' },
        { effectiveFrom: 'desc' },
      ],
    });

    if (candidates.length === 0) {
      throw new BadRequestException(
        `No active tax rate found for taxTypeId=${input.taxTypeId} on ${date.toISOString()}.`,
      );
    }

    const r = candidates[0];
    return {
      rate: Number(r.rate),
      calculation: r.calculationMethod === 'FIXED_AMOUNT' ? 'FIXED' : 'PERCENTAGE',
    };
  }
}

export interface TaxComputeInput {
  /** Either taxRateId or taxTypeId is required. */
  taxRateId?: string;
  taxTypeId?: string;
  companyId: string;
  baseAmount: number;
  transactionDate?: Date;
}

export interface TaxComputeResult {
  base: number;
  tax: number;
  gross: number;
  rate: number;
  method: 'EXCLUSIVE' | 'INCLUSIVE';
  calculation: 'PERCENTAGE' | 'FIXED';
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
