import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { RunResult } from '../msaidizi.service';
import { GRANT_ID, MAX_CONFIRMED_PER_TURN } from './approval-grants';
import { SESSION_ID } from './session-id';

/**
 * One prior turn, echoed back from the previous response's `messages`.
 *
 * This has to be a class with real decorators, not the `ModelMessage` interface.
 * The global ValidationPipe runs `whitelist: true`, which strips any property it
 * cannot see a decorator for — and an interface carries no metadata at runtime,
 * so an undecorated `history` arrives as an array of empty objects and the model
 * request fails with "messages.0: Input does not match the expected shape".
 *
 * `content` is deliberately only `@IsDefined()`. It is a string on user turns and
 * an array of provider content blocks on assistant turns, and those blocks must
 * survive the round trip byte-for-byte. Declaring a nested type here would make
 * the pipe recurse and strip fields inside them — including the ones the API
 * requires echoed back unchanged.
 */
export class ConversationMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsDefined()
  content!: unknown;
}

export class AskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  message!: string;

  /** Conversation state returned by the previous turn, echoed back verbatim. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversationMessageDto)
  history?: ConversationMessageDto[];

  /**
   * The session id of the run being continued, echoed back from the previous
   * turn's `AskResult` or `session` frame.
   *
   * A LOOKUP KEY, and — since the grant ledger landed — nothing else. `open()`
   * resolves it against this caller's own conversations; an id that resolves to
   * one of theirs continues it, and an id that resolves to nothing of theirs is
   * IGNORED in favour of a freshly minted one rather than adopted. Never
   * rejected: failing a run over a stale id is a worse outcome than
   * re-identifying it.
   *
   * It is still an AUDIT key — `capability-invoker` sends whatever the store
   * settled on as the agent-session header that every `audit_logs` row this run
   * writes is stamped with — which is why the value is pinned to a shape at all.
   * What it is NOT, any more, is load-bearing for approvals. Red-tier ids used to
   * be derived from it, so a client that lost or changed this value approved the
   * same action forever without it running; approvals are now server-issued
   * nonces in `confirmed`, and they survive the session id changing underneath
   * them.
   *
   * The pattern checks SHAPE, and stating that plainly is still the point. It is
   * the alphabet and length `mintSessionId()` produces, so a hand-written or
   * copied string is rejected — but any client with a random-hex generator
   * satisfies it, and no validator on this field can tell an id this server
   * issued from one a caller invented that looks the same. It does not need to:
   * an id this server did not issue to this caller resolves to nothing of
   * theirs, and is replaced.
   */
  @IsOptional()
  @IsString()
  @Matches(SESSION_ID)
  sessionId?: string;

  /**
   * Grant ids the user has approved, for this request only.
   *
   * Server-issued nonces, read off the `grantId` of a `confirmation_required`
   * event — never anything the client computed. A grant is issued when the
   * server PROPOSES a red-tier action and spent, atomically and once, when it
   * DISPATCHES one. So an id here is a receipt for a proposal this server
   * actually made, in this conversation, to this user, for those exact
   * arguments.
   *
   * Sending one back twice — in one array, on a later turn, or on a later
   * REQUEST — buys exactly one execution. The second attempt finds the grant
   * already used and the action is proposed again, with a NEW grant, which is
   * also how the same action legitimately repeated next week stays approvable.
   *
   * The old contract accepted any string here because the ids were DERIVED from
   * values the caller already had, which made this field a way to ask for an
   * action rather than a way to answer for one. `@Matches(GRANT_ID, { each: true })`
   * is the visible half of that change: the field now admits only the shape this
   * server mints, and a value it never issued matches no row in the ledger.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CONFIRMED_PER_TURN)
  @IsString({ each: true })
  @Matches(GRANT_ID, { each: true })
  confirmed?: string[];

  /**
   * Continue a stored conversation, by id.
   *
   * Sending this moves the client onto the stored-state path, which is what lets
   * a conversation be picked up from a second tab or a different device rather
   * than only from the tab that started it. Author-only — someone else's id is a
   * 404, not a 403, because there is nothing to tell a non-author about a
   * conversation that is not theirs, including that it exists.
   *
   * It does NOT replace `history`, and sending both is the normal case. The
   * server keeps the copy that holds more of the conversation, so the stored
   * state wins the case this field exists for (a tab that has none, or one a
   * turn behind) while a client that is holding a turn the store failed to
   * record keeps it. `continueById` states the rule.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  /**
   * The turn sequence this client last saw, sent alongside `conversationId`.
   *
   * When the conversation has moved on in another window the request is a 409
   * rather than a silent divergence between two tabs writing alternate futures
   * into one thread.
   *
   * Sequences are 1-based, so only a positive value is a claim about stored
   * state; `open()` ignores anything else rather than reading it as a tab that
   * has fallen behind by every turn. `@Min(0)` rather than `@Min(1)` because a
   * client already in the field can still send the `0` this server used to
   * report for an unpersisted turn, and answering that with a 400 would be a
   * harder failure than the one being removed.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  sequence?: number;
}

/**
 * What `POST /msaidizi/ask` answers with: the run, plus where it landed.
 *
 * The two extra fields are the non-streaming half of the `session` frame. This
 * DTO accepts `conversationId` and `sequence`, and a caller that is never told
 * which conversation the server filed its turn under, or which turn number it
 * got, can never send either of them back — which leaves `continueById`, the
 * two-tab 409 and both 410 sentences reachable only from the stream. Accepting
 * input a caller has no way to follow up is the asymmetry this closes.
 *
 * The third field a follow-up needs is not here, and deliberately: the grant ids
 * for a suspended run ride on the `confirmation_required` entries inside
 * `events`, which this result already carries in full. One place to read an
 * approval from, whether the client streamed the run or waited for it.
 *
 * Both are optional, and ABSENT rather than zero when the turn was not
 * persisted, exactly as the `session` frame is: `JSON.stringify` drops an
 * undefined field, so a client holds its last known-good values through an
 * answer that omits them. See `OpenedTurn.sequence` for why a zero would be
 * worse than silence. An answer with no `conversationId` also means no grant
 * could have been issued for anything it proposed — an unpersisted run has no
 * conversation to bind one to — so a red-tier action in it is un-approvable
 * until the store comes back and the run is asked again.
 */
export interface AskResult extends RunResult {
  conversationId?: string;
  sequence?: number;
}
