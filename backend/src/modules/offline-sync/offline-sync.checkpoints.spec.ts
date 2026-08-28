import { OfflineSyncService } from './offline-sync.service';

describe('OfflineSyncService.findCheckpoints', () => {
  it('always binds checkpoint reads to the authenticated actor and optional device', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'checkpoint-a' }]);
    const service = new OfflineSyncService(
      { syncCheckpoint: { findMany } } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const user = { id: 'user-a' } as any;

    await expect(service.findCheckpoints(user, 'device-a')).resolves.toEqual([
      { id: 'checkpoint-a' },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-a', deviceId: 'device-a' },
    });
  });
});
