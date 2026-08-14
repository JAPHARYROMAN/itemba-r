import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * The end-of-day close a rep submits from Funga Siku (spec-history-reports
 * §1.3).
 *
 * The client sends NO totals, no lines, no method breakdown and no rep or
 * terminal identity: everything the office reads as fact is recomputed
 * server-side from SalesOrder rows, and the terminal headers pin who and where.
 * The only client-declared numbers on the whole record are heldCount /
 * heldAmount — what the phone's outbox is still holding, which is the one thing
 * the server genuinely cannot know — and they are stored, returned and printed
 * under names that say they were declared.
 */
export class CreateMobilePosLiteDayReportDto {
  /**
   * Client-generated replay-protection token, same rule as purchases and
   * counts. Frozen on the phone from the first send attempt until a 2xx or an
   * explicit new close, so an identical retry is always safe; the company-scoped
   * unique index on mobile_pos_day_reports is what enforces it here.
   */
  @IsString()
  @MinLength(16)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message: 'idempotencyKey may only contain letters, numbers, ".", "_", ":" and "-"',
  })
  idempotencyKey!: string;

  /**
   * The calendar day being closed, frozen WITH the key.
   *
   * The phone owns WHICH day it is closing and the server owns WHETHER that day
   * is closable: a retry at 00:01 for a close begun at 23:59 must still close
   * yesterday, and if the server picked the day the retry would silently close a
   * different one. The server refuses anything outside today-or-yesterday IN THE
   * BUSINESS TIMEZONE (see MOBILE_POS_BUSINESS_TIMEZONE and
   * resolveClosableBusinessDate) — not in the container's incidental zone, which
   * used to refuse every close made between midnight and 03:00 EAT, and not on
   * the phone's word, so a device clock two weeks out still cannot mint a report
   * for a day nobody worked.
   */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'businessDate must be a calendar date in YYYY-MM-DD form',
  })
  businessDate!: string;

  /** How many sales are still sitting in the phone's outbox. Declared, never derived. */
  @IsInt()
  @Min(0)
  @Max(500)
  heldCount!: number;

  /** The display-snapshot sum of those held sales. Declared, never derived. */
  @IsNumber()
  @Min(0)
  @Max(1000000000)
  heldAmount!: number;
}

/**
 * Query for the office list `GET /mobile-pos-lite/day-reports`
 * (spec-history-reports §1.5). Company scope is resolved from the AuthUser, so
 * there is deliberately no `companyId` here; `limit` is fixed server-side.
 *
 * No boolean parameters on purpose — whoever adds one must use the documented
 * coercion pattern `@Type(() => String) @Transform(({ value }) => value ===
 * 'true')`, since the plain pattern is clobbered by `enableImplicitConversion`.
 */
export class QueryMobilePosLiteDayReportsDto {
  @IsOptional()
  @IsUUID()
  terminalId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be a calendar date in YYYY-MM-DD form' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be a calendar date in YYYY-MM-DD form' })
  to?: string;
}
