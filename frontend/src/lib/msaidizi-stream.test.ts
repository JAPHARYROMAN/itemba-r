import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_EXPIRED_EVENT } from './api-client';
import {
  SseFrameParser,
  decodeFrame,
  streamMsaidiziAsk,
  type MsaidiziFrame,
} from './msaidizi-stream';
import type { MsaidiziAskRequest, MsaidiziRunResult, ModelMessage } from './msaidizi-types';

const encoder = new TextEncoder();

/** A response whose body arrives as the given chunks, in order, then closes. */
function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    ...init,
  });
}

/**
 * A response that dies part-way through, the way a reaped connection does.
 * The chunks are pulled one at a time so they genuinely reach the reader before
 * the error does — erroring from `start()` discards the queue instead.
 */
function droppedResponse(chunks: string[]): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
        return;
      }
      controller.error(new Error('socket hang up'));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const RESULT: MsaidiziRunResult = {
  sessionId: 'ms_abc',
  events: [{ type: 'done', reason: 'end_turn' }],
  reason: 'end_turn',
  messages: [{ role: 'user', content: 'How much do we owe suppliers?' }],
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadInputTokens: 1042,
    cacheCreationInputTokens: 0,
    modelTurns: 2,
  },
};

const ASK: MsaidiziAskRequest = { message: 'How much do we owe suppliers?' };

describe('SseFrameParser', () => {
  it('holds a frame back until its blank line arrives', () => {
    const parser = new SseFrameParser();
    expect(parser.push('event: text\n')).toEqual([]);
    expect(parser.push('data: {"type":"text","text":"hi"}\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([
      { event: 'text', data: '{"type":"text","text":"hi"}', id: undefined },
    ]);
  });

  it('reassembles a frame split at every single character boundary', () => {
    const wire = frame('text', { type: 'text', text: 'Three suppliers have unpaid invoices.' });
    const parser = new SseFrameParser();
    const frames = [];
    for (const character of wire) frames.push(...parser.push(character));

    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0].data)).toEqual({
      type: 'text',
      text: 'Three suppliers have unpaid invoices.',
    });
    expect(parser.pending).toBe(0);
  });

  it('splits correctly when a chunk boundary lands between the two terminating newlines', () => {
    const parser = new SseFrameParser();
    expect(parser.push('event: done\ndata: {"type":"done","reason":"end_turn"}\n')).toEqual([]);
    const frames = parser.push('\nevent: result\ndata: {}\n\n');
    expect(frames.map((f) => f.event)).toEqual(['done', 'result']);
  });

  it('emits several frames that arrive inside one chunk, in order', () => {
    const parser = new SseFrameParser();
    const frames = parser.push(
      frame('text', { type: 'text', text: 'a' }) +
        frame('tool_call', { type: 'tool_call', tool: 'Suppliers_findAll' }) +
        frame('done', { type: 'done', reason: 'end_turn' }),
    );
    expect(frames.map((f) => f.event)).toEqual(['text', 'tool_call', 'done']);
  });

  it('handles CRLF, including a chunk that ends on the CR half of one', () => {
    const parser = new SseFrameParser();
    expect(parser.push('event: text\r\ndata: {"type":"text","text":"hi"}\r')).toEqual([]);
    const frames = parser.push('\n\r\n');
    expect(frames).toEqual([{ event: 'text', data: '{"type":"text","text":"hi"}', id: undefined }]);
  });

  it('keeps one frame whole when a chunk ends on the CR of a line break inside it', () => {
    // What the trailing-CR hold-back is actually for. The case above passes
    // either way — the orphaned `\n` it would leave behind is swallowed by the
    // frame's own terminator — so it is this one that pins the behaviour: a CR
    // ending a chunk at a NON-terminating break, here between the `event:` line
    // and its `data:` line. Treat that CR as a break and the following `\n`
    // completes a blank line, splitting one event into two: a name with no
    // payload, then a payload the parser can no longer tell you the name of.
    const parser = new SseFrameParser();
    expect(parser.push('event: text\r')).toEqual([]);
    const frames = parser.push('\ndata: {"type":"text","text":"hi"}\r\n\r\n');

    expect(frames).toEqual([{ event: 'text', data: '{"type":"text","text":"hi"}', id: undefined }]);
    expect(parser.pending).toBe(0);
  });

  it('ignores comment lines and joins multi-line data with newlines', () => {
    const parser = new SseFrameParser();
    const frames = parser.push(': heartbeat\nevent: text\ndata: one\ndata: two\nid: 7\n\n');
    expect(frames).toEqual([{ event: 'text', data: 'one\ntwo', id: '7' }]);
  });

  it('discards an unterminated frame at end of stream rather than half-dispatching it', () => {
    const parser = new SseFrameParser();
    expect(parser.push('event: result\ndata: {"sessionId":"ms_a"')).toEqual([]);
    expect(parser.pending).toBeGreaterThan(0);
  });
});

describe('decodeFrame', () => {
  it('keys off the frame name, so the catch-all error frame decodes without a data.type', () => {
    const decoded = decodeFrame({ event: 'error', data: '{"message":"could not complete"}' });
    expect(decoded).toEqual({
      kind: 'event',
      event: { type: 'error', message: 'could not complete' },
    });
  });

  it('reports an unreadable frame instead of throwing', () => {
    const decoded = decodeFrame({ event: 'text', data: '{"type":"text"' });
    expect(decoded.kind).toBe('malformed');
  });

  it('rejects a result frame that is missing its session or events', () => {
    expect(decodeFrame({ event: 'result', data: '{"reason":"end_turn"}' }).kind).toBe('malformed');
  });

  it('carries a frame this build does not know about rather than dropping it', () => {
    const decoded = decodeFrame({ event: 'heartbeat', data: '{"at":1}' });
    expect(decoded).toEqual({ kind: 'unknown', name: 'heartbeat', data: { at: 1 } });
  });
});

describe('streamMsaidiziAsk', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = 'itemba_csrf=; Max-Age=0; path=/';
  });

  it('streams frames as they arrive and terminates on the run’s own verdict', async () => {
    const wire = [
      frame('text', { type: 'text', text: 'Looking into it.' }),
      frame('tool_call', {
        type: 'tool_call',
        tool: 'SupplierInvoices_findAll',
        capabilityId: 'cap_1',
        tier: 'green',
        args: {},
      }),
      frame('tool_result', {
        type: 'tool_result',
        tool: 'SupplierInvoices_findAll',
        ok: true,
        status: 200,
      }),
      frame('done', { type: 'done', reason: 'end_turn' }),
      frame('result', RESULT),
    ];
    const seen: MsaidiziFrame[] = [];

    const outcome = await streamMsaidiziAsk(
      ASK,
      { onFrame: (f) => seen.push(f) },
      { fetchImpl: async () => sseResponse(wire) },
    );

    expect(outcome.termination).toEqual({ kind: 'done', reason: 'end_turn' });
    expect(outcome.events.map((event) => event.type)).toEqual([
      'text',
      'tool_call',
      'tool_result',
      'done',
    ]);
    expect(outcome.result?.sessionId).toBe('ms_abc');
    expect(seen.map((f) => f.kind)).toEqual(['event', 'event', 'event', 'event', 'result']);
    expect(outcome.malformedFrames).toBe(0);
    expect(outcome.unknownFrames).toBe(0);
  });

  it('counts a frame whose name this build does not know instead of losing it', async () => {
    // The transport's contract is that an unrecognised frame is carried, not
    // dropped. Carrying it is only half of that: a run that read an update it
    // could not use has to be able to say so, the same way it says how many
    // frames it could not read at all.
    const seen: MsaidiziFrame[] = [];
    const outcome = await streamMsaidiziAsk(
      ASK,
      { onFrame: (f) => seen.push(f) },
      {
        fetchImpl: async () =>
          sseResponse([
            frame('heartbeat', { at: 1 }),
            frame('done', { type: 'done', reason: 'end_turn' }),
          ]),
      },
    );

    expect(outcome.unknownFrames).toBe(1);
    expect(outcome.malformedFrames).toBe(0);
    expect(seen.filter((f) => f.kind === 'unknown')).toHaveLength(1);
    // It is not a trace event and must not be rendered as one.
    expect(outcome.events.map((event) => event.type)).toEqual(['done']);
  });

  it('reports a verdict this build cannot name as failed rather than passing it through', async () => {
    // The reason is an unvalidated wire string, and this is where it stops being
    // one: nothing downstream of the transport sees a reason outside the seven, so
    // a verdict this build cannot name draws the `failed` notice rather than
    // whatever a renderer does with a key it has no arm for. The stored path has
    // always read a stored reason the same way; this is the live half of it.
    const unknownReason = await streamMsaidiziAsk(
      ASK,
      {},
      {
        fetchImpl: async () => sseResponse([frame('done', { type: 'done', reason: 'cancelled' })]),
      },
    );
    expect(unknownReason.termination).toEqual({ kind: 'done', reason: 'failed' });

    const noReason = await streamMsaidiziAsk(
      ASK,
      {},
      { fetchImpl: async () => sseResponse([frame('done', {})]) },
    );
    expect(noReason.termination).toEqual({ kind: 'done', reason: 'failed' });
  });

  it('carries a truncated verdict through rather than flattening it to failed', async () => {
    // The other side of the same coercion, and the reason it has to be a list
    // rather than a shrug. A turn cut off at the token ceiling streams prose and
    // no tool calls — byte for byte what a finished turn streams — so `reason`
    // is the ONLY thing that says the answer stops mid-sentence. If `truncated`
    // is not on the known list `asDoneReason` reads it as `failed`, and the
    // thread tells the user the model was unreachable about a run that answered.
    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      {
        fetchImpl: async () =>
          sseResponse([
            frame('text', {
              type: 'text',
              text: 'Three suppliers have unpaid invoices totalling TZS 4,18',
            }),
            frame('done', { type: 'done', reason: 'truncated' }),
          ]),
      },
    );

    expect(outcome.termination).toEqual({ kind: 'done', reason: 'truncated' });
  });

  it('reassembles frames that straddle chunk boundaries in the real transport', async () => {
    const wire = frame('done', { type: 'done', reason: 'end_turn' }) + frame('result', RESULT);
    const chunks: string[] = [];
    for (let index = 0; index < wire.length; index += 7) chunks.push(wire.slice(index, index + 7));

    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      { fetchImpl: async () => sseResponse(chunks) },
    );

    expect(outcome.termination).toEqual({ kind: 'done', reason: 'end_turn' });
    expect(outcome.result).toEqual(RESULT);
  });

  it('surfaces a mid-stream drop as its own state rather than a silent stall', async () => {
    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      {
        fetchImpl: async () =>
          droppedResponse([
            frame('text', { type: 'text', text: 'Looking into it.' }),
            'event: result\ndata: {"sessionId":"ms_abc"',
          ]),
      },
    );

    expect(outcome.termination.kind).toBe('disconnected');
    expect(outcome.result).toBeNull();
    // The work that did arrive is kept — a dropped view is not a dropped run.
    expect(outcome.events).toHaveLength(1);
    if (outcome.termination.kind === 'disconnected') {
      expect(outcome.termination.message).toMatch(/part-way|dropped/i);
    }
  });

  it('keeps a verdict that arrived before the socket died', async () => {
    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      {
        fetchImpl: async () =>
          droppedResponse([
            frame('done', { type: 'done', reason: 'awaiting_confirmation' }),
            'event: result\ndata: {"sessionId"',
          ]),
      },
    );

    expect(outcome.termination).toEqual({ kind: 'done', reason: 'awaiting_confirmation' });
    expect(outcome.result).toBeNull();
  });

  it('keeps the session frame when the socket dies before the result frame', async () => {
    // The same drop, with the frame that decides whether it is recoverable. The
    // `session` frame is written before the first model turn, and its
    // `conversationId` is the server saying it opened a row for THIS turn — so a
    // run that got as far as `done` and then lost the socket is a run the server
    // has, and a suspended approval on it can still be answered by conversation
    // id. That only holds if the frame survives decoding: read off the frame
    // NAME like every other, handed to `onSession` as it arrives, and left on
    // the outcome for a caller that was not listening. Lose it here and every
    // dropped run reads as unrecoverable, which is the state this whole shape
    // exists to distinguish from.
    const seen: unknown[] = [];
    const outcome = await streamMsaidiziAsk(
      ASK,
      { onSession: (session) => seen.push(session) },
      {
        fetchImpl: async () =>
          droppedResponse([
            frame('session', {
              type: 'session',
              conversationId: 'conv_1',
              agentSessionId: 'ms_A',
              sequence: 2,
            }),
            frame('confirmation_required', {
              type: 'confirmation_required',
              confirmationId: 'cnf_Invoices_remove_x1',
              tool: 'Invoices_remove',
              capabilityId: 'cap_del',
              description: 'Delete invoice — DELETE /invoices/:id with id=41',
              args: { id: '41' },
            }),
            frame('done', { type: 'done', reason: 'awaiting_confirmation' }),
            'event: result\ndata: {"sessionId":"ms_A","messages":[{"role"',
          ]),
      },
    );

    expect(seen).toEqual([
      { type: 'session', conversationId: 'conv_1', agentSessionId: 'ms_A', sequence: 2 },
    ]);
    expect(outcome.session?.conversationId).toBe('conv_1');
    expect(outcome.session?.sequence).toBe(2);
    expect(outcome.result).toBeNull();
    expect(outcome.termination).toEqual({ kind: 'done', reason: 'awaiting_confirmation' });
    // Not a trace event: the thread renders `events`, and a session handle drawn
    // as a step is a step nobody took.
    expect(outcome.events.map((event) => event.type)).toEqual(['confirmation_required', 'done']);
  });

  it('reports a clean close with no verdict as disconnected, not as success', async () => {
    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      { fetchImpl: async () => sseResponse([frame('text', { type: 'text', text: 'hi' })]) },
    );

    expect(outcome.termination.kind).toBe('disconnected');
    expect(outcome.result).toBeNull();
  });

  it('keeps the verdict when the result frame never lands', async () => {
    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      {
        fetchImpl: async () =>
          sseResponse([frame('done', { type: 'done', reason: 'awaiting_confirmation' })]),
      },
    );

    expect(outcome.termination).toEqual({ kind: 'done', reason: 'awaiting_confirmation' });
    expect(outcome.result).toBeNull();
  });

  it('distinguishes the server’s catch-all error frame from a dropped connection', async () => {
    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      {
        fetchImpl: async () =>
          sseResponse([frame('error', { message: 'The assistant could not complete this.' })]),
      },
    );

    expect(outcome.termination).toEqual({
      kind: 'stream_failed',
      message: 'The assistant could not complete this.',
    });
  });

  it('counts an unreadable frame and keeps reading', async () => {
    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      {
        fetchImpl: async () =>
          sseResponse([
            'event: text\ndata: {"type":"text"\n\n',
            frame('done', { type: 'done', reason: 'end_turn' }),
          ]),
      },
    );

    expect(outcome.malformedFrames).toBe(1);
    expect(outcome.termination).toEqual({ kind: 'done', reason: 'end_turn' });
  });

  it('reports a pre-stream failure as unavailable, with the server’s own message', async () => {
    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      {
        fetchImpl: async () =>
          jsonResponse({ message: 'Msaidizi is not enabled in this deployment.' }, 503),
      },
    );

    expect(outcome.termination).toEqual({
      kind: 'unavailable',
      status: 503,
      cause: 'http',
      message: 'Msaidizi is not enabled in this deployment.',
    });
    expect(outcome.events).toEqual([]);
  });

  it('refuses to read a 200 that is not an event stream', async () => {
    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      { fetchImpl: async () => jsonResponse({ success: true, data: {} }, 200) },
    );

    expect(outcome.termination).toMatchObject({ kind: 'unavailable', cause: 'not_a_stream' });
  });

  it('reports an unreachable proxy without inventing an HTTP status', async () => {
    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      {
        fetchImpl: async () => {
          throw new TypeError('Failed to fetch');
        },
      },
    );

    expect(outcome.termination).toMatchObject({
      kind: 'unavailable',
      status: null,
      cause: 'network',
    });
  });

  it('separates a caller abort from a connection drop', async () => {
    const controller = new AbortController();
    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      {
        signal: controller.signal,
        fetchImpl: async () => {
          controller.abort();
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        },
      },
    );

    expect(outcome.termination).toEqual({ kind: 'aborted' });
  });

  it('retries once after a 401 and streams the retried response', async () => {
    const responses = [
      jsonResponse({ message: 'Unauthorized' }, 401),
      sseResponse([frame('done', { type: 'done', reason: 'end_turn' }), frame('result', RESULT)]),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);

    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch, refreshSession: async () => true },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(outcome.termination).toEqual({ kind: 'done', reason: 'end_turn' });
  });

  it('gives up on a 401 the refresh cannot fix, and says the session expired', async () => {
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);

    const outcome = await streamMsaidiziAsk(
      ASK,
      {},
      {
        fetchImpl: async () => jsonResponse({ message: 'Unauthorized' }, 401),
        refreshSession: async () => false,
      },
    );

    window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
    expect(outcome.termination).toMatchObject({ kind: 'unavailable', cause: 'session_expired' });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('posts through the proxy with the CSRF token and the managed-401 marker', async () => {
    document.cookie = 'itemba_csrf=csrf-value; path=/';
    const fetchImpl = vi.fn(async () =>
      sseResponse([frame('done', { type: 'done', reason: 'end_turn' })]),
    );

    await streamMsaidiziAsk(ASK, {}, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/backend/msaidizi/ask/stream');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('csrf-value');
    expect(headers['x-itemba-managed-401']).toBe('1');
    expect(headers.Accept).toBe('text/event-stream');
  });

  it('echoes history byte-identically, keeps confirmed, and omits both when empty', async () => {
    // A realistic assistant turn: provider-added fields on the content blocks
    // that the API requires echoed back, and that a typed re-serialisation would
    // quietly strip. This is the failure that already broke multi-turn once.
    const history: ModelMessage[] = [
      { role: 'user', content: 'Delete invoice 41.' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will need you to confirm that.' },
          {
            type: 'tool_use',
            id: 'toolu_01XyZ',
            name: 'Invoices_remove',
            input: { id: '41' },
            cache_control: { type: 'ephemeral' },
            unknown_provider_field: { nested: [1, 2, { deep: true }] },
          },
        ],
      },
    ];
    const expected = JSON.stringify(history);

    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return sseResponse([frame('done', { type: 'done', reason: 'end_turn' })]);
    });

    await streamMsaidiziAsk(
      { message: 'Yes — go ahead.', history, sessionId: 'ms_abc', confirmed: ['cnf_1'] },
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    await streamMsaidiziAsk(
      { message: 'And the next one?', history: [], confirmed: [] },
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    const first = JSON.parse(bodies[0]) as MsaidiziAskRequest;
    expect(JSON.stringify(first.history)).toBe(expected);
    expect(first.sessionId).toBe('ms_abc');
    expect(first.confirmed).toEqual(['cnf_1']);

    const second = JSON.parse(bodies[1]) as MsaidiziAskRequest;
    expect(second).toEqual({ message: 'And the next one?' });
  });

  it('puts the conversation id and sequence on the wire, and never a sequence of zero', async () => {
    // Read off the body STRING, through the real `streamMsaidiziAsk`, and that
    // is the point of the test rather than an implementation detail of it.
    // `serialiseAsk` is an allowlist: it shipped copying only `message`,
    // `history`, `sessionId` and `confirmed`, so `conversationId` and `sequence`
    // never left the browser and the entire server-authoritative continuation
    // path — `continueById`, the 409 two-tab guard, both 410 sentences — was
    // unreachable in the product. Every test covering it mocked this module and
    // asserted the request OBJECT, which cannot see a field the serialiser
    // drops. So: real transport, injected fetch, assert what was posted.
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return sseResponse([frame('done', { type: 'done', reason: 'end_turn' })]);
    });

    await streamMsaidiziAsk(
      { message: 'And which of those are overdue?', conversationId: 'conv_1', sequence: 3 },
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    // A turn the store could not persist reports no sequence. Zero is not turn
    // zero, it is the absence of a turn, and sending it beside a real
    // conversation id is read by the server as this tab being behind — a 409
    // reading "continued in another window" for the rest of the conversation.
    await streamMsaidiziAsk(
      { message: 'And the supplier after that?', conversationId: 'conv_1', sequence: 0 },
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(JSON.parse(bodies[0])).toEqual({
      message: 'And which of those are overdue?',
      conversationId: 'conv_1',
      sequence: 3,
    });
    expect(bodies[1]).not.toContain('sequence');
    expect(JSON.parse(bodies[1])).toEqual({
      message: 'And the supplier after that?',
      conversationId: 'conv_1',
    });
  });
});

/* ------------------------------------------------------------------------ *
 * The 409 discriminator
 * ------------------------------------------------------------------------ *
 *
 * Two 409s come out of the conversations service and they are opposite answers:
 * one clears by itself, one never will. They used to be told apart by the
 * English in `message`, which meant a copy edit on the server silently flipped
 * the client's retry decision. `code` is the fix, and this is the half of it
 * that lives in the transport: if the field is dropped here, every branch
 * downstream quietly falls back to reading prose again and no test above would
 * notice.
 */
describe('MSAIDIZI-STREAM · the refusal code the server sends', () => {
  it('carries a recognised conflict code onto the termination', async () => {
    const outcome = await streamMsaidiziAsk(
      { message: 'and the second supplier?' },
      {},
      {
        fetchImpl: async () =>
          jsonResponse(
            {
              statusCode: 409,
              error: 'Conflict',
              code: 'unfinished_turn',
              message: 'The last thing you asked has not finished being saved.',
            },
            409,
          ),
      },
    );

    expect(outcome.termination).toEqual({
      kind: 'unavailable',
      status: 409,
      cause: 'http',
      code: 'unfinished_turn',
      message: 'The last thing you asked has not finished being saved.',
    });
  });

  it('carries the other code too, so the two are distinguishable', async () => {
    const outcome = await streamMsaidiziAsk(
      { message: 'and the second supplier?' },
      {},
      {
        fetchImpl: async () =>
          jsonResponse(
            { code: 'continued_elsewhere', message: 'This conversation continued elsewhere.' },
            409,
          ),
      },
    );

    expect(outcome.termination).toMatchObject({ status: 409, code: 'continued_elsewhere' });
  });

  // Narrowed rather than passed through, for the same reason `asDoneReason`
  // narrows: a value this build does not know must not reach a branch that
  // understands two of them and be treated as whichever one the comparison
  // happens to miss. An unknown code reads as no code at all.
  it('drops a code this build does not know', async () => {
    const outcome = await streamMsaidiziAsk(
      { message: 'and the second supplier?' },
      {},
      {
        fetchImpl: async () =>
          jsonResponse({ code: 'some_future_conflict', message: 'Refused.' }, 409),
      },
    );

    expect(outcome.termination).toEqual({
      kind: 'unavailable',
      status: 409,
      cause: 'http',
      message: 'Refused.',
    });
  });

  // A backend older than the code, and every status that never carries one. The
  // key must be absent rather than present-and-undefined.
  it('omits the field entirely when the server sent no code', async () => {
    const outcome = await streamMsaidiziAsk(
      { message: 'and the second supplier?' },
      {},
      {
        fetchImpl: async () =>
          jsonResponse({ message: 'This conversation continued in another window.' }, 409),
      },
    );

    expect(outcome.termination).not.toHaveProperty('code');
    expect(outcome.termination).toMatchObject({ status: 409 });
  });

  // The sentence and the code are read independently: a body may carry a
  // perfectly good message and no code, or — as the validation pipe does — an
  // array of messages. Neither may disturb the other.
  it('still joins an array message when a code is present', async () => {
    const outcome = await streamMsaidiziAsk(
      { message: 'and the second supplier?' },
      {},
      {
        fetchImpl: async () =>
          jsonResponse({ code: 'unfinished_turn', message: ['first fault', 'second fault'] }, 409),
      },
    );

    expect(outcome.termination).toMatchObject({
      code: 'unfinished_turn',
      message: 'first fault, second fault',
    });
  });
});
