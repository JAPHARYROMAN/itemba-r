import { TasksService } from './tasks.service';

function makeService(overrides: { status?: string } = {}) {
  const task = {
    id: 'task-1',
    companyId: 'company-1',
    status: overrides.status ?? 'TODO',
    assignedToId: 'user-1',
    deletedAt: null,
  };
  const prisma = {
    task: {
      findFirst: jest.fn().mockResolvedValue(task),
      update: jest.fn(async ({ data }: any) => ({ ...task, ...data })),
    },
  } as any;
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new TasksService(prisma, audit);
  return { service, prisma, audit, task };
}

const user = { id: 'user-1' } as any;

describe('TasksService status guards', () => {
  describe('complete', () => {
    it('rejects completing an already COMPLETED task', async () => {
      const { service, prisma } = makeService({ status: 'COMPLETED' });

      await expect(service.complete('task-1', user)).rejects.toThrow(
        'Only open tasks (TODO, IN_PROGRESS, OVERDUE) can be completed',
      );
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it('rejects completing a CANCELLED task', async () => {
      const { service, prisma } = makeService({ status: 'CANCELLED' });

      await expect(service.complete('task-1', user)).rejects.toThrow(
        'Only open tasks (TODO, IN_PROGRESS, OVERDUE) can be completed',
      );
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it('allows completing a TODO task', async () => {
      const { service, prisma } = makeService({ status: 'TODO' });

      const result = await service.complete('task-1', user);

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1' },
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      expect(result.status).toBe('COMPLETED');
    });

    it('allows completing an OVERDUE task', async () => {
      const { service, prisma } = makeService({ status: 'OVERDUE' });

      const result = await service.complete('task-1', user);

      expect(prisma.task.update).toHaveBeenCalled();
      expect(result.status).toBe('COMPLETED');
    });
  });

  describe('cancel', () => {
    it('rejects cancelling an already CANCELLED task', async () => {
      const { service, prisma } = makeService({ status: 'CANCELLED' });

      await expect(service.cancel('task-1', user)).rejects.toThrow(
        'Only open tasks (TODO, IN_PROGRESS, OVERDUE) can be cancelled',
      );
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it('rejects cancelling a COMPLETED task', async () => {
      const { service, prisma } = makeService({ status: 'COMPLETED' });

      await expect(service.cancel('task-1', user)).rejects.toThrow(
        'Only open tasks (TODO, IN_PROGRESS, OVERDUE) can be cancelled',
      );
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it('allows cancelling an IN_PROGRESS task', async () => {
      const { service, prisma } = makeService({ status: 'IN_PROGRESS' });

      const result = await service.cancel('task-1', user);

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
      expect(result.status).toBe('CANCELLED');
    });
  });
});
