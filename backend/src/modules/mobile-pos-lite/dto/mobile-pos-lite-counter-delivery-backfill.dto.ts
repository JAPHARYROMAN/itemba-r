import { IsOptional, IsUUID } from 'class-validator';

/**
 * Query for the manager-authorised historical repair
 * `POST /mobile-pos-lite/counter-delivery-backfill` (spec-counter-delivery §4).
 *
 * The ONLY thing a caller may say is *which company* to repair, and even that is
 * a narrowing of what CompanyScopeService already allows — never a widening.
 * Everything else about the run is server-derived: the qualifying population, the
 * batch cap, the delivery date, the acting user and every field on the note.
 *
 * Deliberately no `limit`, no `take`, no `dryRun` and no `orderIds`:
 *  - a caller-chosen batch size is how one request ends up trying to write ten
 *    thousand documents, which is exactly what the server-side cap exists to
 *    prevent;
 *  - a caller-supplied list of order ids would let a request name orders the
 *    §4.2 qualifiers exclude — a DRAFT order, a cancelled one, a desktop one —
 *    and the whole safety of this endpoint is that the population is computed,
 *    not accepted.
 *
 * No boolean parameters on purpose. Whoever adds one must use the documented
 * coercion pattern `@Type(() => String) @Transform(({ value }) => value ===
 * 'true')`, since the plain pattern is clobbered by `enableImplicitConversion`.
 */
export class QueryMobilePosLiteCounterDeliveryBackfillDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

/** One order the run could not repair. Counted, reported, never fatal. */
export interface MobilePosLiteCounterDeliveryBackfillFailure {
  salesOrderId: string;
  salesOrderNumber: string | null;
  reason: string;
}

/**
 * The run report — and the operator's verification instrument
 * (spec-counter-delivery §4.3). The backfill script reads exactly these fields
 * and stops driving batches when a run makes no progress, so the names are a
 * contract:
 *
 *  - `scanned`  how many qualifying orders this batch selected (≤ the cap)
 *  - `created`  a note was written and driven to DELIVERED
 *  - `resumed`  a note already existed in a non-terminal state and was healed
 *  - `skipped`  nothing to do (already DELIVERED/CLOSED, or the order has no lines)
 *  - `failed`   the order was left exactly as it was; see `failures`
 *
 * A second run over a repaired population reports `created: 0, resumed: 0`.
 */
export interface MobilePosLiteCounterDeliveryBackfillReport {
  scanned: number;
  created: number;
  resumed: number;
  skipped: number;
  failed: number;
  failures: MobilePosLiteCounterDeliveryBackfillFailure[];
}
