/**
 * Red-tier approvals, as they appear ON THE WIRE.
 *
 * The ledger itself — what a grant row holds, how it is issued and how it is
 * spent — belongs to `msaidizi.service.ts` (`ApprovalGrant`, `ApprovalGrantStore`)
 * and to the store that implements it. What lives here is the narrow part the
 * DTO layer owns: the shape of the id a client is allowed to send back, and the
 * mint that produces exactly that shape. Those two must not drift, so they are
 * one file and there is a test that runs one through the other.
 *
 * ─── Why the field this validates changed meaning ────────────────────────────
 *
 * An approval used to be `confirmationIdFor(sessionId, toolName, args)` — an id
 * DERIVED from three values the caller supplies on the same request that carries
 * `confirmed`. Two limits followed from that:
 *
 *   - the spend lived in an in-memory `Set` inside `run()`, so it died at the
 *     request boundary. Re-sending the same id on a LATER request bought another
 *     execution, because the proposal it binds to was still standing in the
 *     history;
 *   - the id was never bound to a proposal having been MADE. Anyone holding the
 *     three public inputs could compute it, which made `confirmed` a
 *     pre-authorisation channel rather than a receipt.
 *
 * Marking a derived id permanently spent closes neither and opens a worse hole
 * in the other direction: the id is deterministic, so the same weekly journal
 * posted again next week produces the same id, and an id remembered as spent
 * forever would make a legitimately repeated action permanently unapprovable.
 *
 * So the server ISSUES a grant when it proposes and SPENDS it when it
 * dispatches, and `confirmed` carries those server-issued nonces. A client
 * cannot compute one; one this server never issued matches no row. That is why
 * this field could be widened from "any string" to a pattern at all — under the
 * old scheme the id was whatever the hash produced, and the validator had
 * nothing to pin it to.
 */

import { randomUUID } from 'node:crypto';

/**
 * The shape a grant id has: `grt_` and a UUID with its dashes removed.
 *
 * Deliberately NOT the session-id alphabet. `/^ms_[0-9a-f]{32}$/` and this one
 * are mutually exclusive, so a client that puts a session id in `confirmed`, or
 * a grant id in `sessionId`, is told which field it got wrong instead of being
 * handed a 200 and a run that suspends forever on an action it thought it had
 * approved.
 *
 * The pattern is a check on SHAPE, exactly as the session-id pattern is, and
 * what separates the two fields is what happens NEXT rather than what the regex
 * proves. A conforming session id a client invented is honoured as a lookup key.
 * A conforming grant id a client invented resolves to no row in the ledger and
 * buys nothing: the pattern keeps malformed input out of the query, and the
 * query is what decides.
 */
export const GRANT_ID = /^grt_[0-9a-f]{32}$/;

/**
 * A fresh approval nonce.
 *
 * 128 bits from `randomUUID`, derived from no input: not from the session id,
 * not from the tool name, not from the arguments. That is the property the whole
 * model rests on — a caller cannot compute an id the server has not issued, so
 * `confirmed` names receipts rather than requests.
 *
 * It lives beside `GRANT_ID` so the mint and the validator cannot drift. A mint
 * that produced anything this pattern rejects would issue grants the very next
 * request could not send back, and the failure would surface as an approval
 * button that does nothing.
 */
export function mintGrantId(): string {
  return `grt_${randomUUID().replace(/-/g, '')}`;
}

/**
 * How many approvals one request may carry.
 *
 * A turn proposes a handful of red-tier actions at most — the write budget caps
 * a run at ten — so this is far above any legitimate client and exists only to
 * keep an unbounded array out of the ledger lookup, which walks the offered
 * grants one conditional update at a time. Well clear of the real ceiling on
 * purpose: a cap a real approval can hit is a cap that fails a user rather than
 * an attacker.
 */
export const MAX_CONFIRMED_PER_TURN = 64;
