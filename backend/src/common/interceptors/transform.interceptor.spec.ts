import { CallHandler, ExecutionContext, MessageEvent, Sse } from '@nestjs/common';
import { SseStream } from '@nestjs/core/router/sse-stream';
import { firstValueFrom, of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

class ResponseHandlers {
  json() {
    return undefined;
  }

  @Sse()
  events() {
    return undefined;
  }
}

function contextFor(handler: () => unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ResponseHandlers,
  } as unknown as ExecutionContext;
}

function serializeSse(message: MessageEvent): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = new SseStream();
    const chunks: string[] = [];
    stream.on('data', (chunk: unknown) => chunks.push(String(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(chunks.join('')));
    stream.writeMessage(message, (error) => {
      if (error) {
        reject(error);
        return;
      }
      stream.end();
    });
  });
}

describe('TransformInterceptor', () => {
  const interceptor = new TransformInterceptor();

  it('preserves the normal JSON response envelope', async () => {
    const response = { id: 'task-1' };

    await expect(
      firstValueFrom(
        interceptor.intercept(contextFor(ResponseHandlers.prototype.json), {
          handle: () => of(response),
        } as CallHandler),
      ),
    ).resolves.toEqual({
      success: true,
      data: response,
      timestamp: expect.any(String),
    });
  });

  it('keeps paginated service data nested under the outer production envelope', async () => {
    const response = { data: [{ id: 'row-1' }], total: 1, page: 1, limit: 20 };

    await expect(
      firstValueFrom(
        interceptor.intercept(contextFor(ResponseHandlers.prototype.json), {
          handle: () => of(response),
        } as CallHandler),
      ),
    ).resolves.toEqual({
      success: true,
      data: response,
      timestamp: expect.any(String),
    });
  });

  it('preserves durable task-event and heartbeat cursors through Nest SSE serialization', async () => {
    const taskEvent = {
      cursor: '42',
      taskId: 'task-1',
      type: 'step.succeeded',
      actorType: 'MSAIDIZI',
      actorId: 'principal-1',
      payload: { stepId: 'step-1' },
      createdAt: '2026-08-25T08:00:00.000Z',
      integrityVersion: 1,
      previousHash: '0'.repeat(64),
      eventHash: '1'.repeat(64),
    };
    const event: MessageEvent = { id: '42', type: taskEvent.type, data: taskEvent };
    const heartbeat: MessageEvent = {
      id: '42',
      type: 'heartbeat',
      data: { cursor: '42', at: '2026-08-25T08:00:15.000Z' },
    };
    const context = contextFor(ResponseHandlers.prototype.events);

    const transformedEvent = (await firstValueFrom(
      interceptor.intercept(context, { handle: () => of(event) } as CallHandler),
    )) as MessageEvent;
    const transformedHeartbeat = (await firstValueFrom(
      interceptor.intercept(context, { handle: () => of(heartbeat) } as CallHandler),
    )) as MessageEvent;

    expect(transformedEvent).toBe(event);
    expect(transformedHeartbeat).toBe(heartbeat);
    await expect(serializeSse(transformedEvent)).resolves.toBe(
      `event: step.succeeded\nid: 42\ndata: ${JSON.stringify(taskEvent)}\n\n`,
    );
    await expect(serializeSse(transformedHeartbeat)).resolves.toBe(
      `event: heartbeat\nid: 42\ndata: ${JSON.stringify(heartbeat.data)}\n\n`,
    );
  });
});
