import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AccessLevel, AuditScopeKind, Prisma, SequenceResetFrequency } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { DEFAULT_PATTERNS, fallbackPattern, interpolateTokens } from './defaults';

export function sequenceResetDue(
  frequency: SequenceResetFrequency,
  lastResetAt: Date | null,
  now: Date,
): boolean {
  if (frequency === 'NEVER') return false;
  if (!lastResetAt) return true;
  if (frequency === 'YEARLY') return lastResetAt.getFullYear() !== now.getFullYear();
  if (frequency === 'MONTHLY') {
    return (
      lastResetAt.getFullYear() !== now.getFullYear() || lastResetAt.getMonth() !== now.getMonth()
    );
  }
  return (
    lastResetAt.getFullYear() !== now.getFullYear() ||
    lastResetAt.getMonth() !== now.getMonth() ||
    lastResetAt.getDate() !== now.getDate()
  );
}

export interface SequenceBackfillAuditScope {
  scopeKind: AuditScopeKind;
  companyScopeIds: string[];
}

/**
 * Exact immutable audit scope for the companies that passed WRITE policy.
 * An empty sweep has no mutation summary: no company authority was established
 * and every available zero-id scope would overclaim or misstate attribution.
 */
export function sequenceBackfillAuditScope(
  authorizedCompanyIds: readonly string[],
): SequenceBackfillAuditScope | undefined {
  const companyScopeIds = [...new Set(authorizedCompanyIds)].sort();
  if (companyScopeIds.length === 0) return undefined;
  return {
    scopeKind: companyScopeIds.length === 1 ? AuditScopeKind.COMPANY : AuditScopeKind.MULTI_COMPANY,
    companyScopeIds,
  };
}

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
 *   - Never decreases — counter writes use an atomic database maximum; a
 *     stale periodic anchor may also be refreshed without lowering the count
 *
 * Run via `POST /entity-code-generator/backfill?companyId=X` after a fresh
 * deploy. Operators can also re-run any time without harm.
 */

export interface BackfillTarget {
  entityType: string;
  /** Prisma model name on the client (e.g. `salesOrder`). */
  prismaModel: string;
  /** Field on the row that holds the human-readable code. */
  numberField: string;
  /**
   * Field that owns the generated-number namespace for this model.
   * Most models use `companyId`; asymmetric intercompany rows are scoped by
   * their source company instead.
   */
  companyIdField?: string;
}

export const BACKFILL_TARGETS: readonly BackfillTarget[] = [
  { entityType: 'Trip', prismaModel: 'trip', numberField: 'tripNumber' },
  { entityType: 'HarvestRecord', prismaModel: 'harvestRecord', numberField: 'harvestNumber' },
  {
    entityType: 'ProjectMaterialIssue',
    prismaModel: 'projectMaterialIssue',
    numberField: 'issueNumber',
  },
  { entityType: 'ProjectBilling', prismaModel: 'projectBilling', numberField: 'billingNumber' },
  { entityType: 'SalesOrder', prismaModel: 'salesOrder', numberField: 'salesOrderNumber' },
  { entityType: 'PurchaseOrder', prismaModel: 'purchaseOrder', numberField: 'purchaseOrderNumber' },
  { entityType: 'JournalEntry', prismaModel: 'journalEntry', numberField: 'journalNumber' },
  { entityType: 'Receivable', prismaModel: 'receivable', numberField: 'receivableNumber' },
  { entityType: 'Payable', prismaModel: 'payable', numberField: 'payableNumber' },
  {
    entityType: 'TaxTransaction',
    prismaModel: 'taxTransaction',
    numberField: 'taxTransactionNumber',
  },
  { entityType: 'TaxReturn', prismaModel: 'taxReturn', numberField: 'taxReturnNumber' },
  {
    entityType: 'InventoryMovement',
    prismaModel: 'inventoryMovement',
    numberField: 'movementNumber',
  },
  { entityType: 'Expense', prismaModel: 'expense', numberField: 'expenseNumber' },
  {
    entityType: 'AuditAdjustment',
    prismaModel: 'auditAdjustment',
    numberField: 'adjustmentNumber',
  },
  {
    entityType: 'LoanRepaymentPayment',
    prismaModel: 'loanRepaymentPayment',
    numberField: 'repaymentPaymentNumber',
  },
  {
    entityType: 'IntercompanyTransaction',
    prismaModel: 'interCompanyTransaction',
    numberField: 'transactionNumber',
    companyIdField: 'fromCompanyId',
  },
  { entityType: 'DeliveryNote', prismaModel: 'deliveryNote', numberField: 'deliveryNoteNumber' },
  { entityType: 'PackageMovement', prismaModel: 'packageMovement', numberField: 'movementNumber' },
  {
    entityType: 'AttendanceRecord',
    prismaModel: 'attendanceRecord',
    numberField: 'attendanceNumber',
  },
  {
    entityType: 'DisciplinaryAction',
    prismaModel: 'disciplinaryAction',
    numberField: 'actionNumber',
  },
  {
    entityType: 'EmploymentDispute',
    prismaModel: 'employmentDispute',
    numberField: 'disputeNumber',
  },
  {
    entityType: 'SubcontractorRecord',
    prismaModel: 'subcontractorRecord',
    numberField: 'subcontractorCode',
  },
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
  /** True only when this target threw; informational no-op messages are not failures. */
  failed?: boolean;
}

@Injectable()
export class SequenceBackfillService {
  private readonly logger = new Logger(SequenceBackfillService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly auditLogs: AuditLogsService,
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
  async backfillAll(user: AuthUser, query: { companyId?: string } = {}): Promise<BackfillResult[]> {
    let companies: Array<{ id: string }>;

    if (query.companyId) {
      await this.companyScope.assertCanAccessCompany(user, query.companyId, AccessLevel.WRITE);
      companies = [{ id: query.companyId }];
    } else {
      // No company specified: enumerate potential companies, then authorize
      // every one at WRITE. Group scope and membership/read visibility are
      // candidate-discovery mechanisms only; neither grants mutation rights.
      // Keep authorization sequential so large groups have bounded database
      // concurrency and one denied company cannot broaden the sweep.
      let candidates: Array<{ id: string }>;
      if (this.companyScope.isGroupScoped(user)) {
        candidates = await this.prisma.company.findMany({
          where: { deletedAt: null },
          select: { id: true },
        });
      } else {
        const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
        candidates =
          accessibleIds.length === 0
            ? []
            : await this.prisma.company.findMany({
                where: { id: { in: accessibleIds }, deletedAt: null },
                select: { id: true },
              });
      }

      companies = [];
      for (const candidate of candidates) {
        try {
          await this.companyScope.assertCanAccessCompany(user, candidate.id, AccessLevel.WRITE);
          companies.push(candidate);
        } catch (err) {
          if (err instanceof ForbiddenException) continue;
          throw err;
        }
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
            failed: true,
          });
        }
      }
    }
    const auditScope = sequenceBackfillAuditScope(companies.map((company) => company.id));
    if (auditScope) {
      await this.auditLogs.log({
        action: 'ENTITY_CODE_BACKFILL',
        entityType: 'DocumentNumberSequence',
        userId: user.id,
        ...auditScope,
        metadata: {
          companies: companies.length,
          targets: results.length,
          updated: results.filter((result) => result.updated).length,
          failed: results.filter((result) => result.failed).length,
        },
      });
    }
    return results;
  }

  private async backfillOne(target: BackfillTarget, companyId: string): Promise<BackfillResult> {
    const sequenceCode = `${target.entityType}_${companyId}`;
    const pattern = DEFAULT_PATTERNS[target.entityType] ?? fallbackPattern(target.entityType);
    const backfillAt = new Date();

    // Fetch the existing entity codes for this company. Limited to a sane
    // page size so a million-row table doesn't blow memory; if a company
    // has more than this we still get the highest by ordering.
    const client = this.prisma as unknown as Record<
      string,
      {
        findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
      }
    >;
    const model = client[target.prismaModel];
    if (!model) {
      throw new Error(`Prisma model "${target.prismaModel}" not found`);
    }

    const rows = await model.findMany({
      where: { [target.companyIdField ?? 'companyId']: companyId },
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
    const matchers = this.buildPatternMatchers(pattern.prefix, pattern.suffix, backfillAt);

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
      select: {
        id: true,
        currentNumber: true,
        resetFrequency: true,
        lastResetAt: true,
      },
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
          // A periodic sequence with a null anchor is treated by `next()` as
          // first-use and reset to 1. Stamp the backfill instant so the next
          // issue advances from the recovered maximum instead.
          lastResetAt: pattern.resetFrequency === 'NEVER' ? null : backfillAt,
          isActive: true,
        },
      });
      after = maxFound;
      updated = true;
    } else {
      before = existing.currentNumber;
      const needsPeriodicAnchor =
        maxFound > 0 && sequenceResetDue(existing.resetFrequency, existing.lastResetAt, backfillAt);
      if (maxFound > existing.currentNumber || needsPeriodicAnchor) {
        let mutations: number;
        if (needsPeriodicAnchor) {
          // One PostgreSQL statement owns the row for the entire alignment.
          // GREATEST makes a concurrent issuer monotonic, while refreshing the
          // current-period anchor makes any issuer holding a stale reset CAS
          // lose, re-read, and increment from the recovered maximum. The CASE
          // protects a concurrent administrative change to NEVER frequency.
          mutations = await this.prisma.$executeRaw(
            Prisma.sql`
              UPDATE "document_number_sequences"
              SET
                "currentNumber" = GREATEST("currentNumber", ${maxFound}),
                "lastResetAt" = CASE
                  WHEN "resetFrequency" <> 'NEVER'::"SequenceResetFrequency" THEN ${backfillAt}
                  ELSE "lastResetAt"
                END,
                "updatedAt" = ${backfillAt}
              WHERE "id" = ${existing.id}
                AND "deletedAt" IS NULL
            `,
          );
        } else {
          mutations = await this.prisma.$executeRaw(
            Prisma.sql`
              UPDATE "document_number_sequences"
              SET
                "currentNumber" = GREATEST("currentNumber", ${maxFound}),
                "updatedAt" = ${backfillAt}
              WHERE "id" = ${existing.id}
                AND "deletedAt" IS NULL
                AND "currentNumber" < ${maxFound}
            `,
          );
        }

        const fresh = await this.prisma.documentNumberSequence.findFirstOrThrow({
          where: { id: existing.id, deletedAt: null },
          select: { currentNumber: true },
        });
        after = fresh.currentNumber;
        updated = mutations > 0;
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
   * Build the matcher for the active reset period. A previous-period maximum
   * must not seed the current period: doing so either creates needless gaps or
   * leaves a stale reset anchor that causes the next issuer to reset to 1.
   */
  private buildPatternMatchers(prefix: string, suffix: string | undefined, when: Date): RegExp[] {
    const escapedPrefix = interpolateTokens(prefix, when).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedSuffix = interpolateTokens(suffix ?? '', when).replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
    return [new RegExp(`^${escapedPrefix}(\\d+)${escapedSuffix}$`)];
  }
}
