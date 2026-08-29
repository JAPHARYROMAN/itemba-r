import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessLevel,
  AuditSeverity,
  CashAccountType,
  CurrencyCode,
  MobilePosDayReport,
  MobilePosTerminalStatus,
  Prisma,
  ProductType,
  PurchaseType,
  SalesOrderStatus,
  SalesPaymentMethod,
  SalesType,
} from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { GoodsReceivedNotesService } from '../goods-received-notes/goods-received-notes.service';
import { StockAdjustmentsService } from '../stock-adjustments/stock-adjustments.service';
import { DeliveryNotesService } from '../delivery-notes/delivery-notes.service';
import { GeneratedDocumentsService } from '../generated-documents/generated-documents.service';
import type { BusinessPdfSection } from '../generated-documents/pdf-builder';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import {
  businessDayKeyOf,
  businessDayStart,
  businessDayWindow,
  shiftBusinessDayKey,
} from '../../common/utils/business-day';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateMobilePosTerminalDto,
  MOBILE_POS_LITE_RECEIPT_METHODS,
  MobilePosTerminalPaymentDto,
  QueryMobilePosTerminalDto,
  UpdateMobilePosTerminalDto,
} from './dto/mobile-pos-terminal.dto';
import { ActivateMobilePosTerminalDto } from './dto/mobile-pos-lite-session.dto';
import { CreateMobilePosLiteSaleDto } from './dto/mobile-pos-lite-sale.dto';
import { CreateMobilePosLitePurchaseDto } from './dto/mobile-pos-lite-purchase.dto';
import { CreateMobilePosLiteStockCountDto } from './dto/mobile-pos-lite-stock-count.dto';
import {
  CreateMobilePosLiteDayReportDto,
  QueryMobilePosLiteDayReportsDto,
} from './dto/mobile-pos-lite-day-report.dto';
import {
  MobilePosLiteCounterDeliveryBackfillFailure,
  MobilePosLiteCounterDeliveryBackfillReport,
  QueryMobilePosLiteCounterDeliveryBackfillDto,
} from './dto/mobile-pos-lite-counter-delivery-backfill.dto';

const ACTIVATION_TTL_MS = 20 * 60 * 1000;

/**
 * "Confirmed" sales, mirroring westsides-reports dailyClose:
 * SalesOrder.status ∈ {CONFIRMED, PARTIALLY_PAID, PAID}.
 */
const CONFIRMED_SALES_STATUSES = [
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.PARTIALLY_PAID,
  SalesOrderStatus.PAID,
] as const;

/**
 * How far back both history lists reach (spec-history-reports §1.0, owner
 * decision 2026-08-14). Today counts as day 1, so "siku 7" is today plus the
 * six before it.
 *
 * A SERVER constant, deliberately NOT a `days` query parameter on either route:
 * a client-supplied window is a knob nobody turns and a widening waiting to
 * happen, and the purchase list is the one payload in this module that a stolen
 * phone must never be able to stretch. The owner set 7, so 7 lives here.
 */
const MOBILE_POS_HISTORY_DAYS = 7;

/**
 * Newest-first bound on the sales history list. ~28 sales/day for a week, and
 * the list is ordered desc, so truncation drops the OLDEST rows rather than the
 * ones a rep is looking for. The headline count/total come from an UNBOUNDED
 * aggregate over the same where, so a truncated list can never produce a wrong
 * total — the same discipline stock() applies to its 1500.
 */
const MOBILE_POS_SALES_HISTORY_TAKE = 200;

/** Same bound, same reasoning, for the branch's POS receiving book. */
const MOBILE_POS_PURCHASE_HISTORY_TAKE = 100;

/**
 * How many product rows survive into the stored day-report breakdown. This is
 * the ONLY bound left on that record, and it cannot corrupt a figure the paper
 * presents as a total: salesCount, grossTotal and itemsSoldQuantity all come
 * from unbounded aggregates, and when the cap bites the row carries
 * `itemsTruncated: true` so the paper can say so out loud.
 */
const MOBILE_POS_DAY_REPORT_ITEM_CAP = 50;

/*
 * THE BUSINESS TIMEZONE and the business-day window arithmetic now live in
 * `common/utils/business-day.ts` (imported above), hoisted VERBATIM so the
 * westsides daily close can aggregate over the SAME window a terminal's
 * MobilePosDayReport covers. Behavior here is unchanged; the review-blocking
 * rule still applies: nothing in this module may decide a day boundary from
 * the PROCESS's zone or from an instant the client chose — use
 * `businessDayKeyOf` and `businessDayWindow`, which read the pinned
 * MOBILE_POS_BUSINESS_TIMEZONE and nothing else. The zone stays the SAME one
 * this module pins for every rendered time (`receiptDateTime`,
 * `reportFileTime`, and the letterhead builder), so the day a report is filed
 * under and the clock printed on the receipts inside it cannot disagree.
 */

/**
 * How far back a terminal may reach when it closes a day, counted in business
 * days. 1 = today or yesterday.
 *
 * Yesterday is not a courtesy: with the boundary above, a rep who traded until
 * 23:50 and closes at 00:30 is closing YESTERDAY, and so is one whose day ended
 * with no signal and who closes over breakfast. Both are ordinary. It stops at
 * yesterday because the phone offers exactly those two days, because a day
 * older than that is a device clock rather than a work day, and because the
 * office can always read the records themselves — the report is a snapshot, not
 * a financial fact, so nothing is lost by refusing to mint one for a day nobody
 * can still remember.
 */
const MOBILE_POS_CLOSABLE_DAYS_BACK = 1;

/**
 * Every company id a resolved company scope can actually reach.
 *
 * `companyWhereFor` returns one of three shapes — a single `companyId`, an
 * `{ in: [...] }` list for a group user who named no company, or the
 * `{ id: { in: [] } }` reach-nothing guard. Only the first is obvious enough to
 * assert against by hand, which is exactly how the write-access check on the
 * backfill came to cover the narrowing path and miss the wider default one.
 */
function scopedCompanyIds(scope: unknown): string[] {
  const companyId = (scope as { companyId?: unknown })?.companyId;
  if (typeof companyId === 'string') return [companyId];
  const list = (companyId as { in?: unknown })?.in;
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * A `@db.Date` column carries a calendar day, not an instant, so it is written
 * and read at UTC midnight and formatted back with UTC getters. Local midnight
 * would be stored as the PREVIOUS day east of Greenwich (21:00Z in Tanzania),
 * which is how a report for the 14th ends up filed under the 13th.
 *
 * This is deliberately a different INSTANT from the one the sales window opens
 * at: the window opens at midnight in the business zone (21:00Z the evening
 * before), because that is the boundary every figure in this module is computed
 * over. Both describe the same calendar day, which is the only thing a
 * `@db.Date` column is allowed to mean.
 */
function utcCalendarDate(businessDate: string) {
  return new Date(`${businessDate}T00:00:00.000Z`);
}

function businessDateKey(value: Date | string) {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * The day report's figures are summed in JS from Prisma Decimals, so they are
 * snapped back to the precision their columns actually hold before they are
 * stored: Decimal(18,2) for money, Decimal(18,4) for quantities. Without this a
 * day of 0.1-kilo lines arrives at the office as 3.0000000000000004.
 */
function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

/**
 * Product types that never carry stock value, mirroring the predicate the GRN
 * posting flow uses (goods-received-notes.service.ts). A POS purchase must only
 * accept products whose receipt will actually post an inventory movement.
 */
const STOCK_EXEMPT_PRODUCT_TYPES = new Set(['SERVICE', 'NON_STOCK_ITEM']);

function isStockItem(product: {
  productType?: string | null;
  trackInventory?: boolean | null;
}): boolean {
  if (product.trackInventory === false) return false;
  return !STOCK_EXEMPT_PRODUCT_TYPES.has(String(product.productType ?? '').toUpperCase());
}

/** Problems-first ordering for the Stoo stock screen (spec-inventory §1.1). */
const STOCK_STATUS_RANK = {
  OVERSOLD: 0,
  OUT_OF_STOCK: 1,
  LOW_STOCK: 2,
  IN_STOCK: 3,
} as const;

type StockStatus = keyof typeof STOCK_STATUS_RANK;

/**
 * The POS purchase flow stamps the client's key on PurchaseOrder.idempotencyKey
 * (company-scoped UNIQUE) immediately after create, and that column is the
 * authority: see claimPurchaseKey. This marker is still written into the notes
 * atomically with the row, for two reasons that have nothing to do with racing
 * — the office reads it on the document when it has to match an abandoned chain
 * against a second attempt, and it is what resolves rows created before the
 * column existed.
 */
const PURCHASE_IDEMPOTENCY_MARKER_PREFIX = '[MPL-PURCHASE:';

function purchaseIdempotencyMarker(idempotencyKey: string) {
  return `${PURCHASE_IDEMPOTENCY_MARKER_PREFIX}${idempotencyKey}]`;
}

/**
 * Strip anything marker-shaped out of client-supplied text before it is joined
 * into a field a marker also lives in.
 *
 * `notes` is free text from the phone and the markers are a CONTROL SURFACE:
 * the purchase lookup's fallback arm matches them with `contains`, so a hostile
 * or compromised terminal that writes `[MPL-PURCHASE:<another terminal's key>]`
 * into its own slip could otherwise make that key resolve to ITS order — the
 * victim's next POKEA either 409s on a delivery it has nothing to do with, or
 * is driven to receive the attacker's lines instead of the lorry in front of
 * her. A payload must not be able to write the token that protects it.
 *
 * Stripped rather than rejected: the manager typed a note, not an attack, and a
 * new 400 on this path would reach her as an unmapped English card. The bracket
 * token is the only thing removed.
 *
 * Belt and braces with the two structural guards, on purpose. The key column
 * closes this for every row this module creates from now on (a stamped row can
 * never be matched by its notes), and the count path has no notes field at all
 * — but the sanitiser is what makes the guarantee hold at the point the text
 * enters, rather than depending on a query staying shaped the way it is today.
 */
const MOBILE_POS_MARKER_TEXT = /\[MPL-[^\]]*\]?/gi;

function sanitizeClientNotes(notes: string | undefined | null): string {
  return (notes ?? '').replace(MOBILE_POS_MARKER_TEXT, '').trim();
}

/** A company-scoped unique index said no: somebody else owns this key. */
function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Second marker written beside the idempotency one at create: a fingerprint of
 * what the MANAGER typed on the slip.
 *
 * The content guard below has to answer one question — is this retry the same
 * delivery? — and the recorded PurchaseOrder alone cannot answer it for costs.
 * A recorded unitCost of 50000 is either a number she typed or the product
 * default resolved at create time, and the two are indistinguishable in the
 * row. So the guard used to compare only the costs a retry STATES, which makes
 * CLEARING a wrongly-typed cost read as a match: the correction is dropped and
 * the delivery replays at the typo. Comparing the RESOLVED cost instead would
 * break the opposite case the guard's doc protects — the office moving a
 * default between attempts must never turn a safe replay into a failure.
 *
 * Recording the intent settles both. The fingerprint covers the supplier, the
 * per-product quantity, and whether a unit cost was stated at all and what it
 * was — never a server-resolved cost — so an omitted-versus-present cost is a
 * real difference and a repriced product is not.
 */
const PURCHASE_CONTENT_MARKER_PREFIX = '[MPL-PURCHASE-CONTENT:';

function purchaseContentMarker(dto: CreateMobilePosLitePurchaseDto) {
  const byProduct = new Map<string, { quantity: number; unitCost: number | null }>();
  for (const line of dto.lines) {
    const existing = byProduct.get(line.productId);
    byProduct.set(line.productId, {
      // Same aggregation resolvePurchaseLines applies: repeated lines for one
      // product are one bigger line, and the last stated cost wins (two
      // DIFFERENT stated costs never survive create — resolvePurchaseLines
      // rejects them).
      quantity: (existing?.quantity ?? 0) + Number(line.quantity),
      unitCost: line.unitCost != null ? Number(line.unitCost) : (existing?.unitCost ?? null),
    });
  }
  const canonical = JSON.stringify({
    supplierId: dto.supplierId,
    lines: Array.from(byProduct, ([productId, line]) => ({
      productId,
      quantity: line.quantity,
      unitCost: line.unitCost,
    })).sort((a, b) => a.productId.localeCompare(b.productId)),
  });
  return `${PURCHASE_CONTENT_MARKER_PREFIX}${sha256(canonical).slice(0, 32)}]`;
}

/** The slice of a PurchaseOrder the purchase chain needs to resume/replay. */
interface PurchaseChainOrder {
  id: string;
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  supplierId: string | null;
  status: string;
  purchaseOrderNumber: string;
  totalAmount: unknown;
  /** Carries both markers; read by the content guard, never by the chain steps. */
  notes: string | null;
  lines: Array<{ productId: string; unitId: string; quantity: unknown; unitCost: unknown }>;
}

/** Where a purchase chain stopped, recorded on every exit short of a receipt. */
type PurchaseChainStep = 'create' | 'confirm' | 'receive' | 'approve' | 'post' | 'resume';

/**
 * What the chain has done so far, carried by reference so the settle path can
 * name the step and the document an interrupted delivery left behind — without
 * a settle call at every rethrow, which is what let the purchase chain exit
 * silently five different ways.
 */
interface PurchaseChainProgress {
  step: PurchaseChainStep;
  orderStatus: string;
  grn: { id: string; status: string; grnNumber: string } | null;
}

const PURCHASE_CHAIN_SELECT = {
  id: true,
  companyId: true,
  divisionId: true,
  branchId: true,
  supplierId: true,
  status: true,
  purchaseOrderNumber: true,
  totalAmount: true,
  notes: true,
  lines: { select: { productId: true, unitId: true, quantity: true, unitCost: true } },
} satisfies Prisma.PurchaseOrderSelect;

/**
 * The count flow stamps StockAdjustment.idempotencyKey (company-scoped UNIQUE)
 * the same way the purchase flow does, and the same way for the same reason.
 * This marker is still written into the adjustment's notes atomically with the
 * row: it is what the office matches a document against, and what resolves rows
 * created before the column existed. `reject()` APPENDS its reason to notes, so
 * the fallback must search it with `contains` — the marker survives anything
 * appended after it. Nothing client-supplied is ever joined into this field
 * (the count DTO has no notes), which is what keeps the count path immune to
 * the marker-planting the purchase path sanitises for.
 */
function stockCountIdempotencyMarker(idempotencyKey: string) {
  return `[MPL-COUNT:${idempotencyKey}]`;
}

/** Where a count chain stopped, recorded on every non-POSTED exit. */
type StockCountChainStep = 'create' | 'submit' | 'approve' | 'post' | 'resume';

/**
 * How old a CAPTURE may be and still be posted by this wrapper.
 *
 * post() applies the varianceQuantity frozen at create (counted − system read
 * at that moment), not the counted number itself, and that is the right thing
 * to apply: every sale, receipt and transfer between the capture and the post
 * moves the books and the shelf together, so a delta stays true across them
 * while re-deriving the system side on resume would silently erase them — a
 * count of 50 taken before 40 units were sold would set the balance back to 50.
 * Re-resolving the system side on a resume is therefore NOT the fix for a stale
 * capture; it is a worse bug wearing the fix's clothes.
 *
 * What age really costs is the premise that the shelf and the books moved
 * TOGETHER. Cross a night or a trading session and the same discrepancy can be
 * corrected twice — a desktop count, another terminal's count, or a manual
 * adjustment fixes the shrinkage at 07:00 and this frozen delta applies it
 * again at 08:00 — or moved unrecorded (breakage, an unlogged transfer). No
 * evidence available to this wrapper can tell those apart after the fact.
 *
 * So the capture gets a life. Six hours covers every honest retry the design
 * invites — a storeroom count sent when the signal comes back, a count re-sent
 * after a pool blip, a phone restarted at the counter — and refuses the one the
 * copy on the phone can otherwise invite forever ("hesabu yako ipo salama
 * kwenye simu hii"): last night's sheet sent this morning.
 *
 * THE LIFE IS MEASURED ON TWO DIFFERENT CLOCKS, because the interval at risk is
 * capture -> post and no single clock spans it:
 *
 *   - CREATE (assertCaptureStillCountable, before anything exists): the gap
 *     between the shelf being counted and this request arriving, measured on
 *     dto.countedAt, the draft's own first-edit stamp. This is the side the
 *     scenario above actually lives on. Capture is offline-first by design —
 *     storerooms have no signal, the draft has no expiry, and the phone will
 *     restore a sheet of any age — so a count taken at 18:00 and sent at 08:00
 *     has NO row until the morning send, and its variance would be frozen
 *     against a balance the night's trading has already moved: every overnight
 *     sale re-appears as stock found on the shelf. Nothing is created, so
 *     nothing is stranded and no audit row is owed; the refusal is one of this
 *     wrapper's pre-create validations, and a recount is the only honest
 *     recovery for a physical count that has gone cold.
 *
 *   - RESUME (isStaleCapture, once a row exists): the gap between that row
 *     being created and this attempt trying to POST it, measured on the row's
 *     own createdAt. The variance is already frozen, so what this bounds is how
 *     long a frozen delta may wait before it is applied.
 *
 * Both sides obey the same rule: an age that cannot be established never
 * refuses. countedAt is optional and phone clocks drift, so an absent,
 * unparseable, or future-dated capture stamp falls through as "age unknown".
 * That leaves a phone whose clock is badly WRONG able to buy itself more time —
 * accepted deliberately: this endpoint already trusts the same phone for the
 * counted numbers themselves, the confirm sheet prints the capture date and
 * time for the manager before she sends, and the alternative (refusing on an
 * unproven age) fails the recount too and strands a real shelf count.
 *
 * Nothing is destroyed by either refusal. On the resume side the row stays live
 * at its own status, visible on the desktop adjustments list with an audit row
 * naming it, so the office can still post it deliberately — exactly the human
 * judgement an automatic post cannot supply.
 */
const STOCK_COUNT_MAX_CAPTURE_AGE_HOURS = 6;
const STOCK_COUNT_MAX_CAPTURE_AGE_MS = STOCK_COUNT_MAX_CAPTURE_AGE_HOURS * 60 * 60 * 1000;

/** Reason code every POS-originated count carries, so the office can filter them. */
const MOBILE_POS_STOCK_COUNT_REASON = 'MOBILE_POS_STOCK_COUNT';

/**
 * Counts auto-post: the manager standing at the shelf is the human in the loop
 * (blind entry, then a review step showing variance, then a threshold-gated
 * confirm), exactly the trust level the POS purchase chain already carries.
 *
 * THE ESCAPE: flip this to false and the chain stops after submit(), leaving
 * every POS count at PENDING_APPROVAL for a desktop approver holding
 * inventory.adjustments.approve/post. Nothing else changes — the resume path
 * treats PENDING_APPROVAL as a terminal state either way. Typed `boolean` on
 * purpose so flipping it does not statically kill the branches below.
 */
const AUTO_POST_MOBILE_POS_STOCK_COUNTS: boolean = true;

/**
 * THE COUNTER-DELIVERY SWITCH, and the revert.
 *
 * A counter sale is delivered at the instant it is paid — the customer carries
 * the goods out — but fulfillment in this system is tracked ONLY by DeliveryNote
 * rows, so without this every POS sale reads "Delivered: PENDING" for the life
 * of the order. When true, a completed sale also drives a delivery note
 * create -> dispatch -> deliver, which is what flips that stage to APPROVED and
 * what corrects `ordersAwaitingDelivery` on the office dashboard.
 *
 * THE ESCAPE: flip to false and redeploy. Sales continue immediately, notes
 * already written stay valid and correct, and the column and index behind them
 * are additive and inert when nothing writes them — no migration rollback is
 * involved in the revert. This constant IS the revert; that is why it ships in
 * the build. Typed `boolean` on purpose so flipping it does not statically kill
 * the branch below.
 *
 * What it can NEVER do, in either position: change the money, the stock, the
 * receivable or the GL. The note is a document ABOUT the sale, written after
 * every one of the sale's transactions has committed, behind a total wrapper.
 */
const RECORD_COUNTER_SALE_DELIVERY_NOTES: boolean = true;

/**
 * Per-request cap on the historical repair (spec-counter-delivery §4.2
 * `take: 500`). A large tenant is repaired across several runs rather than in
 * one request that a gateway would time out halfway through — and because every
 * order is an independently committed chain, a run cut short loses nothing: the
 * next run re-selects only what is still outstanding.
 */
const COUNTER_DELIVERY_BACKFILL_BATCH = 500;

/** The slice of a DeliveryNote the counter-delivery chain needs to drive it. */
interface CounterDeliveryNote {
  id: string;
  status: string;
}

/**
 * What one pass of the counter-delivery chain actually did. The live sale path
 * ignores this; the historical repair counts it into its run report, which is
 * the operator's only view of what a run changed.
 */
type CounterDeliveryOutcome = 'created' | 'resumed' | 'skipped';

/**
 * Server-derived variations on the counter-delivery note, for the ONE caller
 * that is not a live sale.
 *
 * Deliberately not a DTO and deliberately not reachable from a request body:
 * every field here changes what a business document says, so only this service
 * may set one. Empty — the default — is the live counter sale, unchanged.
 */
interface CounterDeliveryOptions {
  /**
   * Calendar date (YYYY-MM-DD) of the backfill run that issued this note,
   * stamped into `notes` so that nobody, ever, mistakes a repaired historical
   * note for one a person wrote at the counter that day. Absent on the live
   * path, where the note IS written at the counter that day.
   */
  backfilledOn?: string;
}

/** The slice of a completed sale the counter-delivery chain reads. */
interface CounterSale {
  id: string;
  salesOrderNumber?: string | null;
  companyId: string;
  branchId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  orderDate: Date | string;
  lines?: Array<{
    productId: string;
    description?: string | null;
    quantity: unknown;
    unitId: string;
  }>;
}

/** The slice of a StockAdjustment the count chain needs to resume/replay. */
interface StockCountChainAdjustment {
  id: string;
  companyId: string;
  status: string;
  adjustmentNumber: string;
  /**
   * When this capture entered the system — the age the resume bound is measured
   * against. Optional in the type because it is the ONLY field here that can
   * decide to refuse work: a row whose createdAt somehow did not come back must
   * fall through as "age unknown, do not refuse", never as "age zero" and never
   * as a refusal (rule 1 of the settle path).
   */
  createdAt?: Date | string | null;
  lines: Array<{
    productId: string;
    systemQuantity: unknown;
    countedQuantity: unknown;
    varianceQuantity: unknown;
  }>;
}

/**
 * What the count-up cost precondition reads off a product — the same two
 * fields post() values an inbound adjustment line from. `unknown` because
 * Prisma hands Decimals back here, exactly like the chain interfaces above.
 */
interface StockCountCostProduct {
  name: string;
  defaultPurchasePrice: unknown;
  productFamily: { defaultPurchasePrice: unknown } | null;
}

/** Quantities only — a POS count response never carries unitCost (see stockCountResult). */
const STOCK_COUNT_CHAIN_SELECT = {
  id: true,
  companyId: true,
  status: true,
  adjustmentNumber: true,
  createdAt: true,
  lines: {
    select: {
      productId: true,
      systemQuantity: true,
      countedQuantity: true,
      varianceQuantity: true,
    },
  },
} satisfies Prisma.StockAdjustmentSelect;

/**
 * One row of the day report's payment breakdown, as stored in `byMethod`.
 * Exported because the serialised report is a controller return type.
 */
export interface DayReportMethodTotal {
  paymentMethod: string;
  /** The TERMINAL's own configured label. CREDIT has no payment row, so null. */
  label: string | null;
  count: number;
  amount: number;
}

/** One row of the day report's product breakdown, as stored in `items`. */
export interface DayReportItemTotal {
  productId: string;
  name: string;
  quantity: number;
  amount: number;
}

/**
 * The calendar day a close is closing, in the three forms the chain needs it:
 * `key` for the record and the reference, `storedAt` for the `@db.Date` column,
 * and the BUSINESS-zone window the sales figures are computed over.
 */
interface DayReportWindow {
  key: string;
  storedAt: Date;
  dayStart: Date;
  dayEnd: Date;
}

/**
 * Json columns come back as Prisma.JsonValue. A stored breakdown is always an
 * array — createDayReport is the only writer — but a row hand-edited in the
 * database must degrade to an empty list rather than crash a rep's PDF.
 */
function readDayReportJson<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const TERMINAL_INCLUDE = {
  company: { select: { id: true, name: true, code: true } },
  division: { select: { id: true, name: true, code: true } },
  branch: { select: { id: true, name: true, code: true } },
  assignedUser: { select: { id: true, fullName: true, status: true } },
  salesperson: { select: { id: true, fullName: true, employeeCode: true } },
  generalCustomer: { select: { id: true, name: true, customerCode: true } },
  paymentMethods: {
    orderBy: { paymentMethod: 'asc' as const },
    include: {
      cashAccount: {
        select: { id: true, accountName: true, accountType: true, currency: true, isActive: true },
      },
    },
  },
} satisfies Prisma.MobilePosTerminalInclude;

type Terminal = Prisma.MobilePosTerminalGetPayload<{ include: typeof TERMINAL_INCLUDE }>;
type PaymentInput = Pick<MobilePosTerminalPaymentDto, 'paymentMethod' | 'cashAccountId' | 'label'>;

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function secureHashMatch(storedHash: string | null | undefined, suppliedValue: string | undefined) {
  if (!storedHash || !suppliedValue) return false;
  const stored = Buffer.from(storedHash, 'hex');
  const supplied = Buffer.from(sha256(suppliedValue), 'hex');
  return stored.length === supplied.length && timingSafeEqual(stored, supplied);
}

function newActivationCode() {
  return randomBytes(24).toString('base64url');
}

function newTerminalCode() {
  return `MPL-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function positivePrice(value: unknown) {
  const price = Number(value ?? 0);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function effectiveSellingPrice(product: {
  defaultSellingPrice?: unknown;
  retailPrice?: unknown;
  wholesalePrice?: unknown;
  productFamily?: {
    defaultSellingPrice?: unknown;
    retailPrice?: unknown;
    wholesalePrice?: unknown;
  } | null;
}) {
  return (
    positivePrice(product.defaultSellingPrice) ??
    positivePrice(product.retailPrice) ??
    positivePrice(product.wholesalePrice) ??
    positivePrice(product.productFamily?.defaultSellingPrice) ??
    positivePrice(product.productFamily?.retailPrice) ??
    positivePrice(product.productFamily?.wholesalePrice)
  );
}

/** Whole-shilling TZS format for receipts (POS prices are whole shillings). */
function tzsWhole(amount: unknown) {
  return `TZS ${new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(
    Math.round(Number(amount ?? 0)),
  )}`;
}

function receiptQty(amount: unknown) {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(Number(amount ?? 0));
}

function receiptDateTime(value: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Nairobi',
  }).format(value);
}

/** Bilingual sw/en payment method label, with the terminal's custom label (e.g. a till number) appended. */
function bilingualPaymentMethod(
  paymentMethod: SalesPaymentMethod | null | undefined,
  configuredLabel?: string | null,
) {
  const base = (() => {
    switch (paymentMethod) {
      case SalesPaymentMethod.CASH:
        return 'Taslimu / Cash';
      case SalesPaymentMethod.MOBILE_MONEY:
        return 'Pesa za Simu / Mobile Money';
      case SalesPaymentMethod.BANK_TRANSFER:
        return 'Benki / Bank Transfer';
      case SalesPaymentMethod.CREDIT:
        return 'Mkopo / Credit';
      default:
        return String(paymentMethod ?? 'N/A');
    }
  })();
  const custom = configuredLabel?.trim();
  return custom ? `${base} (${custom})` : base;
}

function receiptFileStem(reference: string) {
  return reference.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'RECEIPT';
}

/** Just the date, for the day report's `Tarehe / Date` meta row. */
function receiptDate(value: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(value);
}

/**
 * hhmm of the submit, for the day report's file name: a rep may legitimately
 * close the same day twice (a shift handover), and two files called
 * RIPOTI-<terminal>-<date>.pdf in one share sheet is one of them silently
 * overwriting the other.
 */
function reportFileTime(value: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  })
    .format(value)
    .replace(/\D+/g, '');
}

function paymentLabel(paymentMethod: SalesPaymentMethod, configuredLabel?: string | null) {
  if (configuredLabel?.trim()) return configuredLabel.trim();
  switch (paymentMethod) {
    case SalesPaymentMethod.CASH:
      return 'Cash';
    case SalesPaymentMethod.MOBILE_MONEY:
      return 'Mobile Money';
    case SalesPaymentMethod.BANK_TRANSFER:
      return 'Bank';
    case SalesPaymentMethod.CREDIT:
      return 'Credit';
    default:
      return paymentMethod;
  }
}

@Injectable()
export class MobilePosLiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly auditLogs: AuditLogsService,
    private readonly salesOrders: SalesOrdersService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly goodsReceivedNotes: GoodsReceivedNotesService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly generatedDocuments: GeneratedDocumentsService,
    private readonly stockAdjustments: StockAdjustmentsService,
    // LAST argument on purpose: every existing construction site (and the whole
    // of mobile-pos-lite.service.spec.ts) keeps its argument order.
    private readonly deliveryNotes: DeliveryNotesService,
  ) {}

  /**
   * What the count chain actually reads. The module-level flag is the
   * deployment switch; this mirror gives the PENDING_APPROVAL path a test seam
   * that does not need a rebuild to exercise.
   */
  private readonly autoPostStockCounts = AUTO_POST_MOBILE_POS_STOCK_COUNTS;

  /** Same shape, same reason: the deployment switch with a test seam. */
  private readonly recordCounterSaleDeliveryNotes = RECORD_COUNTER_SALE_DELIVERY_NOTES;

  /**
   * Only ever used where the audit trail itself is unwritable — the database
   * that would carry the record is the database that just failed. See
   * settleNonPostedStockCount.
   */
  private readonly logger = new Logger(MobilePosLiteService.name);

  async findTerminals(query: QueryMobilePosTerminalDto, user: AuthUser) {
    this.assertCanManage(user);
    const where: Prisma.MobilePosTerminalWhereInput = await this.companyScope.companyWhereFor(
      user,
      query.companyId,
    );

    const data = await this.prisma.mobilePosTerminal.findMany({
      where,
      include: TERMINAL_INCLUDE,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return data.map((terminal) => this.serializeTerminal(terminal));
  }

  async createTerminal(dto: CreateMobilePosTerminalDto, user: AuthUser) {
    this.assertCanManage(user);
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    const configuration = await this.validateConfiguration(dto);
    const activationCode = newActivationCode();
    const activationExpiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);

    let terminalCode = newTerminalCode();
    while (await this.prisma.mobilePosTerminal.findFirst({ where: { terminalCode } })) {
      terminalCode = newTerminalCode();
    }

    const terminal = await this.prisma.mobilePosTerminal.create({
      data: {
        terminalCode,
        name: dto.name.trim(),
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        assignedUserId: configuration.assignedUserId,
        salespersonId: dto.salespersonId,
        generalCustomerId: dto.generalCustomerId,
        creditEnabled: Boolean(dto.creditEnabled),
        offlineCashEnabled: Boolean(dto.offlineCashEnabled),
        activationTokenHash: sha256(activationCode),
        activationExpiresAt,
        paymentMethods: {
          create: configuration.paymentMethods.map((payment) => ({
            paymentMethod: payment.paymentMethod,
            cashAccountId: payment.cashAccountId,
            label: payment.label,
          })),
        },
      },
      include: TERMINAL_INCLUDE,
    });

    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_TERMINAL_CREATED',
      entityType: 'MobilePosTerminal',
      entityId: terminal.id,
      userId: user.id,
      companyId: terminal.companyId,
      severity: AuditSeverity.HIGH,
      newValue: {
        terminalCode: terminal.terminalCode,
        divisionId: terminal.divisionId,
        branchId: terminal.branchId,
        assignedUserId: terminal.assignedUserId,
      },
    });

    return {
      terminal: this.serializeTerminal(terminal),
      activation: this.activationPayload(
        terminal.terminalCode,
        activationCode,
        activationExpiresAt,
      ),
    };
  }

  async updateTerminal(id: string, dto: UpdateMobilePosTerminalDto, user: AuthUser) {
    this.assertCanManage(user);
    const existing = await this.findTerminalForManagement(id, user);
    const paymentInputs: PaymentInput[] =
      dto.paymentMethods ??
      existing.paymentMethods.map((payment) => ({
        paymentMethod: payment.paymentMethod as (typeof MOBILE_POS_LITE_RECEIPT_METHODS)[number],
        cashAccountId: payment.cashAccountId,
        label: payment.label ?? undefined,
      }));
    const configuration = await this.validateConfiguration({
      companyId: existing.companyId,
      divisionId: existing.divisionId,
      branchId: existing.branchId,
      salespersonId: dto.salespersonId ?? existing.salespersonId,
      generalCustomerId: dto.generalCustomerId ?? existing.generalCustomerId,
      paymentMethods: paymentInputs,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.paymentMethods) {
        await tx.mobilePosTerminalPayment.deleteMany({ where: { terminalId: existing.id } });
      }
      return tx.mobilePosTerminal.update({
        where: { id: existing.id },
        data: {
          name: (dto.name ?? existing.name).trim(),
          assignedUserId: configuration.assignedUserId,
          salespersonId: dto.salespersonId ?? existing.salespersonId,
          generalCustomerId: dto.generalCustomerId ?? existing.generalCustomerId,
          creditEnabled: dto.creditEnabled ?? existing.creditEnabled,
          offlineCashEnabled: dto.offlineCashEnabled ?? existing.offlineCashEnabled,
          uiVersion: dto.uiVersion ?? existing.uiVersion,
          configVersion: { increment: 1 },
          ...(dto.paymentMethods
            ? {
                paymentMethods: {
                  create: configuration.paymentMethods.map((payment) => ({
                    paymentMethod: payment.paymentMethod,
                    cashAccountId: payment.cashAccountId,
                    label: payment.label,
                  })),
                },
              }
            : {}),
        },
        include: TERMINAL_INCLUDE,
      });
    });

    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_TERMINAL_UPDATED',
      entityType: 'MobilePosTerminal',
      entityId: updated.id,
      userId: user.id,
      companyId: updated.companyId,
      severity: AuditSeverity.HIGH,
    });
    return this.serializeTerminal(updated);
  }

  async updateTerminalStatus(id: string, status: MobilePosTerminalStatus, user: AuthUser) {
    this.assertCanManage(user);
    const existing = await this.findTerminalForManagement(id, user);
    if (
      existing.status === MobilePosTerminalStatus.REVOKED &&
      status !== MobilePosTerminalStatus.REVOKED
    ) {
      throw new BadRequestException(
        'A revoked terminal must be replaced with a newly activated device',
      );
    }
    const updated = await this.prisma.mobilePosTerminal.update({
      where: { id: existing.id },
      data: {
        status,
        ...(status !== MobilePosTerminalStatus.ACTIVE
          ? { activationTokenHash: null, activationExpiresAt: null }
          : {}),
        ...(status === MobilePosTerminalStatus.REVOKED
          ? { deviceSecretHash: null, deviceName: null }
          : {}),
      },
      include: TERMINAL_INCLUDE,
    });
    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_TERMINAL_STATUS_CHANGED',
      entityType: 'MobilePosTerminal',
      entityId: updated.id,
      userId: user.id,
      companyId: updated.companyId,
      severity: AuditSeverity.HIGH,
      newValue: { status },
    });
    return this.serializeTerminal(updated);
  }

  async issueActivation(id: string, user: AuthUser) {
    this.assertCanManage(user);
    const existing = await this.findTerminalForManagement(id, user, AccessLevel.WRITE);
    if (existing.status !== MobilePosTerminalStatus.ACTIVE) {
      throw new BadRequestException('Only active terminals can be activated');
    }

    const activationCode = newActivationCode();
    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);
    const terminal = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.mobilePosTerminal.update({
        where: { id: existing.id },
        data: {
          activationTokenHash: sha256(activationCode),
          activationExpiresAt: expiresAt,
        },
        select: { terminalCode: true },
      });
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'MOBILE_POS_LITE_ACTIVATION_ISSUED',
        entityType: 'MobilePosTerminal',
        entityId: existing.id,
        userId: user.id,
        companyId: existing.companyId,
        severity: AuditSeverity.HIGH,
      });
      return updated;
    });
    // The raw code is constructed into a response only after the hash and its
    // mandatory audit row have committed together.
    return this.activationPayload(terminal.terminalCode, activationCode, expiresAt);
  }

  async activate(dto: ActivateMobilePosTerminalDto, user: AuthUser) {
    const terminal = await this.prisma.mobilePosTerminal.findFirst({
      where: { terminalCode: dto.terminalCode.trim() },
      include: TERMINAL_INCLUDE,
    });
    if (!terminal || terminal.status !== MobilePosTerminalStatus.ACTIVE) {
      throw new NotFoundException('Mobile POS terminal is not available');
    }
    await this.assertAssignedUserCanSell(terminal, user);
    if (!terminal.activationExpiresAt || terminal.activationExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'This activation code has expired. Ask the group admin for a new code.',
      );
    }
    if (!secureHashMatch(terminal.activationTokenHash, dto.activationCode)) {
      throw new ForbiddenException('Invalid Mobile POS activation code');
    }

    // Atomic one-time claim prevents the same QR code from binding a second device.
    const claimed = await this.prisma.mobilePosTerminal.updateMany({
      where: {
        id: terminal.id,
        activationTokenHash: terminal.activationTokenHash,
        activationExpiresAt: { gte: new Date() },
      },
      data: {
        deviceSecretHash: sha256(dto.deviceSecret),
        deviceName: dto.deviceName?.trim() || null,
        activationTokenHash: null,
        activationExpiresAt: null,
        activatedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException(
        'This activation code has already been used. Ask the group admin for a new code.',
      );
    }

    const active = await this.requireTerminal(dto.terminalCode, dto.deviceSecret, user);
    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_TERMINAL_ACTIVATED',
      entityType: 'MobilePosTerminal',
      entityId: active.id,
      userId: user.id,
      companyId: active.companyId,
      severity: AuditSeverity.HIGH,
    });
    return this.sessionPayload(active, user);
  }

  async session(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    return this.sessionPayload(terminal, user);
  }

  async products(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    search: string | undefined,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    const term = search?.trim() ?? '';

    const searchTerms: Prisma.ProductWhereInput[] = [
      { barcode: { equals: term, mode: 'insensitive' } },
      { productCode: { contains: term, mode: 'insensitive' } },
      { sku: { contains: term, mode: 'insensitive' } },
      { name: { contains: term, mode: 'insensitive' } },
    ];
    const products = await this.prisma.product.findMany({
      where: {
        companyId: terminal.companyId,
        status: 'ACTIVE',
        AND: [
          { OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] },
          ...(term ? [{ OR: searchTerms }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        productCode: true,
        sku: true,
        barcode: true,
        baseUnitId: true,
        productType: true,
        trackInventory: true,
        imageUrl: true,
        defaultSellingPrice: true,
        retailPrice: true,
        wholesalePrice: true,
        baseUnit: { select: { id: true, name: true, symbol: true } },
        productFamily: {
          select: { defaultSellingPrice: true, retailPrice: true, wholesalePrice: true },
        },
      },
      orderBy: { name: 'asc' },
      // A bounded catalogue snapshot gives the installed PWA a useful offline
      // starting point. Searches stay deliberately small for fast counter use.
      take: term ? 12 : 1500,
    });
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        branchId: terminal.branchId,
        productId: { in: products.map((product) => product.id) },
      },
      select: { productId: true, quantityOnHand: true, quantityReserved: true },
    });
    const availability = new Map(
      balances.map((balance) => [
        balance.productId,
        Math.max(0, Number(balance.quantityOnHand) - Number(balance.quantityReserved)),
      ]),
    );

    return products
      .map((product) => {
        const sellingPrice = effectiveSellingPrice(product);
        if (sellingPrice == null) return null;
        return {
          id: product.id,
          name: product.name,
          code: product.productCode ?? product.sku ?? product.barcode ?? '',
          barcode: product.barcode,
          unitId: product.baseUnitId,
          unitSymbol: product.baseUnit?.symbol ?? '',
          sellingPrice,
          availableStock: product.trackInventory ? (availability.get(product.id) ?? 0) : null,
          trackInventory: product.trackInventory,
          imageUrl: product.imageUrl ?? null,
        };
      })
      .filter((product): product is NonNullable<typeof product> => product !== null);
  }

  /**
   * Branch stock for the Stoo screen (spec-inventory §1.1). Direct Prisma,
   * mirroring the products() precedent — deliberately NOT a wrapper over
   * InventoryBalancesService.liveStock(), whose projection carries
   * averageCost/totalValue/riskValue and filters in memory with no take.
   *
   * REVIEW-BLOCKING RULE: this endpoint must NEVER return cost or value
   * fields (averageCost, totalValue, unitCost, riskValue, ...). Rep phones
   * get stolen; branch quantities are operational, valuations are not. Any
   * change that widens this payload needs an owner decision, not a review nod.
   *
   * products() is untouched on purpose: its drop-unpriced filter is
   * load-bearing for the sale flow, while Stoo INCLUDES unpriced items — a
   * stocked product without a price is exactly what the screen should expose
   * (edge case 1).
   */
  async stock(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    search: string | undefined,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    const term = search?.trim() ?? '';

    const searchTerms: Prisma.ProductWhereInput[] = [
      { barcode: { equals: term, mode: 'insensitive' } },
      { productCode: { contains: term, mode: 'insensitive' } },
      { sku: { contains: term, mode: 'insensitive' } },
      { name: { contains: term, mode: 'insensitive' } },
    ];
    const products = await this.prisma.product.findMany({
      where: {
        companyId: terminal.companyId,
        status: 'ACTIVE',
        // isStockItem() in where-clause form: only products whose movement
        // would post an inventory change belong on the stock screen.
        trackInventory: true,
        productType: { notIn: [ProductType.SERVICE, ProductType.NON_STOCK_ITEM] },
        AND: [
          { OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] },
          ...(term ? [{ OR: searchTerms }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        productCode: true,
        sku: true,
        barcode: true,
        baseUnitId: true,
        imageUrl: true,
        defaultSellingPrice: true,
        retailPrice: true,
        wholesalePrice: true,
        reorderLevel: true,
        minimumStockLevel: true,
        baseUnit: { select: { id: true, name: true, symbol: true } },
        productFamily: {
          select: { defaultSellingPrice: true, retailPrice: true, wholesalePrice: true },
        },
      },
      orderBy: { name: 'asc' },
      // The catalog's accepted 1500-item bound (spec-inventory edge case 10).
      take: 1500,
    });
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        branchId: terminal.branchId,
        productId: { in: products.map((product) => product.id) },
      },
      select: { productId: true, quantityOnHand: true, quantityReserved: true },
    });
    const balancesByProduct = new Map(balances.map((balance) => [balance.productId, balance]));

    const items = products.map((product) => {
      const balance = balancesByProduct.get(product.id);
      // No balance row = this branch never moved the product: honest zeros.
      const quantityOnHand = Number(balance?.quantityOnHand ?? 0);
      const quantityReserved = Number(balance?.quantityReserved ?? 0);
      // Unclamped on purpose: the server always sends the oversold truth;
      // the client gates the rep-facing presentation (spec-inventory §2).
      const available = quantityOnHand - quantityReserved;
      // The annotateBalance/liveStock threshold predicate.
      const threshold = Number(product.reorderLevel ?? product.minimumStockLevel ?? 10);
      const status: StockStatus =
        available < 0
          ? 'OVERSOLD'
          : available === 0
            ? 'OUT_OF_STOCK'
            : available <= threshold
              ? 'LOW_STOCK'
              : 'IN_STOCK';
      return {
        productId: product.id,
        name: product.name,
        code: product.productCode ?? product.sku ?? product.barcode ?? '',
        barcode: product.barcode,
        unitId: product.baseUnitId,
        unitSymbol: product.baseUnit?.symbol ?? '',
        imageUrl: product.imageUrl ?? null,
        // Nullable: unpriced products stay in (they never reach the sale flow).
        sellingPrice: effectiveSellingPrice(product),
        quantityOnHand,
        quantityReserved,
        available,
        threshold,
        status,
      };
    });
    // Problems-first: OVERSOLD → OUT_OF_STOCK → LOW_STOCK → IN_STOCK. sort()
    // is stable, so the DB's name-asc order survives within each band.
    items.sort((a, b) => STOCK_STATUS_RANK[a.status] - STOCK_STATUS_RANK[b.status]);

    return {
      asOf: new Date().toISOString(),
      branch: { id: terminal.branchId, name: terminal.branch?.name ?? '' },
      items,
    };
  }

  async customers(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    search: string | undefined,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    // Customer lookup works on every terminal so any sale (cash, mobile money,
    // credit) can be attached to a named customer. creditEnabled only governs
    // whether CREDIT is offered as a payment method (sessionPayload/createSale).
    const term = search?.trim() ?? '';
    if (term.length < 2) return [];

    return this.prisma.customer.findMany({
      where: {
        companyId: terminal.companyId,
        status: 'ACTIVE',
        AND: [
          { OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] },
          { OR: [{ branchId: terminal.branchId }, { branchId: null }] },
          {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { customerCode: { contains: term, mode: 'insensitive' } },
              { phone: { contains: term, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        customerCode: true,
        phone: true,
        creditLimit: true,
        currentBalance: true,
      },
      orderBy: { name: 'asc' },
      take: 12,
    });
  }

  async mySalesToday(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);

    // Local-day boundary, mirroring westsides-reports dailyClose: truncate to
    // the server PROCESS's local midnight.
    //
    // KNOWN AND DELIBERATELY UNTOUCHED. This once claimed the process runs at
    // "UTC+3 for Tanzania in production"; nothing in the deployment enforces
    // that and node:20-alpine runs UTC, so today's Leo total is really cut at
    // 03:00 EAT. It is left alone because the CLASSIC shell (uiVersion 1),
    // which the whole fleet runs, reads this endpoint, and moving its boundary
    // would change what every terminal in the field shows tonight — a fleet
    // decision, not a POS-report one (spec-history-reports §1.8). The day
    // REPORT and both history lists no longer share this boundary: they use
    // MOBILE_POS_BUSINESS_TIMEZONE, so the record the office reads is right
    // even while this preview is three hours out. Fixing this properly means
    // moving mySalesToday onto businessDayWindow in a release of its own.
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

    // POS sales are recorded via mobilePosLiteQuickSale, which stamps the
    // terminal on SalesOrder.mobilePosTerminalId and the authenticated rep on
    // SalesOrder.createdById — scope on exactly those two.
    const where: Prisma.SalesOrderWhereInput = {
      companyId: terminal.companyId,
      mobilePosTerminalId: terminal.id,
      createdById: user.id,
      status: { in: [...CONFIRMED_SALES_STATUSES] },
      orderDate: { gte: dayStart, lt: dayEnd },
    };

    const [totals, orders] = await Promise.all([
      this.prisma.salesOrder.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.salesOrder.findMany({
        where,
        select: {
          id: true,
          salesOrderNumber: true,
          totalAmount: true,
          paymentMethod: true,
          createdAt: true,
          customerName: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    return {
      count: totals._count._all,
      totalAmount: Number(totals._sum.totalAmount ?? 0),
      sales: orders.map((order) => ({
        id: order.id,
        salesOrderNumber: order.salesOrderNumber,
        totalAmount: Number(order.totalAmount),
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
        customerName: order.customerName ?? undefined,
      })),
    };
  }

  /**
   * This rep's own sales on this terminal over the history window
   * (spec-history-reports §1.1), for the Historia ya Mauzo screen. Sits beside
   * mySalesToday and reuses its scoping decisions verbatim — same terminal,
   * same rep, same confirmed statuses — because the two screens are the same
   * book at two zoom levels. The one place they deliberately differ is the day
   * boundary: this window is cut at midnight in the BUSINESS zone (see
   * historyWindow and MOBILE_POS_BUSINESS_TIMEZONE) while mySalesToday still
   * reads the process's, for the fleet reason its own comment gives.
   *
   * REVIEW-BLOCKING RULE: this endpoint may show SELLING prices and never
   * COST or margin. unitPrice/lineTotal/totalAmount are the numbers the catalog
   * already caches on the phone and the receipt already prints, so they are no
   * new exposure — and a rep who cannot see what she charged cannot answer the
   * customer standing in front of her. SalesOrderLine also carries
   * unitCostAtSale, cogsAmount, grossProfitAmount and grossMarginPct; none of
   * them is ever selected. `include:` is BANNED here at every level, so a field
   * added to either model tomorrow cannot ride out to a phone. Any change that
   * widens this payload needs an owner decision, not a review nod.
   */
  async salesHistory(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    const { from, dayEnd } = this.historyWindow();

    // Per-REP scope, exactly like mySalesToday: sales are personal
    // accountability. (The purchase history is branch-scoped instead, and
    // purchaseHistory says why.)
    const where: Prisma.SalesOrderWhereInput = {
      companyId: terminal.companyId,
      mobilePosTerminalId: terminal.id,
      createdById: user.id,
      status: { in: [...CONFIRMED_SALES_STATUSES] },
      orderDate: { gte: from, lt: dayEnd },
    };

    const [totals, orders] = await Promise.all([
      // Exact and UNBOUNDED: the headline numbers must not depend on the list's
      // take, so a truncated list can never produce a wrong total.
      this.prisma.salesOrder.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.salesOrder.findMany({
        where,
        select: {
          id: true,
          salesOrderNumber: true,
          createdAt: true,
          paymentMethod: true,
          paymentReference: true,
          customerName: true,
          totalAmount: true,
          customer: { select: { name: true } },
          lines: {
            select: {
              productId: true,
              description: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
              product: { select: { name: true } },
              unit: { select: { symbol: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: MOBILE_POS_SALES_HISTORY_TAKE,
      }),
    ]);

    // Whether a sale is still queued on the phone is a CLIENT concern: the
    // server cannot know what is sitting in an outbox and must not pretend to,
    // so nothing on this payload refers to queued state and the merge happens
    // on the device.
    return {
      days: MOBILE_POS_HISTORY_DAYS,
      from: from.toISOString(),
      count: totals._count._all,
      totalAmount: Number(totals._sum.totalAmount ?? 0),
      sales: orders.map((order) => ({
        id: order.id,
        salesOrderNumber: order.salesOrderNumber,
        createdAt: order.createdAt,
        paymentMethod: order.paymentMethod,
        paymentReference: order.paymentReference ?? null,
        customerName: order.customer?.name ?? order.customerName ?? null,
        totalAmount: Number(order.totalAmount),
        lines: order.lines.map((line) => ({
          productId: line.productId,
          name: line.product?.name ?? line.description ?? '',
          quantity: Number(line.quantity),
          unitSymbol: line.unit?.symbol ?? '',
          unitPrice: Number(line.unitPrice),
          lineTotal: Number(line.lineTotal),
        })),
      })),
    };
  }

  /**
   * What this BRANCH received through the POS over the history window
   * (spec-history-reports §1.2), for the Historia ya Manunuzi screen.
   *
   * REVIEW-BLOCKING RULE — THE COST-BLINDNESS LAW. No cost, total or value
   * field may appear anywhere on this payload. Not unitCost, not lineTotal, not
   * totalAmount, not subtotal/taxAmount/discountAmount/paidAmount/
   * outstandingAmount, not averageCost, not margin, not anything derived from
   * them — and no window or per-purchase total either. A manager sees supplier,
   * date, reference, goods-received number, products and quantities, and
   * nothing else.
   *
   * The reason is the whole reason Historia was cut from v1 and the reason the
   * owner revived it with the protection intact: manager phones get stolen out
   * of hands, and a stolen phone must still reveal nothing about what this
   * business pays its suppliers. PurchaseOrderLine carries unitCost, lineTotal,
   * discountAmount and taxAmount; PurchaseOrder carries subtotal, totalAmount,
   * paidAmount and outstandingAmount. So `include:` is BANNED on this route at
   * EVERY level and the payload is assembled field by field from explicit
   * `select` blocks, which is what stops a column added to either model next
   * year from silently riding out to a phone. A test asserts the exact key set
   * recursively (mobile-pos-lite.service.spec.ts). This is review-blocking on
   * every future change to this method.
   *
   * Scoping, and why it differs from salesHistory:
   * - BRANCH-scoped, not user-scoped. Receiving is a branch activity, so the
   *   manager sees the branch's whole POS receiving book, a colleague's entries
   *   included. Sales are personal accountability; deliveries are the branch's
   *   stock.
   * - MARKER-filtered. Desktop-ERP purchases at the same branch are excluded:
   *   this screen is the POS book and the office sees everything in the ERP
   *   proper. The marker is written atomically with the row at create and
   *   client notes are sanitised (sanitizeClientNotes), so it cannot be planted
   *   from a phone. Unindexed, but riding @@index([companyId]) plus a 7-day
   *   branch window. Do NOT widen this company-wide.
   * - INCOMPLETE surfaces honestly. An interrupted chain leaves a
   *   marker-bearing PO with no POSTED GRN, and hiding it would make a stock
   *   movement unexplainable to the manager who made it.
   */
  async purchaseHistory(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    const { from, dayEnd } = this.historyWindow();

    const orders = await this.prisma.purchaseOrder.findMany({
      where: {
        companyId: terminal.companyId,
        branchId: terminal.branchId,
        purchaseType: PurchaseType.STOCK_PURCHASE,
        deletedAt: null,
        notes: { contains: PURCHASE_IDEMPOTENCY_MARKER_PREFIX },
        createdAt: { gte: from, lt: dayEnd },
      },
      select: {
        id: true,
        purchaseOrderNumber: true,
        createdAt: true,
        // No snapshot column exists on PurchaseOrder for the POS path, and the
        // relation is onDelete: SetNull — hence the ?? '' below.
        supplier: { select: { name: true } },
        lines: {
          select: {
            productId: true,
            description: true,
            quantity: true,
            product: { select: { name: true } },
            unit: { select: { symbol: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: MOBILE_POS_PURCHASE_HISTORY_TAKE,
    });

    // Also cost-free. PurchaseOrder.status is deliberately NOT selected: a
    // POSTED goods-received note is the only authority on whether stock
    // actually moved, and every field not selected is a field that cannot leak.
    const receipts = orders.length
      ? await this.prisma.goodsReceivedNote.findMany({
          where: { purchaseOrderId: { in: orders.map((order) => order.id) }, deletedAt: null },
          select: { purchaseOrderId: true, grnNumber: true, status: true },
        })
      : [];
    const postedByOrder = new Map<string, string>();
    for (const receipt of receipts) {
      if (receipt.status === 'POSTED' && receipt.purchaseOrderId) {
        postedByOrder.set(receipt.purchaseOrderId, receipt.grnNumber);
      }
    }

    return {
      days: MOBILE_POS_HISTORY_DAYS,
      from: from.toISOString(),
      count: orders.length,
      purchases: orders.map((order) => {
        const grnNumber = postedByOrder.get(order.id) ?? null;
        return {
          id: order.id,
          purchaseOrderNumber: order.purchaseOrderNumber,
          grnNumber,
          supplierName: order.supplier?.name ?? '',
          // The moment the manager tapped POKEA, which is the moment she
          // remembers. One field for both the window filter and the display, so
          // the two can never disagree.
          recordedAt: order.createdAt,
          status: grnNumber ? 'COMPLETE' : 'INCOMPLETE',
          lines: order.lines.map((line) => ({
            productId: line.productId,
            name: line.product?.name ?? line.description ?? '',
            quantity: Number(line.quantity),
            unitSymbol: line.unit?.symbol ?? '',
          })),
        };
      }),
    };
  }

  /**
   * The window both history lists read: midnight in the BUSINESS zone,
   * MOBILE_POS_HISTORY_DAYS - 1 days back, ending at tomorrow's midnight there.
   *
   * The boundary is walked as calendar days rather than by subtracting 6×24h
   * from an instant, so the window's edges land on the same midnights the day
   * report's do even if the zone ever gains a transition. Today counts as day
   * 1, so "siku 7" is today plus the six before it.
   */
  private historyWindow() {
    const today = businessDayKeyOf(new Date());
    return {
      from: businessDayStart(shiftBusinessDayKey(today, -(MOBILE_POS_HISTORY_DAYS - 1))),
      dayEnd: businessDayStart(shiftBusinessDayKey(today, 1)),
    };
  }

  async suppliers(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    search: string | undefined,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    const term = search?.trim() ?? '';
    if (term.length < 2) return [];

    return this.prisma.supplier.findMany({
      where: {
        companyId: terminal.companyId,
        status: 'ACTIVE',
        AND: [
          { OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] },
          { OR: [{ branchId: terminal.branchId }, { branchId: null }] },
          {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { supplierCode: { contains: term, mode: 'insensitive' } },
              { phone: { contains: term, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: { id: true, name: true, supplierCode: true, phone: true },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  /**
   * Rep-recorded stock-in purchase. Reuses the core procurement chain — a
   * CONFIRMED PurchaseOrder plus a fully-received, approved, POSTED
   * GoodsReceivedNote — by calling the purchase-orders and goods-received-notes
   * services with the authenticated rep. Those services scope by company access
   * only (no procurement permission codes are enforced service-side), so the
   * rep needs nothing beyond mobile_pos_lite.purchase.
   *
   * Atomicity: each step is individually atomic inside the core services'
   * own transactions; the chain as a whole is NOT one DB transaction (the core
   * services own their transactions and cannot be composed without bypassing
   * them). Instead, every retry carrying the same idempotencyKey RESUMES an
   * interrupted chain from its recorded state and replays a completed one, and
   * the GRN over-receipt ceiling plus the RECEIVED-PO guard make a second
   * stock receipt against the same purchase order impossible.
   */
  async createPurchase(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    dto: CreateMobilePosLitePurchaseDto,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    const marker = purchaseIdempotencyMarker(dto.idempotencyKey);

    // Replay/resume BEFORE validation, exactly like createStockCount and for
    // exactly the same reason: a purchase order carrying this marker means the
    // same request already ran (fully or partially), and the branch really does
    // have the crates. Re-validating first meant a product deactivated
    // overnight — or a supplier moved to another branch, or a cleared default
    // purchase price on a line she typed no cost for — turned a safe replay
    // into a 400 for a delivery that was already received, once per retry tap.
    // Idempotency resolution comes first; later data changes can then only
    // affect requests that still have work to do.
    let order = await this.findPurchaseByKey(terminal.companyId, dto.idempotencyKey);

    if (order) {
      // The key matched — but a matching key is only a claim that this is the
      // SAME delivery, and the phone can no longer be trusted to guarantee it.
      // Verify before replaying. See assertPurchaseMatchesRecordedOrder.
      await this.assertPurchaseMatchesOrSettle(order, dto, terminal, user);
    }

    if (!order) {
      const supplier = await this.prisma.supplier.findFirst({
        where: {
          id: dto.supplierId,
          companyId: terminal.companyId,
          status: 'ACTIVE',
          AND: [
            { OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] },
            { OR: [{ branchId: terminal.branchId }, { branchId: null }] },
          ],
        },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException(
          'The selected supplier is not available for this terminal branch',
        );
      }

      const lines = await this.resolvePurchaseLines(terminal, dto.lines);
      const notes = [
        // Sanitised, not trimmed only: the manager's note lands in the same
        // field as the markers below, and a payload may not write the token
        // that protects it. See sanitizeClientNotes.
        sanitizeClientNotes(dto.notes),
        `Created from Mobile POS Lite (${terminal.terminalCode})`,
        marker,
        purchaseContentMarker(dto),
      ]
        .filter(Boolean)
        .join('\n');
      const created = await this.purchaseOrders.create(
        {
          companyId: terminal.companyId,
          divisionId: terminal.divisionId,
          branchId: terminal.branchId,
          supplierId: dto.supplierId,
          purchaseType: PurchaseType.STOCK_PURCHASE,
          orderDate: new Date().toISOString(),
          currency: CurrencyCode.TZS,
          notes,
          lines,
        },
        user,
      );
      const record: PurchaseChainOrder = {
        id: created.id,
        companyId: created.companyId,
        divisionId: created.divisionId,
        branchId: created.branchId,
        supplierId: created.supplierId,
        status: created.status,
        purchaseOrderNumber: created.purchaseOrderNumber,
        totalAmount: created.totalAmount,
        notes,
        lines: created.lines,
      };
      order = record;

      // From here on a PO exists, so every exit is settled: a connection drop
      // in this window leaves a marker-anchored DRAFT order that nothing would
      // otherwise record. It has received nothing and the frozen key resumes
      // it, but the office must still be able to recognise it.
      try {
        // Claim the key. The DATABASE decides the winner of a create race now:
        // the twin check this replaced was two reads, and a read cannot settle
        // it — Postgres stamps createdAt at transaction START, so the request
        // that started earlier can commit later and each side can see a set in
        // which it is the earliest. Two live orders under one key each received
        // the same lorry.
        if (!(await this.claimPurchaseKey(record.id, dto.idempotencyKey))) {
          const winner = await this.findPurchaseByKey(terminal.companyId, dto.idempotencyKey);
          if (winner && winner.id !== record.id) {
            // The loser drops its own (still stockless) draft and resumes the
            // winner's chain. Looked up BEFORE deleting, so a lookup that comes
            // back empty cannot leave this request with nothing at all.
            await this.prisma.purchaseOrder.delete({ where: { id: record.id } });
            order = winner;
          }
          // No winner visible while the index says the key is taken means the
          // holder is soft-deleted (only a stockless order can be). Keep our
          // own live order and drive it: it has received nothing twice, its
          // notes still carry the marker, and refusing here would strand a
          // delivery that is standing at the door.
        }
      } catch (error) {
        await this.settleUnfinishedPurchase(record, terminal, user, error, {
          step: 'create',
          orderStatus: String(record.status),
          grn: null,
        });
        throw error;
      }

      if (order !== record) {
        // Same rule as the pre-check above: about to drive somebody else's
        // order, so verify it is this delivery before touching it. Outside the
        // settle-the-loser block on purpose — the row this refusal is ABOUT is
        // the winner, and that is the one the office has to be able to see.
        await this.assertPurchaseMatchesOrSettle(order, dto, terminal, user);
      }
    }

    const result = await this.resumePurchaseChain(order, terminal, user, marker);

    await this.prisma.mobilePosTerminal.update({
      where: { id: terminal.id },
      data: { lastSeenAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_PURCHASE_COMPLETED',
      entityType: 'PurchaseOrder',
      entityId: result.id,
      userId: user.id,
      companyId: terminal.companyId,
      severity: AuditSeverity.MEDIUM,
      newValue: {
        terminalCode: terminal.terminalCode,
        purchaseOrderNumber: result.purchaseOrderNumber,
        grnNumber: result.grnNumber,
      },
    });
    return result;
  }

  /**
   * Manager-recorded physical stock count. Reuses the core inventory chain — a
   * StockAdjustment driven create -> submit -> approve -> post — by calling
   * StockAdjustmentsService with the authenticated manager. That service scopes
   * by company access only (create asserts company WRITE, every other step goes
   * through findOne(..., WRITE); the inventory.adjustments.* permission codes
   * live on its controller), so the controller-level
   * mobile_pos_lite.stock_count is the sole permission gate on this path.
   *
   * The client sends counted quantities and nothing else: the system side is
   * read here from inventoryBalance.quantityOnHand for the TERMINAL's branch on
   * the attempt that CREATES the count, so no cost ever travels to or from the
   * phone and nothing the client believes about stock can reach the books. What
   * post() then applies is the variance frozen at that moment, which is why a
   * capture also has a life: see STOCK_COUNT_MAX_CAPTURE_AGE_HOURS, enforced on
   * both sides of that freeze — assertCaptureStillCountable before a row exists
   * (capture -> create), isStaleCapture before an existing one is posted
   * (create -> post).
   *
   * Atomicity: as with purchases, each step is atomic inside the core service's
   * own transaction and the chain as a whole is not one DB transaction. Every
   * retry carrying the same idempotencyKey RESUMES the interrupted chain from
   * its recorded state, and post()'s atomic APPROVED->POSTED claim makes a
   * second stock movement against the same count impossible.
   *
   * Because the chain is not one transaction, an interrupted chain leaves a row
   * behind at whatever state it reached. That row is NOT an orphan: the client
   * freezes its idempotency key on the first send and persists it with the
   * draft until a 2xx or an explicit discard, so the next attempt finds this
   * row by marker and drives it on. The wrapper's job is therefore to keep it
   * resumable and to make it visible, and it has exactly three duties:
   *   - assertCaptureStillCountable / resolveStockCountLines /
   *     assertCountUpsCanBeValued refuse BEFORE anything is created. This is
   *     the only place that can know a request can never succeed as it stands,
   *     and by construction it has nothing to undo;
   *   - assertCountMatchesRecordedAdjustment refuses to replay a marker hit
   *     whose numbers are not the numbers just sent, because a frozen key is a
   *     claim of sameness and only the server can check it;
   *   - settleNonPostedStockCount writes an audit row on EVERY exit from the
   *     chain that did not reach POSTED — create, submit, approve, post, or a
   *     row moved out from under it — naming the step, so the office can tell
   *     an abandoned chain from a routine pending count, and it still writes
   *     one when its own evidence queries fail. It never destroys a row and
   *     never closes a key: whatever happened after the row existed is a
   *     property of the moment or of the company's configuration as far as this
   *     wrapper can know, so it stays resumable and the office keeps something
   *     to post.
   * The one thing none of this can promise is a record when the database is
   * unreachable altogether; there the frozen key alone carries the guarantee,
   * which is exactly what it exists for.
   */
  async createStockCount(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    dto: CreateMobilePosLiteStockCountDto,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    const marker = stockCountIdempotencyMarker(dto.idempotencyKey);

    // Replay/resume BEFORE validation: an adjustment carrying this key means
    // the same request already ran (fully or partially). Drive it to completion
    // instead of counting twice — and a product deactivated since the original
    // request must not turn a safe retry into a 400.
    let adjustment = await this.findStockCountByKey(terminal.companyId, dto.idempotencyKey);

    if (adjustment) {
      // The key matched — but a matching key is only a CLAIM that this is the
      // same sheet, and the phone can no longer be trusted to guarantee it (its
      // key is frozen across edits on purpose, so a corrected sheet rides the
      // original key). Verify before replaying. See
      // assertCountMatchesRecordedAdjustment.
      await this.assertCountMatchesOrSettle(adjustment, dto, terminal, user);
    }

    if (!adjustment) {
      // The capture's life, create side: this is a FIRST send, so the variance
      // is about to be frozen against the balance as it stands NOW, and a sheet
      // counted before the shop traded would re-book every sale since as stock
      // found on the shelf. Refused before anything exists — nothing to strand,
      // nothing to settle, and a recount is the honest recovery.
      // See STOCK_COUNT_MAX_CAPTURE_AGE_HOURS.
      this.assertCaptureStillCountable(dto);

      const lines = await this.resolveStockCountLines(terminal, dto.lines);
      const created = await this.stockAdjustments.create(
        {
          companyId: terminal.companyId,
          divisionId: terminal.divisionId,
          branchId: terminal.branchId,
          reason: MOBILE_POS_STOCK_COUNT_REASON,
          notes:
            `${marker} Stock count from terminal ${terminal.terminalCode}` +
            (dto.countedAt ? ` captured ${dto.countedAt}` : ''),
          lines,
        },
        user,
      );
      const record: StockCountChainAdjustment = {
        id: created.id,
        companyId: created.companyId,
        status: created.status,
        adjustmentNumber: created.adjustmentNumber,
        createdAt: created.createdAt,
        lines: created.lines,
      };
      adjustment = record;

      // Everything from here to the chain runs INSIDE the settle path, because
      // the row now exists: a connection drop in the twin window (the ordinary
      // failure, since it is the same pool the create just used) would
      // otherwise leave a marker-anchored DRAFT with no record that a terminal
      // count stopped there — the one hole in "an audit row on every exit".
      try {
        // Claim the key, verbatim the purchase mechanic and for the same
        // reason: the twin check this replaced was two reads racing each other,
        // and two reads cannot decide it — Postgres stamps createdAt at
        // transaction START, so each side of a create race could see itself as
        // the earliest and drive its own row, applying one shelf's variance
        // twice. The unique index decides it in one write.
        if (!(await this.claimStockCountKey(record.id, dto.idempotencyKey))) {
          const winner = await this.findStockCountByKey(terminal.companyId, dto.idempotencyKey);
          if (winner && winner.id !== record.id) {
            // The loser retires its own (still unposted) draft and resumes the
            // winner's chain. Soft, because that is what deletion means for
            // this entity — the create already wrote an audit log pointing at
            // the row — and looked up BEFORE the retire, so an empty lookup
            // cannot leave this request holding nothing.
            await this.prisma.stockAdjustment.update({
              where: { id: record.id },
              data: { deletedAt: new Date() },
            });
            adjustment = winner;
          }
          // No live winner while the index says the key is taken means the
          // holder was soft-deleted, and only a DRAFT or REJECTED adjustment
          // can be: it applied nothing. Keep our own row and drive it rather
          // than refuse a count the manager is standing over.
        }
      } catch (error) {
        await this.settleNonPostedStockCount(record, terminal, user, error, 'create', {
          status: record.status,
          notes: null,
        });
        throw error;
      }

      if (adjustment !== record) {
        // Same rule as the pre-check above: about to drive somebody else's row,
        // so verify it is this sheet before touching it. Outside the
        // settle-the-loser block on purpose — the row this refusal is ABOUT is
        // the winner, and that is the one the office has to be able to see.
        await this.assertCountMatchesOrSettle(adjustment, dto, terminal, user);
      }
    }

    const result = await this.resumeStockCountChain(adjustment, terminal, user);

    await this.prisma.mobilePosTerminal.update({
      where: { id: terminal.id },
      data: { lastSeenAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_STOCK_COUNT_COMPLETED',
      entityType: 'StockAdjustment',
      entityId: result.id,
      userId: user.id,
      companyId: terminal.companyId,
      severity: AuditSeverity.MEDIUM,
      newValue: {
        terminalCode: terminal.terminalCode,
        adjustmentNumber: result.adjustmentNumber,
        status: result.status,
      },
    });
    return result;
  }

  async createSale(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    dto: CreateMobilePosLiteSaleDto,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    const paymentMethod = dto.paymentMethod;
    const isCredit = paymentMethod === SalesPaymentMethod.CREDIT;
    if (isCredit && !terminal.creditEnabled) {
      throw new ForbiddenException('Credit is not enabled on this Mobile POS terminal');
    }
    if (isCredit && !dto.customerId) {
      throw new BadRequestException('Select the customer before completing a credit sale');
    }
    // Any attached customer — required for credit, optional for cash/mobile
    // money — must belong to the terminal's company and branch scope (the same
    // scope the customer search offers).
    if (dto.customerId) {
      const selectedCustomer = await this.prisma.customer.findFirst({
        where: {
          id: dto.customerId,
          companyId: terminal.companyId,
          status: 'ACTIVE',
          AND: [
            { OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] },
            { OR: [{ branchId: terminal.branchId }, { branchId: null }] },
          ],
        },
        select: { id: true },
      });
      if (!selectedCustomer) {
        throw new BadRequestException(
          'The selected customer is not available for this terminal branch',
        );
      }
    }

    const payment = isCredit
      ? null
      : terminal.paymentMethods.find(
          (configured) => configured.isEnabled && configured.paymentMethod === paymentMethod,
        );
    if (!isCredit && !payment) {
      throw new ForbiddenException(
        'This payment method is not enabled on this Mobile POS terminal',
      );
    }

    const lines = await this.resolveSaleLines(terminal, dto.lines);
    const sale = await this.salesOrders.mobilePosLiteQuickSale(
      {
        companyId: terminal.companyId,
        divisionId: terminal.divisionId,
        branchId: terminal.branchId,
        // Credit always carries dto.customerId (validated above); cash/mobile
        // money sales record an attached customer when one was chosen and fall
        // back to the terminal's general customer otherwise.
        customerId: dto.customerId ?? terminal.generalCustomerId,
        salesType: isCredit ? SalesType.CREDIT_SALE : SalesType.CASH_SALE,
        orderDate: new Date().toISOString(),
        currency: CurrencyCode.TZS,
        paymentMethod,
        cashAccountId: payment?.cashAccountId,
        paymentReference: dto.paymentReference?.trim() || undefined,
        salespersonId: terminal.salespersonId,
        idempotencyKey: dto.idempotencyKey,
        lines,
      },
      user,
      terminal.id,
      terminal.terminalCode,
    );

    await this.prisma.mobilePosTerminal.update({
      where: { id: terminal.id },
      data: { lastSeenAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_SALE_COMPLETED',
      entityType: 'SalesOrder',
      entityId: sale.id,
      userId: user.id,
      companyId: terminal.companyId,
      severity: AuditSeverity.MEDIUM,
      newValue: { terminalCode: terminal.terminalCode, paymentMethod },
    });

    // The goods left the counter the moment this sale was paid, so the note
    // that records it is written here — after every transaction the sale owns
    // (create, confirm, the receivable, the cash receipt, the GL posting) has
    // already committed, and outside all of them.
    //
    // THE MONEY AND THE STOCK ARE THE SALE; THE NOTE IS A DOCUMENT ABOUT IT.
    // A note that cannot be written is logged and the sale still stands — never
    // the reverse. This wrapper is TOTAL: recordCounterDelivery must not be able
    // to throw out of createSale under any circumstances, because a throw here
    // stops a real shop selling.
    //
    // Awaited, not detached: a detached promise loses the request's logging
    // context, escapes the audit user, and risks an unhandled rejection taking
    // the process down mid-trade. Three small round trips on a path that already
    // makes several is the price of the failure being findable.
    if (this.recordCounterSaleDeliveryNotes) {
      try {
        await this.recordCounterDelivery(sale as unknown as CounterSale, terminal, user);
      } catch (error) {
        await this.logCounterDeliveryNotRecorded(
          sale as unknown as CounterSale,
          terminal,
          user,
          error,
        );
      }
    }
    return sale;
  }

  /**
   * Record that a counter sale's goods were collected: one delivery note per
   * sale, driven to DELIVERED.
   *
   * IDEMPOTENCY IS A DATABASE GUARANTEE HERE, NOT A READ. The POS sale chain is
   * replay-safe by marker and offline queued sales replay by construction, so a
   * second createSale for one physical sale is ordinary traffic. A read-then-
   * write check cannot decide a create race — Postgres stamps createdAt at
   * transaction START, so two concurrent requests can each read a set in which
   * they are the winner; migration 20260813120000 exists because that exact bug
   * received one lorry twice. The authority is
   * `delivery_notes_companyId_counterSaleOrderId_key`. The findFirst below is a
   * cheap fast path for the ordinary replay and NOTHING ELSE — the index is what
   * decides.
   *
   * Keyed on the sales order rather than the sale's idempotencyKey because the
   * invariant we want is "one auto-issued note per counter sale" and the order
   * id states it directly: a replayed sale resolves through replayQuickSale() to
   * the SAME SalesOrder row, so the second request arrives holding the same id
   * and collides.
   *
   * NOTE ON STOCK, because it is the one thing that would make this dangerous:
   * DeliveryNotesService has no inventory effects of any kind — no movement, no
   * balance, no batch, no ledger. Stock is issued by the sale itself as
   * SALE_ISSUE movements inside SalesOrdersService.confirm(). This chain
   * therefore CANNOT double-decrement. A source-level guard in the spec fails the
   * day that stops being true.
   *
   * NOTE ON PERMISSIONS: these are service-to-service calls into the service,
   * never the controller. A rep holds `mobile_pos_lite.use` and nothing else;
   * requiring `delivery_notes.create` would stop every terminal in the fleet
   * from selling.
   */
  private async recordCounterDelivery(
    sale: CounterSale,
    // Only the code is read, and widening it to that is what lets the historical
    // repair (§4) drive THIS chain instead of forking a second one: a backfilled
    // order has a terminal code but no activated terminal session behind it.
    terminal: Pick<Terminal, 'terminalCode'>,
    user: AuthUser,
    options: CounterDeliveryOptions = {},
  ): Promise<CounterDeliveryOutcome> {
    const lines = sale.lines ?? [];
    if (lines.length === 0) {
      // Nothing physically crossed the counter that we can describe. Do not
      // write an empty note; leave the order as it is.
      return 'skipped';
    }

    const existing = await this.prisma.deliveryNote.findFirst({
      where: { companyId: sale.companyId, counterSaleOrderId: sale.id },
      select: { id: true, status: true },
    });
    if (existing) {
      const status = String(existing.status);
      await this.driveCounterDeliveryChain({ id: existing.id, status }, sale, user);
      // Already finished is not work done: the repair report must not claim to
      // have healed a note it only looked at.
      return status === 'DELIVERED' || status === 'CLOSED' ? 'skipped' : 'resumed';
    }

    let created: { id: string; status: string };
    try {
      const note = await this.deliveryNotes.create(
        this.counterDeliveryDto(sale, terminal, user, lines, options),
        user.id,
        // Server-derived, never from a DTO: this is both the replay key and the
        // discriminator that keeps the note off the office's worklists.
        { counterSaleOrderId: sale.id },
      );
      created = { id: note.id, status: String(note.status) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Lost the create race. The row that OWNS the key is the one to drive —
      // decided by the index, not by whichever read ran first.
      const winner = await this.prisma.deliveryNote.findFirst({
        where: { companyId: sale.companyId, counterSaleOrderId: sale.id },
        select: { id: true, status: true },
      });
      if (!winner) throw error;
      await this.driveCounterDeliveryChain(
        { id: winner.id, status: String(winner.status) },
        sale,
        user,
      );
      return 'resumed';
    }

    await this.driveCounterDeliveryChain(created, sale, user);
    return 'created';
  }

  /**
   * The delivery-note payload for a counter sale. Everything here is a recorded
   * fact; nothing is invented.
   *
   * Three rules this method exists to keep:
   *
   *  - `deliveredById` is `user.id`, the authenticated rep — NOT
   *    `terminal.salespersonId`, which is an Employee id while
   *    DeliveryNote.deliveredById is a foreign key to User. Passing the
   *    salesperson id fails the FK on EVERY sale.
   *  - `deliveryDate` is the sale's own orderDate, not `new Date()`. An
   *    offline-queued sale replays later; pinning the note to the order's own
   *    instant keeps "sold today" and "delivered today" agreeing, and keeps a
   *    resumed chain from dating the note a day after the goods left.
   *  - NO `salesOrderLineId` on the lines, ever. CreateDeliveryNoteLineDto
   *    whitelists it and create() forwards it, but `delivery_note_lines` HAS NO
   *    SUCH COLUMN — it is absent from the schema, from every migration, and
   *    from the generated client. A defined value raises
   *    PrismaClientValidationError at runtime. This path stays immune by never
   *    emitting the key.
   *
   * driverName, vehicleNumber, deliveryAddress and receivedByPhone are all
   * omitted. There was no driver, no vehicle, no destination and no phone.
   * Filling any of them in would be forging delivery evidence — and it is also
   * why the dashboard's "open notes missing driver/vehicle" worklist has to
   * exclude counter notes.
   */
  private counterDeliveryDto(
    sale: CounterSale,
    terminal: Pick<Terminal, 'terminalCode'>,
    user: AuthUser,
    lines: NonNullable<CounterSale['lines']>,
    options: CounterDeliveryOptions = {},
  ) {
    return {
      companyId: sale.companyId,
      branchId: sale.branchId ?? undefined,
      salesOrderId: sale.id,
      customerId: sale.customerId ?? undefined,
      customerName: sale.customerName ?? undefined,
      deliveryDate: new Date(sale.orderDate).toISOString(),
      // The authenticated rep who handed the goods across the counter — a User
      // id, which is what this FK points at. NOT terminal.salespersonId.
      deliveredById: user.id,
      // The historical repair says so on the document itself. A note issued
      // months after the goods left must never read as one written at the time.
      notes: options.backfilledOn
        ? `Counter sale — goods collected at the counter (${terminal.terminalCode}). Recorded by backfill on ${options.backfilledOn}.`
        : `Counter sale — goods collected at the counter (${terminal.terminalCode})`,
      lines: lines.map((line) => ({
        productId: line.productId,
        description: line.description ?? undefined,
        // The Prisma value is a Decimal; CreateDeliveryNoteLineDto wants a
        // number, and create() writes it into BOTH orderedQuantity and
        // deliveredQuantity — correct, because a counter sale is delivered in
        // full by definition.
        quantity: Number(line.quantity),
        unitId: line.unitId,
      })),
    };
  }

  /**
   * Drive a counter-sale note to DELIVERED: DRAFT -> DISPATCHED -> DELIVERED.
   *
   * Each transition is state-guarded inside DeliveryNotesService (dispatch
   * refuses a non-DRAFT, deliver refuses a non-DISPATCHED), which is exactly
   * what makes this safe to call on a fresh note, on a resume after a mid-chain
   * crash, and on a full replay. Concurrent retries that lose a transition race
   * re-read the row and continue instead of failing — the purchase chain's
   * pattern, for the same reason.
   *
   * A note stranded at DRAFT or DISPATCHED by a crash is harmless: the
   * counterSaleOrderId discriminator keeps it out of every delivery worklist
   * whatever state it holds, and the next replay resumes it.
   */
  private async driveCounterDeliveryChain(
    note: CounterDeliveryNote,
    sale: CounterSale,
    user: AuthUser,
  ) {
    let status = note.status;
    if (status === 'DELIVERED' || status === 'CLOSED') return;
    if (status === 'CANCELLED') {
      // Somebody cancelled this note deliberately. Never resurrect it.
      throw new ConflictException('The counter-sale delivery note for this sale was cancelled');
    }

    if (status === 'DRAFT') {
      try {
        await this.deliveryNotes.dispatch(note.id, user.id);
        status = 'DISPATCHED';
      } catch (error) {
        const fresh = await this.prisma.deliveryNote.findFirst({
          where: { id: note.id },
          select: { status: true },
        });
        if (!fresh || String(fresh.status) === 'DRAFT') throw error;
        status = String(fresh.status);
      }
    }

    if (status === 'DISPATCHED' || status === 'IN_TRANSIT' || status === 'PARTIALLY_DELIVERED') {
      try {
        await this.deliveryNotes.deliver(
          note.id,
          // The one field where a walk-in matters. A counter sale has no
          // signature and no named recipient, so we repeat the party the sale is
          // already recorded against — for a walk-in that is the terminal's
          // general customer, which is the shop's own record of "walk-in".
          // NEVER invent a person: not the rep's name, not "Collected".
          { receivedByName: sale.customerName ?? undefined },
          user.id,
        );
        status = 'DELIVERED';
      } catch (error) {
        const fresh = await this.prisma.deliveryNote.findFirst({
          where: { id: note.id },
          select: { status: true },
        });
        if (!fresh || String(fresh.status) !== 'DELIVERED') throw error;
        status = String(fresh.status);
      }
    }

    if (status !== 'DELIVERED') {
      throw new ConflictException('The counter-sale delivery note is no longer deliverable');
    }
  }

  /**
   * The counter-delivery twin of settleUnfinishedPurchase, and it obeys the same
   * two rules: it destroys nothing, and it never lets its own failure replace
   * the caller's. It only ever writes a line.
   *
   * Severity is MEDIUM, not HIGH: no money and no stock is at risk. One sales
   * order is left reading "Delivered: PENDING" — the status quo this fix removes
   * — and it is repaired by the next replay or the next backfill run.
   */
  private async logCounterDeliveryNotRecorded(
    sale: CounterSale,
    terminal: Terminal,
    user: AuthUser,
    error: unknown,
  ) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await this.auditLogs.log({
        action: 'MOBILE_POS_LITE_COUNTER_DELIVERY_NOT_RECORDED',
        entityType: 'SalesOrder',
        entityId: sale.id,
        userId: user.id,
        companyId: sale.companyId,
        severity: AuditSeverity.MEDIUM,
        newValue: {
          terminalCode: terminal.terminalCode,
          salesOrderNumber: sale.salesOrderNumber ?? null,
          reason,
        },
      });
    } catch (logError) {
      // Last resort: the audit row lives in the database that just failed, which
      // is exactly when this fallback matters. Nothing escapes — the rep's sale
      // has already succeeded and must be returned.
      this.logger.error(
        `Mobile POS counter sale ${sale.salesOrderNumber ?? sale.id} could not record its delivery note and the audit log could not be written: ${
          logError instanceof Error ? logError.message : String(logError)
        }. Original failure: ${reason}`,
      );
    }
  }

  /**
   * THE HISTORICAL HALF (spec-counter-delivery §4). Repair the counter sales
   * that were rung before this module started recording collections, so they
   * stop reading "Delivered: PENDING" forever.
   *
   * A historical SalesOrder never replays through createSale, so no other code
   * path will ever issue notes for those orders. Without this method the fix
   * lands for new sales only and `ordersAwaitingDelivery` on the office
   * dashboard means two different things depending on the sale's date — the
   * "worst of both worlds" §4.1 set out to avoid.
   *
   * WHY AN ENDPOINT AND NOT A MIGRATION. A SQL migration would have to hand-roll
   * `DN-{YYYY}-#####` numbering outside EntityCodeGeneratorService (that is how
   * you get duplicate delivery-note numbers and a broken
   * `@@unique([companyId, deliveryNoteNumber])`), it would write business
   * documents with no audit rows, and it would fire automatically at deploy —
   * possibly mid-trade — instead of when a manager decides. This runs when a
   * human with `mobile_pos_lite.manage` says so, outside trading hours.
   *
   * IT DRIVES THE SAME CHAIN THE LIVE SALE DRIVES. recordCounterDelivery, with a
   * backfill stamp on the note text and the original rep as the acting user.
   * A second implementation of "how a counter sale is recorded" would be a
   * divergence between how history and how new sales are written, and the copy
   * nobody remembers to update is always the one that rots. Numbering, audit
   * rows, field discipline and — above all — the idempotency guarantee are
   * therefore identical here by construction, not by review.
   *
   * SAFE TO INTERRUPT, SAFE TO RE-RUN. Every order is its own committed chain,
   * so a run cut off by a timeout or a dropped connection loses only the orders
   * it had not reached. Re-running repairs the remainder and nothing else,
   * because "already done" is decided on three independent layers: the selection
   * filter below excludes any order that already carries a counter note; the
   * chain's own findFirst excludes it again; and
   * `delivery_notes_companyId_counterSaleOrderId_key` rejects it AT THE DATABASE
   * if both reads lose a race to a concurrent sale. Only the third is authority
   * — a read cannot decide a create race — and the first two exist so the
   * ordinary re-run is cheap and burns no DN- numbers.
   *
   * MOVES NO STOCK. DeliveryNotesService has no inventory effects of any kind;
   * the SALE_ISSUE movements were written by SalesOrdersService.confirm() when
   * the customer paid, months ago. That is what makes repairing history safe at
   * all, and it is pinned by a source-level guard in the spec.
   */
  async counterDeliveryBackfill(
    query: QueryMobilePosLiteCounterDeliveryBackfillDto,
    user: AuthUser,
  ): Promise<MobilePosLiteCounterDeliveryBackfillReport> {
    // Same manager gate the route carries, asserted again in the service so the
    // permission cannot be lost by a future refactor of the controller — and the
    // same gate the operator script probes before it writes anything.
    this.assertCanManage(user);
    // This writes business documents, so EVERY company the run can reach must
    // carry WRITE — not the READ that companyWhereFor alone settles for.
    //
    // Asserting only on the narrowing path made the default STRICTER to name
    // than to omit: `?companyId=B` was refused for a group user holding only
    // READ on B, while omitting the parameter wrote delivery notes into B and
    // burned its DN- numbers, because companyWhereFor returns every accessible
    // company at whatever level it was granted. Omitting it is what the
    // operator script's own usage examples do, so the lenient path was also the
    // usual one. Inert on a single-company install; wrong the day a group has a
    // read-only member.
    if (query.companyId) {
      await this.companyScope.assertCanAccessCompany(user, query.companyId, AccessLevel.WRITE);
    }
    const scope = await this.companyScope.companyWhereFor(user, query.companyId);
    for (const companyId of scopedCompanyIds(scope)) {
      await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.WRITE);
    }

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        // Never widen this. Every qualifier is load-bearing:
        ...scope,
        // POS origin, and the ONLY proof of it that a human cannot type. The
        // terminal id is stamped server-side from an activated session; a notes
        // marker, a CASH payment method or a "counter" sales type can all belong
        // to a desktop order and prove nothing.
        mobilePosTerminalId: { not: null },
        // confirm() IS the counter event: it issues the SALE_ISSUE movements and
        // takes the payment at the instant the customer pays and walks out, so a
        // row in one of these states is a row whose stock has already left.
        // DRAFT never charged anybody and never moved goods; CANCELLED/VOIDED
        // means the counter reversed it. Neither gets a note, ever. CREDIT
        // counter sales ARE here — the goods still walked out, only the money is
        // owed, and those are the orders where fulfillment tracking matters most.
        status: { in: [...CONFIRMED_SALES_STATUSES] },
        // A soft-deleted or empty order describes no goods.
        deletedAt: null,
        lines: { some: {} },
        // The no-existing-note guard, and the reason successive batches advance:
        // as orders are repaired they leave the population, so batch 2 picks up
        // where batch 1 stopped instead of re-reading the same 500 rows forever.
        // Deliberately NOT filtered on the note's deletedAt — a soft-deleted
        // counter note still owns its key and still means "already backfilled".
        deliveryNotes: { none: { counterSaleOrderId: { not: null } } },
      },
      // Oldest first: the run repairs history in the order it happened, and an
      // interrupted run leaves a contiguous unrepaired tail rather than holes.
      orderBy: { orderDate: 'asc' },
      take: COUNTER_DELIVERY_BACKFILL_BATCH,
      select: {
        id: true,
        salesOrderNumber: true,
        companyId: true,
        branchId: true,
        customerId: true,
        customerName: true,
        // The order's OWN instant. Dating a repaired note `new Date()` would
        // back-date nothing and misdate everything.
        orderDate: true,
        // The rep who actually rang it — a recorded fact and a valid User FK.
        createdById: true,
        mobilePosTerminalId: true,
        mobilePosTerminal: { select: { terminalCode: true } },
        lines: { select: { productId: true, description: true, quantity: true, unitId: true } },
      },
    });

    const backfilledOn = new Date().toISOString().slice(0, 10);
    const failures: MobilePosLiteCounterDeliveryBackfillFailure[] = [];
    let created = 0;
    let resumed = 0;
    let skipped = 0;

    for (const order of orders) {
      try {
        const outcome = await this.recordCounterDelivery(
          order,
          // mobilePosTerminalId is non-null by the filter above, so the relation
          // resolves; the fallback records the id rather than inventing a code.
          {
            terminalCode: order.mobilePosTerminal?.terminalCode ?? order.mobilePosTerminalId ?? '',
          },
          // The note is attributed to the rep who rang the sale, not to the
          // manager running the repair: deliveredById and createdById are both a
          // recorded fact about that day. WHO RAN THE REPAIR is recorded too —
          // on the run's own audit row below, which is where it belongs.
          { ...user, id: order.createdById },
          { backfilledOn },
        );
        if (outcome === 'created') created += 1;
        else if (outcome === 'resumed') resumed += 1;
        else skipped += 1;
      } catch (error) {
        // One order's failure is counted and reported; it never aborts the run
        // and never touches the orders after it. The failed order is left
        // exactly as it was and the next run will try it again.
        failures.push({
          salesOrderId: order.id,
          salesOrderNumber: order.salesOrderNumber ?? null,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const report: MobilePosLiteCounterDeliveryBackfillReport = {
      scanned: orders.length,
      created,
      resumed,
      skipped,
      failed: failures.length,
      failures,
    };

    try {
      await this.auditLogs.log({
        action: 'MOBILE_POS_LITE_COUNTER_DELIVERY_BACKFILL',
        entityType: 'SalesOrder',
        // The run is the subject, not any one order; the per-order evidence is
        // in newValue and every note carries its own DELIVERY_NOTE_* rows.
        entityId: 'counter-delivery-backfill',
        userId: user.id,
        companyId: query.companyId ?? user.companyId ?? undefined,
        severity: AuditSeverity.MEDIUM,
        newValue: { ...report, backfilledOn },
      });
    } catch (logError) {
      // The notes are already written and correct. A failed audit row must not
      // turn a successful repair into a 500 that sends the operator round again.
      this.logger.error(
        `Mobile POS counter-delivery backfill completed (created ${created}, resumed ${resumed}, failed ${failures.length}) but its audit row could not be written: ${
          logError instanceof Error ? logError.message : String(logError)
        }`,
      );
    }

    return report;
  }

  /**
   * Letterhead receipt PDF for a sale recorded on THIS terminal. Terminal-bound
   * by construction: the sale must carry the activated terminal's id on
   * SalesOrder.mobilePosTerminalId, so a rep can never pull another terminal's
   * receipts. Rendering reuses the shared business-PDF letterhead engine
   * (generated-documents renderLetterheadPdf -> buildBusinessPdf); nothing is
   * persisted — the receipt is regenerated on demand.
   */
  async saleReceipt(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    saleId: string,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    const sale = await this.prisma.salesOrder.findFirst({
      where: {
        id: saleId,
        companyId: terminal.companyId,
        mobilePosTerminalId: terminal.id,
        deletedAt: null,
      },
      select: {
        id: true,
        salesOrderNumber: true,
        orderDate: true,
        createdAt: true,
        totalAmount: true,
        paymentMethod: true,
        paymentReference: true,
        customerName: true,
        customer: { select: { name: true } },
        lines: {
          select: {
            description: true,
            quantity: true,
            unitPrice: true,
            taxAmount: true,
            lineTotal: true,
            product: { select: { name: true } },
          },
        },
      },
    });
    if (!sale) {
      throw new NotFoundException('Sale not found for this Mobile POS terminal');
    }

    const receiptNumber = sale.salesOrderNumber ?? sale.id.slice(0, 8).toUpperCase();
    const customerName =
      sale.customer?.name ?? sale.customerName ?? terminal.generalCustomer?.name ?? 'N/A';
    const configuredLabel = terminal.paymentMethods.find(
      (payment) => payment.paymentMethod === sale.paymentMethod,
    )?.label;
    const paymentReference = sale.paymentReference?.trim();

    const sections: BusinessPdfSection[] = [
      {
        title: 'Muamala / Transaction',
        items: [
          { label: 'Mteja / Customer', value: customerName },
          {
            label: 'Malipo / Payment Method',
            value: bilingualPaymentMethod(sale.paymentMethod, configuredLabel),
          },
          ...(paymentReference
            ? [{ label: 'Kumbukumbu ya Malipo / Payment Reference', value: paymentReference }]
            : []),
        ],
      },
      {
        title: 'Bidhaa / Items',
        table: {
          headers: ['Bidhaa / Item', 'Idadi / Qty', 'Bei / Unit Price', 'Jumla / Total'],
          numericColumns: [1, 2, 3],
          columnWeights: [3, 1, 1.5, 1.5],
          rows: sale.lines.map((line) => {
            // The persisted unitPrice is the NET (ex-VAT) figure after the
            // server carved output VAT out of the VAT-inclusive sticker price;
            // lineTotal is still the gross amount the customer paid. Print the
            // VAT-INCLUSIVE per-unit price so the paper multiplies out
            // (qty x unit price == line total) and matches the shelf price.
            const quantity = Number(line.quantity);
            const grossUnitPrice =
              quantity > 0
                ? Number(line.lineTotal) / quantity
                : Number(line.unitPrice) + Number(line.taxAmount ?? 0);
            return [
              line.description || line.product?.name || 'N/A',
              receiptQty(line.quantity),
              tzsWhole(grossUnitPrice),
              tzsWhole(line.lineTotal),
            ];
          }),
        },
        totals: [{ label: 'JUMLA / TOTAL', value: tzsWhole(sale.totalAmount), emphasis: true }],
      },
      {
        title: 'Asante / Thank You',
        paragraphs: ['Asante kwa biashara yako! / Thank you for your business!'],
      },
    ];

    const buffer = await this.generatedDocuments.renderLetterheadPdf(
      { companyId: terminal.companyId, branchId: terminal.branchId },
      {
        title: 'RISITI / RECEIPT',
        subtitle: customerName,
        reference: receiptNumber,
        generatedAt: new Date(),
        meta: [
          { label: 'Namba ya Risiti / Receipt No', value: receiptNumber },
          { label: 'Tarehe / Date', value: receiptDateTime(sale.createdAt ?? sale.orderDate) },
          { label: 'Tawi / Branch', value: terminal.branch?.name ?? 'N/A' },
          { label: 'Muuzaji / Served By', value: terminal.assignedUser?.fullName ?? 'N/A' },
        ],
        sections,
      },
      user,
    );

    return { buffer, fileName: `RISITI-${receiptFileStem(receiptNumber)}.pdf` };
  }

  /**
   * The end-of-day close a rep submits from Funga Siku (spec-history-reports
   * §1.3) — the only write in this module.
   *
   * SERVER-AUTHORITATIVE. The client sends no totals, no lines, no method
   * breakdown and no rep or terminal identity: every figure the office reads as
   * fact is recomputed here from SalesOrder rows, and the terminal headers pin
   * who and where. The only client-declared numbers on the whole record are
   * declaredHeldCount/declaredHeldAmount — what the phone's outbox was still
   * holding, which is the one thing this server genuinely cannot know — and
   * they are named as declared on the record, in the response and on the paper.
   *
   * Why businessDate comes from the client at all: the phone's key is frozen
   * against a specific day, so a retry at 00:01 for a close begun at 23:59 must
   * still close YESTERDAY, and if the server picked the day the retry would
   * silently close a different one. So the phone owns WHICH day it is closing
   * and the server owns WHETHER that day is closable — today or yesterday in
   * the BUSINESS zone (MOBILE_POS_BUSINESS_TIMEZONE), never in the process's
   * incidental one and never on the phone's word, so a device clock two weeks
   * out cannot mint a report for a day nobody worked. Yesterday is the ordinary
   * case, not the exception: a rep who finished at 23:50 with no signal and
   * closes on the bus at 00:10 is closing yesterday, and so is one whose day
   * ended offline and who closes it over breakfast.
   *
   * REPLAY PROTECTION IS A DATABASE GUARANTEE. @@unique([companyId,
   * idempotencyKey]) with the key written by the INSERT itself. A read-then-
   * write twin check is not an option here for the reason the 20260813120000
   * migration states: Postgres stamps createdAt at transaction START, so both
   * racers can conclude they won. This is also a SINGLE-write claim, unlike the
   * purchase and count chains — they have to create through a core service that
   * does not take the key and then claim it in a second statement, so they have
   * a window between "row exists" and "key claimed" and a loser row to retire.
   * This model is ours, so the stronger form is available and is what we use:
   * no window, no loser row, nothing to retire.
   *
   * A MARKER HIT IS VERIFIED BEFORE IT IS REPLAYED. A matching key is only a
   * CLAIM that this is the same close — the key is frozen across a midnight
   * rollover on purpose, so only the server can check it. Terminal, rep and the
   * stored businessDate must all agree, or the request is refused with a
   * conflict and an audit row the office can find.
   *
   * NOTHING IS EVER DESTROYED OR PERMANENTLY REFUSED. There is no downstream
   * chain to strand: this record creates no financial fact, no stock movement
   * and no GL entry — it is a snapshot of records that already exist. If
   * anything after the insert fails (the lastSeenAt touch, the audit row), the
   * row stands and the client's identical retry lands on the replay path and
   * gets the same record back; if the insert itself fails, no row exists and the
   * frozen key makes the retry safe. A SUBMITTED REPORT IS IMMUTABLE: a replay
   * never rewrites the stored declared-held figures even if the outbox drained
   * in between, because mutating a record the office may already have read and
   * printed is worse than a five-minute-stale disclosure. A rep who wants the
   * corrected picture closes again — a new key, a new row, a later submittedAt.
   */
  async createDayReport(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    dto: CreateMobilePosLiteDayReportDto,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    // The only refusal that can happen before anything exists, and by
    // construction it has nothing to undo.
    const businessDay = this.resolveClosableBusinessDate(dto.businessDate);

    const existing = await this.prisma.mobilePosDayReport.findFirst({
      where: { companyId: terminal.companyId, idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      await this.assertDayReportMatchesOrLog(existing, terminal, businessDay, user);
      return this.serializeDayReport(existing);
    }

    const computed = await this.computeDayReport(terminal, businessDay, user);
    let report: MobilePosDayReport;
    try {
      report = await this.prisma.mobilePosDayReport.create({
        data: {
          companyId: terminal.companyId,
          divisionId: terminal.divisionId,
          branchId: terminal.branchId,
          branchName: terminal.branch?.name ?? '',
          terminalId: terminal.id,
          terminalCode: terminal.terminalCode,
          terminalName: terminal.name,
          repUserId: user.id,
          repName: terminal.assignedUser.fullName,
          businessDate: businessDay.storedAt,
          salesCount: computed.salesCount,
          grossTotal: computed.grossTotal,
          itemsSoldQuantity: computed.itemsSoldQuantity,
          byMethod: computed.byMethod as unknown as Prisma.InputJsonValue,
          items: computed.items as unknown as Prisma.InputJsonValue,
          itemsTruncated: computed.itemsTruncated,
          declaredHeldCount: dto.heldCount,
          declaredHeldAmount: dto.heldAmount,
          idempotencyKey: dto.idempotencyKey,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The index said no: a concurrent request under this key committed first.
      // Re-read it, verify it the same three ways, and return the winner —
      // there is no loser row to retire, because our insert never landed.
      const winner = await this.prisma.mobilePosDayReport.findFirst({
        where: { companyId: terminal.companyId, idempotencyKey: dto.idempotencyKey },
      });
      if (!winner) throw error;
      await this.assertDayReportMatchesOrLog(winner, terminal, businessDay, user);
      return this.serializeDayReport(winner);
    }

    await this.prisma.mobilePosTerminal.update({
      where: { id: terminal.id },
      data: { lastSeenAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_DAY_REPORT_SUBMITTED',
      entityType: 'MobilePosDayReport',
      entityId: report.id,
      userId: user.id,
      companyId: terminal.companyId,
      severity: AuditSeverity.MEDIUM,
      newValue: {
        terminalCode: terminal.terminalCode,
        businessDate: businessDay.key,
        salesCount: computed.salesCount,
        declaredHeldCount: dto.heldCount,
      },
    });
    return this.serializeDayReport(report);
  }

  /**
   * The office's read surface for submitted day reports
   * (spec-history-reports §1.5). A DESKTOP call: no terminal headers, and the
   * company scope is resolved from the AuthUser exactly like findTerminals —
   * never a client-supplied companyId.
   */
  async dayReports(query: QueryMobilePosLiteDayReportsDto, user: AuthUser) {
    this.assertCanManage(user);
    const where: Prisma.MobilePosDayReportWhereInput = {
      ...(await this.companyScope.companyWhereFor(user)),
      ...(query.terminalId ? { terminalId: query.terminalId } : {}),
      ...(query.from || query.to
        ? {
            businessDate: {
              ...(query.from ? { gte: utcCalendarDate(query.from) } : {}),
              // Inclusive `to`: the office asks for a day, not for the instant
              // it begins.
              ...(query.to
                ? { lt: new Date(utcCalendarDate(query.to).getTime() + 24 * 3600 * 1000) }
                : {}),
            },
          }
        : {}),
    };

    const reports = await this.prisma.mobilePosDayReport.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: 100,
    });
    return reports.map((report) => this.serializeDayReport(report));
  }

  /**
   * The letterhead paper the rep hands to the phone's share sheet
   * (spec-history-reports §1.4). Terminal-bound by construction — the report
   * must carry the activated terminal's id — exactly as saleReceipt is bound
   * through mobilePosTerminalId, so a rep can never pull another terminal's
   * report.
   *
   * RENDERED FROM THE STORED RECORD, never from client state and never from a
   * re-query. That is the whole reason this is a separate GET on a submitted id
   * rather than a field on the POST response: the paper she hands over and the
   * record the office reads are the same numbers by construction, and they stay
   * the same numbers if she re-shares it a week later.
   */
  async dayReportPdf(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    reportId: string,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    const record = await this.prisma.mobilePosDayReport.findFirst({
      where: { id: reportId, companyId: terminal.companyId, terminalId: terminal.id },
    });
    if (!record) {
      throw new NotFoundException('Day report not found for this Mobile POS terminal');
    }
    const report = this.serializeDayReport(record);

    const sections: BusinessPdfSection[] = [
      {
        title: 'Muhtasari / Summary',
        items: [
          { label: 'Mauzo / Sales', value: String(report.salesCount) },
          { label: 'Jumla / Gross Total', value: tzsWhole(report.grossTotal) },
          { label: 'Bidhaa zilizouzwa / Items Sold', value: receiptQty(report.itemsSoldQuantity) },
        ],
      },
      {
        title: 'Malipo / Payment Methods',
        ...(report.byMethod.length
          ? {
              table: {
                headers: ['Njia / Method', 'Idadi / Count', 'Jumla / Total'],
                numericColumns: [1, 2],
                columnWeights: [3, 1, 1.5],
                rows: report.byMethod.map((entry) => [
                  entry.label ??
                    bilingualPaymentMethod(entry.paymentMethod as SalesPaymentMethod, null),
                  String(entry.count),
                  tzsWhole(entry.amount),
                ]),
              },
              totals: [
                { label: 'JUMLA / TOTAL', value: tzsWhole(report.grossTotal), emphasis: true },
              ],
            }
          : {
              paragraphs: [
                'Hakuna mauzo yaliyorekodiwa siku hii. / No sales were recorded on this day.',
              ],
            }),
      },
      {
        title: 'Bidhaa / Items',
        ...(report.items.length
          ? {
              table: {
                headers: ['Bidhaa / Item', 'Idadi / Qty', 'Jumla / Total'],
                numericColumns: [1, 2],
                columnWeights: [3, 1, 1.5],
                rows: report.items.map((item) => [
                  item.name,
                  receiptQty(item.quantity),
                  tzsWhole(item.amount),
                ]),
              },
              // Says exactly what was dropped and what was not. Every figure in
              // Muhtasari above — sales, gross, items sold — now comes from an
              // unbounded aggregate, so this sentence vouches for nothing a
              // bound can move; the list itself is the day's whole breakdown
              // ranked by value and cut at the cap.
              ...(report.itemsTruncated
                ? {
                    paragraphs: [
                      `Orodha hii inaonyesha bidhaa ${MOBILE_POS_DAY_REPORT_ITEM_CAP} zenye thamani kubwa zaidi; jumla hapo juu ni kamili. / This list shows the ${MOBILE_POS_DAY_REPORT_ITEM_CAP} highest-value items; the totals above are complete.`,
                    ],
                  }
                : {}),
            }
          : {
              paragraphs: ['Hakuna bidhaa zilizouzwa siku hii. / No items were sold on this day.'],
            }),
      },
      // The section that makes the report honest: printed if and only if the
      // phone declared something still in its outbox, saying both that it is
      // NOT in the total above and that the phone is where the figure came
      // from. A report that silently omitted unsent sales would be a lie.
      ...(report.declaredHeldCount > 0
        ? [
            {
              title: 'Mauzo Yaliyo Mkononi / Sales Still On The Phone',
              items: [
                { label: 'Mauzo / Sales', value: String(report.declaredHeldCount) },
                { label: 'Kiasi / Amount', value: tzsWhole(report.declaredHeldAmount) },
              ],
              paragraphs: [
                'Hazijajumuishwa kwenye jumla hapo juu. Idadi hii imetolewa na simu. / Not included in the total above. This figure is declared by the phone.',
              ],
            },
          ]
        : []),
    ];

    const buffer = await this.generatedDocuments.renderLetterheadPdf(
      { companyId: record.companyId, branchId: record.branchId },
      {
        title: 'RIPOTI YA SIKU / DAY SALES REPORT',
        subtitle: report.rep.name,
        reference: report.reference,
        generatedAt: new Date(),
        meta: [
          { label: 'Tarehe / Date', value: receiptDate(record.businessDate) },
          {
            label: 'Kituo / Terminal',
            value: `${report.terminal.code} (${report.terminal.name})`,
          },
          { label: 'Tawi / Branch', value: report.branch.name || 'N/A' },
          { label: 'Muuzaji / Sales Rep', value: report.rep.name || 'N/A' },
          { label: 'Imetumwa / Submitted', value: receiptDateTime(record.submittedAt) },
        ],
        sections,
      },
      user,
    );

    return {
      buffer,
      fileName: `RIPOTI-${receiptFileStem(report.reference)}-${reportFileTime(record.submittedAt)}.pdf`,
    };
  }

  /**
   * The day the phone says it is closing, refused unless the server agrees it
   * is closable. Returns it in the three forms the chain needs: the
   * `YYYY-MM-DD` key, the UTC-midnight instant the `@db.Date` column stores,
   * and the BUSINESS-zone window every sales figure is computed over.
   *
   * "Today or yesterday" is decided in the BUSINESS zone
   * (MOBILE_POS_BUSINESS_TIMEZONE), never in the process's own. Read in UTC on
   * a container that sets no TZ, this refused a rep in Dar who closed at 00:30
   * — an ordinary act — for the three hours a night shift most needs, and it is
   * the same three hours over which the trading day itself was being cut. Both
   * ends now agree by construction: the phone's calendar day, the day this
   * window opens on, and the date printed on the paper are the same day in the
   * same zone.
   *
   * The round-trip check is not decoration: `2026-02-31` matches the DTO's
   * regex and rolls silently forward to 3 March, which could otherwise land
   * inside the window and file a report under a day that does not exist.
   */
  private resolveClosableBusinessDate(businessDate: string): DayReportWindow {
    const [year, month, day] = businessDate.split('-').map(Number);
    const asDay = new Date(Date.UTC(year, month - 1, day));
    const isRealDate =
      asDay.getUTCFullYear() === year &&
      asDay.getUTCMonth() === month - 1 &&
      asDay.getUTCDate() === day;
    const today = Date.parse(`${businessDayKeyOf(new Date())}T00:00:00.000Z`);
    const daysBack = Math.round((today - asDay.getTime()) / (24 * 3600 * 1000));
    if (!isRealDate || daysBack < 0 || daysBack > MOBILE_POS_CLOSABLE_DAYS_BACK) {
      throw new BadRequestException(
        'Only today or yesterday can be closed from a Mobile POS terminal',
      );
    }
    return {
      key: businessDate,
      storedAt: utcCalendarDate(businessDate),
      ...businessDayWindow(businessDate),
    };
  }

  /**
   * Everything the office reads as fact, recomputed from SalesOrder rows over
   * the same scope mySalesToday uses — this terminal, this rep, confirmed
   * statuses — across the BUSINESS-zone day window.
   *
   * EVERY FIGURE THE PAPER PRESENTS AS A TOTAL COMES FROM AN UNBOUNDED
   * AGGREGATE. `salesCount` and `grossTotal` from the order aggregate,
   * `itemsSoldQuantity` and the per-product amounts from a line-level groupBy.
   * itemsSoldQuantity used to be summed in JS over a findMany capped at 500
   * orders while being printed in `Muhtasari / Summary` beside the two exact
   * figures, directly under a sentence promising "jumla hapo juu ni kamili" —
   * a financial document must not carry a number it quietly qualifies
   * elsewhere, so the bound that could move it is gone rather than annotated.
   * The ONLY bound left is the 50-row display cap on the item list, it can move
   * no total, and `itemsTruncated` says when it bit.
   */
  private async computeDayReport(terminal: Terminal, businessDay: DayReportWindow, user: AuthUser) {
    const where: Prisma.SalesOrderWhereInput = {
      companyId: terminal.companyId,
      mobilePosTerminalId: terminal.id,
      createdById: user.id,
      status: { in: [...CONFIRMED_SALES_STATUSES] },
      orderDate: { gte: businessDay.dayStart, lt: businessDay.dayEnd },
    };

    // The line-level scope, expressed once: every line belonging to an order in
    // the window above. A relation filter rather than a second copy of the
    // predicate, so the two can never drift.
    const lineWhere: Prisma.SalesOrderLineWhereInput = { salesOrder: where };

    const [totals, methods, lineTotals] = await Promise.all([
      // Unbounded and exact.
      this.prisma.salesOrder.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      // The breakdown is what makes the gross legible: money in the pocket is
      // the CASH row, not the total.
      this.prisma.salesOrder.groupBy({
        by: ['paymentMethod'],
        where,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      // Also unbounded: the day's whole product breakdown, summed by the
      // database rather than in JS over a page of orders. Nothing here is
      // capped — the cap is applied to the DISPLAY list below, after the
      // ranking, so the figure the Summary prints is the day's real one.
      this.prisma.salesOrderLine.groupBy({
        by: ['productId'],
        where: lineWhere,
        _sum: { quantity: true, lineTotal: true },
      }),
    ]);

    const byMethod: DayReportMethodTotal[] = methods.map((method) => ({
      paymentMethod: method.paymentMethod,
      // The terminal's OWN configured label (a till number, say). CREDIT has no
      // configured payment row at all and honestly gets null.
      label:
        terminal.paymentMethods.find((payment) => payment.paymentMethod === method.paymentMethod)
          ?.label ?? null,
      count: method._count._all,
      amount: round2(Number(method._sum.totalAmount ?? 0)),
    }));

    const ranked = lineTotals
      .map((line) => ({
        productId: line.productId,
        quantity: Number(line._sum.quantity ?? 0),
        amount: Number(line._sum.lineTotal ?? 0),
      }))
      .sort((a, b) => b.amount - a.amount);
    const itemsSoldQuantity = ranked.reduce((sum, item) => sum + item.quantity, 0);

    // Names for the rows that will actually be printed, and only those. Product
    // is a Restrict relation so the row cannot vanish under a sale, but a name
    // that somehow will not resolve must not blank a paper: the id stands in.
    const shown = ranked.slice(0, MOBILE_POS_DAY_REPORT_ITEM_CAP);
    const named = shown.length
      ? await this.prisma.product.findMany({
          where: { id: { in: shown.map((item) => item.productId) }, companyId: terminal.companyId },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(named.map((product) => [product.id, product.name]));

    const items: DayReportItemTotal[] = shown.map((item) => ({
      productId: item.productId,
      name: nameById.get(item.productId) ?? item.productId,
      quantity: round4(item.quantity),
      amount: round2(item.amount),
    }));

    return {
      salesCount: totals._count._all,
      grossTotal: round2(Number(totals._sum.totalAmount ?? 0)),
      itemsSoldQuantity: round4(itemsSoldQuantity),
      byMethod,
      items,
      // The one bound left, and it is a DISPLAY cap: the smallest rows are
      // dropped from the printed list after the whole day has been ranked, so
      // it can move no total on the record or on the paper. Disclosed anyway,
      // because a shortened list should say it is one.
      itemsTruncated: ranked.length > MOBILE_POS_DAY_REPORT_ITEM_CAP,
    };
  }

  /**
   * The three-way verification, with the office's copy of the argument
   * attached.
   *
   * A frozen key is a CLAIM of sameness and only the server can check it, so a
   * marker-matched replay is verified before it is replayed: same terminal,
   * same rep, same business date. The refusal names the office as the recovery
   * ("ulizia ofisi"), so the office has to be able to SEE it — exactly the
   * reason assertPurchaseMatchesOrSettle writes a row. Nothing is destroyed and
   * nothing is rewritten either way: the stored report is immutable.
   */
  private async assertDayReportMatchesOrLog(
    record: MobilePosDayReport,
    terminal: Terminal,
    businessDay: DayReportWindow,
    user: AuthUser,
  ) {
    const storedDate = businessDateKey(record.businessDate);
    if (
      record.terminalId === terminal.id &&
      record.repUserId === user.id &&
      storedDate === businessDay.key
    ) {
      return;
    }
    try {
      await this.auditLogs.log({
        action: 'MOBILE_POS_LITE_DAY_REPORT_CONFLICT',
        entityType: 'MobilePosDayReport',
        entityId: record.id,
        userId: user.id,
        companyId: record.companyId,
        severity: AuditSeverity.HIGH,
        oldValue: {
          terminalCode: record.terminalCode,
          businessDate: storedDate,
          repUserId: record.repUserId,
        },
        newValue: {
          terminalCode: terminal.terminalCode,
          businessDate: businessDay.key,
          repUserId: user.id,
        },
      });
    } catch (logError) {
      // Last resort, exactly like the purchase and count settles: the rep's own
      // refusal is what must reach her, so this never propagates and never
      // masks it. The process log at least lets an operator find the report.
      this.logger.error(
        `Mobile POS day report ${record.id} was re-claimed under a mismatched key and its audit log could not be written: ${
          logError instanceof Error ? logError.message : String(logError)
        }`,
      );
    }
    throw new ConflictException(
      'This day report key was already used for a different day or terminal',
    );
  }

  /**
   * The stored record as the phone, the paper and the office all read it.
   *
   * `reference` is computed rather than stored, and deliberately not a new
   * document-number sequence: EntityCodeGeneratorService exists, but a report is
   * not a numbered business document, and saleReceipt already sets the
   * precedent of falling back to a derived reference.
   */
  private serializeDayReport(record: MobilePosDayReport) {
    const businessDate = businessDateKey(record.businessDate);
    return {
      id: record.id,
      businessDate,
      reference: `${record.terminalCode}-${businessDate.replace(/-/g, '')}`,
      submittedAt: record.submittedAt,
      terminal: { id: record.terminalId, code: record.terminalCode, name: record.terminalName },
      branch: { id: record.branchId, name: record.branchName },
      rep: { id: record.repUserId, name: record.repName },
      salesCount: record.salesCount,
      grossTotal: Number(record.grossTotal),
      itemsSoldQuantity: Number(record.itemsSoldQuantity),
      byMethod: readDayReportJson<DayReportMethodTotal>(record.byMethod),
      items: readDayReportJson<DayReportItemTotal>(record.items),
      itemsTruncated: record.itemsTruncated,
      // Named as declared everywhere they appear, because that is what they
      // are: the phone's own statement about its outbox.
      declaredHeldCount: record.declaredHeldCount,
      declaredHeldAmount: Number(record.declaredHeldAmount),
    };
  }

  private async resolveSaleLines(terminal: Terminal, lines: CreateMobilePosLiteSaleDto['lines']) {
    const quantities = new Map<string, number>();
    for (const line of lines) {
      quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + Number(line.quantity));
    }
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: Array.from(quantities.keys()) },
        companyId: terminal.companyId,
        status: 'ACTIVE',
        AND: [{ OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] }],
      },
      select: {
        id: true,
        name: true,
        baseUnitId: true,
        defaultSellingPrice: true,
        retailPrice: true,
        wholesalePrice: true,
        productFamily: {
          select: { defaultSellingPrice: true, retailPrice: true, wholesalePrice: true },
        },
      },
    });
    if (products.length !== quantities.size) {
      throw new BadRequestException('One or more products are unavailable for this terminal');
    }

    return products.map((product) => {
      const unitPrice = effectiveSellingPrice(product);
      if (unitPrice == null) {
        throw new BadRequestException(`${product.name} does not have a selling price`);
      }
      return {
        productId: product.id,
        description: product.name,
        quantity: quantities.get(product.id) ?? 0,
        unitId: product.baseUnitId,
        unitPrice,
        discountAmount: 0,
        taxAmount: 0,
      };
    });
  }

  private async resolvePurchaseLines(
    terminal: Terminal,
    lines: CreateMobilePosLitePurchaseDto['lines'],
  ) {
    const quantities = new Map<string, number>();
    const explicitCosts = new Map<string, number>();
    for (const line of lines) {
      quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + Number(line.quantity));
      if (line.unitCost != null) {
        const existing = explicitCosts.get(line.productId);
        if (existing != null && existing !== Number(line.unitCost)) {
          throw new BadRequestException('Provide a single unit cost per product');
        }
        explicitCosts.set(line.productId, Number(line.unitCost));
      }
    }

    const products = await this.prisma.product.findMany({
      where: {
        id: { in: Array.from(quantities.keys()) },
        companyId: terminal.companyId,
        status: 'ACTIVE',
        AND: [{ OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] }],
      },
      select: {
        id: true,
        name: true,
        baseUnitId: true,
        productType: true,
        trackInventory: true,
        defaultPurchasePrice: true,
        productFamily: { select: { defaultPurchasePrice: true } },
      },
    });
    if (products.length !== quantities.size) {
      throw new BadRequestException('One or more products are unavailable for this terminal');
    }

    return products.map((product) => {
      if (!isStockItem(product)) {
        throw new BadRequestException(
          `${product.name} is not a stock item and cannot be received here`,
        );
      }
      // Cost resolution mirrors the GRN receive flow: an explicit line cost
      // wins, then the product (then family) default purchase price. Ordering
      // in the product's base unit keeps those base-unit-denominated defaults
      // valid, exactly like the GRN post's base-unit guard.
      const unitCost =
        explicitCosts.get(product.id) ??
        positivePrice(product.defaultPurchasePrice) ??
        positivePrice(product.productFamily?.defaultPurchasePrice);
      if (unitCost == null) {
        throw new BadRequestException(
          `${product.name} does not have a purchase cost — enter the unit cost`,
        );
      }
      return {
        productId: product.id,
        description: product.name,
        quantity: quantities.get(product.id) ?? 0,
        unitId: product.baseUnitId,
        unitCost,
      };
    });
  }

  /**
   * The content guard on a replayed purchase.
   *
   * A marker hit used to be taken as proof that the incoming body is the same
   * delivery, and resumePurchaseChain then drove the RECORDED order without
   * looking at the dto at all. That is only safe while the client guarantees
   * one key per slip content, and it cannot: whichever way the phone's key
   * policy leans, one of the two failure modes is live. Freeze the key across
   * edits and a corrected slip is silently discarded — the sugar the manager
   * added after the lost response never arrives, and the muhuri stamps anyway.
   * Re-mint on edit and the marker misses, so the SAME delivery is recorded a
   * SECOND time: two POs, two GRNs, two payables against the supplier, stock
   * the branch never received, and nothing linking the pair.
   *
   * So the server decides. When the recorded order and the incoming body
   * disagree on anything the manager actually typed — the supplier, which
   * products, how many, or a cost she entered herself — this is not a replay
   * and it is not a new delivery either: it is a slip that was already received
   * once, being re-sent changed. Neither replaying nor creating is right, so
   * refuse and point at the office, which can see both documents.
   *
   * Server-RESOLVED costs are deliberately not compared: a line that carried no
   * unitCost is priced from the product (then family) default at resolve time,
   * and the office moving that default between the original send and a retry
   * must not turn a legitimate replay into a conflict.
   *
   * That is why the comparison is made against the CONTENT MARKER written at
   * create (purchaseContentMarker) whenever the recorded order carries one: the
   * marker fingerprints what the manager typed, so a cost she REMOVED — the
   * ordinary correction after typing 50000 for 5000 — is a real difference and
   * 409s like any other edit, while a repriced product still replays. The
   * structural comparison below is the fallback for orders created before the
   * marker existed; it cannot see a cleared cost (an empty explicit-cost set
   * matches vacuously), which is precisely the hole the marker closes.
   */
  private assertPurchaseMatchesRecordedOrder(
    order: PurchaseChainOrder,
    dto: CreateMobilePosLitePurchaseDto,
  ) {
    if (order.notes?.includes(PURCHASE_CONTENT_MARKER_PREFIX)) {
      if (!order.notes.includes(purchaseContentMarker(dto))) {
        throw new ConflictException(
          'The earlier slip for this delivery was already received — check with the office before recording it again.',
        );
      }
      return;
    }

    const quantities = new Map<string, number>();
    const explicitCosts = new Map<string, number>();
    for (const line of dto.lines) {
      quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + Number(line.quantity));
      if (line.unitCost != null) explicitCosts.set(line.productId, Number(line.unitCost));
    }

    const recorded = new Map(
      order.lines.map((line) => [
        line.productId,
        { quantity: Number(line.quantity), unitCost: Number(line.unitCost) },
      ]),
    );

    const matches =
      order.supplierId === dto.supplierId &&
      recorded.size === quantities.size &&
      Array.from(quantities).every(
        ([productId, quantity]) => recorded.get(productId)?.quantity === quantity,
      ) &&
      Array.from(explicitCosts).every(
        ([productId, unitCost]) => recorded.get(productId)?.unitCost === unitCost,
      );

    if (!matches) {
      throw new ConflictException(
        'The earlier slip for this delivery was already received — check with the office before recording it again.',
      );
    }
  }

  /**
   * The content guard with the office's copy of the argument attached.
   *
   * The refusal names the office as the recovery ("ulizia ofisi kabla ya kutuma
   * tena"), so the office has to be able to SEE it: a terminal holding a slip
   * it believes was never received is disputing a delivery this company has
   * recorded as complete, and from the desktop that GRN looks like any other
   * posted receipt. Without this line the sentence sends the manager to a desk
   * that has no idea why she is there. The count path settles the identical
   * case, and resumePurchaseChain's contract — every exit that is not a
   * received delivery is settled first — is only true with this here.
   */
  private async assertPurchaseMatchesOrSettle(
    order: PurchaseChainOrder,
    dto: CreateMobilePosLitePurchaseDto,
    terminal: Terminal,
    user: AuthUser,
  ) {
    try {
      this.assertPurchaseMatchesRecordedOrder(order, dto);
    } catch (error) {
      await this.settleUnfinishedPurchase(order, terminal, user, error, {
        step: 'resume',
        orderStatus: String(order.status),
        grn: null,
      });
      throw error;
    }
  }

  /**
   * Stamp this key on the order we just created, and let the unique index
   * decide whether we own it. `true` means we do; `false` means somebody else
   * got there first and this request is the loser of a create race.
   *
   * Written as a claim rather than checked as a read on purpose: a read cannot
   * settle a create race at all (see the call site), and this is the only step
   * in the chain whose outcome is decided by the database rather than by
   * whichever query happened to run first.
   */
  private async claimPurchaseKey(orderId: string, idempotencyKey: string): Promise<boolean> {
    try {
      await this.prisma.purchaseOrder.update({
        where: { id: orderId },
        data: { idempotencyKey },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /**
   * The order this key already created, if any.
   *
   * The stamped column is the authority. The notes marker is a FALLBACK, for
   * the rows this module created before that column existed — a phone can be
   * holding a frozen key across the deploy, and failing to resume such an order
   * receives the same lorry a second time — and for the narrow window where the
   * stamp itself failed.
   *
   * The fallback only ever matches rows that carry NO key of their own, which
   * is what stops a marker planted in somebody's free text from taking a
   * stamped order's place: every order this module records from now on is
   * stamped, so its notes are no longer a way in. Client text is sanitised at
   * the other end too (sanitizeClientNotes).
   */
  private async findPurchaseByKey(
    companyId: string,
    idempotencyKey: string,
  ): Promise<PurchaseChainOrder | null> {
    const marker = purchaseIdempotencyMarker(idempotencyKey);
    return this.prisma.purchaseOrder.findFirst({
      where: {
        companyId,
        OR: [
          { idempotencyKey },
          { AND: [{ idempotencyKey: null }, { notes: { contains: marker } }] },
        ],
      },
      // Stamped first, and only then the oldest: the row that OWNS the key is
      // the one to drive. Without this a loser whose own delete failed could
      // outrank the winner on createdAt — it is the earlier row by definition,
      // since the race is lost by committing second — and a later retry would
      // drive the stockless twin and receive the same lorry all over again.
      orderBy: [
        { idempotencyKey: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: PURCHASE_CHAIN_SELECT,
    });
  }

  /**
   * Drive a marker-anchored purchase order to its terminal state: CONFIRMED
   * PO -> DRAFT GRN -> APPROVED -> POSTED. Every step is state-guarded inside
   * the core services, so this is safe to call on a fresh order, on a resume
   * after a mid-chain crash, and on a full replay (where it short-circuits to
   * the recorded result). Concurrent retries that lose a state-transition race
   * re-read the entity and continue instead of failing.
   *
   * Every exit that is not a received delivery goes through
   * settleUnfinishedPurchase first, for exactly the reason the count chain has
   * one: an interrupted chain leaves a CONFIRMED purchase order with a DRAFT or
   * APPROVED goods-received note behind it, and that GRN is indistinguishable
   * on the desktop from any other receipt waiting to be posted. The office
   * posts it as routine the next morning; meanwhile the phone's own recovery
   * from a stuck slip is to empty the form, which drops the frozen key, so the
   * same lorry is re-typed under a fresh key and received a SECOND time — two
   * GRNs, two payables, double stock, and nothing linking the pair. The audit
   * row (and the idempotency marker now written into the GRN's notes) is what
   * lets the office tell an abandoned chain from a real pending one.
   */
  private async resumePurchaseChain(
    order: PurchaseChainOrder,
    terminal: Terminal,
    user: AuthUser,
    marker: string,
  ) {
    const progress: PurchaseChainProgress = {
      step: 'resume',
      orderStatus: String(order.status),
      grn: null,
    };
    try {
      return await this.drivePurchaseChain(order, terminal, user, marker, progress);
    } catch (error) {
      // One wrapper around the whole chain rather than a settle at each throw
      // site: a step added later cannot forget to record itself, which is the
      // hole this had before — every rethrow in here was silent.
      await this.settleUnfinishedPurchase(order, terminal, user, error, progress);
      throw error;
    }
  }

  private async drivePurchaseChain(
    order: PurchaseChainOrder,
    terminal: Terminal,
    user: AuthUser,
    marker: string,
    progress: PurchaseChainProgress,
  ) {
    let status = String(order.status);
    if (status === 'CANCELLED' || status === 'VOIDED') {
      throw new ConflictException(
        'The original purchase behind this idempotency key was cancelled',
      );
    }

    if (status === 'DRAFT') {
      progress.step = 'confirm';
      try {
        await this.purchaseOrders.confirm(order.id, user);
        status = 'CONFIRMED';
      } catch (error) {
        // A concurrent retry may have confirmed it first — continue if so.
        const fresh = await this.prisma.purchaseOrder.findFirst({
          where: { id: order.id },
          select: { status: true },
        });
        if (!fresh || fresh.status === 'DRAFT') throw error;
        status = fresh.status;
      }
      progress.orderStatus = status;
    }

    let grn = await this.prisma.goodsReceivedNote.findFirst({
      where: { companyId: order.companyId, purchaseOrderId: order.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, grnNumber: true },
    });
    progress.grn = grn ? { ...grn, status: String(grn.status) } : null;

    if (!grn) {
      if (status === 'RECEIVED') {
        // Stock already came in outside this flow (e.g. a direct PO receive by
        // an operations user). Never receive again — replay what exists.
        return this.purchaseResult(order, null);
      }
      progress.step = 'receive';
      const grnNumber = await this.nextGrnNumber(order.companyId);
      const created = await this.goodsReceivedNotes.create(
        {
          companyId: order.companyId,
          divisionId: order.divisionId ?? undefined,
          branchId: order.branchId ?? undefined,
          purchaseOrderId: order.id,
          supplierId: order.supplierId ?? undefined,
          grnNumber,
          receivedDate: new Date().toISOString(),
          // The marker rides into the GRN too. The office reads an abandoned
          // receipt here, not on the PO, and a receipt that names the key can
          // be matched against the audit row and against any second attempt.
          notes: `Created from Mobile POS Lite (${terminal.terminalCode}) ${marker}`,
          lines: order.lines.map((line) => ({
            productId: line.productId,
            unitId: line.unitId,
            orderedQuantity: Number(line.quantity),
            receivedQuantity: Number(line.quantity),
            acceptedQuantity: Number(line.quantity),
            rejectedQuantity: 0,
            unitCost: Number(line.unitCost),
          })),
        },
        user,
      );
      grn = { id: created.id, status: created.status, grnNumber: created.grnNumber };
      progress.grn = { ...grn, status: String(grn.status) };
    }

    if (String(grn.status) === 'DRAFT') {
      progress.step = 'approve';
      try {
        await this.goodsReceivedNotes.approve(grn.id, user);
        grn = { ...grn, status: 'APPROVED' as typeof grn.status };
      } catch (error) {
        const fresh = await this.prisma.goodsReceivedNote.findFirst({
          where: { id: grn.id },
          select: { status: true },
        });
        if (!fresh || String(fresh.status) === 'DRAFT') throw error;
        grn = { ...grn, status: fresh.status };
      }
      progress.grn = { ...grn, status: String(grn.status) };
    }
    if (String(grn.status) === 'APPROVED') {
      progress.step = 'post';
      try {
        await this.goodsReceivedNotes.post(grn.id, user);
        grn = { ...grn, status: 'POSTED' as typeof grn.status };
      } catch (error) {
        const fresh = await this.prisma.goodsReceivedNote.findFirst({
          where: { id: grn.id },
          select: { status: true },
        });
        if (!fresh || String(fresh.status) !== 'POSTED') throw error;
        grn = { ...grn, status: fresh.status };
      }
      progress.grn = { ...grn, status: String(grn.status) };
    }
    if (String(grn.status) !== 'POSTED') {
      progress.step = 'resume';
      throw new ConflictException(
        'The goods received note behind this purchase is no longer postable',
      );
    }

    return this.purchaseResult(order, grn.grnNumber);
  }

  /**
   * The purchase chain's twin of settleNonPostedStockCount, and it obeys the
   * same two rules: it destroys nothing, and it never lets its own failure
   * replace the manager's. It only ever writes a line.
   *
   * What that line has to carry is where the delivery stopped and what it left
   * behind, because the two are what tell an abandoned chain from a routine
   * one: a chain that stopped at `confirm` left no receipt at all and the next
   * send resumes it, while one that stopped at `post` left an APPROVED GRN that
   * a desk will post as ordinary work — the same crates, received twice, if the
   * phone has meanwhile re-typed the lorry under a new key.
   */
  private async settleUnfinishedPurchase(
    order: PurchaseChainOrder,
    terminal: Terminal,
    user: AuthUser,
    error: unknown,
    progress: PurchaseChainProgress,
  ) {
    const failedBecause = error instanceof Error ? error.message : String(error);
    try {
      await this.auditLogs.log({
        action: 'MOBILE_POS_LITE_PURCHASE_NOT_RECEIVED',
        entityType: 'PurchaseOrder',
        entityId: order.id,
        userId: user.id,
        companyId: order.companyId,
        severity: AuditSeverity.HIGH,
        oldValue: { status: progress.orderStatus },
        newValue: {
          terminalCode: terminal.terminalCode,
          purchaseOrderNumber: order.purchaseOrderNumber,
          stoppedAt: progress.step,
          grnId: progress.grn?.id ?? null,
          grnNumber: progress.grn?.grnNumber ?? null,
          grnStatus: progress.grn?.status ?? null,
          failedBecause,
        },
      });
    } catch (logError) {
      // Last resort, exactly like the count's: the manager's own failure is
      // what must reach her, so this never propagates and never masks it. The
      // process log at least lets an operator find the chain by its PO number.
      this.logger.error(
        `Mobile POS purchase ${order.purchaseOrderNumber} stopped at ${progress.step} and its audit log could not be written: ${
          logError instanceof Error ? logError.message : String(logError)
        }. Original failure: ${failedBecause}`,
      );
    }
  }

  private purchaseResult(order: PurchaseChainOrder, grnNumber: string | null) {
    return {
      id: order.id,
      purchaseOrderNumber: order.purchaseOrderNumber,
      grnNumber,
      totalAmount: Number(order.totalAmount),
    };
  }

  /**
   * Turn counted lines into stock-adjustment lines. Every field the core DTO
   * needs beyond the counted number is resolved here from the terminal's own
   * scope, so nothing the phone sends can widen it.
   */
  private async resolveStockCountLines(
    terminal: Terminal,
    lines: CreateMobilePosLiteStockCountDto['lines'],
  ) {
    const countedByProduct = new Map<string, number>();
    for (const line of lines) {
      // Counts do not sum like sale/purchase quantities do: two lines for one
      // product are contradictory counts of the same shelf, not a bigger count.
      if (countedByProduct.has(line.productId)) {
        throw new BadRequestException(
          `Product ${line.productId} was counted more than once in this stock count`,
        );
      }
      countedByProduct.set(line.productId, Number(line.countedQuantity));
    }
    const productIds = Array.from(countedByProduct.keys());

    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        companyId: terminal.companyId,
        status: 'ACTIVE',
        AND: [{ OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] }],
      },
      select: {
        id: true,
        name: true,
        baseUnitId: true,
        productType: true,
        trackInventory: true,
        // Read for the count-up precondition below, never for the payload: no
        // buying cost may ride on a POS count in either direction.
        defaultPurchasePrice: true,
        productFamily: { select: { defaultPurchasePrice: true } },
      },
    });
    const productsById = new Map(products.map((product) => [product.id, product]));

    // Rejections NAME the product: the draft on the phone is keyed by
    // productId, so a rep can only drop the offending line and resubmit if the
    // error says which line it is.
    for (const productId of productIds) {
      const product = productsById.get(productId);
      if (!product) {
        throw new BadRequestException(`Product ${productId} is not available for this terminal`);
      }
      if (!isStockItem(product)) {
        throw new BadRequestException(
          `${product.name} (${productId}) is not a stock item and cannot be counted`,
        );
      }
    }

    // Server-authoritative system side, read for the TERMINAL's branch. It is
    // quantityOnHand and NOT onHand - reserved: a physical count counts
    // physical stock, so reservations are irrelevant here (unlike Stoo's
    // `available`). The client never sends this number, and the review-step
    // preview it computed against its own snapshot is only ever a preview.
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { branchId: terminal.branchId, productId: { in: productIds } },
      select: { productId: true, quantityOnHand: true },
    });
    const onHandByProduct = new Map(
      balances.map((balance) => [balance.productId, Number(balance.quantityOnHand)]),
    );

    // Built from the counted map itself, never re-looked-up with a `?? 0`
    // fallback: 0 is a real count here, so a fallback zero and a counted zero
    // must never be able to look alike.
    const resolved = Array.from(countedByProduct, ([productId, countedQuantity]) => ({
      productId,
      // No balance row = this branch never moved the product: honest zero, and
      // the whole counted quantity is the variance.
      systemQuantity: onHandByProduct.get(productId) ?? 0,
      countedQuantity,
      unitId: productsById.get(productId)!.baseUnitId,
      // unitCost is deliberately absent: post() values a count-up from the
      // product's weighted-average cost (then the default purchase price), and
      // no buying cost may ever ride on a POS payload.
    }));

    await this.assertCountUpsCanBeValued(terminal, resolved, productsById);

    return resolved;
  }

  /**
   * The count-up precondition, checked BEFORE anything is created.
   *
   * post() values an inbound (variance > 0) line at the branch weighted-average
   * cost, then the product's defaultPurchasePrice, then the family's, and
   * throws `Stock add for <name> must include a unit cost greater than zero`
   * when none of them is > 0 (stock-adjustments.service.ts, inbound branch of
   * the post transaction). That throw lands AFTER this wrapper has already
   * driven create -> submit -> approve, and post()'s transaction only rolls
   * back its own APPROVED->POSTED claim — so the count would settle at APPROVED
   * with every line intact: an orphan a desktop user could post by hand,
   * applying every variance a second time while the phone (which re-mints its
   * key as soon as the sheet is edited) sends a second count. Resolving the
   * SAME precedence here turns that into one clear 400 naming the product,
   * with nothing created. spec-inventory §7 case 2 also depends on this being
   * a cost check and not a balance check: a product with no inventoryBalance
   * row counts up fine as long as a default price values it.
   *
   * Only count-UPS need a cost — post() skips zero-variance lines and relieves
   * a count-down at the balance's own average — so this can only run once the
   * system side above is known. averageCost is read in its own query rather
   * than merged into the quantityOnHand read: these numbers are a precondition
   * that never reaches the returned lines, the response, or the phone, and
   * keeping the two reads apart keeps that visibly true.
   */
  private async assertCountUpsCanBeValued(
    terminal: Terminal,
    lines: Array<{ productId: string; systemQuantity: number; countedQuantity: number }>,
    productsById: Map<string, StockCountCostProduct>,
  ) {
    const countUpProductIds = lines
      .filter((line) => line.countedQuantity > line.systemQuantity)
      .map((line) => line.productId);
    if (!countUpProductIds.length) return;

    const costRows = await this.prisma.inventoryBalance.findMany({
      where: { branchId: terminal.branchId, productId: { in: countUpProductIds } },
      select: { productId: true, averageCost: true },
    });
    const averageCostByProduct = new Map(
      costRows.map((row) => [row.productId, Number(row.averageCost)]),
    );

    for (const productId of countUpProductIds) {
      const product = productsById.get(productId)!;
      // Valued stock at this branch already prices the added units.
      if ((averageCostByProduct.get(productId) ?? 0) > 0) continue;
      // Mirrors post() including its ordering subtlety: a product default that
      // EXISTS but is zero wins over the family price and then fails the > 0
      // test — the family is consulted only when the product's own price is
      // null. positivePrice() would quietly fall through, which would put the
      // rejection back inside post() where it strands the count.
      const fallback =
        product.defaultPurchasePrice != null
          ? Number(product.defaultPurchasePrice)
          : product.productFamily?.defaultPurchasePrice != null
            ? Number(product.productFamily.defaultPurchasePrice)
            : undefined;
      if (!fallback || fallback <= 0) {
        // Named like every other rejection on this path: the draft on the phone
        // is keyed by productId, and the manager cannot supply a cost from the
        // POS, so the copy has to point at the office.
        throw new BadRequestException(
          `${product.name} (${productId}) has no buying price on record and cannot be counted up — the office must set one first`,
        );
      }
    }
  }

  /**
   * The content guard on a replayed count — the count's twin of
   * assertPurchaseMatchesRecordedOrder, and it exists for the same reason.
   *
   * A marker hit used to be taken as proof that the incoming body is the same
   * sheet, and resumeStockCountChain then drove the RECORDED adjustment without
   * looking at the dto at all. That is only safe while the client guarantees
   * one key per sheet content, and it cannot: the key is now frozen from the
   * first send until a 2xx or an explicit discard — it has to be, or a phone
   * that lost the response mints a second key and counts the branch twice — so
   * an edit made WHILE waiting rides the original key. Without this guard the
   * ordinary correction is silently destroyed: the manager keys 50 for a shelf
   * of 5, the response is lost, she spots it and fixes it, taps TUMA again, and
   * the wrapper posts the recorded +45 and stamps the muhuri over it. She sees
   * success; the shelf and the books now disagree by 45 units with no record
   * that anyone ever disagreed.
   *
   * So the server decides. When the recorded count and the incoming body
   * disagree on ANY counted number — a line's quantity, a line she added, a
   * line she removed — this is neither a replay nor a new count: it is a sheet
   * that was already sent, being sent changed. Refuse and point at the office,
   * which can see the recorded document; the phone's own recovery is a fresh
   * count, which is worth exactly as much as this one and costs a re-key.
   *
   * Unlike the purchase guard this needs no separate content marker, and the
   * difference is worth stating so nobody "harmonises" them later: every number
   * compared here is verbatim client input stored on the row. A purchase line's
   * unitCost may be a server-resolved default, indistinguishable in the row
   * from a typed one, which is why that guard fingerprints the intent instead.
   * A count line's countedQuantity is never resolved from anything, and the
   * recorded lines are built from the counted map itself (one line per product,
   * created for every product sent and for no other), so the recorded row IS
   * the canonical statement of what was sent. systemQuantity and
   * varianceQuantity are deliberately not compared: they are the server's side
   * of the arithmetic and move on their own.
   */
  private assertCountMatchesRecordedAdjustment(
    adjustment: StockCountChainAdjustment,
    dto: CreateMobilePosLiteStockCountDto,
  ) {
    const submitted = new Map<string, number>();
    let duplicated = false;
    for (const line of dto.lines) {
      // A repeated productId cannot match a recorded row (resolveStockCountLines
      // refuses one line per product on the way in, so no recorded count has a
      // twin line). Flagged rather than thrown: on this path the body is being
      // compared, not validated, and "this is not the sheet that was recorded"
      // is the true answer.
      if (submitted.has(line.productId)) duplicated = true;
      submitted.set(line.productId, Number(line.countedQuantity));
    }

    const recorded = new Map(
      adjustment.lines.map((line) => [line.productId, Number(line.countedQuantity)]),
    );

    // Size equality plus one-directional membership is a full comparison of
    // both directions: an omitted line and an added line are each a size
    // difference, and a changed line fails the value test. `0` is a real count,
    // so nothing here may fall back to a zero.
    const matches =
      !duplicated &&
      recorded.size === submitted.size &&
      Array.from(submitted).every(
        ([productId, countedQuantity]) => recorded.get(productId) === countedQuantity,
      );

    if (!matches) {
      throw new ConflictException(
        'This count was already sent with different numbers — check with the office before sending it again.',
      );
    }
  }

  /**
   * The count's twin of assertPurchaseMatchesOrSettle: the refusal names the
   * office as the recovery, so the office has to be able to see it. This row's
   * numbers are DISPUTED by the manager who took them, which is precisely what
   * a desk needs to know before deciding whether to post the recorded document
   * by hand.
   */
  private async assertCountMatchesOrSettle(
    adjustment: StockCountChainAdjustment,
    dto: CreateMobilePosLiteStockCountDto,
    terminal: Terminal,
    user: AuthUser,
  ) {
    try {
      this.assertCountMatchesRecordedAdjustment(adjustment, dto);
    } catch (error) {
      await this.settleNonPostedStockCount(adjustment, terminal, user, error, 'resume', {
        status: adjustment.status,
        notes: null,
      });
      throw error;
    }
  }

  /**
   * Stamp this key on the adjustment we just created and let the unique index
   * decide whether we own it — the count's twin of claimPurchaseKey, and the
   * only step in this chain whose winner is decided by the database rather than
   * by whichever read happened to run first. `false` means we lost the race.
   */
  private async claimStockCountKey(adjustmentId: string, idempotencyKey: string): Promise<boolean> {
    try {
      await this.prisma.stockAdjustment.update({
        where: { id: adjustmentId },
        data: { idempotencyKey },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /**
   * The adjustment this key already created, if any. Column first, notes marker
   * only for rows that carry no key of their own — see findPurchaseByKey for
   * why the fallback exists and why it is scoped that way. `contains`, not
   * equals: reject() APPENDS its reason to notes, and a rejected count must
   * still be found by its key or it would be counted a second time.
   */
  private async findStockCountByKey(
    companyId: string,
    idempotencyKey: string,
  ): Promise<StockCountChainAdjustment | null> {
    const marker = stockCountIdempotencyMarker(idempotencyKey);
    return this.prisma.stockAdjustment.findFirst({
      where: {
        companyId,
        deletedAt: null,
        OR: [
          { idempotencyKey },
          { AND: [{ idempotencyKey: null }, { notes: { contains: marker } }] },
        ],
      },
      // Stamped first, then the oldest — see findPurchaseByKey: the row that
      // owns the key is the row to drive, whatever the clock says.
      orderBy: [
        { idempotencyKey: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: STOCK_COUNT_CHAIN_SELECT,
    });
  }

  /**
   * Drive a marker-anchored stock count to its terminal state: DRAFT ->
   * PENDING_APPROVAL -> APPROVED -> POSTED. Every step is state-guarded inside
   * the core service, so this is safe on a fresh count, on a resume after a
   * mid-chain crash, and on a full replay (where it short-circuits to the
   * recorded result). Concurrent retries that lose a state-transition race
   * re-read the entity and continue instead of failing.
   *
   * Every exit that is NOT a POSTED (or escape-flag PENDING_APPROVAL) result
   * goes through settleNonPostedStockCount first, whichever step it stopped at,
   * so the row is never left both unfinished and unrecorded.
   */
  private async resumeStockCountChain(
    adjustment: StockCountChainAdjustment,
    terminal: Terminal,
    user: AuthUser,
  ) {
    let status = String(adjustment.status);
    if (status === 'REJECTED' || status === 'CANCELLED') {
      const rejected = new ConflictException(
        'The original stock count behind this idempotency key was rejected',
      );
      // A desk rejected this count. Nothing of ours is stranded and nothing is
      // ours to reopen — but the office still gets the line saying a terminal
      // kept trying to send it, so no exit from this chain is silent.
      await this.settleNonPostedStockCount(adjustment, terminal, user, rejected, 'resume', {
        status,
        notes: null,
      });
      throw rejected;
    }

    // The capture's life, checked before any step that can APPLY it. A replay
    // of an already-POSTED count is never refused (it applies nothing, and the
    // phone needs that 2xx to release its draft), and with the auto-post escape
    // flag off this wrapper applies nothing at all, so the age is the desk's
    // business rather than ours.
    if (this.autoPostStockCounts && status !== 'POSTED' && this.isStaleCapture(adjustment)) {
      const stale = new ConflictException(
        `This count was captured more than ${STOCK_COUNT_MAX_CAPTURE_AGE_HOURS} hours ago and can no longer be sent from the phone — count the shelf again, or ask the office to post this one.`,
      );
      // Left exactly where it is, at its own live status, and named in the log:
      // refusing to post it automatically is not the same as deciding it is
      // worthless, and the office can see the document and the shelf.
      await this.settleNonPostedStockCount(adjustment, terminal, user, stale, 'resume', {
        status,
        notes: null,
      });
      throw stale;
    }

    if (status === 'DRAFT') {
      try {
        await this.stockAdjustments.submit(adjustment.id, user);
        status = 'PENDING_APPROVAL';
      } catch (error) {
        // A concurrent retry may have submitted it first — continue if so.
        const observed = await this.observeStockCount(adjustment.id);
        if (!observed || String(observed.status) === 'DRAFT') {
          await this.settleNonPostedStockCount(
            adjustment,
            terminal,
            user,
            error,
            'submit',
            observed,
          );
          throw error;
        }
        status = String(observed.status);
      }
    }

    // Escape flag OFF: the wrapper's job ends at submit. Whatever the count
    // rests at — PENDING_APPROVAL, or a state a desktop approver has since
    // moved it to — is reported as terminal, never as an error.
    if (!this.autoPostStockCounts) {
      return this.stockCountResult(adjustment, status);
    }

    if (status === 'PENDING_APPROVAL') {
      try {
        await this.stockAdjustments.approve(adjustment.id, user);
        status = 'APPROVED';
      } catch (error) {
        const observed = await this.observeStockCount(adjustment.id);
        if (!observed || String(observed.status) === 'PENDING_APPROVAL') {
          await this.settleNonPostedStockCount(
            adjustment,
            terminal,
            user,
            error,
            'approve',
            observed,
          );
          throw error;
        }
        status = String(observed.status);
      }
    }
    if (status === 'APPROVED') {
      try {
        await this.stockAdjustments.post(adjustment.id, user);
        status = 'POSTED';
      } catch (error) {
        const observed = await this.observeStockCount(adjustment.id);
        if (observed && String(observed.status) === 'POSTED') {
          // A concurrent retry — or a post whose commit outlived the response —
          // already applied it. Report the recorded truth.
          status = String(observed.status);
        } else {
          // Everything post() does lives in ONE transaction, so a failure out
          // of it rolls the movements AND the APPROVED->POSTED claim back and
          // leaves the count sitting at APPROVED with all its lines. That row
          // is resumable — the next request carrying the same key drives it —
          // but until it is driven it reads to the office like a routine
          // pending count, so it gets a log. It is never destroyed here,
          // whatever post() said: see settleNonPostedStockCount's rule 2.
          await this.settleNonPostedStockCount(adjustment, terminal, user, error, 'post', observed);
          throw error;
        }
      }
    }
    if (status !== 'POSTED') {
      // Reached only when someone else moved the row out from under the chain
      // (a desktop revert, a reject) between our steps. Nothing of ours is
      // stranded — the row is live and visible at its own status — but the
      // office still gets a line in the log saying a terminal count stopped
      // here, so no non-POSTED exit from this chain is silent.
      await this.settleNonPostedStockCount(
        adjustment,
        terminal,
        user,
        new ConflictException('The stock count behind this request is no longer postable'),
        'resume',
        { status, notes: null },
      );
      throw new ConflictException('The stock count behind this request is no longer postable');
    }

    return this.stockCountResult(adjustment, status);
  }

  /**
   * Re-read the row this chain is driving — for the state guards, and for the
   * settle path's evidence.
   *
   * `null` means one of three things, and every caller must treat all three the
   * same way, as NO evidence: the row is gone; the row is soft-deleted, which
   * the `deletedAt: null` filter here is what makes true (the twin-detect loser
   * is deleted this way, and a soft delete does not change `status`, so an
   * unfiltered read would return it still looking APPROVED); or the read itself
   * failed, which is the ORDINARY case, because the connection that just killed
   * the step is usually still down.
   *
   * Nothing is ever destroyed on the strength of a null — nothing on this path
   * destroys anything at all any more — and a failed re-read never replaces the
   * manager's real failure with a second, less informative one.
   */
  private async observeStockCount(
    id: string,
  ): Promise<{ status: string; notes: string | null } | null> {
    try {
      return await this.prisma.stockAdjustment.findFirst({
        where: { id, deletedAt: null },
        select: { status: true, notes: true },
      });
    } catch {
      return null;
    }
  }

  /**
   * Settle EVERY exit from the count chain that did not reach POSTED — create,
   * submit, approve, post, or a row moved out from under the chain — and leave
   * the office a record.
   *
   * Two rules, and they are the whole design:
   *
   * 1. LEAVE IT RESUMABLE. Always. The client's idempotency key is frozen and
   *    persisted with the draft from the first send until a 2xx or an explicit
   *    discard, so an unfinished chain is not an orphan: the next attempt finds
   *    it by marker and drives it on, and the content guard makes sure it is
   *    the same sheet. Nothing here may destroy or refuse work to defend
   *    against a scenario the frozen key already handles.
   *
   * 2. THIS WRAPPER CANNOT PRONOUNCE A VERDICT ON A REQUEST AFTER THE ROW
   *    EXISTS, so it no longer tries. Two earlier rounds tried and both were
   *    wrong in the same direction. Round 2 retired on movement evidence alone,
   *    so a P2028 timeout or a 2s pool wait — which roll back exactly like a
   *    refusal — destroyed a valid 350-line closing count. Round 3 added "and
   *    the failure was a 400/422", on the premise that such a verdict is a
   *    property of the request rather than of the moment. That premise is false
   *    for most of the 400s post() can actually raise: a missing or duplicated
   *    inventory-adjustment-variance account is company CONFIGURATION (the
   *    resolver's own copy ends "and retry"), and "Insufficient stock at
   *    branch/location …" against a stored count-down delta is pure MOMENT — it
   *    clears the second stock arrives. Retiring on those meant a pilot company
   *    with an unseeded chart of accounts destroyed and permanently refused
   *    every count the shop sent, with nothing left for the office to post
   *    after a one-minute fix.
   *    The only place that can honestly say "this can never succeed as it
   *    stands" is this wrapper's OWN pre-create validation — resolveStockCountLines
   *    and assertCountUpsCanBeValued — and it runs before anything exists, so
   *    it has nothing to retire. Everything reaching this function has a row
   *    behind it and is therefore environmental or moment-dependent as far as
   *    we can know. It gets a log and keeps its life.
   *
   * The movement count is still read at the post step, but only as EVIDENCE FOR
   * THE OFFICE and never as an input to a decision: post() writes every
   * movement it applies inside the same transaction that claims
   * APPROVED->POSTED, so `0` says the rollback was total while any rows at all
   * say the work is out there and the document disagrees with it — the
   * difference between "resend it" and "look at this today".
   *
   * The log is what tells the office an abandoned chain from a routine pending
   * count, so it is attempted on every path INCLUDING the ones where the settle
   * path's own queries fail — which is the ordinary case, since they run on the
   * connection that just failed. Honest limit: the audit row needs that same
   * database. When even the log cannot be written, nothing is recorded and the
   * guarantee is carried entirely by rule 1 — the row is untouched and the
   * frozen key resumes it rather than building a second count.
   */
  private async settleNonPostedStockCount(
    adjustment: StockCountChainAdjustment,
    terminal: Terminal,
    user: AuthUser,
    error: unknown,
    step: StockCountChainStep,
    observed: { status: string; notes: string | null } | null,
  ) {
    const failedBecause = error instanceof Error ? error.message : String(error);
    let appliedMovements: number | null = null;
    let settleFailed: string | null = null;

    if (step === 'post') {
      try {
        appliedMovements = await this.prisma.inventoryMovement.count({
          where: {
            companyId: adjustment.companyId,
            referenceType: 'StockAdjustment',
            referenceId: adjustment.id,
          },
        });
      } catch (settleError) {
        // The evidence query rides the same connection the post step just
        // failed against, so this is a normal outcome, not an exception. Record
        // that the evidence is unmeasured and fall through to the log.
        appliedMovements = null;
        settleFailed = settleError instanceof Error ? settleError.message : String(settleError);
      }
    }

    try {
      await this.logStockCountNotPosted(adjustment, terminal, user, {
        step,
        observedStatus: observed ? String(observed.status) : 'UNKNOWN',
        appliedMovements,
        failedBecause,
        settleFailed,
      });
    } catch (logError) {
      // Last resort. The manager's own failure is what must reach her, so this
      // never propagates and never masks the original: it goes to the process
      // log so an operator can still find the abandoned chain by its marker.
      this.logger.error(
        `Stock count ${adjustment.adjustmentNumber} stopped at ${step} and its audit log could not be written: ${
          logError instanceof Error ? logError.message : String(logError)
        }. Original failure: ${failedBecause}`,
      );
    }
  }

  /**
   * The office's only way to tell an abandoned chain from a genuine pending
   * count: a row left at DRAFT / PENDING_APPROVAL / APPROVED reads exactly like
   * any other terminal count waiting for a desk. Written on every exit from the
   * chain that did not reach POSTED, at whichever step it stopped.
   *
   * `step` is what makes the row actionable: a count that stopped at `create`
   * or `submit` has moved nothing and needs no desk at all — the phone's next
   * send resumes it — while one that stopped at `post` with movements applied
   * is a real inventory event whose document says otherwise.
   */
  private async logStockCountNotPosted(
    adjustment: StockCountChainAdjustment,
    terminal: Terminal,
    user: AuthUser,
    detail: {
      step: StockCountChainStep;
      observedStatus: string;
      appliedMovements: number | null;
      failedBecause: string;
      settleFailed?: string | null;
    },
  ) {
    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_STOCK_COUNT_NOT_POSTED',
      entityType: 'StockAdjustment',
      entityId: adjustment.id,
      userId: user.id,
      companyId: adjustment.companyId,
      severity: AuditSeverity.HIGH,
      oldValue: { status: detail.observedStatus },
      newValue: {
        terminalCode: terminal.terminalCode,
        adjustmentNumber: adjustment.adjustmentNumber,
        stoppedAt: detail.step,
        appliedMovements: detail.appliedMovements,
        failedBecause: detail.failedBecause,
        // Present only when the settle path's own queries failed, so the office
        // can read `appliedMovements: null` as unmeasured rather than zero.
        settleFailed: detail.settleFailed ?? null,
      },
    });
  }

  /**
   * The capture's life, CREATE side: nothing exists yet, so the interval at
   * risk is the one between the shelf being counted and this request arriving,
   * and the only clock that spans it is the client's own capture stamp.
   *
   * This is the side the harm actually lives on. Capture is offline-first by
   * design — the storeroom has no signal, the draft never expires, and the
   * phone will restore a sheet of any age — so a sheet counted at 18:00 and
   * sent at 08:00 reaches a server that has never seen it, and
   * resolveStockCountLines will freeze its variance against THIS MORNING's
   * balance: every unit sold overnight comes back as stock found on the shelf,
   * with a receipt showing exactly the numbers she expects. No row exists, so
   * nothing is stranded, nothing is destroyed and no audit row is owed — this
   * is a pre-create validation like the two beside it.
   *
   * Trusting a client timestamp here is deliberate and bounded: it can only
   * REFUSE work, never buy any (an absent, unparseable or future-dated stamp
   * falls through as "age unknown" and is driven normally, the same rule the
   * resume side obeys), the same phone is already trusted for the counted
   * numbers themselves, and the confirm sheet prints the capture date and time
   * to the manager before she sends. The resume side deliberately does NOT read
   * it: there the row's own createdAt is the better clock and a client number
   * could buy a stale freeze more time. See STOCK_COUNT_MAX_CAPTURE_AGE_HOURS.
   *
   * Skipped entirely while the auto-post escape flag is off, exactly like the
   * resume bound: this wrapper then applies nothing and the age is the desk's
   * judgement to make on a document it can see.
   */
  private assertCaptureStillCountable(dto: CreateMobilePosLiteStockCountDto) {
    if (!this.autoPostStockCounts) return;
    const age = this.captureAgeMs(dto);
    if (age == null || age <= STOCK_COUNT_MAX_CAPTURE_AGE_MS) return;
    throw new ConflictException(
      `This count was captured more than ${STOCK_COUNT_MAX_CAPTURE_AGE_HOURS} hours ago and can no longer be sent from the phone — count the shelf again.`,
    );
  }

  /**
   * The capture's age on the create path, in milliseconds, or null when it
   * cannot be established (an unknown age never refuses).
   *
   * `capturedAgoMs` wins when the phone sent it, because it is the interval
   * measured on ONE clock: `countedAt` against `Date.now()` is two clocks, and
   * their skew is added to the age. Only the slow direction refuses, so a
   * device sitting hours behind would have every count it takes — including the
   * recount the refusal asks for — rejected as stale. Falling back to the
   * two-clock comparison keeps a phone that sends no elapsed time bounded, and
   * a future-dated stamp still reads as unknown rather than as age zero.
   */
  private captureAgeMs(dto: CreateMobilePosLiteStockCountDto): number | null {
    if (typeof dto.capturedAgoMs === 'number' && Number.isFinite(dto.capturedAgoMs)) {
      return Math.max(0, dto.capturedAgoMs);
    }
    if (!dto.countedAt) return null;
    const capturedAt = new Date(dto.countedAt).getTime();
    if (!Number.isFinite(capturedAt)) return null;
    const elapsed = Date.now() - capturedAt;
    return elapsed < 0 ? null : elapsed;
  }

  /**
   * The capture's life, RESUME side: a row already exists, so what is bounded
   * here is the gap between the variance being frozen on it and this attempt
   * trying to POST it. See STOCK_COUNT_MAX_CAPTURE_AGE_HOURS for why age is
   * what matters and why re-deriving the system side would be worse than
   * useless.
   *
   * `createdAt` is the row's own timestamp, never the client's `countedAt`: on
   * this side the freeze has already happened, so a client-supplied number
   * could only buy a stale delta more time (or, sent wrong, refuse a count the
   * server itself created minutes ago). The capture -> create gap that number
   * describes is bounded on the other side, before the row exists, by
   * assertCaptureStillCountable. An absent or unparseable timestamp means the
   * age is UNKNOWN, and an unknown age never refuses.
   */
  private isStaleCapture(adjustment: StockCountChainAdjustment): boolean {
    if (adjustment.createdAt == null) return false;
    const createdAt = new Date(adjustment.createdAt).getTime();
    if (!Number.isFinite(createdAt)) return false;
    return Date.now() - createdAt > STOCK_COUNT_MAX_CAPTURE_AGE_MS;
  }

  /**
   * Lines come back so the success screen can show SERVER-TRUTH variance: the
   * client's review-step preview was computed against a possibly-stale
   * snapshot. Quantities only — the same review-blocking no-cost/no-value rule
   * that governs the Stoo endpoint applies here (rep phones get stolen).
   */
  private stockCountResult(adjustment: StockCountChainAdjustment, status: string) {
    return {
      id: adjustment.id,
      adjustmentNumber: adjustment.adjustmentNumber,
      status,
      lines: adjustment.lines.map((line) => ({
        productId: line.productId,
        systemQuantity: Number(line.systemQuantity),
        countedQuantity: Number(line.countedQuantity),
        varianceQuantity: Number(line.varianceQuantity),
      })),
    };
  }

  /**
   * Issue the next server-generated GRN number via the global entity-code
   * generator. `DEFAULT_PATTERNS` has no GoodsReceivedNote entry, so the first
   * call for a company would lazy-create an awkward fallback prefix; pre-create
   * the sequence with the conventional GRN prefix instead (a later operator
   * override via /settings/number-sequences is respected — we only create when
   * the row is missing).
   */
  private async nextGrnNumber(companyId: string) {
    const sequenceCode = `GoodsReceivedNote_${companyId}`;
    const existing = await this.prisma.documentNumberSequence.findFirst({
      where: { sequenceCode },
      select: { id: true },
    });
    if (!existing) {
      try {
        await this.prisma.documentNumberSequence.create({
          data: {
            sequenceCode,
            companyId,
            entityType: 'GoodsReceivedNote',
            prefix: 'GRN-{YYYY}-',
            padding: 6,
            resetFrequency: 'YEARLY',
            currentNumber: 0,
            isActive: true,
          },
        });
      } catch (error) {
        // Lost a create race — the winner's row is what codes.next will use.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw error;
        }
      }
    }
    return this.codes.next({ entityType: 'GoodsReceivedNote', companyId });
  }

  private async requireTerminal(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    user: AuthUser,
  ) {
    if (!terminalCode || !deviceSecret) {
      throw new ForbiddenException('Activate this Mobile POS device before selling');
    }
    const terminal = await this.prisma.mobilePosTerminal.findFirst({
      where: { terminalCode: terminalCode.trim() },
      include: TERMINAL_INCLUDE,
    });
    if (!terminal || terminal.status !== MobilePosTerminalStatus.ACTIVE) {
      throw new ForbiddenException('This Mobile POS terminal is not active');
    }
    await this.assertAssignedUserCanSell(terminal, user);
    if (!secureHashMatch(terminal.deviceSecretHash, deviceSecret)) {
      throw new ForbiddenException(
        'This device is not registered for the selected Mobile POS terminal',
      );
    }
    return terminal;
  }

  private async assertAssignedUserCanSell(terminal: Terminal, user: AuthUser) {
    if (terminal.assignedUserId !== user.id) {
      throw new ForbiddenException('This Mobile POS terminal is assigned to a different sales rep');
    }
    if (terminal.assignedUser.status !== 'ACTIVE') {
      throw new ForbiddenException('The assigned Mobile POS user is not active');
    }
    await this.companyScope.assertCanAccessCompany(user, terminal.companyId, AccessLevel.WRITE);
  }

  private async findTerminalForManagement(
    id: string,
    user: AuthUser,
    minimumAccess: AccessLevel = AccessLevel.READ,
  ) {
    const terminal = await this.prisma.mobilePosTerminal.findFirst({
      where: { id },
      include: TERMINAL_INCLUDE,
    });
    if (!terminal) throw new NotFoundException('Mobile POS terminal not found');
    await this.companyScope.assertCanAccessCompany(user, terminal.companyId, minimumAccess);
    return terminal;
  }

  private assertCanManage(user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'provision Mobile POS Lite terminals');
  }

  private async validateConfiguration(dto: {
    companyId: string;
    divisionId: string;
    branchId: string;
    salespersonId: string;
    generalCustomerId: string;
    paymentMethods: PaymentInput[];
  }) {
    const [division, branch, salesperson, generalCustomer] = await Promise.all([
      this.prisma.division.findFirst({
        where: { id: dto.divisionId, companyId: dto.companyId, isActive: true },
        select: { id: true },
      }),
      this.prisma.branch.findFirst({
        where: { id: dto.branchId, divisionId: dto.divisionId, isActive: true },
        select: { id: true },
      }),
      this.prisma.employee.findFirst({
        where: { id: dto.salespersonId, companyId: dto.companyId, employmentStatus: 'ACTIVE' },
        select: { id: true, userId: true, divisionId: true, branchId: true },
      }),
      this.prisma.customer.findFirst({
        where: { id: dto.generalCustomerId, companyId: dto.companyId, status: 'ACTIVE' },
        select: { id: true, divisionId: true, branchId: true },
      }),
    ]);
    if (!division)
      throw new BadRequestException('Division does not belong to the selected company');
    if (!branch) throw new BadRequestException('Branch does not belong to the selected division');
    if (!salesperson?.userId) {
      throw new BadRequestException(
        'The selected sales rep must be an active employee linked to a user account',
      );
    }
    if (
      (salesperson.divisionId && salesperson.divisionId !== dto.divisionId) ||
      (salesperson.branchId && salesperson.branchId !== dto.branchId)
    ) {
      throw new BadRequestException(
        'The selected sales rep is not assigned to this division and branch',
      );
    }
    if (!generalCustomer)
      throw new BadRequestException('General Customer does not belong to the selected company');
    if (
      (generalCustomer.divisionId && generalCustomer.divisionId !== dto.divisionId) ||
      (generalCustomer.branchId && generalCustomer.branchId !== dto.branchId)
    ) {
      throw new BadRequestException(
        'General Customer does not belong to the selected division and branch',
      );
    }

    const paymentMethods = await this.validatePaymentMethods(
      dto.companyId,
      dto.divisionId,
      dto.branchId,
      dto.paymentMethods,
    );
    return { assignedUserId: salesperson.userId, paymentMethods };
  }

  private async validatePaymentMethods(
    companyId: string,
    divisionId: string,
    branchId: string,
    paymentInputs: PaymentInput[],
  ) {
    const methods = new Set(paymentInputs.map((payment) => payment.paymentMethod));
    if (methods.size !== paymentInputs.length) {
      throw new BadRequestException('A payment method can only be configured once per terminal');
    }
    if (!methods.has(SalesPaymentMethod.CASH)) {
      throw new BadRequestException('Cash must be configured for every Mobile POS Lite terminal');
    }
    const accounts = await this.prisma.cashAccount.findMany({
      where: {
        id: { in: paymentInputs.map((payment) => payment.cashAccountId) },
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, companyId: true, divisionId: true, branchId: true, accountType: true },
    });
    if (accounts.length !== paymentInputs.length) {
      throw new BadRequestException(
        'One or more configured receipt accounts are inactive or missing',
      );
    }
    const accountsById = new Map(accounts.map((account) => [account.id, account]));

    return paymentInputs.map((payment) => {
      const account = accountsById.get(payment.cashAccountId)!;
      if (account.companyId !== companyId) {
        throw new BadRequestException('Receipt account does not belong to the selected company');
      }
      const expectedTypes = this.accountTypesFor(payment.paymentMethod);
      if (!expectedTypes.includes(account.accountType)) {
        throw new BadRequestException('Receipt account type does not match its payment method');
      }
      if (account.accountType === CashAccountType.BANK) {
        if (
          (account.divisionId && account.divisionId !== divisionId) ||
          (account.branchId && account.branchId !== branchId)
        ) {
          throw new BadRequestException(
            'Bank account does not belong to the selected terminal scope',
          );
        }
      } else if (account.divisionId !== divisionId || account.branchId !== branchId) {
        throw new BadRequestException(
          'Cash or mobile-money account must belong to the selected division and branch',
        );
      }
      return payment;
    });
  }

  private accountTypesFor(
    paymentMethod: (typeof MOBILE_POS_LITE_RECEIPT_METHODS)[number],
  ): CashAccountType[] {
    switch (paymentMethod) {
      case SalesPaymentMethod.CASH:
        return [CashAccountType.CASH_ON_HAND, CashAccountType.PETTY_CASH];
      case SalesPaymentMethod.MOBILE_MONEY:
        return [CashAccountType.MOBILE_MONEY];
      case SalesPaymentMethod.BANK_TRANSFER:
        return [CashAccountType.BANK];
      default:
        return [];
    }
  }

  private activationPayload(terminalCode: string, activationCode: string, expiresAt: Date) {
    return {
      terminalCode,
      activationCode,
      expiresAt: expiresAt.toISOString(),
      activationPath: `/mobile-pos/activate?terminal=${encodeURIComponent(terminalCode)}&code=${encodeURIComponent(activationCode)}`,
    };
  }

  private sessionPayload(terminal: Terminal, user: AuthUser) {
    return {
      terminal: {
        id: terminal.id,
        code: terminal.terminalCode,
        name: terminal.name,
        configVersion: terminal.configVersion,
        offlineCashEnabled: terminal.offlineCashEnabled,
        uiVersion: terminal.uiVersion,
      },
      // Stock-in purchases are gated on the rep's own permission set, not on
      // terminal configuration: managers holding mobile_pos_lite.purchase see
      // the purchase flow, ordinary cashiers/salespeople do not.
      purchasesEnabled: user.permissions?.includes('mobile_pos_lite.purchase') ?? false,
      // Same shape for stock counts (spec-inventory §1.3): permission-derived,
      // so no configVersion bump. Phase 4 uses it only as a presentation gate
      // (manager view on Stoo); the Hesabu flow itself ships in Phase 5.
      stockCountsEnabled: user.permissions?.includes('mobile_pos_lite.stock_count') ?? false,
      company: terminal.company,
      division: terminal.division,
      branch: terminal.branch,
      rep: { id: terminal.assignedUser.id, name: terminal.assignedUser.fullName },
      paymentMethods: [
        ...terminal.paymentMethods
          .filter((payment) => payment.isEnabled && payment.cashAccount.isActive)
          .map((payment) => ({
            code: payment.paymentMethod,
            label: paymentLabel(payment.paymentMethod, payment.label),
            requiresReference: payment.paymentMethod !== SalesPaymentMethod.CASH,
          })),
        ...(terminal.creditEnabled
          ? [{ code: SalesPaymentMethod.CREDIT, label: 'Credit', requiresReference: false }]
          : []),
      ],
      generalCustomer: { name: terminal.generalCustomer.name },
    };
  }

  private serializeTerminal(terminal: Terminal) {
    return {
      id: terminal.id,
      code: terminal.terminalCode,
      name: terminal.name,
      status: terminal.status,
      configVersion: terminal.configVersion,
      creditEnabled: terminal.creditEnabled,
      offlineCashEnabled: terminal.offlineCashEnabled,
      uiVersion: terminal.uiVersion,
      deviceName: terminal.deviceName,
      activatedAt: terminal.activatedAt,
      lastSeenAt: terminal.lastSeenAt,
      company: terminal.company,
      division: terminal.division,
      branch: terminal.branch,
      assignedUser: { id: terminal.assignedUser.id, name: terminal.assignedUser.fullName },
      salesperson: terminal.salesperson,
      generalCustomer: terminal.generalCustomer,
      paymentMethods: terminal.paymentMethods.map((payment) => ({
        paymentMethod: payment.paymentMethod,
        label: paymentLabel(payment.paymentMethod, payment.label),
        isEnabled: payment.isEnabled,
        cashAccount: payment.cashAccount,
      })),
      createdAt: terminal.createdAt,
      updatedAt: terminal.updatedAt,
    };
  }
}
