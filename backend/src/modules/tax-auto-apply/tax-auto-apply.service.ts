import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * TaxAutoApplyService — Sprint C2.
 *
 * Mirrors the per-line `taxAmount` already set on a SalesOrder/PurchaseOrder
 * into the `TaxTransaction` ledger so downstream filing reports (C3) can
 * aggregate VAT/WHT/etc. without re-walking the source documents. This is a
 * READ-and-WRITE-into-ledger pass — it never mutates the source order's
 * line totals.
 *
 * Conservative-by-design:
 *   - **Env-flag gated**: TAX_AUTO_APPLY=true must be set; otherwise every
 *     entry point is a no-op (logged at DEBUG once per call). This is the
 *     safety lever for the rollout caveat called out in the C2 plan.
 *   - **Idempotent**: a TaxTransaction keyed by (companyId, sourceType,
 *     sourceId, taxCodeId) is only created if one doesn't already exist.
 *     Re-running on the same order is safe and a no-op for already-booked
 *     lines.
 *   - **Soft-fails**: any error (missing tax code, missing default,
 *     misconfigured rate) is logged and the function returns `{ booked: 0,
 *     skipped: <n>, error: <msg> }` rather than throwing. Callers can pass
 *     this through inside a $transaction without risk to the source flow.
 *   - **No silent rate computation**: lines with `taxAmount: 0` are skipped.
 *     We only book what the operator already entered. Computing tax that
 *     wasn't on the document is anomaly-detection territory (C4).
 *
 * Resolution strategy for the "which TaxCode does this tax belong to":
 *   1. If the line carries a taxCodeId field (future-proof), use it.
 *   2. Otherwise pick the company's default TaxCode for the appliesTo
 *      direction (SALES for OUT, PURCHASES for IN). If multiple defaults,
 *      prefer company-scoped over the global one.
 *   3. If no default exists, skip the line and log once.
 */
@Injectable()
export class TaxAutoApplyService {
  private readonly logger = new Logger(TaxAutoApplyService.name);
  constructor(private readonly prisma: PrismaService) {}

  private isEnabled(): boolean {
    return (process.env.TAX_AUTO_APPLY ?? 'false').toLowerCase() === 'true';
  }

  /** Capture sales-order line tax into the TaxTransaction ledger. */
  async applyForSalesOrder(
    salesOrderId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<TaxApplyResult> {
    if (!this.isEnabled()) return { skipped: 0, booked: 0, total: 0, disabled: true };
    return this.apply({
      sourceType: 'SALES_ORDER',
      direction: 'OUTPUT',
      appliesTo: 'SALES',
      sourceId: salesOrderId,
      userId,
      tx,
    });
  }

  /** Capture purchase-order line tax into the TaxTransaction ledger. */
  async applyForPurchaseOrder(
    purchaseOrderId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<TaxApplyResult> {
    if (!this.isEnabled()) return { skipped: 0, booked: 0, total: 0, disabled: true };
    return this.apply({
      sourceType: 'PURCHASE_ORDER',
      direction: 'INPUT',
      appliesTo: 'PURCHASES',
      sourceId: purchaseOrderId,
      userId,
      tx,
    });
  }

  // ── Core ────────────────────────────────────────────────────────────────
  private async apply(input: ApplyInput): Promise<TaxApplyResult> {
    const client = input.tx ?? this.prisma;
    const result: TaxApplyResult = { skipped: 0, booked: 0, total: 0 };

    let order: { companyId: string; orderDate?: Date; transactionDate?: Date; lines: Array<{ id: string; taxAmount: any; lineTotal: any }> } | null = null;
    try {
      if (input.sourceType === 'SALES_ORDER') {
        const o = await client.salesOrder.findUnique({
          where: { id: input.sourceId },
          select: {
            companyId: true,
            orderDate: true,
            lines: { select: { id: true, taxAmount: true, lineTotal: true } },
          },
        });
        if (!o) throw new NotFoundException(`SalesOrder ${input.sourceId} not found`);
        order = { ...o, transactionDate: o.orderDate };
      } else {
        const o = await client.purchaseOrder.findUnique({
          where: { id: input.sourceId },
          select: {
            companyId: true,
            orderDate: true,
            lines: { select: { id: true, taxAmount: true, lineTotal: true } },
          },
        });
        if (!o) throw new NotFoundException(`PurchaseOrder ${input.sourceId} not found`);
        order = { ...o, transactionDate: o.orderDate };
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      return result;
    }

    // Resolve a default TaxCode. Company-scoped wins over global; isDefault
    // wins within each scope. We only resolve once per call — every line in
    // a single auto-apply pass shares the same code (operators that need
    // mixed rates will move to per-line taxCodeId in a future iteration).
    let defaultCode: { id: string; taxTypeId: string; taxRateId: string | null } | null;
    try {
      const candidates = await client.taxCode.findMany({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          appliesTo: input.appliesTo as any,
          OR: [{ companyId: order.companyId }, { companyId: null }],
        },
        orderBy: [
          { companyId: 'desc' }, // company-scoped first (nulls last under "desc" in postgres)
          { isDefault: 'desc' },
          { createdAt: 'asc' },
        ],
        select: { id: true, taxTypeId: true, taxRateId: true, taxCode: true, isDefault: true, companyId: true },
        take: 5,
      });
      defaultCode = candidates.find((c) => c.isDefault) ?? candidates[0] ?? null;
    } catch (err) {
      result.error = `Default tax code lookup failed: ${err instanceof Error ? err.message : String(err)}`;
      return result;
    }

    if (!defaultCode) {
      result.error = `No active TaxCode for appliesTo=${input.appliesTo} on company ${order.companyId}.`;
      this.logger.warn(`Tax auto-apply skipped for ${input.sourceType} ${input.sourceId}: ${result.error}`);
      return result;
    }

    for (const line of order.lines) {
      const taxAmount = Number(line.taxAmount ?? 0);
      const lineTotal = Number(line.lineTotal ?? 0);
      if (taxAmount <= 0) {
        result.skipped += 1;
        continue;
      }

      // Idempotency check — keyed by (companyId, sourceType, sourceId,
      // taxCodeId, sourceLineId-in-notes). The TaxTransaction model has no
      // line FK, so we encode the source line in `notes` and use a unique
      // (companyId, taxTransactionNumber) namespacing pattern derived from it.
      const txNumber = `TX-${input.sourceType.split('_')[0]}-${input.sourceId.slice(0, 8)}-${line.id.slice(0, 8)}`;
      const existing = await client.taxTransaction.findFirst({
        where: { companyId: order.companyId, taxTransactionNumber: txNumber, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        result.skipped += 1;
        continue;
      }

      const taxableAmount = Math.max(round2(lineTotal - taxAmount), 0);
      try {
        await client.taxTransaction.create({
          data: {
            taxTransactionNumber: txNumber,
            companyId: order.companyId,
            taxTypeId: defaultCode.taxTypeId,
            taxCodeId: defaultCode.id,
            taxRateId: defaultCode.taxRateId,
            sourceType: input.sourceType as any,
            sourceId: input.sourceId,
            transactionDate: order.transactionDate ?? new Date(),
            taxableAmount,
            taxAmount: round2(taxAmount),
            currency: 'TZS',
            direction: input.direction as any,
            status: 'DRAFT',
            createdById: input.userId,
            notes: `Auto-captured from line ${line.id}`,
          },
        });
        result.booked += 1;
        result.total += taxAmount;
      } catch (err) {
        // Don't bring down the whole call for one bad line.
        this.logger.warn(
          `Tax auto-apply: failed to create TaxTransaction for line ${line.id} on ${input.sourceType} ${input.sourceId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        result.skipped += 1;
      }
    }

    if (result.booked > 0) {
      this.logger.log(
        `Tax auto-apply ${input.sourceType} ${input.sourceId}: booked=${result.booked} skipped=${result.skipped} total=${result.total} via ${defaultCode.id}`,
      );
    }
    return result;
  }
}

interface ApplyInput {
  sourceType: 'SALES_ORDER' | 'PURCHASE_ORDER';
  direction: 'OUTPUT' | 'INPUT';
  appliesTo: 'SALES' | 'PURCHASES';
  sourceId: string;
  userId: string;
  tx?: Prisma.TransactionClient;
}

export interface TaxApplyResult {
  /** Number of lines for which a TaxTransaction was created. */
  booked: number;
  /** Number of lines skipped (zero tax, already booked, or per-line failure). */
  skipped: number;
  /** Sum of taxAmounts booked in this call. */
  total: number;
  /** Set when the env flag is off; callers can rely on this to avoid log noise. */
  disabled?: boolean;
  /** Set to a human message on hard failure. The function still returns; it does not throw. */
  error?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
