/**
 * posErrorMessage — the rejected-send ritual's plain-Swahili map.
 *
 * TRIPWIRE SUITE: every `raw` string below is copied VERBATIM from its throw
 * site, with only ids, names and numbers filled in with realistic values.
 * Sources (the throw sites are also listed, by enclosing function, in the
 * pos-errors.ts header):
 * - backend/src/modules/inventory-movements/inventory-movements.service.ts
 * - backend/src/modules/mobile-pos-lite/mobile-pos-lite.service.ts
 * - backend/src/modules/mobile-pos-lite/dto/mobile-pos-lite-stock-count.dto.ts
 *   (class-validator's own copy, raised by the ValidationPipe and joined into
 *   one string by api-client's messageFromPayload)
 * - backend/src/modules/sales-orders/sales-orders.service.ts
 *
 * WHEN A CASE FAILS, the backend copy was reworded. Do NOT relax the
 * assertion and do NOT delete the case: open the throw site, paste the new
 * sentence in here, and widen the matching row in pos-errors.ts. A reworded
 * message breaks nothing loudly — it just drops that rejection to
 * "Haikukubaliwa — mwite msimamizi" in the field, which is exactly how the
 * stock-count rows shipped dead once already.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  POS_ERROR_MAPPED_KEYS,
  posDayReportFailureMessage,
  posErrorKey,
  posErrorMessage,
  posPurchaseFailureMessage,
  posRefusalStatus,
  posSaleFailureMessage,
} from './pos-errors';
import type { PosStringKey } from './pos-i18n';
import type { PosTranslate } from './pos-types';

const t: PosTranslate = (key) => `<${key}>`;

/**
 * What `backendPost` really throws for a non-2xx — the genuine class, not a
 * hand-rolled double: `new ApiError(messageFromPayload(...), res.status, json)`.
 * The classification below is a claim about what the app can actually produce,
 * so it is certified against the thing that produces it.
 */
function apiError(message: string, status: number) {
  return new ApiError(message, status, { message });
}

/**
 * The rows whose copy interpolates ({name}, {count}) hand `t` a vars object,
 * exactly as usePosLang's t consumes it. This stub records what was handed
 * over, so a row that matches but forgets its vars — which in the field renders
 * a literal "{name}" at the shelf — fails here instead of shipping.
 */
const tVars: PosTranslate = (key, vars) => `${key}|${JSON.stringify(vars ?? null)}`;

/** A real-shaped productId — the wrapper interpolates the raw uuid. */
const PRODUCT_ID = '7f1c8f5a-3c2e-4a1f-9b6d-5e0a7c8d9f10';

const CASES: Array<[raw: string, key: PosStringKey]> = [
  // inventory-movements.service.ts (SALE_ISSUE guards)
  ['Insufficient stock at branch/location b-123: requested 5, available 2', 'errInsufficientStock'],
  [
    'Insufficient available stock at branch/location b-123: requested 5, available 1 after reservations',
    'errInsufficientStock',
  ],
  // mobile-pos-lite.service.ts resolveSaleLines
  ['One or more products are unavailable for this terminal', 'errProductUnavailable'],
  ['Soda Baridi does not have a selling price', 'errProductUnavailable'],
  // mobile-pos-lite.service.ts requireTerminal / assertAssignedUserCanSell
  ['Activate this Mobile POS device before selling', 'terminalUnavailable'],
  ['This Mobile POS terminal is not active', 'terminalUnavailable'],
  ['This device is not registered for the selected Mobile POS terminal', 'terminalUnavailable'],
  ['This Mobile POS terminal is assigned to a different sales rep', 'terminalUnavailable'],
  ['The assigned Mobile POS user is not active', 'terminalUnavailable'],
  // sales-orders.service.ts assertCustomerCreditAvailable. The tail is
  // "projected balance", not the invented "current balance …, this sale …"
  // that stood here through round 1 — the row matches on "credit limit", but a
  // fixture nobody can find at a throw site is how a dead row hides.
  [
    "Credit sale exceeds Asha Duka's credit limit. Limit: 100000.00, projected balance: 115000.00",
    'errCreditLimit',
  ],
  ['Blocked customers cannot be used for credit sales', 'errCustomerInvalid'],
  // sales-orders.service.ts resolveSalesOrderCustomer — reached by ANY attached
  // customer on the POS sale path (create -> createAndConfirm), not just credit.
  ['Blocked customers cannot be used on sales orders', 'errCustomerInvalid'],
  // mobile-pos-lite.service.ts createSale credit guards
  ['Credit is not enabled on this Mobile POS terminal', 'errCustomerInvalid'],
  ['Select the customer before completing a credit sale', 'errCustomerInvalid'],
  ['The selected customer is not available for this terminal branch', 'errCustomerInvalid'],
  // mobile-pos-lite.service.ts resolveStockCountLines — the stock-count
  // wrapper's three 400s (spec-inventory §1.2 step 3). These are the whole
  // reason the count rejection card can say anything more useful than "call a
  // supervisor", so they are copy-verified, not shape-guessed.
  [`Sukari Nyeupe (${PRODUCT_ID}) is not a stock item and cannot be counted`, 'errNotStockItem'],
  [`Product ${PRODUCT_ID} is not available for this terminal`, 'errProductNotInBranch'],
  [`Product ${PRODUCT_ID} was counted more than once in this stock count`, 'errDuplicateLine'],
  // mobile-pos-lite.service.ts assertCountUpsCanBeValued — the fourth count
  // rejection, mapped in round 2 (see the dedicated case below for the name).
  [
    `Sukari Nyeupe (${PRODUCT_ID}) has no buying price on record and cannot be counted up — the office must set one first`,
    'errNoBuyingPrice',
  ],
  // dto/mobile-pos-lite-stock-count.dto.ts — the @ArrayMaxSize message, raised
  // by the ValidationPipe before the service is reached. The number is
  // MOBILE_POS_LITE_STOCK_COUNT_MAX_LINES, not a literal in this file.
  [
    'A stock count can carry at most 500 products — send the rest as a second count.',
    'errCountTooLong',
  ],
  // createPurchase twin-detect, read at its throw site in the DEPLOYED build:
  // `git show HEAD:backend/src/modules/mobile-pos-lite/mobile-pos-lite.service
  // .ts`. Round 5's tree replaced both create races with a unique-index claim,
  // so this sentence is no longer in the working copy — but HEAD is production
  // and its purchases route is live, so a phone can still be answered with it.
  // That is the whole difference between this row and errCountClosed, whose
  // route has never been deployed at all. The count variant below has no throw
  // site in either build; it shares this row's regex and is asserted with it.
  ['This purchase is being recorded by another request. Retry in a moment.', 'errStillSending'],
  ['This stock count is being recorded by another request. Retry in a moment.', 'errStillSending'],
  // mobile-pos-lite.service.ts — the capture's life, BOTH sides of the freeze
  // (STOCK_COUNT_MAX_CAPTURE_AGE_HOURS). The hours travel inside the sentence,
  // so the Swahili quotes the server's own number the way errCountTooLong does.
  // These two are one condition with two different recoveries, and the copy
  // must not swap them: on the resume side a row EXISTS and the office can post
  // it, on the create side nothing was ever recorded and saying otherwise would
  // send her to an office that has nothing to look at.
  //
  //   · assertCaptureStillCountable (create side, before anything exists)
  [
    'This count was captured more than 6 hours ago and can no longer be sent from the phone — count the shelf again.',
    'errCountTooOld',
  ],
  //   · resumeStockCountChain (resume side, the row is alive and left alive)
  [
    'This count was captured more than 6 hours ago and can no longer be sent from the phone — count the shelf again, or ask the office to post this one.',
    'errCountTooOldRecorded',
  ],
  // mobile-pos-lite.service.ts assertPurchaseMatchesRecordedOrder.
  [
    'The earlier slip for this delivery was already received — check with the office before recording it again.',
    'errSlipAlreadyReceived',
  ],
  // mobile-pos-lite.service.ts assertCountMatchesRecordedAdjustment — the same
  // guard on the count side, added in round 4 with the content marker.
  [
    'This count was already sent with different numbers — check with the office before sending it again.',
    'errCountAlreadySent',
  ],
  // mobile-pos-lite.service.ts resolvePurchaseLines — same words, purchase
  // wording, same meaning to the manager.
  ['Sukari Nyeupe is not a stock item and cannot be received here', 'errNotStockItem'],
  // mobile-pos-lite.service.ts createPurchase supplier scope check. Round 3:
  // the Pokea screen routes its notice through this map, so this sentence
  // stopped being "unreachable copy" and started being English at a delivery.
  ['The selected supplier is not available for this terminal branch', 'supplierNotAvailable'],
  // mobile-pos-lite.service.ts resolvePurchaseLines — the cost rejections.
  ['Unga wa Ngano does not have a purchase cost — enter the unit cost', 'errNoPurchaseCost'],
  ['Provide a single unit cost per product', 'errOneCostPerProduct'],
  // mobile-pos-lite.service.ts createDayReport — the two refusals the
  // end-of-day close can actually earn (spec-history-reports §1.3/§5).
  //
  //   · the three-way verification of a marker-matched replay. The phone
  //     freezes its key against ONE close, across a midnight rollover
  //     included, so a key arriving for a different day, terminal or rep means
  //     the two ends disagree about which close this is — and neither
  //     replaying nor creating is right.
  ['This day report key was already used for a different day or terminal', 'reportConflict'],
  //   · the today-or-yesterday window. Yesterday is allowed because a rep who
  //     finished at 23:50 with no signal and closes on the bus at 00:10 is the
  //     normal case; anything outside it is a device clock, not a work day.
  ['Only today or yesterday can be closed from a Mobile POS terminal', 'errReportDateClosed'],
];

describe('posErrorKey — exact backend strings', () => {
  it.each(CASES)('%s → %s', (raw, key) => {
    expect(posErrorKey(raw)).toBe(key);
  });

  it('every row in the map is certified by a verbatim string above', () => {
    // Guards the failure that made the first stock-count rows dead on arrival:
    // a row added to pos-errors.ts with no real backend sentence behind it.
    const certified = new Set<PosStringKey>(CASES.map(([, key]) => key));
    const uncertified = Array.from(new Set(POS_ERROR_MAPPED_KEYS)).filter(
      (key) => !certified.has(key),
    );
    expect(uncertified).toEqual([]);
  });

  it('falls back to errorFallback for unknown backend copy', () => {
    expect(posErrorKey('Something completely new went wrong')).toBe('errorFallback');
    expect(posErrorKey('')).toBe('errorFallback');
    // Near-miss guard: the payment-method message must NOT be mistaken for
    // the credit-disabled one.
    expect(posErrorKey('This payment method is not enabled on this Mobile POS terminal')).toBe(
      'errorFallback',
    );
  });

  it('names the product in the count-up cost rejection', () => {
    // mobile-pos-lite.service.ts assertCountUpsCanBeValued. Round 1 pinned this
    // to errorFallback "so adding the key is a visible change to this case
    // rather than a silent one" — this is that visible change. One unpriced
    // line rejects a 40-line sheet, the manager cannot set a buying price from
    // the phone, and "mwite msimamizi" named neither the problem nor the line:
    // §7 case 5's recovery was only readable by expanding the technical
    // details and reading English.
    const raw = `Sukari Nyeupe (${PRODUCT_ID}) has no buying price on record and cannot be counted up — the office must set one first`;
    expect(posErrorKey(raw)).toBe('errNoBuyingPrice');
    expect(posErrorMessage(raw, tVars)).toBe('errNoBuyingPrice|{"name":"Sukari Nyeupe"}');
    // A product whose own name carries brackets must not truncate the name.
    expect(
      posErrorMessage(
        `Sukari Nyeupe (Kg) (${PRODUCT_ID}) has no buying price on record and cannot be counted up — the office must set one first`,
        tVars,
      ),
    ).toBe('errNoBuyingPrice|{"name":"Sukari Nyeupe (Kg)"}');
  });

  it('quotes the server cap in the too-many-lines rejection', () => {
    // The count DTO's line cap has no counterpart on the phone — nothing caps
    // or warns — so an over-long closing count is unsendable, and every retry
    // repeats. The cap is read out of the message rather than hard-coded, so
    // moving MOBILE_POS_LITE_STOCK_COUNT_MAX_LINES needs no frontend change.
    expect(
      posErrorMessage(
        'A stock count can carry at most 500 products — send the rest as a second count.',
        tVars,
      ),
    ).toBe('errCountTooLong|{"count":"500"}');
    // The ValidationPipe can raise several messages at once; api-client joins
    // them with ", " before anything here sees them.
    expect(
      posErrorMessage(
        'A stock count can carry at most 500 products — send the rest as a second count., lines.0.countedQuantity must be an integer number',
        tVars,
      ),
    ).toBe('errCountTooLong|{"count":"500"}');
    // class-validator's default copy is NOT matched: the DTO overrides it, so a
    // row for it would be certified by a string the backend never emits.
    expect(posErrorKey('lines must contain no more than 500 elements')).toBe('errorFallback');
  });

  it('the three "not available for this terminal" rejections keep their own copy', () => {
    // Three real messages end in the same seven words and mean three different
    // things: a counted product outside scope, a customer who cannot be billed
    // here, a supplier this branch cannot buy from. Each names a different
    // thing to change, so none may answer with another's copy.
    //
    // The supplier case used to be pinned to `errorFallback` HERE, which is how
    // a gap gets certified: the assertion was true when written (nothing
    // rendered the purchase notice through the map) and stayed green after the
    // Pokea screen was wired in, while the manager started reading English.
    expect(posErrorKey(`Product ${PRODUCT_ID} is not available for this terminal`)).toBe(
      'errProductNotInBranch',
    );
    expect(posErrorKey('The selected customer is not available for this terminal branch')).toBe(
      'errCustomerInvalid',
    );
    expect(posErrorKey('The selected supplier is not available for this terminal branch')).toBe(
      'supplierNotAvailable',
    );
  });

  it('names the line in the purchase cost rejection', () => {
    // resolvePurchaseLines. One unpriced line rejects a whole lorry, and unlike
    // the count's version the manager can fix it where she stands — the
    // buying-price box is on the row this sentence names — so the copy carries
    // the name through instead of sending her to the office.
    const raw = 'Unga wa Ngano does not have a purchase cost — enter the unit cost';
    expect(posErrorKey(raw)).toBe('errNoPurchaseCost');
    expect(posErrorMessage(raw, tVars)).toBe('errNoPurchaseCost|{"name":"Unga wa Ngano"}');
    // The count's unpriced-line rejection is a DIFFERENT recovery (the office
    // sets a buying price; she cannot). The two must not swap copy.
    expect(
      posErrorKey(
        `Sukari Nyeupe (${PRODUCT_ID}) has no buying price on record and cannot be counted up — the office must set one first`,
      ),
    ).toBe('errNoBuyingPrice');
    // Near miss: the SALE-side unpriced product keeps its own row.
    expect(posErrorKey('Soda Baridi does not have a selling price')).toBe('errProductUnavailable');
  });

  it('leaves the post-time office failures at the fallback', () => {
    // StockAdjustmentsService.post(). assertCountUpsCanBeValued answers the
    // same condition first with a named line, so this sentence only surfaces
    // when the two disagree — an office problem with no shelf recovery, which
    // is exactly what "mwite msimamizi" is for. Asserted so the cost rows above
    // are proved not to reach across into it.
    expect(
      posErrorKey('Stock add for Sukari Nyeupe must include a unit cost greater than zero'),
    ).toBe('errorFallback');
  });

  it('chain conflicts fall back instead of claiming the send landed', () => {
    // resumeStockCountChain / resumePurchaseChain. An /idempoten|duplicate/ row
    // used to map these to errAlreadySent ("Mauzo haya yameshatumwa"), which
    // tells a manager whose count was rejected upstream that it went through.
    // Nothing was sent; the frozen key can only resume the chain that already
    // ended, so retrying is not a recovery — the office has to act.
    expect(posErrorKey('The original stock count behind this idempotency key was rejected')).toBe(
      'errorFallback',
    );
    expect(posErrorKey('The original purchase behind this idempotency key was cancelled')).toBe(
      'errorFallback',
    );
    expect(posErrorKey('The stock count behind this request is no longer postable')).toBe(
      'errorFallback',
    );
    expect(posErrorKey('The goods received note behind this purchase is no longer postable')).toBe(
      'errorFallback',
    );
  });

  it('the retired-count sentence has no row: nothing that can run emits it', () => {
    // Round 3's assertStockCountNotRetired copy. The method was deleted with
    // the retirement it guarded, and the stock-count route has never been
    // deployed — HEAD's controller has no `stock-counts` POST — so no server
    // that has ever answered this phone can produce this sentence. The row and
    // its two catalog entries were removed in round 5 rather than kept as a
    // rolling-deploy backstop for a deploy that cannot have happened. This case
    // stays to pin the removal: if a future build re-introduces the sentence, it
    // arrives here as errorFallback and this line is where the row goes back.
    expect(
      posErrorKey(
        'This stock count was already refused and closed — send a new count instead of retrying this one.',
      ),
    ).toBe('errorFallback');
  });

  it('the capture-age refusals name a fresh count, and keep their two recoveries apart', () => {
    // The one permanent per-key refusal a live server can now produce, and the
    // only one whose recovery the manager can perform where she stands. Both
    // sentences quote the server's own window; only the resume side has a row
    // for the office to post, so only its copy may mention the office.
    const create =
      'This count was captured more than 6 hours ago and can no longer be sent from the phone — count the shelf again.';
    const resume =
      'This count was captured more than 6 hours ago and can no longer be sent from the phone — count the shelf again, or ask the office to post this one.';
    expect(posErrorMessage(create, tVars)).toBe('errCountTooOld|{"hours":"6"}');
    expect(posErrorMessage(resume, tVars)).toBe('errCountTooOldRecorded|{"hours":"6"}');
    // The window is the SERVER's; moving STOCK_COUNT_MAX_CAPTURE_AGE_HOURS
    // needs no frontend change.
    expect(
      posErrorMessage(
        'This count was captured more than 12 hours ago and can no longer be sent from the phone — count the shelf again.',
        tVars,
      ),
    ).toBe('errCountTooOld|{"hours":"12"}');
    // Neither may reach across into the count's other 409s.
    expect(posErrorKey(create)).not.toBe('errCountAlreadySent');
    expect(posErrorKey(resume)).not.toBe('errStillSending');
  });

  it('the conflicts that name a recovery get their own copy', () => {
    // The line between these and the four fallbacks above is whether the
    // sentence names something the manager can do at the shelf. A
    // content-conflicted slip really was received once, and "check with the
    // office" is the move; a capture too old to send names a fresh count. All
    // of them are useless in English on a phone.
    expect(
      posErrorKey(
        'The earlier slip for this delivery was already received — check with the office before recording it again.',
      ),
    ).toBe('errSlipAlreadyReceived');
    // The count's half of the slip conflict. It must NOT reach across into the
    // purchase row (or the twin-detect row): "already sent with different
    // numbers" is a statement about a recorded count, and the office is the
    // only place both versions can be seen — a "retry in a moment" would send
    // her back to a 409 forever.
    expect(
      posErrorKey(
        'This count was already sent with different numbers — check with the office before sending it again.',
      ),
    ).toBe('errCountAlreadySent');
  });

  it('the twin-detect conflict says wait-and-retry, never "already sent"', () => {
    // createPurchase's duplicate-create race, as the DEPLOYED build answers it
    // (the working tree settles the race with a unique index instead and
    // refuses nobody). This conflict IS recoverable from the phone — the
    // backend sentence says so itself ("Retry in a moment") — which is what
    // separates it from the four chain conflicts above.
    expect(
      posErrorKey('This stock count is being recorded by another request. Retry in a moment.'),
    ).toBe('errStillSending');
    expect(
      posErrorKey('This purchase is being recorded by another request. Retry in a moment.'),
    ).toBe('errStillSending');
  });

  it('the day-report refusals reach their own copy, and no earlier row claims them', () => {
    // spec-history-reports §5's required ordering check. The conflict sentence
    // ends "…for a different day or terminal", which sits one word from the
    // terminalUnavailable row's territory — and that row is EARLIER in the
    // table, so whichever matches first wins. Assert both halves: the rows
    // answer their own sentences, AND every alternative of the row that could
    // have stolen them still answers its own.
    expect(
      posErrorKey('This day report key was already used for a different day or terminal'),
    ).toBe('reportConflict');
    expect(posErrorKey('Only today or yesterday can be closed from a Mobile POS terminal')).toBe(
      'errReportDateClosed',
    );
    for (const raw of [
      'This Mobile POS terminal is not active',
      'This device is not registered for the selected Mobile POS terminal',
      'This Mobile POS terminal is assigned to a different sales rep',
      'The assigned Mobile POS user is not active',
      'Activate this Mobile POS device before selling',
    ]) {
      expect(posErrorKey(raw)).toBe('terminalUnavailable');
    }
  });
});

describe('posErrorMessage', () => {
  it('translates the mapped key through t', () => {
    expect(
      posErrorMessage('Insufficient stock at branch/location b-1: requested 2, available 0', t),
    ).toBe('<errInsufficientStock>');
    expect(posErrorMessage('total mystery', t)).toBe('<errorFallback>');
  });

  it('gives the count rejections their own Swahili, not the fallback', () => {
    expect(posErrorMessage(`Product ${PRODUCT_ID} is not available for this terminal`, t)).toBe(
      '<errProductNotInBranch>',
    );
    expect(
      posErrorMessage(`Product ${PRODUCT_ID} was counted more than once in this stock count`, t),
    ).toBe('<errDuplicateLine>');
    expect(
      posErrorMessage(`Sukari Nyeupe (${PRODUCT_ID}) is not a stock item and cannot be counted`, t),
    ).toBe('<errNotStockItem>');
  });

  it('passes no vars for the rows whose copy has no placeholders', () => {
    expect(posErrorMessage('This Mobile POS terminal is not active', tVars)).toBe(
      'terminalUnavailable|null',
    );
    expect(posErrorMessage('total mystery', tVars)).toBe('errorFallback|null');
  });
});

describe('posRefusalStatus', () => {
  it('reports the status only when the server actually refused', () => {
    expect(posRefusalStatus(apiError('The selected supplier is not available', 400))).toBe(400);
    expect(posRefusalStatus(apiError('conflict', 409))).toBe(409);
    expect(posRefusalStatus(apiError('forbidden', 403))).toBe(403);
  });

  it('reports nothing for everything that only failed to answer', () => {
    // A proxy in front of a chain that budgets tens of seconds gives up on its
    // own schedule; that says nothing about the delivery.
    expect(posRefusalStatus(apiError('Request failed: 502', 502))).toBeNull();
    expect(posRefusalStatus(apiError('Request failed: 500', 500))).toBeNull();
    // 408/429 are the server asking for the SAME request again.
    expect(posRefusalStatus(apiError('Request failed: 408', 408))).toBeNull();
    expect(posRefusalStatus(apiError('Request failed: 429', 429))).toBeNull();
    // No status at all: the fetch layer never got a verdict.
    expect(posRefusalStatus(new TypeError('Failed to fetch'))).toBeNull();
    expect(posRefusalStatus(new Error('boom'))).toBeNull();
    expect(posRefusalStatus('a string')).toBeNull();
    expect(posRefusalStatus(null)).toBeNull();
    expect(posRefusalStatus(undefined)).toBeNull();
    // A non-numeric `status` is not a status (an axios-shaped double, say).
    expect(posRefusalStatus({ status: '502' })).toBeNull();
  });
});

describe('posPurchaseFailureMessage', () => {
  it('speaks Swahili for every rejection that has a row', () => {
    expect(
      posPurchaseFailureMessage(
        apiError('The selected supplier is not available for this terminal branch', 400),
        t,
      ),
    ).toBe('<supplierNotAvailable>');
    expect(
      posPurchaseFailureMessage(
        apiError('Unga wa Ngano does not have a purchase cost — enter the unit cost', 400),
        tVars,
      ),
    ).toBe('errNoPurchaseCost|{"name":"Unga wa Ngano"}');
  });

  it('says wait-and-retry when nothing refused the attempt', () => {
    // The 502 that used to paint "Request failed: 502" in a red danger box at a
    // lorry. Nothing is known to be wrong with the delivery — the PO->GRN chain
    // may well have completed behind the gateway — so the copy may not read as a
    // verdict, and "mwite msimamizi" would answer a question nobody at the
    // delivery can act on.
    expect(posPurchaseFailureMessage(apiError('Request failed: 502', 502), t)).toBe(
      '<purchaseSendFailedRetry>',
    );
    expect(posPurchaseFailureMessage(apiError('Request failed: 429', 429), t)).toBe(
      '<purchaseSendFailedRetry>',
    );
    expect(posPurchaseFailureMessage(new TypeError('Failed to fetch'), t)).toBe(
      '<purchaseSendFailedRetry>',
    );
    // A throw with no message at all is still not a verdict.
    expect(posPurchaseFailureMessage('something threw', t)).toBe('<purchaseSendFailedRetry>');
  });

  it('falls back to "call a supervisor" for a refusal with no row', () => {
    // The two purchase chain conflicts pos-errors.ts lists as deliberately
    // unmapped. The comment there has always said "mwite msimamizi is the
    // honest answer"; until round 4 the screen printed these in English
    // instead, so the comment described behaviour the code did not have.
    expect(
      posPurchaseFailureMessage(
        apiError('The original purchase behind this idempotency key was cancelled', 409),
        t,
      ),
    ).toBe('<errorFallback>');
    expect(
      posPurchaseFailureMessage(
        apiError('The goods received note behind this purchase is no longer postable', 409),
        t,
      ),
    ).toBe('<errorFallback>');
    // …and anything else the wrapper grows next.
    expect(posPurchaseFailureMessage(apiError('Something entirely new', 400), t)).toBe(
      '<errorFallback>',
    );
  });

  it('trusts a recognised sentence over an unproven status', () => {
    // The two questions are asked in this order on purpose: a sentence this map
    // recognises can only have come from the server, so demoting it to "the
    // network dropped" would state a cause that is known to be false. It is the
    // same order the count's rejection card evaluates.
    expect(
      posPurchaseFailureMessage(
        apiError('The selected supplier is not available for this terminal branch', 500),
        t,
      ),
    ).toBe('<supplierNotAvailable>');
  });

  it('never returns the backend sentence itself', () => {
    // The regression this whole function exists for: a Swahili-first manager
    // standing at a delivery must not read English out of a red box.
    const english = [
      'Request failed: 502',
      'Failed to fetch',
      'The original purchase behind this idempotency key was cancelled',
      'The goods received note behind this purchase is no longer postable',
      'Something entirely new',
    ];
    for (const raw of english) {
      expect(posPurchaseFailureMessage(apiError(raw, 409), t)).not.toContain(raw);
      expect(posPurchaseFailureMessage(new Error(raw), t)).not.toContain(raw);
    }
  });
});

describe('posSaleFailureMessage', () => {
  it('speaks Swahili for the rejections a live sale actually earns', () => {
    // These are the highest-volume rejections in the whole module — a credit
    // limit and an over-sold shelf, refused at Malipo with the cart still on
    // screen — and until this function existed they were painted raw in the
    // danger box while the identical sentences arriving through the outbox were
    // mapped two screens away.
    expect(
      posSaleFailureMessage(
        apiError(
          "Credit sale exceeds Asha Duka's credit limit. Limit: 100000.00, projected balance: 115000.00",
          400,
        ),
        t,
      ),
    ).toBe('<errCreditLimit>');
    expect(
      posSaleFailureMessage(
        apiError('Insufficient stock at branch/location b-1: requested 5, available 2', 400),
        t,
      ),
    ).toBe('<errInsufficientStock>');
    expect(posSaleFailureMessage(apiError('This Mobile POS terminal is not active', 403), t)).toBe(
      '<terminalUnavailable>',
    );
  });

  it('says "call a supervisor" for a refusal with no row', () => {
    expect(
      posSaleFailureMessage(
        apiError('This payment method is not enabled on this Mobile POS terminal', 400),
        t,
      ),
    ).toBe('<errorFallback>');
  });

  it('never invites a blind retry when nothing refused the sale', () => {
    // The sale path is the ONE send surface with no frozen key: completeSale
    // mints a fresh idempotencyKey per attempt, so a lost response followed by
    // a second tap is a second sale. The purchase's "wait a moment, then tap
    // POKEA again" would therefore be a false instruction here — the unproven
    // copy has to say the outcome is unknown and stop her from repeating it.
    expect(posSaleFailureMessage(apiError('Request failed: 502', 502), t)).toBe(
      '<saleSendFailedUnknown>',
    );
    expect(posSaleFailureMessage(new TypeError('Failed to fetch'), t)).toBe(
      '<saleSendFailedUnknown>',
    );
    expect(posSaleFailureMessage('something threw', t)).toBe('<saleSendFailedUnknown>');
    expect(posSaleFailureMessage(apiError('Request failed: 429', 429), t)).toBe(
      '<saleSendFailedUnknown>',
    );
  });

  it('never returns the backend sentence itself', () => {
    const english = [
      'Request failed: 502',
      'Failed to fetch',
      "Credit sale exceeds Asha Duka's credit limit. Limit: 100000.00, projected balance: 115000.00",
      'This payment method is not enabled on this Mobile POS terminal',
      'Something entirely new',
    ];
    for (const raw of english) {
      expect(posSaleFailureMessage(apiError(raw, 409), t)).not.toContain(raw);
      expect(posSaleFailureMessage(new Error(raw), t)).not.toContain(raw);
    }
  });
});

describe('posDayReportFailureMessage', () => {
  it('speaks Swahili for the two rejections a close can earn', () => {
    expect(
      posDayReportFailureMessage(
        apiError('This day report key was already used for a different day or terminal', 409),
        t,
      ),
    ).toBe('<reportConflict>');
    expect(
      posDayReportFailureMessage(
        apiError('Only today or yesterday can be closed from a Mobile POS terminal', 400),
        t,
      ),
    ).toBe('<errReportDateClosed>');
    // A terminal rejection can land on this route too, and it already has copy.
    expect(
      posDayReportFailureMessage(apiError('This Mobile POS terminal is not active', 403), t),
    ).toBe('<terminalUnavailable>');
  });

  it('invites the plain retry when nothing refused the close', () => {
    // Unlike the sale, the day report HAS a frozen key: it is persisted before
    // the request leaves and never moves until a 2xx, so an identical retry is
    // settled by the server's unique index rather than guessed at here. That
    // is what makes "jaribu tena" a true instruction on this surface.
    expect(posDayReportFailureMessage(apiError('Request failed: 502', 502), t)).toBe(
      '<reportSendFailedRetry>',
    );
    expect(posDayReportFailureMessage(new TypeError('Failed to fetch'), t)).toBe(
      '<reportSendFailedRetry>',
    );
    expect(posDayReportFailureMessage('something threw', t)).toBe('<reportSendFailedRetry>');
    expect(posDayReportFailureMessage(apiError('Request failed: 429', 429), t)).toBe(
      '<reportSendFailedRetry>',
    );
  });

  it('falls back to "call a supervisor" for a refusal with no row', () => {
    expect(posDayReportFailureMessage(apiError('Some brand new day-report rule', 400), t)).toBe(
      '<errorFallback>',
    );
  });

  it('never returns the backend sentence itself', () => {
    const english = [
      'Request failed: 502',
      'Failed to fetch',
      'This day report key was already used for a different day or terminal',
      'Only today or yesterday can be closed from a Mobile POS terminal',
      'Something entirely new',
    ];
    for (const raw of english) {
      expect(posDayReportFailureMessage(apiError(raw, 409), t)).not.toContain(raw);
      expect(posDayReportFailureMessage(new Error(raw), t)).not.toContain(raw);
    }
  });
});
