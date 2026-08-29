import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

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
 *     lines. The pre-check filters on sourceType/sourceId (a key collision
 *     from a DIFFERENT source can never masquerade as "already booked"), and
 *     the ledger insert itself is INSERT ... ON CONFLICT DO NOTHING so a
 *     concurrent duplicate surfaces as a clean skip, not a statement error.
 *   - **Transaction-safe inside a caller's tx**: when invoked with a caller's
 *     TransactionClient (order confirm, expense approval), each per-line
 *     write runs under a SAVEPOINT. A failed SQL statement is rolled back to
 *     the savepoint instead of aborting the caller's whole Postgres
 *     transaction — without this, the JS-level catch below would "swallow"
 *     the error while every later statement in the approval died with 25P02.
 *   - **Hard failures are flagged, not failed-open**: a failure to *determine*
 *     tax (source order lookup error, tax-code lookup error, or no active
 *     default TaxCode) is logged at ERROR and returned with `failed: true` +
 *     `error`, so it is visibly distinct from the legitimate booked:0 no-op and
 *     can be alerted/reconciled. It does NOT throw, because this runs inside
 *     the order-confirm $transaction and throwing would incorrectly roll back a
 *     legitimate confirm. Per-line booking errors remain soft (logged + counted
 *     as skipped) so one bad line doesn't abort the batch. "Legitimately
 *     nothing to book" (feature disabled, zero-tax lines, already-booked)
 *     returns normally with `failed` unset.
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private isEnabled(): boolean {
    return (process.env.TAX_AUTO_APPLY ?? 'false').toLowerCase() === 'true';
  }

  /**
   * Capture sales-order line tax into the TaxTransaction ledger.
   *
   * `user` is REQUIRED for externally-triggered (manual endpoint) calls: when
   * present, the resolved order's company is checked against the caller's access
   * (MANAGE) before any ledger row is booked, preventing a cross-company write.
   * The in-transaction confirm-path callers omit it because the order is already
   * proven to belong to the confirming company inside their own $transaction.
   */
  async applyForSalesOrder(
    salesOrderId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
    user?: AuthUser,
  ): Promise<TaxApplyResult> {
    const result = !this.isEnabled()
      ? { skipped: 0, booked: 0, total: 0, disabled: true }
      : await this.apply({
          sourceType: 'SALES_ORDER',
          direction: 'OUTPUT',
          appliesTo: 'SALES',
          sourceId: salesOrderId,
          userId,
          tx,
          user,
        });
    if (user) {
      await this.auditManualApply('SALES_ORDER', salesOrderId, user, result);
    }
    return result;
  }

  /**
   * Capture purchase-order line tax into the TaxTransaction ledger.
   *
   * See {@link applyForSalesOrder} for the `user` company-scope contract.
   */
  async applyForPurchaseOrder(
    purchaseOrderId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
    user?: AuthUser,
  ): Promise<TaxApplyResult> {
    const result = !this.isEnabled()
      ? { skipped: 0, booked: 0, total: 0, disabled: true }
      : await this.apply({
          sourceType: 'PURCHASE_ORDER',
          direction: 'INPUT',
          appliesTo: 'PURCHASES',
          sourceId: purchaseOrderId,
          userId,
          tx,
          user,
        });
    if (user) {
      await this.auditManualApply('PURCHASE_ORDER', purchaseOrderId, user, result);
    }
    return result;
  }

  /**
   * Capture an expense's recoverable input VAT into the TaxTransaction ledger.
   *
   * Expenses have no lines, so the core pass runs over ONE synthetic line
   * derived from the expense header (id = the expense id, taxAmount = the
   * recoverable input VAT included in the gross, lineTotal = the gross
   * amount). The idempotency key is one stable key per expense, built from
   * the FULL expense UUID (truncating it would collapse the key to 32 bits
   * of entropy and let cross-expense prefix collisions silently drop VAT).
   *
   * See {@link applyForSalesOrder} for the `user` company-scope contract.
   */
  async applyForExpense(
    expenseId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
    user?: AuthUser,
  ): Promise<TaxApplyResult> {
    const result = !this.isEnabled()
      ? { skipped: 0, booked: 0, total: 0, disabled: true }
      : await this.apply({
          sourceType: 'EXPENSE',
          direction: 'INPUT',
          appliesTo: 'PURCHASES',
          sourceId: expenseId,
          userId,
          tx,
          user,
        });
    if (user) {
      await this.auditManualApply('EXPENSE', expenseId, user, result);
    }
    return result;
  }

  /**
   * Manual agent/API invocations are first-class governed mutations even when
   * the rollout flag makes them a no-op. Internal order-confirm callers omit
   * `user`, so they retain their parent workflow's single audit boundary.
   */
  private async auditManualApply(
    sourceType: 'SALES_ORDER' | 'PURCHASE_ORDER' | 'EXPENSE',
    sourceId: string,
    user: AuthUser,
    result: TaxApplyResult,
  ): Promise<void> {
    const source =
      sourceType === 'SALES_ORDER'
        ? await this.prisma.salesOrder.findUnique({
            where: { id: sourceId },
            select: { companyId: true },
          })
        : sourceType === 'PURCHASE_ORDER'
          ? await this.prisma.purchaseOrder.findUnique({
              where: { id: sourceId },
              select: { companyId: true },
            })
          : await this.prisma.expense.findUnique({
              where: { id: sourceId },
              select: { companyId: true },
            });
    if (!source) return;
    await this.auditLogs.logStrict({
      action:
        sourceType === 'SALES_ORDER'
          ? 'TAX_AUTO_APPLY_SALES_ORDER'
          : sourceType === 'PURCHASE_ORDER'
            ? 'TAX_AUTO_APPLY_PURCHASE_ORDER'
            : 'TAX_AUTO_APPLY_EXPENSE',
      entityType:
        sourceType === 'SALES_ORDER'
          ? 'SalesOrder'
          : sourceType === 'PURCHASE_ORDER'
            ? 'PurchaseOrder'
            : 'Expense',
      entityId: sourceId,
      userId: user.id,
      companyId: source.companyId,
      newValue: {
        booked: result.booked,
        skipped: result.skipped,
        total: result.total,
        disabled: result.disabled ?? false,
        failed: result.failed ?? false,
      },
    });
  }

  // ── Core ────────────────────────────────────────────────────────────────
  private async apply(input: ApplyInput): Promise<TaxApplyResult> {
    const client = input.tx ?? this.prisma;
    const result: TaxApplyResult = { skipped: 0, booked: 0, total: 0 };

    let order: {
      companyId: string;
      divisionId?: string | null;
      branchId?: string | null;
      orderDate?: Date;
      transactionDate?: Date;
      currency?: string | null;
      lines: Array<{ id: string; taxAmount: any; lineTotal: any }>;
    } | null = null;
    try {
      if (input.sourceType === 'SALES_ORDER') {
        const o = await client.salesOrder.findUnique({
          where: { id: input.sourceId },
          select: {
            companyId: true,
            divisionId: true,
            branchId: true,
            orderDate: true,
            lines: { select: { id: true, taxAmount: true, lineTotal: true } },
          },
        });
        if (!o) throw new NotFoundException(`SalesOrder ${input.sourceId} not found`);
        // Orders carry no explicit currency column here — keep the historical
        // TZS labelling for SO/PO ledger rows.
        order = { ...o, transactionDate: o.orderDate, currency: 'TZS' };
      } else if (input.sourceType === 'PURCHASE_ORDER') {
        const o = await client.purchaseOrder.findUnique({
          where: { id: input.sourceId },
          select: {
            companyId: true,
            divisionId: true,
            branchId: true,
            orderDate: true,
            lines: { select: { id: true, taxAmount: true, lineTotal: true } },
          },
        });
        if (!o) throw new NotFoundException(`PurchaseOrder ${input.sourceId} not found`);
        order = { ...o, transactionDate: o.orderDate, currency: 'TZS' };
      } else {
        // EXPENSE: no lines — synthesize ONE line from the expense header so
        // the shared per-line pass (zero-tax skip, idempotency key, booking)
        // applies unchanged. `taxAmount` only counts when the expense is
        // flagged taxable; NULL/exempt rows fall through as a zero-tax skip.
        const e = await client.expense.findUnique({
          where: { id: input.sourceId },
          select: {
            companyId: true,
            divisionId: true,
            branchId: true,
            expenseDate: true,
            amount: true,
            currency: true,
            isTaxable: true,
            taxAmount: true,
          },
        });
        if (!e) throw new NotFoundException(`Expense ${input.sourceId} not found`);
        order = {
          companyId: e.companyId,
          divisionId: e.divisionId,
          branchId: e.branchId,
          transactionDate: e.expenseDate,
          // Expenses are explicitly multi-currency (TZS/USD/EUR/...): the
          // compliance row must carry the expense's own currency, or a USD
          // 180 input VAT would be summed as 180 TZS by the filing engine.
          currency: e.currency,
          lines: [
            {
              id: input.sourceId,
              taxAmount: e.isTaxable ? e.taxAmount : 0,
              lineTotal: e.amount,
            },
          ],
        };
      }
    } catch (err) {
      // Hard failure to determine the source order: this is NOT "nothing to
      // book". The feature is enabled here (entry points short-circuit when
      // off). We must NOT fail open silently (a swallowed error understates VAT
      // in downstream filing reports), but this runs inside the order-confirm
      // $transaction, so throwing would incorrectly roll back a legitimate
      // confirm. Instead we escalate to ERROR and flag the result via
      // `failed`/`error` so callers/alerting can reconcile it — distinct from
      // the legitimate booked:0 no-op.
      result.error = err instanceof Error ? err.message : String(err);
      result.failed = true;
      this.logger.error(
        `Tax auto-apply FAILED (tax not determined) for ${input.sourceType} ${input.sourceId}: ${result.error}`,
      );
      return result;
    }

    // Company-scope guard for externally-triggered (manual endpoint) calls.
    // We deliberately load the order FIRST, then compare its real companyId to
    // the caller's access — never trusting a client-supplied company. This
    // block is intentionally OUTSIDE the try/catch above so an authorization
    // failure propagates as a 403 instead of being swallowed into the soft
    // `failed` result used for "tax could not be determined". The in-tx
    // confirm-path callers pass no `user` and are already company-safe.
    if (input.user) {
      await this.companyScope.assertCanAccessCompany(
        input.user,
        order.companyId,
        AccessLevel.MANAGE,
      );
    }

    // Resolve a default TaxCode. Company-scoped wins over global; isDefault
    // wins within each scope. We only resolve once per call — every line in
    // a single auto-apply pass shares the same code (operators that need
    // mixed rates will move to per-line taxCodeId in a future iteration).
    let defaultCode: {
      id: string;
      taxTypeId: string;
      taxRateId: string | null;
      taxType: { taxCategory: string; taxTypeCode: string };
    } | null;
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
        select: {
          id: true,
          taxTypeId: true,
          taxRateId: true,
          taxCode: true,
          isDefault: true,
          companyId: true,
          taxType: { select: { taxCategory: true, taxTypeCode: true } },
        },
        take: 5,
      });
      defaultCode = candidates.find((c) => c.isDefault) ?? candidates[0] ?? null;
    } catch (err) {
      // Hard failure to determine the applicable tax code — escalate + flag,
      // but do not throw (see note above: we run inside the confirm tx).
      result.error = `Default tax code lookup failed: ${err instanceof Error ? err.message : String(err)}`;
      result.failed = true;
      this.logger.error(
        `Tax auto-apply FAILED (tax not determined) for ${input.sourceType} ${input.sourceId}: ${result.error}`,
      );
      return result;
    }

    if (!defaultCode) {
      // Misconfiguration (no active TaxCode) means VAT cannot be determined.
      // This is a hard failure, NOT a legitimate no-op: escalate to ERROR and
      // flag the result so it is reconciled rather than silently lost.
      result.error = `No active TaxCode for appliesTo=${input.appliesTo} on company ${order.companyId}.`;
      result.failed = true;
      this.logger.error(
        `Tax auto-apply FAILED (no active TaxCode) for ${input.sourceType} ${input.sourceId}: ${result.error}`,
      );
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
      //
      // Expenses use the FULL source UUID: the synthetic line id IS the
      // expense id, so the truncated two-slice form would repeat the same 8
      // hex chars (32 bits of entropy) and a cross-expense prefix collision
      // would silently drop recoverable VAT from the filing ledger. SO/PO
      // keep the historical truncated two-id key so rows already booked
      // under it stay idempotent.
      const txNumber =
        input.sourceType === 'EXPENSE'
          ? `TX-EXPENSE-${input.sourceId}`
          : `TX-${input.sourceType.split('_')[0]}-${input.sourceId.slice(0, 8)}-${line.id.slice(0, 8)}`;
      // The pre-check filters on sourceType/sourceId as well as the key: a
      // number collision from a DIFFERENT source must never masquerade as
      // "already booked" for THIS source.
      const existing = await client.taxTransaction.findFirst({
        where: {
          companyId: order.companyId,
          taxTransactionNumber: txNumber,
          sourceType: input.sourceType as any,
          sourceId: input.sourceId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existing) {
        result.skipped += 1;
        continue;
      }

      const taxableAmount = Math.max(round2(lineTotal - taxAmount), 0);
      // When we run inside a caller's transaction (order confirm / expense
      // approval), a failed SQL statement aborts the WHOLE Postgres
      // transaction — the JS catch below cannot undo that, and the caller's
      // next statement would die with 25P02, rolling back a legitimate
      // approval. A savepoint makes the per-line write independently
      // abortable: ROLLBACK TO SAVEPOINT restores the enclosing transaction
      // to health before we swallow the error. Standalone (non-tx) calls
      // need no savepoint — each statement is its own transaction.
      const inCallerTx = Boolean(input.tx);
      if (inCallerTx) {
        await client.$executeRaw`SAVEPOINT tax_auto_apply_line`;
      }
      try {
        // INSERT ... ON CONFLICT DO NOTHING (createMany + skipDuplicates): a
        // duplicate key — concurrent apply, soft-deleted row, or a genuine
        // collision — surfaces as count === 0 instead of a 23505 statement
        // error that would poison the caller's transaction.
        const taxTransactionId = randomUUID();
        const created = await client.taxTransaction.createMany({
          data: [
            {
              id: taxTransactionId,
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
              currency: order.currency ?? 'TZS',
              direction: input.direction as any,
              status: 'DRAFT',
              createdById: input.userId,
              notes: `Auto-captured from line ${line.id}`,
            },
          ],
          skipDuplicates: true,
        });
        if (created.count === 0) {
          // The key is already taken (the pre-check missed it: a concurrent
          // apply, or a soft-deleted row). Same source: a legitimate
          // idempotent skip. A DIFFERENT source holding the key is a genuine
          // collision — flag it for reconciliation, never count it as booked.
          const holder = await client.taxTransaction.findFirst({
            where: { companyId: order.companyId, taxTransactionNumber: txNumber },
            select: { sourceType: true, sourceId: true },
          });
          if (
            holder &&
            (holder.sourceType !== (input.sourceType as any) || holder.sourceId !== input.sourceId)
          ) {
            result.error = `Tax transaction number collision: ${txNumber} is already booked for ${holder.sourceType} ${holder.sourceId}`;
            result.failed = true;
            this.logger.error(
              `Tax auto-apply FAILED (key collision) for ${input.sourceType} ${input.sourceId}: ${result.error}`,
            );
          }
          result.skipped += 1;
        } else {
          await this.postTaxTransaction({
            tx: input.tx,
            taxTransactionId,
            taxTransactionNumber: txNumber,
            companyId: order.companyId,
            divisionId: order.divisionId,
            branchId: order.branchId,
            direction: input.direction,
            taxCategory: defaultCode.taxType.taxCategory,
            taxTypeCode: defaultCode.taxType.taxTypeCode,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            transactionDate: order.transactionDate ?? new Date(),
            amount: round2(taxAmount),
            userId: input.userId,
          });
          result.booked += 1;
          result.total += taxAmount;
        }
        if (inCallerTx) {
          await client.$executeRaw`RELEASE SAVEPOINT tax_auto_apply_line`;
        }
      } catch (err) {
        if (inCallerTx) {
          // Restore the enclosing transaction so the caller's approval can
          // still commit — the soft-fail contract at the SQL level.
          try {
            await client.$executeRaw`ROLLBACK TO SAVEPOINT tax_auto_apply_line`;
          } catch (rollbackErr) {
            this.logger.error(
              `Tax auto-apply: ROLLBACK TO SAVEPOINT failed for ${input.sourceType} ${input.sourceId}: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
            );
          }
        }
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

  private async postTaxTransaction(input: {
    tx?: Prisma.TransactionClient;
    taxTransactionId: string;
    taxTransactionNumber: string;
    companyId: string;
    divisionId?: string | null;
    branchId?: string | null;
    direction: 'OUTPUT' | 'INPUT';
    taxCategory: string;
    taxTypeCode: string;
    sourceType: string;
    sourceId: string;
    transactionDate: Date;
    amount: number;
    userId: string;
  }) {
    const db = input.tx ?? this.prisma;
    const existingJournal = await db.journalEntry.findFirst({
      where: {
        companyId: input.companyId,
        referenceType: 'TaxTransaction',
        referenceId: input.taxTransactionId,
        status: 'POSTED',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingJournal) return;

    // The source sales/purchase journal owns the GL impact. TaxTransaction is
    // the compliance ledger, so mark it posted without creating duplicate AR/AP.
    await db.taxTransaction.update({
      where: { id: input.taxTransactionId },
      data: {
        status: 'POSTED',
        postedById: input.userId,
        postedAt: new Date(),
      },
    });
  }
}

interface ApplyInput {
  sourceType: 'SALES_ORDER' | 'PURCHASE_ORDER' | 'EXPENSE';
  direction: 'OUTPUT' | 'INPUT';
  appliesTo: 'SALES' | 'PURCHASES';
  sourceId: string;
  userId: string;
  tx?: Prisma.TransactionClient;
  /**
   * Present only for externally-triggered (manual endpoint) calls. When set, the
   * loaded order's company is asserted against this user's access before booking.
   */
  user?: AuthUser;
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
  /**
   * True when tax could NOT be determined (source lookup failed, tax-code
   * lookup failed, or no active TaxCode). Distinguishes a hard failure from the
   * legitimate booked:0 no-op so callers/alerting can reconcile the order.
   */
  failed?: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
