import { BadRequestException } from '@nestjs/common';
import { OfflineSyncOperation, OfflineSyncRecordStatus } from '@prisma/client';
import { OfflineSyncControlService } from './offline-sync-control.service';

describe('OfflineSyncControlService', () => {
  let service: OfflineSyncControlService;

  beforeEach(() => {
    service = new OfflineSyncControlService();
  });

  it('rejects conflict resolution for records that are not in conflict', () => {
    expect(() =>
      service.resolveRecord({
        record: {
          status: OfflineSyncRecordStatus.PENDING,
          operation: OfflineSyncOperation.UPDATE,
        },
        resolution: 'USE_SERVER',
      }),
    ).toThrow(BadRequestException);
  });

  it('normalizes supported resolution actions', () => {
    expect(service.normalizeResolution(' use_client ')).toBe('USE_CLIENT');
    expect(() => service.normalizeResolution('overwrite')).toThrow(BadRequestException);
  });

  it('uses the server value when resolving with USE_SERVER', () => {
    const result = service.resolveRecord({
      record: {
        status: OfflineSyncRecordStatus.CONFLICT,
        operation: OfflineSyncOperation.UPDATE,
        payload: { name: 'Client Name' },
        serverValue: { name: 'Server Name' },
      },
      resolution: 'USE_SERVER',
    });

    expect(result).toEqual({
      status: OfflineSyncRecordStatus.PROCESSED,
      serverValue: { name: 'Server Name' },
      conflictReason: 'USE_SERVER',
    });
  });

  it('uses the client payload when resolving with USE_CLIENT', () => {
    const result = service.resolveRecord({
      record: {
        status: OfflineSyncRecordStatus.CONFLICT,
        operation: OfflineSyncOperation.UPDATE,
        payload: { name: 'Client Name' },
        serverValue: { name: 'Server Name' },
      },
      resolution: 'USE_CLIENT',
    });

    expect(result).toMatchObject({
      status: OfflineSyncRecordStatus.PROCESSED,
      serverValue: { name: 'Client Name' },
      conflictReason: 'USE_CLIENT',
    });
  });

  it('requires a resolved value for merge resolution', () => {
    expect(() =>
      service.resolveRecord({
        record: {
          status: OfflineSyncRecordStatus.CONFLICT,
          operation: OfflineSyncOperation.UPDATE,
        },
        resolution: 'MERGE',
      }),
    ).toThrow(BadRequestException);

    expect(
      service.resolveRecord({
        record: {
          status: OfflineSyncRecordStatus.CONFLICT,
          operation: OfflineSyncOperation.UPDATE,
        },
        resolution: 'MERGE',
        resolvedValue: { name: 'Merged Name' },
      }),
    ).toMatchObject({
      status: OfflineSyncRecordStatus.PROCESSED,
      serverValue: { name: 'Merged Name' },
      conflictReason: 'MERGE',
    });
  });

  it('marks rejected conflict records as rejected', () => {
    expect(
      service.resolveRecord({
        record: {
          status: OfflineSyncRecordStatus.CONFLICT,
          operation: OfflineSyncOperation.DELETE,
        },
        resolution: 'REJECT',
      }),
    ).toEqual({
      status: OfflineSyncRecordStatus.REJECTED,
      conflictReason: 'REJECT',
    });
  });
});
