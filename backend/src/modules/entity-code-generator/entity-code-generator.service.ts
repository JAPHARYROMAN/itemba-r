import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SequenceResetFrequency } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_PATTERNS, EntityCodePattern, fallbackPattern, interpolateTokens } from './defaults';

type DbClient = Prisma.TransactionClient | PrismaService;

/** The subset of a DocumentNumberSequence row the generator needs to advance. */
interface SequenceRow {
  id: string;
  currentNumber: number;
  padding: number;
  prefix: string | null;
  suffix: string | null;
  resetFrequency: SequenceResetFrequency;
  lastResetAt: Date | null;
}

/**
 * Bound on how many times `advance()` will re-read + retry after losing a
 * reset compare-and-set. Losing means another caller already reset this
 * period, so the retry hits the (race-safe) increment fast path; a handful of
 * retries covers even pathological boundary contention without spinning.
 */
const MAX_ADVANCE_RETRIES = 3;

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
 * The reset is applied as a **guarded compare-and-set** (`updateMany` whose
 * `where` still pins the previously-observed `lastResetAt`): only the first
 * caller across a period boundary matches the guard and claims the reset;
 * every loser matches zero rows and falls through to a plain atomic
 * increment. This closes the read-decide-reset TOCTOU where two concurrent
 * callers could each observe "reset due" and both write `currentNumber = 1`
 * (duplicate numbers) or race the unique key (P2002). A lost claim retries
 * the advance rather than surfacing a 500.
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

    const advanced = await this.advance(client, seq, now);

    const prefix = interpolateTokens(advanced.prefix ?? '', now);
    const suffix = interpolateTokens(advanced.suffix ?? '', now);
    const padded = String(advanced.currentNumber).padStart(advanced.padding ?? 5, '0');
    return `${prefix}${padded}${suffix}`;
  }

  /**
   * Atomically advance the counter for an already-resolved sequence row,
   * honouring the reset frequency without a read-decide-write race.
   *
   * Reset is a **guarded compare-and-set**: we only reset when the period has
   * rolled over *and* the row still carries the `lastResetAt` we observed
   * (`updateMany({ where: { id, lastResetAt: <observed> }, ... })`). At a
   * period boundary many callers may all compute `shouldReset === true`, but
   * the guard means exactly one `updateMany` matches (count === 1) and claims
   * the reset to `currentNumber = 1`; the others match zero rows and fall back
   * to a plain atomic increment. No two callers can both write `1`, and no
   * caller collides on the unique key. When no reset is due, we take the fast
   * path: a single `{ increment: 1 }` update, which is already race-safe.
   *
   * `updateMany` does not return the affected row, so after a *won* reset we
   * re-read the row's current fields; the read runs on the same `client`
   * (shared tx when provided). A rare lost claim retries the whole advance so
   * a boundary race degrades to a retry instead of a 500.
   */
  private async advance(
    client: DbClient,
    seq: SequenceRow,
    now: Date,
    attempt = 0,
  ): Promise<{ currentNumber: number; prefix: string | null; suffix: string | null; padding: number }> {
    const shouldReset = this.shouldReset(seq.resetFrequency, seq.lastResetAt, now);

    if (!shouldReset) {
      const updated = await client.documentNumberSequence.update({
        where: { id: seq.id },
        data: { currentNumber: { increment: 1 } },
        select: { currentNumber: true, prefix: true, suffix: true, padding: true },
      });
      return updated;
    }

    // Reset is due — try to claim it. The `lastResetAt` guard makes this a
    // compare-and-set: it only matches while the row still holds the value we
    // read, so a concurrent reset (which bumps lastResetAt) invalidates ours.
    const claim = await client.documentNumberSequence.updateMany({
      where: { id: seq.id, lastResetAt: seq.lastResetAt },
      data: { currentNumber: 1, lastResetAt: now },
    });

    if (claim.count === 1) {
      // We won the reset. updateMany returns no row, so re-read the fields we
      // need; currentNumber is authoritatively 1 for the winner.
      const row = await client.documentNumberSequence.findUniqueOrThrow({
        where: { id: seq.id },
        select: { prefix: true, suffix: true, padding: true },
      });
      return { currentNumber: 1, prefix: row.prefix, suffix: row.suffix, padding: row.padding };
    }

    // Lost the reset claim (another caller already reset this period). Re-read
    // the row and retry: `shouldReset` will now be false, so we take the
    // atomic-increment fast path off the fresh value.
    if (attempt >= MAX_ADVANCE_RETRIES) {
      // Extremely unlikely (would require repeated boundary resets). Fall back
      // to a plain atomic increment so we still hand back a unique number
      // rather than throwing.
      const updated = await client.documentNumberSequence.update({
        where: { id: seq.id },
        data: { currentNumber: { increment: 1 } },
        select: { currentNumber: true, prefix: true, suffix: true, padding: true },
      });
      return updated;
    }

    const fresh = await client.documentNumberSequence.findUniqueOrThrow({
      where: { id: seq.id },
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
    return this.advance(client, fresh, now, attempt + 1);
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
  ): Promise<SequenceRow> {
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
