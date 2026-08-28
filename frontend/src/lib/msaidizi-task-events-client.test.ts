import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MsaidiziTaskEvent } from './msaidizi-task-types';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('./api-client', () => ({
  BACKEND_PROXY_URL: '/api/backend',
  MANAGED_401_HEADER: 'x-itemba-managed-401',
  SESSION_EXPIRED_EVENT: 'itemba:session-expired',
  backendGet: api.get,
  backendPost: api.post,
  backendPut: api.put,
  backendDelete: api.delete,
  backendUpload: api.upload,
}));

import { MsaidiziTaskEventWatchError, watchMsaidiziTaskEvents } from './msaidizi-tasks-client';

const TASK_ID = 'task/one';
const PREVIOUS_HASH = '0'.repeat(64);
const EVENT_HASH = '1'.repeat(64);

function taskEvent(cursor: string, overrides: Partial<MsaidiziTaskEvent> = {}): MsaidiziTaskEvent {
  return {
    cursor,
    taskId: TASK_ID,
    type: 'step.succeeded',
    actorType: 'MSAIDIZI',
    actorId: 'principal-1',
    payload: { stepId: `step-${cursor}` },
    createdAt: '2026-08-25T08:00:00.000Z',
    integrityVersion: 1,
    previousHash: PREVIOUS_HASH,
    eventHash: EVENT_HASH,
    ...overrides,
  };
}

function eventFrame(event: MsaidiziTaskEvent, id: string = event.cursor): string {
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function heartbeatFrame(cursor: string): string {
  return `id: ${cursor}\nevent: heartbeat\ndata: ${JSON.stringify({ cursor, at: '2026-08-25T08:00:15.000Z' })}\n\n`;
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('durable Msaidizi task-event transport', () => {
  it('parses chunked frames, ignores replayed cursors, and keeps heartbeats out of the timeline', async () => {
    const controller = new AbortController();
    const first = taskEvent('1');
    const second = taskEvent('2');
    const wire = eventFrame(first) + heartbeatFrame('1') + eventFrame(first) + eventFrame(second);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        sseResponse([wire.slice(0, 13), wire.slice(13, 91), wire.slice(91, 157), wire.slice(157)]),
      );
    const rendered: MsaidiziTaskEvent[] = [];
    const cursors: string[] = [];

    await watchMsaidiziTaskEvents(TASK_ID, {
      signal: controller.signal,
      fetchImpl,
      onCursor: (cursor) => cursors.push(cursor),
      onEvents: (events, cursor) => {
        rendered.push(...events);
        if (cursor === '2') controller.abort();
      },
    });

    expect(rendered.map((event) => event.cursor)).toEqual(['1', '2']);
    expect(cursors).toEqual(['1', '1', '2']);
    expect(api.get).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/backend/msaidizi/tasks/task%2Fone/events/stream?after=0&limit=100',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: expect.objectContaining({ Accept: 'text/event-stream' }),
      }),
    );
  });

  it('rejects an id/payload cursor mismatch and recovers the event through polling', async () => {
    const controller = new AbortController();
    const event = taskEvent('3');
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([eventFrame(event, '9')]));
    api.get.mockResolvedValue({ data: [event], nextCursor: '3', hasMore: false });
    const rendered: MsaidiziTaskEvent[] = [];

    await watchMsaidiziTaskEvents(TASK_ID, {
      signal: controller.signal,
      fetchImpl,
      fallbackPollAttempts: 1,
      onEvents: (events) => {
        rendered.push(...events);
        controller.abort();
      },
    });

    expect(rendered.map((item) => item.cursor)).toEqual(['3']);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/msaidizi/tasks/task%2Fone/events', {
      query: { after: '0', limit: 100 },
      signal: controller.signal,
    });
  });

  it('rejects an event without a valid database integrity envelope', async () => {
    const controller = new AbortController();
    const valid = taskEvent('7');
    const invalid = { ...valid, eventHash: 'not-a-sha256' } as MsaidiziTaskEvent;
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([eventFrame(invalid)]));
    api.get.mockResolvedValue({ data: [valid], nextCursor: '7', hasMore: false });
    const rendered: MsaidiziTaskEvent[] = [];

    await watchMsaidiziTaskEvents(TASK_ID, {
      signal: controller.signal,
      fetchImpl,
      fallbackPollAttempts: 1,
      onEvents: (events) => {
        rendered.push(...events);
        controller.abort();
      },
    });

    expect(rendered).toEqual([valid]);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('reconnects the stream from the last accepted cursor after a drop and bounded poll', async () => {
    const controller = new AbortController();
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      if (urls.length === 1) return sseResponse([eventFrame(taskEvent('42'))]);
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    api.get.mockResolvedValue({ data: [], nextCursor: '42', hasMore: false });

    await watchMsaidiziTaskEvents(TASK_ID, {
      signal: controller.signal,
      fetchImpl,
      fallbackPollAttempts: 1,
      onEvents: () => undefined,
    });

    expect(urls).toEqual([
      '/api/backend/msaidizi/tasks/task%2Fone/events/stream?after=0&limit=100',
      '/api/backend/msaidizi/tasks/task%2Fone/events/stream?after=42&limit=100',
    ]);
    expect(api.get).toHaveBeenCalledWith('/msaidizi/tasks/task%2Fone/events', {
      query: { after: '42', limit: 100 },
      signal: controller.signal,
    });
  });

  it('aborts a live reader cleanly without starting the polling fallback', async () => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel: cancelled,
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    );

    const watching = watchMsaidiziTaskEvents(TASK_ID, {
      signal: controller.signal,
      fetchImpl,
      onEvents: () => undefined,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();
    await watching;

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('uses bounded polling for a non-SSE success and deduplicates replayed page events', async () => {
    const controller = new AbortController();
    const replay = taskEvent('2');
    const next = taskEvent('4');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    api.get.mockResolvedValue({ data: [replay, next], nextCursor: '4', hasMore: false });
    const transports: string[] = [];
    const rendered: MsaidiziTaskEvent[] = [];

    await watchMsaidiziTaskEvents(TASK_ID, {
      signal: controller.signal,
      after: '2',
      fetchImpl,
      fallbackPollAttempts: 1,
      onTransportChange: (transport) => transports.push(transport),
      onEvents: (events) => {
        rendered.push(...events);
        controller.abort();
      },
    });

    expect(transports).toEqual(['polling']);
    expect(rendered.map((event) => event.cursor)).toEqual(['4']);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('dispatches session-expired once and does not poll after an unrecoverable 401', async () => {
    const expired = vi.fn();
    window.addEventListener('itemba:session-expired', expired);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      watchMsaidiziTaskEvents(TASK_ID, {
        signal: new AbortController().signal,
        fetchImpl,
        refreshSession: async () => false,
        onEvents: () => undefined,
      }),
    ).rejects.toMatchObject({ status: 401 });

    expect(expired).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(api.get).not.toHaveBeenCalled();
    window.removeEventListener('itemba:session-expired', expired);
  });

  it('stops on a live permission denial instead of reconnecting or polling', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Permission revoked' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      watchMsaidiziTaskEvents(TASK_ID, {
        signal: new AbortController().signal,
        fetchImpl,
        onEvents: () => undefined,
      }),
    ).rejects.toEqual(new MsaidiziTaskEventWatchError('Permission revoked', 403));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(api.get).not.toHaveBeenCalled();
  });
});
