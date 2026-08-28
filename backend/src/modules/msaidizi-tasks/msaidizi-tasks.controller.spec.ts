import { EventEmitter } from 'node:events';
import { firstValueFrom } from 'rxjs';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MsaidiziTasksController } from './msaidizi-tasks.controller';

describe('MsaidiziTasksController event stream', () => {
  const user = { id: 'user-1' } as AuthUser;

  it('routes draft creation without implicitly planning or queueing it', async () => {
    const draft = { id: 'task-draft', status: 'PLANNING', activePlanVersion: 0 };
    const tasks = { createDraft: jest.fn().mockResolvedValue(draft) };
    const controller = new MsaidiziTasksController(tasks as never);
    const dto = { objective: 'Review a screenshot', mode: 'COLLABORATIVE' } as never;

    await expect(controller.draft(dto, user)).resolves.toBe(draft);
    expect(tasks.createDraft).toHaveBeenCalledWith(dto, user);
  });

  it('emits append-only event cursors as SSE IDs after scoped authorization', async () => {
    const tasks = {
      findOne: jest.fn().mockResolvedValue({ id: 'task-1' }),
      events: jest.fn().mockResolvedValue({
        data: [{ cursor: '42', type: 'step.succeeded', payload: { stepId: 'step-1' } }],
        nextCursor: '42',
        hasMore: false,
      }),
    };
    const controller = new MsaidiziTasksController(tasks as never);
    const request = new EventEmitter();

    const event = await firstValueFrom(
      controller.eventStream('task-1', { after: '41', limit: 100 }, user, request as never),
    );

    expect(tasks.findOne).toHaveBeenCalledWith('task-1', user);
    expect(tasks.events).toHaveBeenCalledWith('task-1', { after: '41', limit: 100 }, user);
    expect(event).toMatchObject({ id: '42', type: 'step.succeeded' });
  });

  it('emits a heartbeat carrying the reconnect cursor when no event is pending', async () => {
    const tasks = {
      findOne: jest.fn().mockResolvedValue({ id: 'task-1' }),
      events: jest.fn().mockResolvedValue({ data: [], nextCursor: '17', hasMore: false }),
    };
    const controller = new MsaidiziTasksController(tasks as never);

    const event = await firstValueFrom(
      controller.eventStream(
        'task-1',
        { after: '17', limit: 100 },
        user,
        new EventEmitter() as never,
      ),
    );

    expect(event).toMatchObject({
      id: '17',
      type: 'heartbeat',
      data: { cursor: '17' },
    });
  });

  it('terminates the SSE stream when a later live-authorized poll is denied', async () => {
    jest.useFakeTimers();
    try {
      const revoked = new Error('Msaidizi event access is no longer authorized');
      const tasks = {
        findOne: jest.fn().mockResolvedValue({ id: 'task-1' }),
        events: jest
          .fn()
          .mockResolvedValueOnce({
            data: [{ cursor: '42', type: 'step.succeeded', payload: {} }],
            nextCursor: '42',
            hasMore: false,
          })
          .mockRejectedValueOnce(revoked),
      };
      const controller = new MsaidiziTasksController(tasks as never);
      const received: unknown[] = [];
      let failStream!: (reason: unknown) => void;
      const failed = new Promise<unknown>((resolve) => {
        failStream = resolve;
      });
      const subscription = controller
        .eventStream('task-1', { after: '41', limit: 100 }, user, new EventEmitter() as never)
        .subscribe({
          next: (event) => received.push(event),
          error: failStream,
        });

      await jest.advanceTimersByTimeAsync(0);
      expect(received).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(2_000);
      await expect(failed).resolves.toBe(revoked);
      expect(tasks.events).toHaveBeenCalledTimes(2);
      expect(subscription.closed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
