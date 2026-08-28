import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { MsaidiziDeviceStatus, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { directMtlsPeer } from './direct-mtls-peer';
import {
  DeviceJournalReconciliationDto,
  DeviceJournalHeadDto,
  DeviceJournalRecordDto,
  MAX_JOURNAL_RECONCILIATION_ENTRIES,
} from './dto/msaidizi-device.dto';
import { fixedTimeHexEquals, sha256Hex } from './device-security';
import { MsaidiziDeviceConfig } from './msaidizi-device.config';

const GENESIS_HASH = '0'.repeat(64);
const JOURNAL_KIND_CODE: Readonly<Record<string, number>> = Object.freeze({
  Prepared: 0,
  Completed: 1,
  Rejected: 2,
  Cancelled: 3,
  Failed: 4,
  NeedsAttention: 5,
  RecoveryPrepared: 6,
  ActionFenced: 7,
  ChainUpgraded: 8,
});
const ACTIVE_DEVICE_STATUSES = new Set<MsaidiziDeviceStatus>([
  MsaidiziDeviceStatus.ACTIVE,
  MsaidiziDeviceStatus.OFFLINE,
]);

type JournalHead = {
  sequence: number;
  hashVersion: number;
  entryHash: string;
  exactAcknowledgedAt?: Date | null;
};
type PersistedJournalEntry = {
  deviceId: string;
  sequence: number;
  hashVersion: number;
  occurredAt: Date;
  kind: string;
  actionId: string;
  idempotencyKey: string;
  previousHash: string;
  payloadSha256: string;
  entryHash: string;
};

@Injectable()
export class MsaidiziDeviceJournalLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MsaidiziDeviceConfig,
  ) {}

  async head(dto: DeviceJournalHeadDto, request: Request) {
    const device = await this.authenticateDevice(request, dto.deviceId);
    const rows = await this.prisma.$queryRaw<JournalHead[]>`
      SELECT "sequence", "hashVersion", "entryHash"
      FROM "msaidizi_device_journal_heads"
      WHERE "deviceId" = ${device.id}
    `;
    const head = rows[0] ?? { sequence: 0, hashVersion: 0, entryHash: GENESIS_HASH };
    return {
      deviceId: device.id,
      sequence: head.sequence,
      hashVersion: head.sequence === 0 ? 0 : head.hashVersion,
      entryHash: head.entryHash,
    };
  }

  async reconcile(dto: DeviceJournalReconciliationDto, request: Request) {
    const device = await this.authenticateDevice(request, dto.deviceId);
    this.validateRange(dto);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "msaidizi_device_journal_heads"
          ("deviceId", "sequence", "hashVersion", "entryHash", "reconciledAt",
            "exactAcknowledgedAt")
        VALUES (${device.id}, 0, 2, ${GENESIS_HASH}, CURRENT_TIMESTAMP, NULL)
        ON CONFLICT ("deviceId") DO NOTHING
      `;
      await tx.$queryRaw`
        SELECT "deviceId"
        FROM "msaidizi_device_journal_heads"
        WHERE "deviceId" = ${device.id}
        FOR UPDATE
      `;
      const currentRows = await tx.$queryRaw<JournalHead[]>`
        SELECT "sequence", "hashVersion", "entryHash"
        FROM "msaidizi_device_journal_heads"
        WHERE "deviceId" = ${device.id}
      `;
      const current = currentRows[0];
      if (!current) throw new ConflictException('The central journal head is unavailable');

      if (dto.startingPreviousSequence > current.sequence) {
        throw new ConflictException('The journal reconciliation range has a sequence gap');
      }
      if (dto.localHeadSequence < current.sequence) {
        throw new ConflictException('The local journal head is behind the central ledger');
      }
      if (
        dto.localHeadSequence === current.sequence &&
        !fixedTimeHexEquals(dto.localHeadHash, current.entryHash)
      ) {
        throw new ConflictException('The local journal head forks from the central ledger');
      }

      const predecessor = await this.loadPredecessor(tx, device.id, dto.startingPreviousSequence);
      if (!fixedTimeHexEquals(dto.startingPreviousHash, predecessor.entryHash)) {
        throw new ConflictException('The journal reconciliation predecessor does not match');
      }
      let verifiedPredecessor = predecessor;
      for (const entry of dto.entries) {
        validateHashVersionTransition(verifiedPredecessor, entry);
        verifiedPredecessor = {
          sequence: entry.sequence,
          hashVersion: entry.hashVersion,
          entryHash: entry.entryHash,
        };
      }

      const existing = dto.entries.length
        ? await tx.$queryRaw<PersistedJournalEntry[]>`
            SELECT
              "deviceId", "sequence", "occurredAt", "kind", "actionId",
              "idempotencyKey", "previousHash", "payloadSha256", "entryHash", "hashVersion"
            FROM "msaidizi_device_journal_entries"
            WHERE "deviceId" = ${device.id}
              AND "sequence" BETWEEN ${dto.entries[0].sequence}
                AND ${dto.entries[dto.entries.length - 1].sequence}
            ORDER BY "sequence" ASC
          `
        : [];
      const existingBySequence = new Map(existing.map((entry) => [entry.sequence, entry]));
      const append: DeviceJournalRecordDto[] = [];
      for (const entry of dto.entries) {
        if (
          entry.hashVersion === 2 &&
          !fixedTimeHexEquals(entry.entryHash, digestOnlyEntryHash(entry))
        ) {
          throw new ConflictException('The journal entry hash does not match its digest material');
        }
        const persisted = existingBySequence.get(entry.sequence);
        if (persisted) {
          if (!recordMatches(persisted, entry)) {
            throw new ConflictException('A journal sequence cannot be rewritten or forked');
          }
          continue;
        }
        if (entry.sequence <= current.sequence) {
          throw new ConflictException('The central journal contains a missing historical record');
        }
        append.push(entry);
      }

      if (append.length > 0) {
        if (append[0].sequence !== current.sequence + 1) {
          throw new ConflictException('The journal reconciliation append has a sequence gap');
        }
        for (const entry of append) {
          await tx.$executeRaw`
            INSERT INTO "msaidizi_device_journal_entries" (
              "deviceId", "sequence", "hashVersion", "occurredAt", "kind", "actionId",
              "idempotencyKey", "previousHash", "payloadSha256", "entryHash"
            ) VALUES (
              ${device.id}, ${entry.sequence}, ${entry.hashVersion},
              ${new Date(entry.occurredAt)}, ${entry.kind},
              ${entry.actionId}, ${entry.idempotencyKey}, ${entry.previousHash},
              ${entry.payloadSha256}, ${entry.entryHash}
            )
          `;
        }
        const terminal = append[append.length - 1];
        const advanced = await tx.$executeRaw`
          UPDATE "msaidizi_device_journal_heads"
          SET
            "sequence" = ${terminal.sequence},
            "hashVersion" = ${terminal.hashVersion},
            "entryHash" = ${terminal.entryHash},
            "reconciledAt" = CURRENT_TIMESTAMP,
            "exactAcknowledgedAt" = NULL
          WHERE "deviceId" = ${device.id}
            AND "sequence" = ${current.sequence}
            AND "entryHash" = ${current.entryHash}
        `;
        if (advanced !== 1) {
          throw new ConflictException('The central journal head changed concurrently');
        }
      }

      const acceptedThrough: JournalHead = {
        sequence: dto.finalSequence,
        hashVersion:
          dto.entries.length === 0
            ? current.hashVersion
            : dto.entries[dto.entries.length - 1].hashVersion,
        entryHash: dto.finalHash,
      };
      const exactHead =
        dto.finalSequence === dto.localHeadSequence &&
        fixedTimeHexEquals(dto.finalHash, dto.localHeadHash);
      if (exactHead) {
        const confirmed = await tx.$executeRaw`
          UPDATE "msaidizi_device_journal_heads"
          SET
            "reconciledAt" = CURRENT_TIMESTAMP,
            "exactAcknowledgedAt" = CURRENT_TIMESTAMP
          WHERE "deviceId" = ${device.id}
            AND "sequence" = ${acceptedThrough.sequence}
            AND "hashVersion" = 2
            AND "entryHash" = ${acceptedThrough.entryHash}
        `;
        if (confirmed !== 1) {
          throw new ConflictException('The central journal head does not equal the local head');
        }
      }

      return {
        accepted: true,
        deviceId: device.id,
        startingPreviousSequence: dto.startingPreviousSequence,
        startingPreviousHash: dto.startingPreviousHash,
        acceptedThroughSequence: acceptedThrough.sequence,
        acceptedThroughHash: acceptedThrough.entryHash,
        localHeadSequence: dto.localHeadSequence,
        localHeadHash: dto.localHeadHash,
        exactHead,
      };
    });
  }

  async isExactHead(deviceId: string, sequence: number, entryHash: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<JournalHead[]>`
      SELECT "sequence", "hashVersion", "entryHash", "exactAcknowledgedAt"
      FROM "msaidizi_device_journal_heads"
      WHERE "deviceId" = ${deviceId}
    `;
    const head = rows[0];
    return Boolean(
      head &&
      head.sequence === sequence &&
      head.hashVersion === 2 &&
      fixedTimeHexEquals(head.entryHash, entryHash) &&
      head.exactAcknowledgedAt != null,
    );
  }

  private validateRange(dto: DeviceJournalReconciliationDto): void {
    if (dto.entries.length > MAX_JOURNAL_RECONCILIATION_ENTRIES) {
      throw new BadRequestException('The journal reconciliation range is too large');
    }
    const hashes = [
      dto.startingPreviousHash,
      dto.finalHash,
      dto.localHeadHash,
      ...dto.entries.flatMap((entry) => [entry.previousHash, entry.payloadSha256, entry.entryHash]),
    ];
    if (hashes.some((hash) => hash !== hash.toLowerCase())) {
      throw new ConflictException('Journal reconciliation hashes must be canonical lowercase');
    }
    let previous: JournalHead = {
      sequence: dto.startingPreviousSequence,
      hashVersion: 2,
      entryHash: dto.startingPreviousHash,
    };
    for (const entry of dto.entries) {
      if (
        entry.sequence !== previous.sequence + 1 ||
        !fixedTimeHexEquals(entry.previousHash, previous.entryHash)
      ) {
        throw new ConflictException('The journal reconciliation range is not contiguous');
      }
      previous = {
        sequence: entry.sequence,
        hashVersion: entry.hashVersion,
        entryHash: entry.entryHash,
      };
    }
    if (
      dto.finalSequence !== previous.sequence ||
      !fixedTimeHexEquals(dto.finalHash, previous.entryHash) ||
      dto.localHeadSequence < dto.finalSequence ||
      (dto.localHeadSequence === dto.finalSequence &&
        !fixedTimeHexEquals(dto.localHeadHash, dto.finalHash))
    ) {
      throw new ConflictException('The journal reconciliation heads are inconsistent');
    }
  }

  private async loadPredecessor(
    tx: Prisma.TransactionClient,
    deviceId: string,
    sequence: number,
  ): Promise<JournalHead> {
    if (sequence === 0) return { sequence: 0, hashVersion: 0, entryHash: GENESIS_HASH };
    const rows = await tx.$queryRaw<JournalHead[]>`
      SELECT "sequence", "hashVersion", "entryHash"
      FROM "msaidizi_device_journal_entries"
      WHERE "deviceId" = ${deviceId} AND "sequence" = ${sequence}
    `;
    const predecessor = rows[0];
    if (!predecessor) {
      throw new ConflictException('The journal reconciliation predecessor is missing');
    }
    return predecessor;
  }

  private async authenticateDevice(request: Request, claimedDeviceId: string) {
    if (!this.config.channelEnabled) {
      throw new ServiceUnavailableException('The device command channel is disabled');
    }
    const peer = directMtlsPeer(request);
    const device = await this.prisma.msaidiziDevice.findUnique({
      where: { certificateThumbprint: peer.certificateSha256 },
      select: {
        id: true,
        status: true,
        publicKey: true,
        certificateThumbprint: true,
      },
    });
    const publicKeySha256 = device ? sha256Hex(device.publicKey.replace(/\r\n/g, '\n').trim()) : '';
    if (
      !device ||
      device.id !== claimedDeviceId ||
      !ACTIVE_DEVICE_STATUSES.has(device.status) ||
      !device.certificateThumbprint ||
      !fixedTimeHexEquals(device.certificateThumbprint, peer.certificateSha256) ||
      !fixedTimeHexEquals(publicKeySha256, peer.publicKeySha256)
    ) {
      throw new UnauthorizedException('The direct TLS peer is not an active enrolled device');
    }
    return device;
  }
}

function validateHashVersionTransition(
  predecessor: JournalHead,
  entry: DeviceJournalRecordDto,
): void {
  if (predecessor.hashVersion === 2 && entry.hashVersion === 1) {
    throw new ConflictException('The journal hash version cannot downgrade from v2 to v1');
  }
  if (predecessor.hashVersion === 1 && entry.hashVersion === 2 && entry.kind !== 'ChainUpgraded') {
    throw new ConflictException('The legacy journal prefix requires an explicit v2 upgrade bridge');
  }
  if (
    entry.kind === 'ChainUpgraded' &&
    !(predecessor.hashVersion === 1 && entry.hashVersion === 2)
  ) {
    throw new ConflictException('A journal upgrade bridge must be the one-way v1 to v2 transition');
  }
}

function recordMatches(
  persisted: {
    sequence: number;
    hashVersion: number;
    occurredAt: Date;
    kind: string;
    actionId: string;
    idempotencyKey: string;
    previousHash: string;
    payloadSha256: string;
    entryHash: string;
  },
  incoming: DeviceJournalRecordDto,
): boolean {
  return (
    persisted.sequence === incoming.sequence &&
    persisted.hashVersion === incoming.hashVersion &&
    persisted.occurredAt.getTime() === new Date(incoming.occurredAt).getTime() &&
    persisted.kind === incoming.kind &&
    persisted.actionId === incoming.actionId &&
    persisted.idempotencyKey === incoming.idempotencyKey &&
    fixedTimeHexEquals(persisted.previousHash, incoming.previousHash) &&
    fixedTimeHexEquals(persisted.payloadSha256, incoming.payloadSha256) &&
    fixedTimeHexEquals(persisted.entryHash, incoming.entryHash)
  );
}

function digestOnlyEntryHash(entry: DeviceJournalRecordDto): string {
  const kind = JOURNAL_KIND_CODE[entry.kind];
  if (kind == null) throw new ConflictException('The journal entry kind is unsupported');
  const material = JSON.stringify({
    hashVersion: entry.hashVersion,
    sequence: entry.sequence,
    occurredAtUnixMilliseconds: new Date(entry.occurredAt).getTime(),
    kind,
    actionId: entry.actionId,
    idempotencyKey: entry.idempotencyKey,
    previousHash: entry.previousHash,
    payloadSha256: entry.payloadSha256,
  });
  return createHash('sha256').update(material, 'utf8').digest('hex');
}
