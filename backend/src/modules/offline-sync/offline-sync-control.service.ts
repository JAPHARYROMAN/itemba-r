import { BadRequestException, Injectable } from '@nestjs/common';
import { OfflineSyncOperation, OfflineSyncRecordStatus } from '@prisma/client';

export type ConflictResolutionAction = 'USE_SERVER' | 'USE_CLIENT' | 'MERGE' | 'REJECT';

type SyncRecordLike = {
  status: OfflineSyncRecordStatus;
  operation: OfflineSyncOperation;
  payload?: unknown;
  serverValue?: unknown;
};

@Injectable()
export class OfflineSyncControlService {
  assertCanResolveConflict(record: SyncRecordLike): void {
    if (record.status !== OfflineSyncRecordStatus.CONFLICT) {
      throw new BadRequestException('Only records in CONFLICT status can be resolved');
    }
  }

  normalizeResolution(value?: string): ConflictResolutionAction {
    const normalized = (value ?? '').trim().toUpperCase();
    if (['USE_SERVER', 'USE_CLIENT', 'MERGE', 'REJECT'].includes(normalized)) {
      return normalized as ConflictResolutionAction;
    }
    throw new BadRequestException(
      'Resolution must be one of USE_SERVER, USE_CLIENT, MERGE, or REJECT',
    );
  }

  resolveRecord(params: {
    record: SyncRecordLike;
    resolution?: string;
    resolvedValue?: Record<string, unknown>;
  }): {
    status: OfflineSyncRecordStatus;
    serverValue?: Record<string, unknown>;
    conflictReason: string;
  } {
    this.assertCanResolveConflict(params.record);
    const resolution = this.normalizeResolution(params.resolution);

    if (resolution === 'MERGE' && !params.resolvedValue) {
      throw new BadRequestException('MERGE resolution requires a resolvedValue');
    }

    if (resolution === 'REJECT') {
      return {
        status: OfflineSyncRecordStatus.REJECTED,
        conflictReason: resolution,
      };
    }

    if (resolution === 'USE_SERVER') {
      return {
        status: OfflineSyncRecordStatus.PROCESSED,
        serverValue: this.asObject(params.record.serverValue),
        conflictReason: resolution,
      };
    }

    if (resolution === 'USE_CLIENT') {
      return {
        status: OfflineSyncRecordStatus.PROCESSED,
        serverValue: this.asObject(params.record.payload),
        conflictReason: resolution,
      };
    }

    return {
      status: OfflineSyncRecordStatus.PROCESSED,
      serverValue: params.resolvedValue,
      conflictReason: resolution,
    };
  }

  private asObject(value: unknown): Record<string, unknown> | undefined {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return undefined;
  }
}
