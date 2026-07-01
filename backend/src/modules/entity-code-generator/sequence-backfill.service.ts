import { Injectable, Logger } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { DEFAULT_PATTERNS, fallbackPattern } from './defaults';

/**
 * SequenceBackfillService — one-shot helper that aligns
 * `DocumentNumberSequence.currentNumber` with the highest-already-issued
 * trailing-counter found across existing entity rows.
 *
 * Why this exists: when a service migrates from inline `count()+1` codes to
 * the central `EntityCodeGeneratorService`, a freshly lazy-created sequence
 * starts at `currentNumber=0` — meaning the next issued code is `…000001`,
 * which collides if existing data already contains `TRIP-2026-00001`. This
 * service walks the source table, extracts trailing digits, and bumps the
 * sequence forward so the next emitted code is guaranteed to be unused.
 *
 * Conservative-by-design:
 *   - Read-only walk of source data, single small UPDATE per sequence
 *   - Idempotent — running twice is a no-op the second time
 *   - Skips entity rows whose code doesn't match the sequence's prefix
 *     pattern (e.g. legacy timestamp-based `SO-2026-AB12CD` codes don't
 *     contribute, so the new sequential format starts cleanly from 1)
 *   - Never decreases — only updates if the found max > current counter
 *
 * Run via `POST /entity-code-generator/backfill?companyId=X` after a fresh
 * deploy. Operators can also re-run any time without harm.
 */

interface BackfillTarget {
  entityType: string;
  /** Prisma model name on the client (e.g. `salesOrder`). */
  prismaModel: string;
  /** Field on the row that holds the human-readable code. */
  numberField: string;
}

const BACKFILL_TARGETS: BackfillTarget[] = [
  { entityType: 'Trip', prismaModel: 'trip', numberField: 'tripNumber' },
  { entityType: 'HarvestRecord', prismaModel: 'harvestRecord', numberField: 'harvestNumber' },
  { entityType: 'ProjectMaterialIssue', prismaModel: 'projectMaterialIssue', numberField: 'issueNumber' },
  { entityType: 'ProjectBilling', prismaModel: 'projectBilling', numberField: 'billingNumber' },
  { entityType: 'SalesOrder', prismaModel: 'salesOrder', numberField: 'salesOrderNumber' },
  { entityType: 'PurchaseOrder', prismaModel: 'purchaseOrder', numberField: 'purchaseOrderNumber' },
  { entityType: 'JournalEntry', prismaModel: 'journalEntry', numberField: 'journalNumber' },
  { entityType: 'Receivable', prismaModel: 'receivable', numberField: 'receivableNumber' },
  { entityType: 'Payable', prismaModel: 'payable', numberField: 'payableNumber' },
  { entityType: 'TaxTransaction', prismaModel: 'taxTransaction', numberField: 'taxTransactionNumber' },
  { entityType: 'TaxReturn', prismaModel: 'taxReturn', numberField: 'taxReturnNumber' },
  { entityType: 'InventoryMovement', prismaModel: 'inventoryMovement', numberField: 'movementNumber' },
  { entityType: 'Expense', prismaModel: 'expense', numberField: 'expenseNumber' },
  { entityType: 'AuditAdjustment', prismaModel: 'auditAdjustment', numberField: 'adjustmentNumber' },
  { entityType: 'LoanRepaymentPayment', prismaModel: 'loanRepaymentPayment', numberField: 'repaymentPaymentNumber' },
  { entityType: 'IntercompanyTransaction', prismaModel: 'interCompanyTransaction', numberField: 'transactionNumber' },
  { entityType: 'DeliveryNote', prismaModel: 'deliveryNote', numberField: 'deliveryNoteNumber' },
  { entityType: 'PackageMovement', prismaModel: 'packageMovement', numberField: 'movementNumber' },
  { entityType: 'AttendanceRecord', prismaModel: 'attendanceRecord', numberField: 'attendanceNumber' },
  { entityType: 'DisciplinaryAction', prismaModel: 'disciplinaryAction', numberField: 'actionNumber' },
  { entityType: 'EmploymentDispute', prismaModel: 'employmentDispute', numberField: 'disputeNumber' },
  { entityType: 'SubcontractorRecord', prismaModel: 'subcontractorRecord', numberField: 'subcontractorCode' },
];

export interface BackfillResult {
  entityType: string;
  sequenceCode: string;
  rowsScanned: number;
  matchingRows: number;
  maxFound: number;
  before: number;
  after: number;
  updated: boolean;
  message?: string;
}

@Injectable()
export class SequenceBackfillService {
  private readonly logger = new Logger(SequenceBackfillService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  /**
   * Backfill all known entity-type sequences for the given company (or
   * across the whole group if `companyId` is omitted, repeated per company).
   *
   * Company scope (guard-gap fix): backfilling advances another company's
   * sequence counters, so it is a WRITE-level cross-company action. The caller
   * must hold WRITE access to the requested `companyId`. When `companyId` is
   * omitted the all-companies sweep is restricted to the companies the caller
   * can actually write to — group-scoped users hit the whole group, non-group
   * users only their own accessible set.
   */
  async backfillAll(
    user: AuthUser,
    query: { companyId?: string } = {},
  ): Promise<BackfillResult[]> {
    let companies: Array<{ id: string }>;

    if (query.companyId) {
      await this.companyScope.assertCanAccessCompany(
        user,
        query.companyId,
        AccessLevel.WRITE,
      );
      companies = [{ id: query.companyId }];
    } else {
      // No company specified: sweep only the caller's accessible companies.
      // Group-scoped users get every non-deleted company in the group; other
      // users are restricted to their explicitly accessible set. This avoids a
      // non-group user with `doc_sequences.update` advancing every company's
      // counters via the all-companies path.
      if (this.companyScope.isGroupScoped(user)) {
        companies = await this.prisma.company.findMany({
          where: { deletedAt: null },
          select: { id: true },
        });
      } else {
        const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
        companies =
          accessibleIds.length === 0
            ? []
            : await this.prisma.company.findMany({
                where: { id: { in: accessibleIds }, deletedAt: null },
                select: { id: true },
              });
      }
    }

    const results: BackfillResult[] = [];
    for (const company of companies) {
      for (const target of BACKFILL_TARGETS) {
        try {
          const result = await this.backfillOne(target, company.id);
          results.push(result);
        } catch (err) {
          this.logger.warn(
            `Backfill failed for ${target.entityType}/${company.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
          results.push({
            entityType: target.entityType,
            sequenceCode: `${target.entityType}_${company.id}`,
            rowsScanned: 0,
            matchingRows: 0,
            maxFound: 0,
            before: 0,
            after: 0,
            updated: false,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return results;
  }

  private async backfillOne(target: BackfillTarget, companyId: string): Promise<BackfillResult> {
    const sequenceCode = `${target.entityType}_${companyId}`;
    const pattern = DEFAULT_PATTERNS[target.entityType] ?? fallbackPattern(target.entityType);

    // Fetch the existing entity codes for this company. Limited to a sane
    // page size so a million-row table doesn't blow memory; if a company
    // has more than this we still get the highest by ordering.
    const client = this.prisma as unknown as Record<string, {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    }>;
    const model = client[target.prismaModel];
    if (!model) {
      throw new Error(`Prisma model "${target.prismaModel}" not found`);
    }

    const rows = await model.findMany({
      where: { companyId },
      select: { [target.numberField]: true },
      take: 5000,
      orderBy: { [target.numberField]: 'desc' },
    });

    let maxFound = 0;
    let matching = 0;
    // Match against the pattern's prefix shape — we only count rows whose
    // codes match the active format. Legacy codes with a different shape
    // (e.g. timestamp-based `SO-2026-AB12CD` when the new pattern is
    // `SO-{YYYY}-{counter}`) are ignored — new codes will start cleanly.
    const matchers = this.buildPatternMatchers(pattern.prefix, pattern.suffix);

    for (const row of rows) {
      const code = row[target.numberField];
      if (typeof code !== 'string') continue;
      for (const matcher of matchers) {
        const m = code.match(matcher);
        if (m) {
          const num = parseInt(m[1], 10);
          if (Number.isFinite(num) && num > maxFound) maxFound = num;
          matching += 1;
          break;
        }
      }
    }

    // Look up the existing sequence (or create at zero so we always return a
    // row's `before` value).
    const existing = await this.prisma.documentNumberSequence.findFirst({
      where: { sequenceCode, deletedAt: null },
      select: { id: true, currentNumber: true },
    });

    let before = 0;
    let after = 0;
    let updated = false;

    if (!existing) {
      if (maxFound === 0) {
        // No data and no sequence — leave both as null.
        return {
          entityType: target.entityType,
          sequenceCode,
          rowsScanned: rows.length,
          matchingRows: matching,
          maxFound: 0,
          before: 0,
          after: 0,
          updated: false,
          message: 'No existing data and no sequence; nothing to backfill.',
        };
      }
      // Create at maxFound so the next emit is maxFound + 1.
      await this.prisma.documentNumberSequence.create({
        data: {
          sequenceCode,
          companyId,
          entityType: target.entityType,
          prefix: pattern.prefix,
          suffix: pattern.suffix ?? null,
          padding: pattern.padding,
          resetFrequency: pattern.resetFrequency,
          currentNumber: maxFound,
          isActive: true,
        },
      });
      after = maxFound;
      updated = true;
    } else {
      before = existing.currentNumber;
      if (maxFound > existing.currentNumber) {
        await this.prisma.documentNumberSequence.update({
          where: { id: existing.id },
          data: { currentNumber: maxFound },
        });
        after = maxFound;
        updated = true;
      } else {
        after = existing.currentNumber;
      }
    }

    return {
      entityType: target.entityType,
      sequenceCode,
      rowsScanned: rows.length,
      matchingRows: matching,
      maxFound,
      before,
      after,
      updated,
    };
  }

  /**
   * Build regex matchers for code parsing. Token-bearing prefixes (e.g.
   * `TRIP-{YYYY}-`) are expanded for both the current year and the previous
   * year so a backfill in early January still picks up December's codes.
   */
  private buildPatternMatchers(prefix: string, suffix?: string): RegExp[] {
    const now = new Date();
    const years = [now.getFullYear(), now.getFullYear() - 1];
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const days = Array.from({ length: 31 }, (_, i) => i + 1);

    // Build token expansions. For YEARLY the only variable is YYYY; for
    // MONTHLY/DAILY we also iterate months/days. Cap the cardinality so we
    // don't generate thousands of regexes.
    const candidates: string[] = [];
    if (!prefix.includes('{')) {
      candidates.push(prefix);
    } else {
      for (const y of years) {
        for (const m of months) {
          for (const d of days) {
            candidates.push(
              prefix
                .replace(/\{YYYY\}/g, String(y))
                .replace(/\{YY\}/g, String(y).slice(-2))
                .replace(/\{MM\}/g, String(m).padStart(2, '0'))
                .replace(/\{DD\}/g, String(d).padStart(2, '0'))
            );
          }
        }
      }
    }
    const uniqueCandidates = Array.from(new Set(candidates));
    const escapedSuffix = (suffix ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return uniqueCandidates.map((p) => {
      const escapedPrefix = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`^${escapedPrefix}(\\d+)${escapedSuffix}$`);
    });
  }
}
