/**
 * The Msaidizi streaming client — the first streaming consumer in this codebase.
 *
 * `EventSource` cannot be used: the endpoint is a POST and the request has to
 * carry a credential. So this is `fetch` + `response.body.getReader()` + a
 * hand-rolled SSE frame parser, and everything `EventSource` would have done for
 * free — framing, reconnection semantics, knowing when the stream is over — is
 * written out below.
 *
 * ─── How the credential is carried ──────────────────────────────────────────
 *
 * It isn't, by this module. The browser never holds a bearer token: `itemba_access`
 * is httpOnly, and `frontend/src/app/api/backend/[...path]/route.ts` reads it
 * server-side and sets `Authorization: Bearer …` on the upstream request. So a
 * browser `POST /api/backend/msaidizi/ask/stream` arrives at the controller with
 * a real token and the agent replays the caller's own credential against the
 * caller's own services. Two consequences worth stating:
 *
 *   - Never `apiFetch()`. `API_URL` is `NEXT_PUBLIC_API_URL ?? '/api/backend'`,
 *     and in production that env var is the public API origin — the bare helper
 *     bypasses the proxy and carries no credential at all.
 *   - The proxy passes SSE through unbuffered. It branches on content-type and
 *     hands non-JSON bodies straight to `new NextResponse(backendRes.body)`, and
 *     it forwards `cache-control`, so the backend's `no-transform` survives and
 *     Caddy's compressor does not swallow the stream into a buffer.
 *
 * CSRF and the 401 dance are handled here rather than inherited, so the module
 * works in a test and in a route that has not mounted `CsrfFetchProvider`. The
 * provider attaches the same header idempotently, and its `json` shim never
 * touches `response.body`, so `getReader()` stays available underneath it.
 *
 * ─── What the transport does NOT do ─────────────────────────────────────────
 *
 * Aborting the request does not cancel the run. `MsaidiziService.run()` takes no
 * `AbortSignal`; closing the stream only makes the server's `send()` a no-op,
 * and the remaining model turns and tool calls execute to completion. That is
 * why `aborted` and `disconnected` are distinct terminations here and why both
 * are reported as "the run is still finishing" rather than "stopped".
 *
 * There is no per-token channel. The backend awaits `stream.finalMessage()`, so
 * frames arrive per model turn — first light measured 6 frames over ~4s with a
 * real spread. A turn appears whole because it *is* whole; a typewriter here
 * would be a fabricated cadence that makes a slow run look like a stalled fast
 * one.
 */

import { MANAGED_401_HEADER, SESSION_EXPIRED_EVENT } from './api-client';
import { asDoneReason, asSequence } from './msaidizi-types';
import type { MsaidiziConflictCode } from './msaidizi-types';
import type {
  DoneReason,
  MsaidiziAskRequest,
  MsaidiziEvent,
  MsaidiziRunResult,
  MsaidiziSessionFrame,
} from './msaidizi-types';

/** Through the proxy, always. See the file header. */
export const MSAIDIZI_STREAM_PATH = '/api/backend/msaidizi/ask/stream';

/** The route the proxy exposes for a silent token refresh, as api-client uses it. */
const REFRESH_PATH = '/api/auth/refresh';

/**
 * Hard ceiling on a single unterminated frame.
 *
 * The `result` frame carries the whole `messages` array and is legitimately
 * large — the backend's own resume cap defaults to 1 MB — so this is generous.
 * It exists so that a proxy that starts emitting garbage produces a stated
 * failure instead of a tab that grows until it dies.
 */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

// ─── Frames ───────────────────────────────────────────────────────────────────

/** A raw SSE frame, before anyone has decided what it means. */
export interface SseFrame {
  /** The `event:` field, or `message` when the frame did not name one. */
  event: string;
  /** The `data:` field(s), joined with newlines exactly as the spec says. */
  data: string;
  id?: string;
}

/**
 * A decoded Msaidizi frame.
 *
 * Decoding keys off the SSE `event:` NAME, never `data.type`. Two of the frames
 * this stream writes have no `data.type` at all — the controller's catch-all
 * `error`, which is a bare `{ message }`, and the `result` frame, which is the
 * `RunResult` — so a client that sniffs the payload gets both of them wrong. The
 * `session` frame does carry a matching `type`, and is decoded by name anyway:
 * one rule for every frame is what keeps the next one that arrives without a
 * `type` from being a special case.
 */
export type MsaidiziFrame =
  | { kind: 'event'; event: MsaidiziEvent }
  | { kind: 'result'; result: MsaidiziRunResult }
  | { kind: 'session'; session: MsaidiziSessionFrame }
  /** A frame whose name this build does not know. Carried, not dropped silently. */
  | { kind: 'unknown'; name: string; data: unknown }
  /** A frame that did not parse. A lost frame is a lost step, not a dead run. */
  | { kind: 'malformed'; name: string; raw: string; reason: string };

const EVENT_NAMES: ReadonlySet<string> = new Set([
  'text',
  'tool_call',
  'tool_result',
  'confirmation_required',
  'done',
  'error',
]);

/**
 * Incremental SSE frame parser.
 *
 * The three things that make hand-rolling this worth doing carefully:
 *
 *   1. A frame can be split across any number of chunk boundaries — including
 *      between the two newlines that terminate it, and mid-way through the JSON
 *      of a megabyte `result`. Nothing is dispatched until its blank line lands.
 *   2. Line breaks may be LF, CRLF or a bare CR, and a chunk can end on the CR
 *      half of a CRLF. That trailing CR is held back rather than treated as a
 *      break.
 *   3. An unterminated frame at end-of-stream is DISCARDED, per the spec. That
 *      is the honest behaviour here too: half a `result` frame is not a result,
 *      and the run reports as disconnected instead of as a truncated success.
 */
export class SseFrameParser {
  private buffer = '';

  /** Feed a decoded text chunk; returns every frame that completed within it. */
  push(chunk: string): SseFrame[] {
    if (!chunk) return [];
    this.buffer += chunk;

    if (this.buffer.length > MAX_FRAME_BYTES) {
      this.buffer = '';
      throw new Error('The assistant sent a frame too large to read.');
    }

    // A trailing CR may be the first half of a CRLF landing in the next chunk.
    let scan = this.buffer;
    let held = '';
    if (scan.endsWith('\r')) {
      held = '\r';
      scan = scan.slice(0, -1);
    }

    const normalised = scan.replace(/\r\n|\r/g, '\n');
    const lastBreak = normalised.lastIndexOf('\n\n');
    if (lastBreak === -1) {
      this.buffer = normalised + held;
      return [];
    }

    this.buffer = normalised.slice(lastBreak + 2) + held;

    const frames: SseFrame[] = [];
    for (const block of normalised.slice(0, lastBreak).split('\n\n')) {
      const frame = parseBlock(block);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  /** Bytes held back waiting for a terminator. Useful when explaining a drop. */
  get pending(): number {
    return this.buffer.length;
  }
}

function parseBlock(block: string): SseFrame | null {
  let event = '';
  let id: string | undefined;
  const data: string[] = [];

  for (const line of block.split('\n')) {
    if (line === '') continue;
    // `:` opens a comment. Heartbeats arrive this way if one is ever added.
    if (line.startsWith(':')) continue;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
    // `retry:` is deliberately ignored: this transport never reconnects on its
    // own. A resumed run is a new HTTP request the user asked for.
  }

  // A block of comments only carries nothing to dispatch.
  if (data.length === 0 && event === '') return null;

  return { event: event || 'message', data: data.join('\n'), id };
}

/** Turn a raw frame into something the conversation can use. Never throws. */
export function decodeFrame(frame: SseFrame): MsaidiziFrame {
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return {
      kind: 'malformed',
      name: frame.event,
      raw: frame.data,
      reason: 'The frame did not contain readable JSON.',
    };
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return {
      kind: 'malformed',
      name: frame.event,
      raw: frame.data,
      reason: 'The frame did not contain an object.',
    };
  }

  const record = payload as Record<string, unknown>;

  if (frame.event === 'result') {
    if (typeof record.sessionId !== 'string' || !Array.isArray(record.events)) {
      return {
        kind: 'malformed',
        name: frame.event,
        raw: frame.data,
        reason: 'The result frame was missing its session or events.',
      };
    }
    // `messages` is passed through by reference and never rebuilt: this value is
    // what gets echoed back on the next turn, and any normalisation applied here
    // would be a normalisation applied to the API's own transport state.
    return { kind: 'result', result: record as unknown as MsaidiziRunResult };
  }

  if (frame.event === 'session') {
    return { kind: 'session', session: record as MsaidiziSessionFrame };
  }

  if (EVENT_NAMES.has(frame.event)) {
    // Key off the frame name, not `data.type`: the controller's catch-all error
    // frame is a bare `{ message }` with no `type` at all.
    return { kind: 'event', event: { ...record, type: frame.event } as MsaidiziEvent };
  }

  return { kind: 'unknown', name: frame.event, data: payload };
}

// ─── Outcome ──────────────────────────────────────────────────────────────────

/**
 * How a run ended, from the client's point of view.
 *
 * `done` is the server's own verdict and fans out into the seven reasons the plan
 * names. The other four are transport facts the server never got to comment on,
 * and each needs its own sentence on screen — a stall that renders identically
 * to a slow run is the failure this whole type exists to prevent.
 */
export type MsaidiziTermination =
  /** The run reported itself finished. Branch on `reason` for the seven states. */
  | { kind: 'done'; reason: DoneReason }
  /**
   * The server wrote its catch-all `error` frame and stopped without a verdict.
   * `run()` threw; nothing further will arrive.
   */
  | { kind: 'stream_failed'; message: string }
  /**
   * The stream ended, or broke, before the run reported anything. The run is
   * still executing on the server — this is a lost view, not a stopped run.
   */
  | { kind: 'disconnected'; message: string }
  /** The caller aborted. Also a lost view: the run continues to completion. */
  | { kind: 'aborted' }
  /**
   * The request never became a stream. A 503 (switched off), a 403 (no
   * `msaidizi.use`), an unrecoverable 401, an unreachable proxy, or a 200 that
   * was not `text/event-stream`. Nothing ran.
   */
  | {
      kind: 'unavailable';
      /** HTTP status, or `null` when no response was ever received. */
      status: number | null;
      cause: 'network' | 'http' | 'session_expired' | 'not_a_stream';
      message: string;
      /**
       * The server's own discriminator for this refusal, when it sent one.
       *
       * Only the 409s carry one today. It is what lets the UI tell a conflict
       * that clears by itself from one that never will WITHOUT reading the
       * server's prose — see `MsaidiziConflictCode`. Absent on every other
       * status, and absent from an older backend, so a reader must branch on
       * its presence rather than assume it.
       */
      code?: MsaidiziConflictCode;
    };

export interface MsaidiziStreamOutcome {
  termination: MsaidiziTermination;
  /** Every trace event that arrived, in order, `done` included. */
  events: MsaidiziEvent[];
  /**
   * The final `result` frame, or `null` when the run never reported one.
   *
   * Null is the case that matters: there is no `messages` to echo, so this tab's
   * own history now has a hole where that exchange was, and continuing on it
   * alone would drop the turn from the model's view of the conversation.
   *
   * Whether that ends the thread is decided a layer up rather than here, and it
   * is no longer automatic: the `session` frame beside this one says whether the
   * server opened a row for the same turn, and a run the server committed is one
   * it can still be asked to continue from. See `historyComplete` in
   * msaidizi-conversation.ts.
   */
  result: MsaidiziRunResult | null;
  /**
   * The `session` frame. Null when the stream died before it arrived — it is
   * written before the first model turn, so that is a very short window.
   */
  session: MsaidiziSessionFrame | null;
  /** Frames that arrived but could not be read. Surface a count, not silence. */
  malformedFrames: number;
  /**
   * Frames whose event name this build does not know.
   *
   * Not an error — the backend may ship a frame before the frontend learns to
   * use it, and that is the point of carrying them. But an update that went
   * unread is the same fact as one that could not be read, and without a count
   * beside `malformedFrames` the only honest signal is a number nobody kept.
   */
  unknownFrames: number;
  /** Wall clock from request to termination. */
  durationMs: number;
}

export interface MsaidiziStreamHandlers {
  /** Every decoded frame, in arrival order, including unknown and malformed ones. */
  onFrame?: (frame: MsaidiziFrame) => void;
  /** Convenience: just the trace events, for a thread that renders steps live. */
  onEvent?: (event: MsaidiziEvent) => void;
  /** Fires when the run reports its verdict, before the stream closes. */
  onResult?: (result: MsaidiziRunResult) => void;
  onSession?: (session: MsaidiziSessionFrame) => void;
}

export interface MsaidiziStreamOptions {
  /** Aborting loses the view of the run. It does not stop the run. */
  signal?: AbortSignal;
  /** Override for tests. Defaults to the proxy path. */
  endpoint?: string;
  /** Override for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Override for tests. Defaults to reading the `itemba_csrf` cookie. */
  csrfToken?: string | null;
  /** Override for tests. Defaults to `POST /api/auth/refresh`. */
  refreshSession?: () => Promise<boolean>;
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number;
}

// ─── The client ───────────────────────────────────────────────────────────────

/**
 * Run one turn and stream its frames.
 *
 * Never throws for a transport failure. Every ugly case — a dead proxy, a 503, a
 * 401 that a refresh cannot fix, a body that is not a stream, a connection that
 * drops mid-run, a frame that does not parse — comes back as a `termination` the
 * caller can render. A promise that rejects would put those cases in a `catch`
 * where they all look the same, and looking the same is the problem.
 */
export async function streamMsaidiziAsk(
  request: MsaidiziAskRequest,
  handlers: MsaidiziStreamHandlers = {},
  options: MsaidiziStreamOptions = {},
): Promise<MsaidiziStreamOutcome> {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const events: MsaidiziEvent[] = [];
  let result: MsaidiziRunResult | null = null;
  let session: MsaidiziSessionFrame | null = null;
  let malformedFrames = 0;
  let unknownFrames = 0;

  const settle = (termination: MsaidiziTermination): MsaidiziStreamOutcome => ({
    termination,
    events,
    result,
    session,
    malformedFrames,
    unknownFrames,
    durationMs: Math.max(0, now() - startedAt),
  });

  const response = await openStream(request, options);
  if ('termination' in response) return settle(response.termination);

  const parser = new SseFrameParser();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  const consume = (chunk: string) => {
    for (const raw of parser.push(chunk)) {
      const frame = decodeFrame(raw);
      handlers.onFrame?.(frame);

      switch (frame.kind) {
        case 'event':
          events.push(frame.event);
          handlers.onEvent?.(frame.event);
          break;
        case 'result':
          result = frame.result;
          handlers.onResult?.(frame.result);
          break;
        case 'session':
          session = frame.session;
          handlers.onSession?.(frame.session);
          break;
        case 'malformed':
          malformedFrames += 1;
          break;
        case 'unknown':
          // A frame this build does not know about is not an error — the
          // backend may ship one before the frontend learns to use it. It is
          // handed to `onFrame` above and left alone otherwise, but it is
          // counted: silence is how a whole class of update goes unnoticed.
          unknownFrames += 1;
          break;
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      consume(decoder.decode(value, { stream: true }));
    }
    consume(decoder.decode());
  } catch (error) {
    // A verdict that already arrived is the truth about the run, whatever the
    // socket did afterwards — a connection that dies between `done` and
    // `result` has still told us how the run ended.
    const reported = verdictFrom(events);
    if (reported) return settle(reported);
    if (isAbort(error, options.signal)) return settle({ kind: 'aborted' });
    return settle({
      kind: 'disconnected',
      message: describeDrop(error, parser.pending),
    });
  } finally {
    // Cancelling an already-finished stream is a no-op; cancelling an abandoned
    // one is what releases it. It rejects on a stream that already errored, and
    // that failure has been turned into a termination above, so drop it.
    void reader.cancel().catch(() => undefined);
  }

  const verdict = verdictFrom(events);
  if (verdict) return settle(verdict);
  if (options.signal?.aborted) return settle({ kind: 'aborted' });

  return settle({
    kind: 'disconnected',
    message:
      parser.pending > 0
        ? 'The connection closed part-way through a message.'
        : 'The connection closed before the assistant reported a result.',
  });
}

/**
 * What the run itself said, read back off the collected trace so there is one
 * source of truth for what arrived rather than a flag set in the reader loop.
 *
 * `done` first: the service emits it exactly once and it is the verdict. The
 * catch-all `error` frame only ever appears without one, when `run()` threw and
 * the controller reported the failure on an already-open stream.
 */
function verdictFrom(events: MsaidiziEvent[]): MsaidiziTermination | null {
  const done = events.find((event) => event.type === 'done');
  // `done.reason` is typed as the union but sourced from an unvalidated wire
  // string, so it is read through `asDoneReason` HERE, at the transport
  // boundary. What that buys is narrow and worth stating exactly: no
  // `MsaidiziTermination` built on this path carries a reason outside the seven,
  // so a verdict this build cannot name arrives downstream as `failed` and draws
  // the `failed` copy. It is the same reading the stored path applies to a
  // stored `reason`, from the same list, so the two halves cannot disagree about
  // what this build knows how to render. A renderer that also defends itself
  // against an unrecognised key is defending against a termination built
  // somewhere other than here — not against this one.
  if (done) return { kind: 'done', reason: asDoneReason(done.reason) };
  const failure = events.find((event) => event.type === 'error');
  if (failure) return { kind: 'stream_failed', message: failure.message };
  return null;
}

type OpenedStream = { body: ReadableStream<Uint8Array> } | { termination: MsaidiziTermination };

/**
 * Get to a readable SSE body, or to a stated reason why there isn't one.
 *
 * The pre-stream failures are ordinary JSON, not SSE frames: the enabled and
 * permission guards throw before `flushHeaders()`, so a 503 or a 403 arrives as
 * an exception-filter body. Hence the content-type check on the success path —
 * a 200 that is not `text/event-stream` means something in front of us replaced
 * the response, and reading it as a stream would hang.
 */
async function openStream(
  request: MsaidiziAskRequest,
  options: MsaidiziStreamOptions,
): Promise<OpenedStream> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.endpoint ?? MSAIDIZI_STREAM_PATH;
  const body = serialiseAsk(request);

  const attempt = () =>
    fetchImpl(endpoint, {
      method: 'POST',
      headers: requestHeaders(options),
      body,
      cache: 'no-store',
      signal: options.signal,
    });

  let response: Response;
  try {
    response = await attempt();
  } catch (error) {
    if (isAbort(error, options.signal)) return { termination: { kind: 'aborted' } };
    return { termination: unreachable() };
  }

  // A 401 means the guard rejected before the run started, so retrying is safe:
  // no model turn happened and no tool was called. The proxy already tried its
  // own refresh; this is the second and last attempt, matching api-client.
  if (response.status === 401) {
    const refreshed = await (options.refreshSession ?? refreshSession)();
    if (refreshed) {
      try {
        response = await attempt();
      } catch (error) {
        if (isAbort(error, options.signal)) return { termination: { kind: 'aborted' } };
        return { termination: unreachable() };
      }
    }
    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      }
      return {
        termination: {
          kind: 'unavailable',
          status: 401,
          cause: 'session_expired',
          message: 'Your session has expired. Sign in again to continue.',
        },
      };
    }
  }

  if (!response.ok) {
    const refusal = await refusalFromErrorResponse(response);
    return {
      termination: {
        kind: 'unavailable',
        status: response.status,
        cause: 'http',
        message: refusal.message,
        ...(refusal.code ? { code: refusal.code } : {}),
      },
    };
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('text/event-stream')) {
    return {
      termination: {
        kind: 'unavailable',
        status: response.status,
        cause: 'not_a_stream',
        message: 'The assistant replied in an unexpected format.',
      },
    };
  }

  if (!response.body) {
    return {
      termination: {
        kind: 'unavailable',
        status: response.status,
        cause: 'not_a_stream',
        message: 'The assistant replied without a readable stream.',
      },
    };
  }

  return { body: response.body };
}

/** The one failure with no HTTP status to report: the proxy was never reached. */
function unreachable(): MsaidiziTermination {
  return {
    kind: 'unavailable',
    status: null,
    cause: 'network',
    message: 'Could not reach the assistant. Check your connection and try again.',
  };
}

/**
 * Serialise the request body.
 *
 * `history` goes in exactly as it was received. It is not copied, not mapped,
 * not filtered, not sorted, not re-typed. The backend's own DTO leaves
 * `content` undecorated for the same reason, with a comment recording that
 * typing it stripped provider fields and broke multi-turn outright. This is the
 * client-side half of that contract.
 *
 * The other half of the job is the part that fails silently: this is an
 * ALLOWLIST, and it is the only body builder on this path, so a field of
 * `MsaidiziAskRequest` not named below does not leave the browser at all. It
 * shipped once without `conversationId` and `sequence`, which took the whole
 * server-authoritative continuation path — the 409 two-tab guard, both 410
 * sentences, and resuming a reopened thread from server-held state — out of the
 * product while every type checked and every test passed. Adding a field to
 * that interface means adding a line here, and the test that holds it has to
 * read the serialised body string: one that reads the request OBJECT cannot see
 * a field this function drops.
 */
function serialiseAsk(request: MsaidiziAskRequest): string {
  const body: MsaidiziAskRequest = { message: request.message };
  if (request.history && request.history.length > 0) body.history = request.history;
  if (request.sessionId) body.sessionId = request.sessionId;
  if (request.confirmed && request.confirmed.length > 0) body.confirmed = request.confirmed;
  if (request.conversationId) body.conversationId = request.conversationId;
  // The wire boundary for the sequence check: whatever the caller is holding, a
  // non-positive one is not a claim about where the conversation is and the
  // server would read it as this tab being behind. Absent says "unknown", which
  // is what an unpersisted turn leaves behind and the only honest thing to send.
  const sequence = asSequence(request.sequence);
  if (sequence !== null) body.sequence = sequence;
  return JSON.stringify(body);
}

function requestHeaders(options: MsaidiziStreamOptions): Record<string, string> {
  const csrf = options.csrfToken === undefined ? readCookie('itemba_csrf') : options.csrfToken;
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    // Tells CsrfFetchProvider that this request runs its own 401 recovery, so it
    // does not bounce to /login before the retry above has had its chance.
    [MANAGED_401_HEADER]: '1',
    ...(csrf ? { 'x-csrf-token': csrf } : {}),
  };
}

/**
 * The server's sentence, and its discriminator when it sent one.
 *
 * The sentence is what the user reads and is extracted exactly as before —
 * class-validator's array form, the `error` field, a status-carrying fallback
 * for a gateway's HTML page. The `code` is what a branch may be built on, and
 * it is deliberately read separately: a body may carry a perfectly good sentence
 * and no code at all (every non-409, and any backend older than the code), so
 * the two are never made to depend on each other.
 */
async function refusalFromErrorResponse(
  response: Response,
): Promise<{ message: string; code?: MsaidiziConflictCode }> {
  const fallback = `The assistant is unavailable (${response.status}).`;
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    // A non-JSON error body — a gateway's HTML page, most likely. The status is
    // the only honest thing we have, and the fallback already carries it.
    return { message: fallback };
  }
  if (typeof payload !== 'object' || payload === null) return { message: fallback };
  return { message: messageFrom(payload, fallback), code: conflictCodeFrom(payload) };
}

function messageFrom(payload: object, fallback: string): string {
  const message = (payload as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.trim()) return message;
  const error = (payload as { error?: unknown }).error;
  return typeof error === 'string' && error.trim() ? error : fallback;
}

/**
 * Narrowed against the closed vocabulary rather than passed through, for the
 * same reason `asDoneReason` narrows: a code this build does not know must not
 * reach a branch that only understands two values and be treated as whichever
 * one the comparison happens to miss. An unknown code reads as no code, and the
 * caller's unrecognised-conflict default takes over.
 */
const CONFLICT_CODES: ReadonlySet<string> = new Set(['unfinished_turn', 'continued_elsewhere']);

function conflictCodeFrom(payload: object): MsaidiziConflictCode | undefined {
  const code = (payload as { code?: unknown }).code;
  return typeof code === 'string' && CONFLICT_CODES.has(code)
    ? (code as MsaidiziConflictCode)
    : undefined;
}

async function refreshSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const res = await fetch(REFRESH_PATH, { method: 'POST', cache: 'no-store' });
    return res.ok;
  } catch {
    // The refresh endpoint is unreachable. Reported by the caller as an expired
    // session, which is what the user needs to do something about either way.
    return false;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const encoded = `${encodeURIComponent(name)}=`;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(encoded));
  return match ? decodeURIComponent(match.slice(encoded.length)) : null;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function describeDrop(error: unknown, pending: number): string {
  if (pending > 0) return 'The connection dropped part-way through a message.';
  const detail = error instanceof Error ? error.message : '';
  return detail
    ? `The connection to the assistant dropped: ${detail}`
    : 'The connection to the assistant dropped.';
}
