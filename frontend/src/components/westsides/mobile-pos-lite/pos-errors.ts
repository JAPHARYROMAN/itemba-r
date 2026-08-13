import type { PosStringKey } from './pos-i18n';
import type { PosTranslate } from './pos-types';

/**
 * Best-effort map from backend rejection free-text to plain-Swahili keys for
 * the rejected-sale ritual (spec-sales §5.3/§6) and the rejected-count ritual
 * (spec-inventory §3). The backend emits English prose, not error codes, so
 * this is pattern matching by design — real error codes are an audit-track
 * ask, not a blocker.
 *
 * TRIPWIRE — these patterns are coupled to the exact backend copy below, and
 * every sentence here is replayed verbatim by pos-errors.test.ts. If backend
 * wording changes, that case fails: re-verify the row against the throw site
 * instead of loosening the case, because a row that stops matching does not
 * break anything loudly — it just degrades to the generic fallback in the
 * field. Sources re-verified 2026-08-13 (round 5: every row re-read at its
 * throw site once more against the wrapper as it now stands. Two moves this
 * round — the capture-age bound grew a throw on BOTH sides of the freeze and
 * both got rows, and `errCountClosed` was DELETED with the sentence it
 * certified: `assertStockCountNotRetired` went in round 4, and the route it
 * belonged to has never been deployed, so no server that can answer this phone
 * emits it. Rows are named by enclosing function rather than line number,
 * since the wrapper is still moving.
 *
 * - backend/src/modules/inventory-movements/inventory-movements.service.ts
 *   · applyBalanceDelta (SALE_ISSUE guards)
 *     "Insufficient stock at branch/location …: requested …, available …"
 *     "Insufficient available stock at branch/location …: requested …,
 *      available … after reservations"
 * - backend/src/modules/mobile-pos-lite/mobile-pos-lite.service.ts
 *   · resolveSaleLines / resolvePurchaseLines
 *     "One or more products are unavailable for this terminal"
 *     "<name> does not have a selling price"
 *     "<name> is not a stock item and cannot be received here"
 *     "<name> does not have a purchase cost — enter the unit cost"
 *     "Provide a single unit cost per product"
 *   · createPurchase supplier scope check
 *     "The selected supplier is not available for this terminal branch"
 *   · requireTerminal / assertAssignedUserCanSell
 *     "Activate this Mobile POS device before selling"
 *     "This Mobile POS terminal is not active"
 *     "This device is not registered for the selected Mobile POS terminal"
 *     "This Mobile POS terminal is assigned to a different sales rep"
 *     "The assigned Mobile POS user is not active"
 *   · createSale credit guards
 *     "Credit is not enabled on this Mobile POS terminal"
 *     "Select the customer before completing a credit sale"
 *     "The selected customer is not available for this terminal branch"
 *   · resolveStockCountLines (the stock-count wrapper, spec-inventory §1.2 step 3)
 *     "Product <id> was counted more than once in this stock count"
 *     "Product <id> is not available for this terminal"
 *     "<name> (<id>) is not a stock item and cannot be counted"
 *   · assertCountUpsCanBeValued (the count-up cost precondition)
 *     "<name> (<id>) has no buying price on record and cannot be counted up
 *      — the office must set one first"
 *   · createPurchase twin-detect — THE DEPLOYED BUILD ONLY, and that is why the
 *     row survives the same audit that deleted errCountClosed. The working tree
 *     replaced both twin checks with a unique-index claim this round (the loser
 *     of a create race now resumes the winner's chain instead of being refused),
 *     so neither sentence is thrown here any more — but HEAD (df231739) IS
 *     production, its `@Post('purchases')` route is live, and it still throws
 *     the purchase one. A phone running today's app against today's server can
 *     read it, so the row stays until that build is gone. The count twin of it
 *     is answered by the same regex and cost nothing to keep.
 *     "This purchase is being recorded by another request. Retry in a moment."
 *       (git show HEAD:…/mobile-pos-lite.service.ts, createPurchase)
 *     "This stock count is being recorded by another request. Retry in a moment."
 *       (no throw site in either build — the route has never been deployed)
 *   · assertPurchaseMatchesRecordedOrder (the marker-matched order disagrees
 *     with the body the manager just typed)
 *     "The earlier slip for this delivery was already received — check with the
 *      office before recording it again."
 *   · assertCountMatchesRecordedAdjustment (the same guard on the count side,
 *     added in round 4: a marker hit whose recorded numbers are not the ones
 *     just sent is neither replayed nor re-created)
 *     "This count was already sent with different numbers — check with the
 *      office before sending it again."
 *   · assertCaptureStillCountable / resumeStockCountChain (the capture's life,
 *     STOCK_COUNT_MAX_CAPTURE_AGE_HOURS, one condition on both sides of the
 *     freeze — added round 5, and the two endings are NOT interchangeable: the
 *     resume side has a recorded row the office can post, the create side has
 *     nothing at all)
 *     "This count was captured more than <n> hours ago and can no longer be
 *      sent from the phone — count the shelf again."
 *     "This count was captured more than <n> hours ago and can no longer be
 *      sent from the phone — count the shelf again, or ask the office to post
 *      this one."
 * - backend/src/modules/mobile-pos-lite/dto/mobile-pos-lite-stock-count.dto.ts
 *   · the ValidationPipe, before the service is ever reached
 *     "A stock count can carry at most 500 products — send the rest as a
 *      second count."   (@ArrayMaxSize's own message; the cap is
 *      MOBILE_POS_LITE_STOCK_COUNT_MAX_LINES)
 * - backend/src/modules/sales-orders/sales-orders.service.ts
 *   · assertCustomerCreditAvailable / resolveSalesOrderCustomer
 *     "Credit sale exceeds <name>'s credit limit. Limit: …, projected balance: …"
 *     "Blocked customers cannot be used for credit sales"
 *     "Blocked customers cannot be used on sales orders"
 *
 * DELIBERATELY UNMAPPED — every one of these is a dead end ON PURPOSE: the
 * phone cannot act on it, so "mwite msimamizi" is the honest answer and a
 * cheerier key would be a lie. That is now a promise the code keeps rather than
 * a comment: ALL THREE Kaunta send surfaces route an unmapped REFUSAL through
 * `errorFallback` (the count card, `posPurchaseFailureMessage` for Pokea, and
 * `posSaleFailureMessage` for Malipo), so these reach the shelf as Swahili.
 * Until round 4 the purchase half printed them in English, and until round 5 so
 * did the live sale — the highest-volume surface of the three — so the comment
 * described behaviour the code did not have. Do not add rows for them without a
 * recovery a manager can actually perform at the shelf.
 *     "The original stock count behind this idempotency key was rejected"
 *     "The original purchase behind this idempotency key was cancelled"
 *     "The stock count behind this request is no longer postable"
 *     "The goods received note behind this purchase is no longer postable"
 *       — all four: the chain this key is anchored to ended somewhere the POS
 *         cannot reopen; the frozen key can only ever resume that same chain,
 *         so retrying is not a recovery and the office has to unblock it.
 *     "This payment method is not enabled on this Mobile POS terminal"
 *       — terminal config; nobody on the phone can change it.
 *     "Stock add for <name> must include a unit cost greater than zero"
 *       — StockAdjustmentsService.post(); assertCountUpsCanBeValued answers the
 *         same condition first, with a row (errNoBuyingPrice) and a named line.
 *         If this one ever surfaces it means the two disagreed, which is an
 *         office problem, not a shelf one.
 *     "This stock count was already refused and closed — send a new count
 *      instead of retrying this one."
 *       — round 3's assertStockCountNotRetired. NOT a dead end: a DEAD SENTENCE.
 *         The method was deleted with the retirement it guarded in round 4, and
 *         the route has never been deployed (HEAD's controller has no
 *         `stock-counts` POST), so no server that has ever answered this phone
 *         can emit it. Round 4 kept a row against a rolling deploy; there is no
 *         deploy to roll. The row and its two catalog entries went in round 5,
 *         and pos-errors.test.ts pins the sentence at `errorFallback` so a
 *         build that revives it is a visible change here, not a silent one.
 *
 * NOTHING IS PARKED HERE ANY MORE, AND NO ENGLISH LEAVES THIS FILE. Until
 * round 3 the three Manunuzi rejections above sat in a "not mapped, but only
 * because nothing renders it yet" note, whose precondition was that
 * `recordPurchase` printed `error.message` raw; round 3 gave them rows but left
 * the passthrough standing, so everything WITHOUT a row — a proxy's
 * "Request failed: 502", the two purchase chain conflicts — still reached a
 * Swahili-speaking manager as English at a lorry. Round 4 closed it at the
 * source: `posPurchaseFailureMessage` classifies once, in `recordPurchase`, and
 * the screen prints what it is handed. So the two halves of a rejection are now
 * one decision made here — a sentence either has a row, or it is a refusal that
 * lands on `errorFallback`, or nothing refused it at all and the copy says so.
 * If a rejection is renderable and has a recovery, it gets a row in the same
 * change that makes it renderable — the note is not a place to leave copy.
 */

/**
 * The count-up cost rejection names the product BEFORE the id, and the Swahili
 * it maps to repeats that name, so the pattern captures it: the manager is
 * standing at a shelf holding 40 counted lines and has to learn which single
 * one to drop. Reading the name back out of the same regex that matched is
 * what makes a half-filled sentence impossible — reword the backend copy and
 * the row stops matching (loudly, in the tripwire suite) rather than
 * interpolating an empty name.
 */
const NO_BUYING_PRICE = /^(.+) \([^)]*\) has no buying price on record and cannot be counted up/i;

/**
 * The count DTO's own @ArrayMaxSize message, raised by the ValidationPipe
 * before the service is reached and joined into one string by api-client's
 * messageFromPayload. The cap (MOBILE_POS_LITE_STOCK_COUNT_MAX_LINES) travels
 * inside the sentence, so the Swahili quotes the server's number instead of
 * hard-coding a constant that can drift out of sync with it. class-validator's
 * default copy ("lines must contain no more than N elements") is deliberately
 * NOT matched: the DTO overrides it, and a row for a string the backend no
 * longer emits is exactly the dead weight this table keeps out.
 */
const COUNT_TOO_LONG = /a stock count can carry at most (\d+) products/i;

/**
 * The purchase-side cost rejection, named the same way and for the same reason
 * as NO_BUYING_PRICE above: `resolvePurchaseLines` refuses the WHOLE delivery
 * over one line that has neither a typed cost nor a product/family default, and
 * the manager is standing at a lorry with a dozen lines on screen. Unlike the
 * count's version she can fix this one herself — the buying-price box is right
 * there on that row — so the copy has to say which row. The name comes back out
 * of the same regex that matched, so a reworded backend sentence stops the row
 * loudly in the tripwire suite instead of rendering "{name}" at the shelf.
 */
const NO_PURCHASE_COST = /^(.+) does not have a purchase cost/i;

/**
 * The capture's life (STOCK_COUNT_MAX_CAPTURE_AGE_HOURS), thrown on both sides
 * of the freeze in the same words up to the recovery clause. The window travels
 * inside the sentence exactly as COUNT_TOO_LONG's cap does, so the Swahili
 * quotes the server's own number and a re-tuned constant needs no frontend
 * change.
 *
 * TWO rows, not one, and the order in the table is load-bearing: the RESUME
 * side ends "…, or ask the office to post this one" because a row exists for
 * the office to look at, and the CREATE side is refused before anything is
 * recorded, where naming the office would send her to a desk holding nothing.
 * The shared prefix means the office variant has to be tested FIRST.
 */
const COUNT_TOO_OLD = /count was captured more than (\d+) hours ago/i;
const COUNT_TOO_OLD_RECORDED =
  /count was captured more than \d+ hours ago.*ask the office to post this one/i;

type PosErrorRow = {
  pattern: RegExp;
  key: PosStringKey;
  /**
   * Placeholder values for the key's copy, read back out of the SAME pattern
   * that matched the row. Rows without placeholders omit this.
   */
  vars?: (raw: string) => Record<string, string | number>;
};

const ERROR_PATTERNS: ReadonlyArray<PosErrorRow> = [
  // Insufficient stock (inventory-movements issue path)
  { pattern: /insufficient (available )?stock/i, key: 'errInsufficientStock' },
  // Product inactive / unpriced / not visible to this terminal
  {
    pattern: /products? (is|are) unavailable for this terminal|does not have a selling price/i,
    key: 'errProductUnavailable',
  },
  // Terminal suspended / device unbound / rep mismatch (requireTerminal chain)
  {
    pattern:
      /terminal is not active|device is not registered|assigned to a different sales rep|mobile pos user is not active|activate this mobile pos device/i,
    key: 'terminalUnavailable',
  },
  // Credit limit breached
  { pattern: /credit limit/i, key: 'errCreditLimit' },
  // Credit customer invalid / blocked / credit disabled on the terminal. This
  // row MUST stay above the stock-count product row below: the customer
  // rejection ends "…customer is not available for this terminal branch",
  // one word away from the count's "Product <id> is not available for this
  // terminal", and whichever row is reached first wins.
  {
    pattern:
      /blocked customers|customer is not available for this terminal|select the customer before|credit is not enabled/i,
    key: 'errCustomerInvalid',
  },
  // Purchase: the supplier on the slip is not this branch's to buy from —
  // deactivated, or moved to another division/branch, between the catalog sync
  // and POKEA ("The selected supplier is not available for this terminal
  // branch", createPurchase's scope check, which now runs only when the marker
  // missed). spec-purchases §7 budgets this exact key and §8 case 3 names the
  // recovery: the lines and their typed costs are fine, the chip is what has to
  // change, so the copy sends her back to the supplier slot and nowhere else.
  // The word "supplier" is what keeps this row and the two "…is not available
  // for this terminal…" rows below out of each other's way.
  { pattern: /supplier is not available/i, key: 'supplierNotAvailable' },
  // Stock count: a counted product that inventory does not track —
  // "<name> (<id>) is not a stock item and cannot be counted". The purchase
  // path's "<name> is not a stock item and cannot be received here" lands here
  // too, and means the same thing to the manager.
  { pattern: /is not a stock item/i, key: 'errNotStockItem' },
  // Stock count: a counted product outside this terminal's scope — deactivated
  // between capture and submit, or moved to another division —
  // "Product <id> is not available for this terminal". The leading "product" is
  // load-bearing, not decoration: the customer and supplier rejections end in
  // the same seven words, so a pattern matching the tail alone would answer a
  // supplier problem with product copy. Both of those now have rows of their
  // own ABOVE this one, which is a second guard, not a replacement — keep the
  // \bproduct\b anchor.
  {
    pattern: /\bproduct\b.*\bis not available for this terminal\b/i,
    key: 'errProductNotInBranch',
  },
  // Stock count: the same productId twice in one body — "Product <id> was
  // counted more than once in this stock count". Counts do not sum: two lines
  // for one product are contradictory counts of one shelf.
  { pattern: /counted more than once/i, key: 'errDuplicateLine' },
  // Stock count: a count-UP on a product nothing has ever priced, refused by
  // assertCountUpsCanBeValued before anything is created. The whole sheet is
  // rejected over one line, and the phone cannot supply a buying price, so the
  // copy has to name that line and send her to the office — the fallback
  // ("mwite msimamizi") left the §7-case-5 recovery undiscoverable unless she
  // expanded the technical details and read English.
  {
    pattern: NO_BUYING_PRICE,
    key: 'errNoBuyingPrice',
    vars: (raw) => ({ name: NO_BUYING_PRICE.exec(raw)?.[1]?.trim() ?? '' }),
  },
  // Stock count: more lines than the DTO accepts. This one never reaches the
  // service — the ValidationPipe answers in class-validator's English, which no
  // row matched when the row was written, so an over-long closing count was
  // permanently unsendable behind "mwite msimamizi" with every retry producing
  // the identical rejection.
  //
  // That precondition is gone: the phone now carries the SAME ceiling
  // (COUNT_MAX_LINES, use-pos-count.ts) and warns before it, so today's client
  // cannot build a body this refuses. The row is therefore a backstop, not the
  // only warning — it answers a sheet written by another build, a drifted
  // constant, or a server cap lowered below the phone's — and it still quotes
  // the server's own number rather than the client's, so those are exactly the
  // cases it stays right for.
  {
    pattern: COUNT_TOO_LONG,
    key: 'errCountTooLong',
    vars: (raw) => ({ count: COUNT_TOO_LONG.exec(raw)?.[1] ?? '' }),
  },
  // Purchase: a received line nothing has ever priced — no typed cost, no
  // product default, no family default — which rejects the whole delivery
  // ("<name> does not have a purchase cost — enter the unit cost"). This is the
  // count's errNoBuyingPrice with the opposite ending: at a delivery the
  // manager IS the pricing authority, the buying-price box sits on the very row
  // named, and the office is not involved. Naming the row is the whole value:
  // "mwite msimamizi" over a twelve-line lorry says nothing about which line.
  {
    pattern: NO_PURCHASE_COST,
    key: 'errNoPurchaseCost',
    vars: (raw) => ({ name: NO_PURCHASE_COST.exec(raw)?.[1]?.trim() ?? '' }),
  },
  // Purchase: two lines for one product carrying two different costs
  // ("Provide a single unit cost per product"). The Pokea form merges a
  // re-added product into the existing line, so today's client cannot build
  // that body — but the row is not speculative copy: the sentence is live
  // backend prose, certified verbatim like every other row, and the recovery
  // ("one price per product") is one the manager performs at the shelf. A
  // restored slip written by another build, or the first form that lets one
  // product arrive on two rows, would otherwise land as English.
  { pattern: /provide a single unit cost per product/i, key: 'errOneCostPerProduct' },
  // Stock count: the capture is older than the server's window, so the sheet in
  // her hand can never post — the ONE permanent per-key refusal a deployable
  // build produces, and the only refusal in this table whose recovery the
  // manager performs where she is standing. It carries the `recount`
  // classification (use-pos-count) so the rejection card offers ANZA HESABU
  // MPYA: retrying is refused forever (neither the row's createdAt nor the
  // draft's capture stamp gets younger), and an edit rides the same frozen key
  // into the same 409.
  //
  // The office variant is FIRST because both sentences share their opening
  // clause; only the resume side has a recorded row for the office to post, so
  // only its copy may mention the office. Both quote the server's window.
  {
    pattern: COUNT_TOO_OLD_RECORDED,
    key: 'errCountTooOldRecorded',
    vars: (raw) => ({ hours: COUNT_TOO_OLD.exec(raw)?.[1] ?? '' }),
  },
  {
    pattern: COUNT_TOO_OLD,
    key: 'errCountTooOld',
    vars: (raw) => ({ hours: COUNT_TOO_OLD.exec(raw)?.[1] ?? '' }),
  },
  // Stock count: the marker-matched adjustment disagrees with the body just
  // sent — the count's half of the slip conflict below, and new this round.
  // A frozen key resent after a lost response must replay the SAME numbers;
  // when the manager corrected a line first, replaying would post her original
  // figures under a success seal and throw the correction away. Neither
  // replaying nor creating a second adjustment is right, so the server refuses
  // and the copy points where both documents are visible: the office.
  {
    pattern: /count was already sent with different numbers/i,
    key: 'errCountAlreadySent',
  },
  // Purchase: the marker-matched order disagrees with the body just typed —
  // the lost-response-then-edited-slip case. The delivery WAS received once, so
  // this is the one place "already received" is the truth and not the lie the
  // deleted errAlreadySent row used to tell; neither replaying nor creating is
  // right, so the copy points at the office, which can see both documents.
  { pattern: /slip for this delivery was already received/i, key: 'errSlipAlreadyReceived' },
  // The twin-detect conflict ("This stock count/purchase is being recorded by
  // another request. Retry in a moment."). Unlike the four chain conflicts in
  // the unmapped list, this one IS recoverable from the phone and says so
  // itself — the copy must repeat that instruction without ever implying the
  // send landed, which is what an "already sent" key would have done.
  //
  // NO THROW SITE IN THIS TREE as of round 5: both create races are now settled
  // by a unique index, and the loser resumes the winner's chain rather than
  // being refused. The row is kept anyway, and the test that decided it is the
  // one that condemned errCountClosed: `git show HEAD:…mobile-pos-lite.service
  // .ts` still throws the PURCHASE sentence, HEAD is production, and its
  // purchases route is deployed and in use. A row is dead when no build that
  // can answer this phone emits its sentence — not when the working tree stops
  // emitting it. Delete this one the day that build is gone.
  { pattern: /is being recorded by another request/i, key: 'errStillSending' },
  // NO `errAlreadySent` ROW. A /idempoten|duplicate/ row sat here for replayed
  // sends, but the sale path replays SILENTLY (sales-orders createAndConfirm
  // returns the original order rather than throwing), so the only live copy it
  // ever caught was the chain conflicts listed as unmapped above — and
  // "Mauzo haya yameshatumwa" tells a manager whose count was rejected
  // upstream that it went through. The two catalog entries were deleted with
  // the row (round 2): posErrorKey is the only producer of these keys, so a
  // key with no row is a string no code path can ever show. Re-add a row only
  // against copy verified at a throw site — and re-add the catalog entries
  // with it.
];

function matchRow(raw: string): PosErrorRow | undefined {
  return ERROR_PATTERNS.find(({ pattern }) => pattern.test(raw));
}

/** The i18n key a raw backend rejection maps to (exported for tests). */
export function posErrorKey(raw: string): PosStringKey {
  return matchRow(raw)?.key ?? 'errorFallback';
}

/**
 * Every key the map can produce, in row order (exported for the tripwire
 * suite, which fails if a row is added without a verbatim backend string to
 * certify it).
 */
export const POS_ERROR_MAPPED_KEYS: ReadonlyArray<PosStringKey> = ERROR_PATTERNS.map(
  ({ key }) => key,
);

/**
 * Plain-Swahili (or English, per the active language) message for a raw
 * backend rejection string. Unknown copy falls back to
 * `errorFallback` ("Haikukubaliwa — mwite msimamizi").
 */
export function posErrorMessage(raw: string, t: PosTranslate): string {
  const match = matchRow(raw);
  if (!match) return t('errorFallback');
  return t(match.key, match.vars?.(raw));
}

/**
 * The HTTP status of a REFUSAL, or `null` when nothing refused the attempt.
 * Only a refusal is evidence:
 * - a shape with no numeric `status` (a fetch-layer TypeError, a string, an
 *   AbortError) never reached a server verdict at all;
 * - 5xx, including a proxy's 502/504, says only that something in the middle
 *   gave up — possibly over a request that committed;
 * - 408/429 are the server asking for the SAME request again, which is the
 *   opposite of a refusal.
 *
 * The status is read off the error rather than through `instanceof ApiError`
 * on purpose. api-client's ApiError is the only thing that ever carries one
 * (`throw new ApiError(message, res.status, json)`), so the two agree in the
 * field — but this module is the leaf of the folder: five test suites double
 * `@/lib/api-client` down to `{ backendGet, backendPost }`, and an `instanceof`
 * against an undefined binding throws from inside a catch block, turning a
 * handled rejection into a crash on a screen that was about to explain itself.
 * A property read cannot do that, and the property IS the contract.
 */
export function posRefusalStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof status !== 'number') return null;
  if (status < 400 || status >= 500) return null;
  if (status === 408 || status === 429) return null;
  return status;
}

/**
 * The sentence a failed POKEA puts on the Pokea screen. This is the whole of
 * the purchase rejection surface: `recordPurchase` classifies here, once, and
 * the screen prints what it is handed — so no backend English can reach a
 * manager standing at a lorry, whatever the wrapper grows next.
 *
 * Two questions in one expression, and the order is the point:
 * 1. Did the server say something this map RECOGNISES? Then say it in her
 *    language, whatever carried it. A recognised sentence can only have come
 *    from the server, so demoting it to "the network dropped" would state a
 *    cause that is known to be false.
 * 2. Otherwise — did anything refuse the attempt at all (`posRefusalStatus`)?
 *    If not, nothing is known to be wrong with this delivery and the copy must
 *    not read as a verdict on it: `purchaseSendFailedRetry` says what IS known
 *    (the form is still here, the retry is safe under the frozen key) instead
 *    of "Request failed: 502" in a red danger box.
 * 3. A refusal with no row is a real dead end — the chain conflicts this file
 *    lists as deliberately unmapped — and `errorFallback` names the only move
 *    that is left: mwite msimamizi.
 *
 * This is deliberately the same expression the count's rejection card evaluates
 * (`refusal === 'unproven' && mapped === 'errorFallback' ? countSendFailedRetry
 * : posErrorMessage(...)`), because it is the same question. The count keeps
 * its own copy of the wording and the extra control it can offer; what must not
 * differ between the two surfaces is which failures are treated as proven.
 */
export function posPurchaseFailureMessage(error: unknown, t: PosTranslate): string {
  const raw = error instanceof Error ? error.message : '';
  return posErrorKey(raw) === 'errorFallback' && posRefusalStatus(error) === null
    ? t('purchaseSendFailedRetry')
    : posErrorMessage(raw, t);
}

/**
 * The sentence a failed KAMILISHA MAUZO puts on Malipo (Kaunta only). Same two
 * questions in the same order as the purchase and the count — a recognised
 * sentence is said in her language whatever carried it; anything unrecognised
 * turns on whether the server actually refused — with ONE difference that is
 * not cosmetic.
 *
 * THE SALE HAS NO FROZEN KEY. `completeSale` mints a fresh `idempotencyKey`
 * inside the payload it builds, per attempt, so an unproven failure is the one
 * place in this module where "jaribu tena" is a false instruction: if the lost
 * response was hiding a sale that committed, the second tap books it twice.
 * That is why the unproven branch reads `saleSendFailedUnknown` (the outcome is
 * unknown, do not send again, get a supervisor to check) rather than the
 * purchase's `purchaseSendFailedRetry`, whose whole premise is a key that makes
 * the identical retry safe. A queue-eligible offline CASH sale never reaches
 * here at all — it is in custody, and `completeSale` stamps it.
 *
 * This is the surface the map was written for first (see the header) and the
 * last one to get a consumer: until round 5 the catch wrote `error.message`
 * straight into the notice cell, and PaymentScreen prints that cell verbatim in
 * a red danger box — so a rep whose credit sale was refused read
 * "Credit sale exceeds Asha Duka's credit limit…" while the identical sentence
 * arriving through the outbox was mapped two screens away.
 */
export function posSaleFailureMessage(error: unknown, t: PosTranslate): string {
  const raw = error instanceof Error ? error.message : '';
  return posErrorKey(raw) === 'errorFallback' && posRefusalStatus(error) === null
    ? t('saleSendFailedUnknown')
    : posErrorMessage(raw, t);
}
