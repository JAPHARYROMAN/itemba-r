import { OfflineSyncService } from './offline-sync.service';

const USER = { id: 'user-a' } as any;
const DTO = {
  companyId: 'company-a',
  entityType: 'Customer',
  lastSyncAt: '2026-08-25T12:00:00.000Z',
};

function harness(existing: Record<string, unknown> | null) {
  const checkpoint = {
    id: 'checkpoint-1',
    userId: USER.id,
    companyId: DTO.companyId,
    deviceId: null,
    entityType: DTO.entityType,
    lastSyncAt: new Date(DTO.lastSyncAt),
  };
  const prisma = {
    syncCheckpoint: {
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue(checkpoint),
      update: jest.fn().mockResolvedValue(checkpoint),
    },
  } as any;
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) };
  const service = new OfflineSyncService(prisma, audit as any, {} as any, companyScope as any);
  return { audit, prisma, service };
}

describe('OfflineSyncService checkpoint audit attribution', () => {
  it.each([
    ['create', null],
    ['update', { id: 'checkpoint-1', ...DTO, userId: USER.id, deviceId: null }],
  ] as const)('%s path appends exactly one checkpoint audit row', async (_path, existing) => {
    const { audit, prisma, service } = harness(existing);

    await service.upsertCheckpoint(DTO, USER);

    expect(
      existing ? prisma.syncCheckpoint.update : prisma.syncCheckpoint.create,
    ).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SYNC_CHECKPOINT_UPSERTED',
        entityType: 'SyncCheckpoint',
        entityId: 'checkpoint-1',
        userId: USER.id,
        companyId: DTO.companyId,
      }),
    );
  });
});
