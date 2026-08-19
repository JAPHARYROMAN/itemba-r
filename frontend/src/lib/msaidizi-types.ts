/**
 * The Msaidizi wire contract, mirrored from the backend.
 *
 * Every type here is a copy of something in `backend/src/modules/msaidizi/`.
 * They are copied rather than shared because the two halves ship separately and
 * a frontend build must not depend on a Nest module; the price is that these
 * drift silently, so each block names the file it mirrors.
 *
 * Two of them are load-bearing beyond their shape:
 *
 * `ModelMessage.content` is `unknown` ON PURPOSE. It is the provider's own
 * content blocks and must survive a round trip untouched — the backend DTO
 * carries the same deliberate hole (`ConversationMessageDto.content` is a bare
 * `@IsDefined()`, and the comment above it records that typing it once broke
 * multi-turn completely). Anything that narrows this type invites a `.map()`,
 * and a `.map()` is how the array stops being the array the API was sent.
 *
 * `MsaidiziEvent`'s `tool_result` variant carries no result body. That is not an
 * omission to be filled in later: the trace is deliberately built so it cannot
 * leak a payload. The steps say what Msaidizi touched; the answer says what it
 * found. There is nothing else to show.
 *
 * A few runtime values live here too — `DONE_REASONS`, `asDoneReason`,
 * `asSequence` and `MSAIDIZI_MESSAGE_LIMIT`. Each is a check performed against
 * the wire rather than a shape, and a check kept beside the declaration it
 * enforces is one that changes when the declaration does.
 */

/** `backend/src/common/capabilities/reversibility.ts` */
export type ReversibilityTier = 'green' | 'amber' | 'red';

/** `msaidizi.config.ts` */
export type MsaidiziWriteMode = 'read-only' | 'amber' | 'red';

/**
 * How a run ended. `done` is emitted exactly once per run and every one of these
 * seven needs its own treatment on screen. Two of them are the reason this list
 * is a contract rather than a label: `refused` and `truncated` both arrive
 * inside a perfectly successful HTTP response, and both read as an ordinary
 * answer to any client that does not branch on the reason — a refusal as a blank
 * one, a truncation as a complete one.
 *
 * Mirrors `DoneReason` in `msaidizi.service.ts`. It is an array with the type
 * derived from it rather than a hand-written union, because both paths that read
 * a reason — the live stream and the stored transcript — have to check an
 * unvalidated wire string against this list, and a list maintained separately
 * from the union is a list that stops matching it.
 */
export const DONE_REASONS = [
  'end_turn',
  'awaiting_confirmation',
  'tool_budget_exhausted',
  'write_budget_exhausted',
  'refused',
  /**
   * The model hit the output ceiling mid-answer. The text on screen stops
   * wherever the token counter ran out, so it is a fragment presented as prose
   * and the only thing that says so is this reason.
   */
  'truncated',
  'failed',
] as const;

export type DoneReason = (typeof DONE_REASONS)[number];

/**
 * Read a `reason` that arrived over the wire.
 *
 * TypeScript cannot help here: the union above is what the backend promises, and
 * the value is whatever actually turned up. A reason this build does not know —
 * an eighth one added by a later phase, a field a proxy mangled, a `done` frame
 * with no `reason` at all — must not reach a renderer that switches on the seven,
 * where it falls off the end of the switch and the run draws no verdict at all.
 * `failed` is the honest reading of a verdict this build cannot name.
 */
export function asDoneReason(reason: unknown): DoneReason {
  return DONE_REASONS.includes(reason as DoneReason) ? (reason as DoneReason) : 'failed';
}

/**
 * One entry in the human-facing trace. Mirrors `MsaidiziEvent`.
 *
 * Everything in here is attacker-influenceable — supplier names, customer notes,
 * document text — and the system prompt tells the model to quote hostile content
 * back when it finds it. Render as text. Never as HTML, never as Markdown with
 * raw HTML enabled.
 */
export type MsaidiziEvent =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call';
      tool: string;
      capabilityId: string;
      tier: ReversibilityTier;
      args: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      tool: string;
      ok: boolean;
      /**
       * HTTP status of the underlying call — except `0`, which is not a status.
       * It means transport failure, timeout, or a missing path parameter. Never
       * render the number to a user.
       */
      status: number;
      error?: string;
    }
  | {
      type: 'confirmation_required';
      confirmationId: string;
      tool: string;
      capabilityId: string;
      description: string;
      args: Record<string, unknown>;
    }
  | { type: 'done'; reason: DoneReason }
  | { type: 'error'; message: string };

export type MsaidiziEventType = MsaidiziEvent['type'];

/** Narrowing helper for the variant the confirmation gate is built from. */
export type ConfirmationRequest = Extract<MsaidiziEvent, { type: 'confirmation_required' }>;

/** Narrowing helper for a step row. */
export type ToolCallEvent = Extract<MsaidiziEvent, { type: 'tool_call' }>;

/**
 * One turn of the model conversation. Transport state, not content: it carries
 * the fenced tool_result payloads the trace deliberately excludes, so it is
 * echoed and stored and never rendered.
 *
 * Mirrors `ModelMessage` in `model-client.ts`.
 */
export interface ModelMessage {
  role: 'user' | 'assistant';
  /** Opaque. See the file header — do not narrow, do not map, do not rebuild. */
  content: unknown;
}

/** Mirrors `RunUsage`. `inputTokens` is the uncached remainder only. */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** Model turns in the loop. Each one re-sends the whole conversation. */
  modelTurns: number;
}

/**
 * What a run returns. Mirrors `RunResult`.
 *
 * `events` here repeats every event already streamed, `done` included. A client
 * that renders both the live frames and this array double-renders the entire
 * run — use this one only for `sessionId`, `messages` and `reason`.
 */
export interface MsaidiziRunResult {
  sessionId: string;
  events: MsaidiziEvent[];
  reason: DoneReason;
  /** Conversation state to send back on the next turn. Opaque. */
  messages: ModelMessage[];
  usage: RunUsage;
  /**
   * Where the store put this turn, when it put it anywhere.
   *
   * The streaming path carries the same two values on its `session` frame and is
   * the only consumer today — `askMsaidizi` has no call sites. They are here so
   * that a non-streaming client is not the one place in the product where the
   * conversation id is on the wire and absent from the type, which is how a
   * future turn ends up unable to name the conversation it belongs to.
   *
   * BOTH optional, and the absence is meaningful rather than tidy. The backend
   * omits them from the JSON entirely for a turn that ran unpersisted — the
   * store was unavailable, or the turn's own transaction rolled back — because a
   * zero sequence would have this client claim, on its next question, to have
   * seen a turn that was never written. Absent means "this turn has no position
   * in any stored conversation", which is a different fact from "position 0".
   */
  conversationId?: string;
  sequence?: number;
}

/**
 * The body of `POST /msaidizi/ask` and `/ask/stream`. Mirrors `AskDto`.
 *
 * `history` is the previous response's `messages`, echoed back unchanged.
 *
 * `confirmed` is a ONE-SHOT, and the reason is the shape of THIS REQUEST rather
 * than any server policy: the array names confirmation ids and has no way to name
 * a row or a turn, so a client that keeps it in state puts a standing "yes" for
 * that action on every later turn of the run. Send an approval on exactly the
 * request it answers, and forget it.
 *
 * What the server currently does with an id is a narrower guarantee than that
 * rule, and it has changed before. `run()` spends each id on the dispatch that id
 * authorises, so within one request an id buys one execution and a second
 * identical proposal in the same run suspends again. It does not span requests:
 * `confirmationIdFor` is deterministic and nothing is remembered between runs, so
 * an id re-sent on a LATER request is indistinguishable from a fresh approval and
 * buys one more execution. Build on the rule above, not on either half of this.
 */
export interface MsaidiziAskRequest {
  message: string;
  history?: ModelMessage[];
  sessionId?: string;
  confirmed?: string[];
  /**
   * Continue a stored conversation, by id.
   *
   * This is the only path that reads server-held resume state. Sending it moves
   * the thread off the client's own array and onto the server's, which is what
   * makes a conversation reopened from the rail continue from what actually
   * happened in it rather than from whatever this tab still has — and, on a live
   * thread, makes the SERVER the authority on which session id the red-tier
   * confirmation ids were derived from.
   *
   * Author-only: someone else's id is a 404, not a 403.
   */
  conversationId?: string;
  /**
   * The turn sequence this client last saw, sent alongside `conversationId`.
   *
   * The server compares it against the conversation's own turn count and answers
   * 409 when the thread has moved on in another window. Without it two tabs
   * write alternate futures into one conversation and neither is told.
   */
  sequence?: number;
}

/**
 * The pipe's cap on `AskDto.message` (`@MaxLength(8000)`, msaidizi.controller.ts).
 *
 * A message over it is rejected with a 400 before `flushHeaders()`, so the
 * client can only read it as "the assistant is unavailable" and retrying can
 * never work. The composer stops the user at this length; anything that composes
 * a message instead of taking one the user typed has to stay under it too.
 */
export const MSAIDIZI_MESSAGE_LIMIT = 8000;

/**
 * The `session` frame. Contracted, and emitted first.
 *
 * `msaidizi.controller.ts` writes it before the first model turn rather than
 * after the last, so a run that drops mid-loop has still told this page which
 * conversation it is and which audit key its rows carry. Two of the three ids
 * are load-bearing beyond identification: `conversationId` is what puts the
 * server's own stored state into the running for the next turn — it compares its
 * copy against whatever the client sends and keeps whichever holds more of the
 * conversation — and `sequence` is what the server's two-tab guard compares
 * against the conversation's own turn count.
 *
 * Every field is still optional, and that is a statement about the run rather
 * than about the contract: a turn the store could not persist has no
 * conversation id and no sequence to report, and it reports the session id it
 * does have instead of inventing the two it does not. So an ABSENT field here
 * means "unknown", never "reset to nothing" — see `asSequence`.
 */
export interface MsaidiziSessionFrame {
  conversationId?: string;
  agentSessionId?: string;
  sessionId?: string;
  sequence?: number;
}

/**
 * Read a `sequence` — off the wire, or off a stored transcript.
 *
 * Turns are numbered from 1, so `0` is not the first turn; it is the absence of
 * one. That is what an unpersisted turn has to say about where the conversation
 * is, and what a mangled or missing field decodes to. Both must read as "this
 * tab has no claim to make", which is `null`, and never as a claim of zero.
 *
 * The difference is the whole defect. A `0` kept in state is sent on every later
 * turn beside a real `conversationId`, and the server reads `0 < turnCount` as
 * "this tab is behind" and answers 409 — "This conversation continued in another
 * window" — for the rest of that conversation's life, about a second window that
 * does not exist. Nothing on screen offers a way out of it but a page reload.
 */
export function asSequence(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** One capability the caller can actually reach. Mirrors `ReachableCapability`. */
export interface ReachableCapability {
  /** The tool name the model sees, and the name that appears in run events. */
  name: string;
  /** Plain-language action phrase — what a step row says instead of an identifier. */
  description: string;
  tier: ReversibilityTier;
  /** `GET /customers` — the underlying route. */
  path: string;
  capabilityId: string;
}

/**
 * The machine-readable discriminator on a Msaidizi 409. Mirrors
 * `CONVERSATION_CONFLICT_CODES` in `backend/src/modules/msaidizi/conversations.service.ts`.
 *
 * Both conflicts arrive as a 409 and they are OPPOSITE answers:
 *
 *   - `unfinished_turn` — the last turn's row has not settled. It clears by
 *     itself, at the outside within the backend's `ABANDONED_TURN_MS`, so a
 *     retry is honest.
 *   - `continued_elsewhere` — this conversation moved on in another window.
 *     As true on the tenth ask as the first; a retry is a lie.
 *
 * Before this existed the only thing separating them on the wire was the English
 * in `message`, and the client matched a phrase in it — which meant an ordinary
 * copy-edit on the server silently flipped the answer and put "asking again gets
 * the same answer" underneath a server sentence promising the opposite.
 *
 * A code this build does not recognise must be treated as the conservative case
 * (no retry), the same way an unrecognised `DoneReason` is: a retry withheld is
 * a worse screen, a retry offered into a wall is a lie.
 */
export type MsaidiziConflictCode = 'unfinished_turn' | 'continued_elsewhere';

/**
 * `GET /msaidizi/capabilities`. Mirrors `MsaidiziCapabilities`.
 *
 * Answerable while the module is switched off, which is the point of it: a
 * client can learn the feature is unavailable without firing a run and reading a
 * 503. `writeMode` drives the mode banner — hardcoding that sentence is the
 * easiest way to ship a lie the day the deployment moves to amber.
 */
export interface MsaidiziCapabilities {
  enabled: boolean;
  writeMode: MsaidiziWriteMode;
  allowedTiers: ReversibilityTier[];
  /**
   * Ceilings on ONE REQUEST, not on a conversation. `maxWrites` in particular is
   * not a per-conversation cap: the counter behind it is a local of the
   * backend's `run()`, so every request carrying the same session id spends the
   * full allowance again — ten turns can write ten times this number.
   *
   * A renderer must therefore say "per request", never "for this conversation".
   * Nothing displays these today, which is exactly why the note belongs here:
   * the first renderer will read this type, and reading the bare number is how
   * an earlier review came to reason about it as a session bound.
   */
  budgets: {
    maxToolCalls: number;
    maxWrites: number;
    toolBudget: number;
  };
  /**
   * Whether relevance narrowing runs for this caller, and how much it removes.
   * A run gives no other signal that the tool set was cut, and that silence is
   * the mechanism behind the worst failure mode in the design: answering
   * confidently from a set that never contained the tool holding the answer.
   */
  narrowing: {
    active: boolean;
    permitted: number;
    perRun: number;
  };
  capabilities: ReachableCapability[];
}

/**
 * `GET /msaidizi/conversations`. Mirrors `ConversationSummary`, except that
 * every `Date` has crossed JSON and is an ISO string here.
 */
export interface MsaidiziConversationSummary {
  id: string;
  agentSessionId: string;
  title: string | null;
  companyId: string | null;
  turnCount: number;
  toolCallCount: number;
  writeCallCount: number;
  /** `green` | `amber` | `red` as a bare string: the backend keeps it untyped. */
  highestTier: string;
  resumable: boolean;
  /** Whether a next turn can still be continued server-side. */
  continuable: boolean;
  lastTurnAt: string | null;
  createdAt: string;
  expiresAt: string;
}

/** One stored turn, as `GET /msaidizi/conversations/:id` returns it. */
export interface MsaidiziConversationTurnRecord {
  id: string;
  sequence: number;
  /** The user's own words. Plaintext server-side; still render as text. */
  prompt: string;
  reason: string;
  toolCallCount: number;
  writeCallCount: number;
  procedureId: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Decrypted trace. Carries no tool-result bodies, by construction. */
  events: MsaidiziEvent[];
}

/** `GET /msaidizi/conversations/:id` — author-only; a non-author gets a 404. */
export interface MsaidiziConversationDetail extends MsaidiziConversationSummary {
  turns: MsaidiziConversationTurnRecord[];
}

/** The list endpoint's envelope-inner shape: `{ data, meta }`, not the house paginator. */
export interface MsaidiziConversationPage {
  data: MsaidiziConversationSummary[];
  meta: { page: number; limit: number; total: number };
}
