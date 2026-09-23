import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('deployment health probes', () => {
  it('keeps liveness independent of database availability', () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('database down')) };
    const controller = new HealthController(prisma as any);
    expect(controller.live()).toMatchObject({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns a successful readiness payload when the database responds', async () => {
    const controller = new HealthController({
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as any);
    await expect(controller.ready()).resolves.toMatchObject({ status: 'ok', database: 'up' });
  });

  it.each(['ready', 'check'] as const)(
    'returns HTTP 503 from %s when the database is unavailable',
    async (method) => {
      const controller = new HealthController({
        $queryRaw: jest.fn().mockRejectedValue(new Error('private connection details')),
      } as any);
      try {
        await controller[method]();
        throw new Error('Expected an unavailable probe');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getStatus()).toBe(503);
        expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
          status: 'critical',
          database: 'down',
        });
        expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain(
          'private connection details',
        );
      }
    },
  );
});
