import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SequenceResetFrequency } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_PATTERNS, EntityCodePattern, fallbackPattern, interpolateTokens } from './defaults';

type DbClient = Prisma.TransactionClient | PrismaService;

/**
 * EntityCodeGeneratorService — central, race-safe issuer for auto-generated
 * entity codes (TripNumber, HarvestNumber, JournalNumber, etc.).
 *
 * Single API: `await codes.next({ companyId, entityType: 'Trip' })` returns
 * a formatted code like `TRIP-2026-00001`, advancing the underlying
 * `DocumentNumberSequence` row atomically.
 *
 * **Race safety**: counter is bumped via Prisma's atomic
 * `{ currentNumber: { increment: 1 } }` update, which compiles to a single
 * SQL UPDATE on Postgres. Two concurrent calls cannot return the same
 * number. Callers running inside a `$transaction` should pass `tx` so the
 * advance shares the surrounding transaction's snapshot — important when
 * the issued code lands on a row that the same transaction creates.
 *
 * **Lazy creation**: if no `DocumentNumberSequence` row exists for the
 * `(companyId, entityType)` pair, one is auto-created using `DEFAULT_PATTERNS`
 * (or `fallbackPattern()` for unknown types). Operators can then customise
 * via `/settings/number-sequences`.
 *
 * **Reset frequency**: when YEARLY/MONTHLY/DAILY and the period has rolled
 * over since `lastResetAt`, the counter resets to 1 instead of incrementing.
 * The reset and the increment happen in one atomic update so concurrent
 * callers can't both observe "reset due" simultaneously.
 *
 * **Format**: `{interpolated-prefix}{padded-counter}{interpolated-suffix}`.
 * Tokens supported in prefix/suffix: `{YYYY}`, `{YY}`, `{MM}`, `{DD}` —
 * resolved at the moment of issue using the server's local time.
 */
@Injectable()
export class EntityCodeGeneratorService {
  private readonly logger = new Logger(EntityCodeGeneratorService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issue the next code for `entityType` scoped to `companyId` (or globally
   * when `companyId` is omitted). Pass an optional `tx` to share an
   * outer transaction.
   */
  async next(input: NextCodeInput): Promise<string> {
    const client: DbClient = input.tx ?? this.prisma;
    const sequenceCode = this.buildSequenceCode(input.entityType, input.companyId);

    const seq = await this.findOrCreate(client, sequenceCode, input);
    const now = input.when ?? new Date();
    const shouldReset = this.shouldReset(seq.resetFrequency, seq.lastResetAt, now);

    // Atomic advance. One UPDATE either increments the counter or resets it
    // to 1 + bumps lastResetAt — both branches return the current value.
    const updated = await client.documentNumberSequence.update({
      where: { id: seq.id },
      data: shouldReset
        ? { currentNumber: 1, lastResetAt: now }
        : { currentNumber: { increment: 1 } },
      select: { currentNumber: true, prefix: true, suffix: true, padding: true },
    });

    const prefix = interpolateTokens(updated.prefix ?? '', now);
    const suffix = interpolateTokens(updated.suffix ?? '', now);
    const padded = String(updated.currentNumber).padStart(updated.padding ?? 5, '0');
    return `${prefix}${padded}${suffix}`;
  }

  /**
   * Preview what the next code would be **without advancing the counter**.
   * Useful for showing the user "your next trip will be TRIP-2026-00042"
   * before they hit save. Does not auto-create a sequence — returns null
   * when none exists yet.
   */
  async preview(input: NextCodeInput): Promise<string | null> {
    const sequenceCode = this.buildSequenceCode(input.entityType, input.companyId);
    const seq = await this.prisma.documentNumberSequence.findFirst({
      where: { sequenceCode, deletedAt: null },
      select: {
        currentNumber: true,
        prefix: true,
        suffix: true,
        padding: true,
        resetFrequency: true,
        lastResetAt: true,
      },
    });
    if (!seq) {
      // No row yet — predict using the defaults so the UI can still show a sample.
      const pattern = DEFAULT_PATTERNS[input.entityType] ?? fallbackPattern(input.entityType);
      const now = input.when ?? new Date();
      const prefix = interpolateTokens(pattern.prefix, now);
      const suffix = interpolateTokens(pattern.suffix ?? '', now);
      return `${prefix}${'1'.padStart(pattern.padding, '0')}${suffix}`;
    }

    const now = input.when ?? new Date();
    const willReset = this.shouldReset(seq.resetFrequency, seq.lastResetAt, now);
    const nextNum = willReset ? 1 : seq.currentNumber + 1;
    const prefix = interpolateTokens(seq.prefix ?? '', now);
    const suffix = interpolateTokens(seq.suffix ?? '', now);
    return `${prefix}${String(nextNum).padStart(seq.padding ?? 5, '0')}${suffix}`;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private buildSequenceCode(entityType: string, companyId?: string | null): string {
    return `${entityType}_${companyId ?? 'GLOBAL'}`;
  }

  private async findOrCreate(
    client: DbClient,
    sequenceCode: string,
    input: NextCodeInput,
  ): Promise<{
    id: string;
    currentNumber: number;
    padding: number;
    prefix: string | null;
    suffix: string | null;
    resetFrequency: SequenceResetFrequency;
    lastResetAt: Date | null;
  }> {
    const existing = await client.documentNumberSequence.findFirst({
      where: { sequenceCode, deletedAt: null },
      select: {
        id: true,
        currentNumber: true,
        padding: true,
        prefix: true,
        suffix: true,
        resetFrequency: true,
        lastResetAt: true,
      },
    });
    if (existing) return existing;

    // Lazy-create with defaults. If a concurrent call beat us to it, the
    // unique constraint on `sequenceCode` will throw — re-fetch and use that.
    const pattern: EntityCodePattern =
      DEFAULT_PATTERNS[input.entityType] ?? fallbackPattern(input.entityType);
    try {
      const created = await client.documentNumberSequence.create({
        data: {
          sequenceCode,
          companyId: input.companyId ?? null,
          entityType: input.entityType,
          prefix: pattern.prefix,
          suffix: pattern.suffix ?? null,
          padding: pattern.padding,
          resetFrequency: pattern.resetFrequency,
          currentNumber: 0,
          isActive: true,
        },
        select: {
          id: true,
          currentNumber: true,
          padding: true,
          prefix: true,
          suffix: true,
          resetFrequency: true,
          lastResetAt: true,
        },
      });
      this.logger.log(`Lazy-created sequence ${sequenceCode} (entityType=${input.entityType})`);
      return created;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Race lost — another caller created it first.
        const re = await client.documentNumberSequence.findFirstOrThrow({
          where: { sequenceCode, deletedAt: null },
          select: {
            id: true,
            currentNumber: true,
            padding: true,
            prefix: true,
            suffix: true,
            resetFrequency: true,
            lastResetAt: true,
          },
        });
        return re;
      }
      throw err;
    }
  }

  private shouldReset(
    frequency: SequenceResetFrequency,
    lastResetAt: Date | null,
    now: Date,
  ): boolean {
    if (frequency === 'NEVER') return false;
    if (!lastResetAt) {
      // First-ever issue under a non-NEVER frequency — treat as a reset so
      // the lastResetAt anchor gets stamped, and the counter starts at 1.
      return true;
    }
    switch (frequency) {
      case 'DAILY':
        return (
          lastResetAt.getFullYear() !== now.getFullYear() ||
          lastResetAt.getMonth() !== now.getMonth() ||
          lastResetAt.getDate() !== now.getDate()
        );
      case 'MONTHLY':
        return (
          lastResetAt.getFullYear() !== now.getFullYear() ||
          lastResetAt.getMonth() !== now.getMonth()
        );
      case 'YEARLY':
        return lastResetAt.getFullYear() !== now.getFullYear();
      default:
        return false;
    }
  }
}

export interface NextCodeInput {
  /** Entity type. Looked up in DEFAULT_PATTERNS for first-time format. */
  entityType: string;
  /** Optional company scope. Different companies get separate counters. */
  companyId?: string | null;
  /** Optional Prisma transaction client to share. */
  tx?: Prisma.TransactionClient;
  /** Override the timestamp used for tokens / reset detection. Tests only. */
  when?: Date;
}
