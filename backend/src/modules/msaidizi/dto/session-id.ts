/**
 * The session-id shape, in one place.
 *
 * `AskDto` and `RunProcedureDto` used to hold a copy each, with a comment on
 * each copy explaining that it was a copy of the other. Both are in this
 * directory now, so there is one constant and the drift the comments apologised
 * for is not available.
 */

/**
 * What `mintSessionId()` produces: `ms_` and a UUID with its dashes removed.
 *
 * A check on SHAPE, and — since the grant ledger landed — that is now all it
 * needs to be. A session id is a LOOKUP KEY on the way in: the store resolves it
 * against the caller's own conversations, and a value that resolves to nothing
 * of theirs is ignored in favour of a freshly minted one rather than adopted.
 * Nothing is authorised by it.
 *
 * This pattern therefore keeps malformed input out of that lookup and nothing
 * more. A client with a random-hex generator satisfies it all day; what such an
 * id can then do is name a conversation the caller already owns, or name nothing
 * and be replaced. It cannot approve anything: approvals are server-issued
 * nonces (`GRANT_ID`), and before that change red-tier confirmation ids were
 * derived from this value, which is why every comment around it used to be about
 * preserving it through an approval.
 */
export const SESSION_ID = /^ms_[0-9a-f]{32}$/;
