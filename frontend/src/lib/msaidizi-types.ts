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
 */

/** `backend/src/common/capabilities/reversibility.ts` */
export type ReversibilityTier = 'green' | 'amber' | 'red';

/** `msaidizi.config.ts` */
export type MsaidiziWriteMode = 'read-only' | 'amber' | 'red';

/**
 * How a run ended. `done` is emitted exactly once per run and every one of these
 * six needs its own treatment on screen — in particular `refused`, which arrives
 * inside a perfectly successful HTTP response and reads as a blank answer to any
 * client that branches on status alone.
 *
 * Mirrors `DoneReason` in `msaidizi.service.ts`.
 */
export type DoneReason =
  | 'end_turn'
  | 'awaiting_confirmation'
  | 'tool_budget_exhausted'
  | 'write_budget_exhausted'
  | 'refused'
  | 'failed';

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
}

/**
 * The body of `POST /msaidizi/ask` and `/ask/stream`. Mirrors `AskDto`.
 *
 * `history` is the previous response's `messages`, echoed back unchanged.
 * `confirmed` is a ONE-SHOT: it is checked as a plain set against every red-tier
 * proposal for the whole run, so a client that keeps it in state and re-sends it
 * has silently granted standing permission for that action.
 */
export interface MsaidiziAskRequest {
  message: string;
  history?: ModelMessage[];
  sessionId?: string;
  confirmed?: string[];
}

/**
 * Forward compatibility only: the plan has the stream emitting a `session` frame
 * first, carrying the ids before the loop starts, and the backend has not
 * shipped it yet. The parser recognises it now so that landing it is a backend
 * change alone; every field is optional because none of it is contracted.
 */
export interface MsaidiziSessionFrame {
  conversationId?: string;
  agentSessionId?: string;
  sessionId?: string;
  sequence?: number;
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
