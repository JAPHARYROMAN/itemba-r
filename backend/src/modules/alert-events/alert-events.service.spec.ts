import { BadRequestException } from '@nestjs/common';
import { AlertEventsService } from './alert-events.service';

function makeService(initialStatus: string) {
  const record = {
    id: 'event-1',
    companyId: 'company-1',
    status: initialStatus,
  };

  const prisma = {
    alertEvent: {
      findFirst: jest.fn(async () => ({ ...record })),
      update: jest.fn(async ({ data }: any) => ({ ...record, ...data })),
    },
  } as any;
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new AlertEventsService(prisma, audit);

  return { service, prisma, audit };
}

const user = { id: 'user-1' } as any;

describe('AlertEventsService status transition guards', () => {
  describe('acknowledge', () => {
    it('acknowledges an OPEN alert event', async () => {
      const { service, prisma } = makeService('OPEN');

      const result = await service.acknowledge('event-1', {}, user);

      expect(result.status).toBe('ACKNOWLEDGED');
      expect(prisma.alertEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'event-1' },
          data: expect.objectContaining({ status: 'ACKNOWLEDGED' }),
        }),
      );
    });

    it('rejects acknowledging a non-OPEN alert event', async () => {
      const { service, prisma } = makeService('ACKNOWLEDGED');

      await expect(service.acknowledge('event-1', {}, user)).rejects.toThrow(BadRequestException);
      expect(prisma.alertEvent.update).not.toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('resolves an OPEN alert event', async () => {
      const { service } = makeService('OPEN');

      const result = await service.resolve('event-1', {}, user);

      expect(result.status).toBe('RESOLVED');
    });

    it('resolves an ACKNOWLEDGED alert event', async () => {
      const { service } = makeService('ACKNOWLEDGED');

      const result = await service.resolve('event-1', {}, user);

      expect(result.status).toBe('RESOLVED');
    });

    it('rejects resolving a DISMISSED alert event', async () => {
      const { service, prisma } = makeService('DISMISSED');

      await expect(service.resolve('event-1', {}, user)).rejects.toThrow(BadRequestException);
      expect(prisma.alertEvent.update).not.toHaveBeenCalled();
    });
  });

  describe('dismiss', () => {
    it.each(['OPEN', 'ACKNOWLEDGED', 'RESOLVED'])('dismisses a %s alert event', async (status) => {
      const { service } = makeService(status);

      const result = await service.dismiss('event-1', {}, user);

      expect(result.status).toBe('DISMISSED');
    });

    it('rejects dismissing an already-DISMISSED alert event', async () => {
      const { service, prisma } = makeService('DISMISSED');

      await expect(service.dismiss('event-1', {}, user)).rejects.toThrow(BadRequestException);
      expect(prisma.alertEvent.update).not.toHaveBeenCalled();
    });
  });
});
