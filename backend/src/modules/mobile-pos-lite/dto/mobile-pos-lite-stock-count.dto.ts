import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Ceiling on one count body.
 *
 * The spec wrote 200 (§1.2). That is below what the feature is FOR: the stock
 * endpoint hands the phone up to 1500 products (service `stock()`), and a full
 * closing count of a mid-sized duka is routinely 250-400 SKUs — a cap of 200
 * makes the whole sheet permanently unsendable for those branches.
 *
 * It is not raised to 1500 either, and the reason is post()'s transaction, not
 * squeamishness: every counted line costs roughly ten round-trips inside the
 * ONE interactive transaction StockAdjustmentsService.post() opens (two balance
 * value reads, movement scope/reference/cost validation, a code-sequence hit,
 * the movement insert, the balance upsert and its FOR UPDATE re-read). At 1500
 * lines that is ~15k statements under one long-lived transaction holding row
 * locks against live sales at the same branch. 500 lines (~5k statements) sits
 * comfortably inside the explicit 60s timeout that post() now carries and still
 * covers a real closing count.
 *
 * Over the cap the manager gets the mapped message below and the recovery it
 * names — a second count for the rest of the shelves — which is exact, not a
 * workaround: variance is computed per product against the live balance at post
 * time, so two counts of disjoint products are worth precisely one count of
 * their union.
 */
export const MOBILE_POS_LITE_STOCK_COUNT_MAX_LINES = 500;

export class MobilePosLiteStockCountLineDto {
  @IsUUID()
  productId!: string;

  /**
   * Units found on the shelf. 0 is a real count ("shelf is empty"), never an
   * absent value — a product the rep did not count carries no line at all.
   * Integer-only in v1 (owner decision 2026-08-11, plan §7-5); decimals return
   * with weighed-goods support.
   */
  @IsInt()
  @Min(0)
  @Max(1000000)
  countedQuantity!: number;
}

export class CreateMobilePosLiteStockCountDto {
  /**
   * Client-generated replay-protection token, same rule as purchases. The
   * charset is restricted so the key can be embedded verbatim in the stock
   * adjustment's notes marker without ambiguity.
   */
  @IsString()
  @MinLength(16)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message: 'idempotencyKey may only contain letters, numbers, ".", "_", ":" and "-"',
  })
  idempotencyKey!: string;

  /**
   * When the shelf was actually counted (the draft's first-edit timestamp).
   *
   * Embedded in the notes so the office can see how old a count was when it
   * posted, AND load-bearing on the create path: it is the only clock that
   * spans the gap between the shelf being counted and this request arriving,
   * and that gap is unbounded by design (capture is offline-first and the draft
   * never expires). A capture older than the server's window is refused before
   * anything is created, because its variance would otherwise be frozen against
   * a balance the shop has already traded past — see
   * STOCK_COUNT_MAX_CAPTURE_AGE_HOURS in the service.
   *
   * Still never trusted for anything that would ACCEPT work: the system side is
   * always read live, and an absent, unparseable or future-dated stamp is
   * treated as an unknown age and driven normally.
   */
  @IsOptional()
  @IsISO8601()
  countedAt?: string;

  /**
   * How long ago the shelf was counted, in milliseconds, measured by the PHONE.
   *
   * `countedAt` alone cannot answer that question: it is stamped by the device
   * clock and compared against the server's, so the answer carries the skew
   * between two clocks. Only the slow direction refuses, and it refuses a count
   * that is minutes old — an Android that came back from a flat battery with
   * automatic time off can sit hours behind and have every count it will ever
   * take rejected as stale, with the recount the message asks for rejected the
   * same way. This field is both readings taken from the SAME clock, so the
   * skew cancels and what arrives is the elapsed interval itself.
   *
   * Trusted for the same reason `countedAt` is: this endpoint already takes the
   * counted numbers from this phone, and the confirm sheet shows the manager
   * the capture time before she sends. Absent or unparseable falls back to the
   * two-clock comparison, and an age that cannot be established never refuses.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  capturedAgoMs?: number;

  /**
   * The counted lines only. The client sends no systemQuantity, no variance,
   * no unitId and no cost — every one of those is server-authoritative.
   *
   * The cap carries its own message on purpose: class-validator's default
   * ("lines must contain no more than N elements") matches no row in the
   * phone's error map, so an over-long sheet would reach the manager as the
   * generic "call a supervisor" card with no way to learn what was wrong or
   * what to do. This sentence names the ceiling and the recovery.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MOBILE_POS_LITE_STOCK_COUNT_MAX_LINES, {
    message: `A stock count can carry at most ${MOBILE_POS_LITE_STOCK_COUNT_MAX_LINES} products — send the rest as a second count.`,
  })
  @ValidateNested({ each: true })
  @Type(() => MobilePosLiteStockCountLineDto)
  lines!: MobilePosLiteStockCountLineDto[];
}
