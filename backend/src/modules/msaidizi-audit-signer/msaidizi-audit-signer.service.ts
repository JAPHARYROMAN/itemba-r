import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { verify as verifySignature } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { DirectMtlsPeerIdentity } from '../msaidizi-devices/direct-mtls-peer';
import {
  AuditCheckpointManifest,
  canonicalSegmentSha256,
  parseAuditCheckpointManifest,
  sha256Hex,
  ZERO_SHA256,
} from './audit-checkpoint.protocol';
import {
  FetchMsaidiziAuditSegmentDto,
  SubmitMsaidiziAuditCheckpointDto,
} from './dto/msaidizi-audit-signer.dto';
import { MsaidiziAuditSignerConfig } from './msaidizi-audit-signer.config';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

interface EventMaterialRow {
  cursor: bigint;
  integrityVersion: number;
  previousHash: string;
  eventHash: string;
  canonicalMaterial: string;
}

const CHECKPOINT_LOCK_NAMESPACE = 1_297_302_865;
const CHECKPOINT_LOCK_KEY = 1_093_678_867;

@Injectable()
export class MsaidiziAuditSignerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MsaidiziAuditSignerConfig,
  ) {}

  async segment(dto: FetchMsaidiziAuditSegmentDto, peer: DirectMtlsPeerIdentity) {
    this.config.assertPinnedPeer(peer);
    const afterCursor = BigInt(dto.afterCursor);
    const limit = Math.min(dto.limit, this.config.maxSegmentEvents);

    return this.prisma.$transaction(
      async (tx) => {
        await checkpointLock(tx);
        const head = await tx.msaidiziAuditCheckpoint.findFirst({
          orderBy: { toCursor: 'desc' },
        });
        const expectedCursor = head?.toCursor ?? 0n;
        const expectedEventHash = head?.eventHeadHash ?? ZERO_SHA256;
        const expectedCheckpointHash = head?.manifestSha256 ?? ZERO_SHA256;
        if (
          afterCursor !== expectedCursor ||
          dto.afterEventHash !== expectedEventHash ||
          dto.lastCheckpointSha256 !== expectedCheckpointHash
        ) {
          throw new ConflictException(
            'Signer head does not match the latest accepted audit checkpoint',
          );
        }
        if (afterCursor > 0n) {
          const predecessor = await tx.msaidiziTaskEvent.findUnique({
            where: { cursor: afterCursor },
            select: { eventHash: true },
          });
          if (!predecessor || predecessor.eventHash !== expectedEventHash) {
            throw new ConflictException('Accepted checkpoint no longer matches the event ledger');
          }
        }

        const rows = await eventMaterialsAfter(tx, afterCursor, limit + 1);
        const hasMore = rows.length > limit;
        const data = hasMore ? rows.slice(0, limit) : rows;
        validateEventChain(data, expectedEventHash, afterCursor);
        return {
          checkpointHead: {
            cursor: expectedCursor.toString(),
            eventHash: expectedEventHash,
            manifestSha256: expectedCheckpointHash,
          },
          events: data.map((row) => ({
            cursor: row.cursor.toString(),
            integrityVersion: row.integrityVersion,
            previousHash: row.previousHash,
            eventHash: row.eventHash,
            canonicalMaterial: row.canonicalMaterial,
          })),
          hasMore,
          maxCheckpointTtlSeconds: this.config.checkpointTtlSeconds,
          signerKeyId: this.config.signerKeyId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async checkpoint(dto: SubmitMsaidiziAuditCheckpointDto, peer: DirectMtlsPeerIdentity) {
    this.config.assertPinnedPeer(peer);
    const manifest = parseAuditCheckpointManifest(dto.manifestJson);
    if (manifest.signerKeyId !== this.config.signerKeyId) {
      throw new UnauthorizedException('Audit checkpoint uses an unpinned signer key id');
    }
    if (sha256Hex(dto.manifestJson) !== dto.manifestSha256) {
      throw new BadRequestException('Audit checkpoint manifest digest is invalid');
    }
    const signature = decodeP1363(dto.signature);
    if (
      !verifySignature(
        'sha256',
        Buffer.from(dto.manifestJson, 'utf8'),
        { key: peer.publicKeyPem, dsaEncoding: 'ieee-p1363' },
        signature,
      )
    ) {
      throw new UnauthorizedException('Audit checkpoint signature is invalid');
    }

    return this.prisma.$transaction(
      async (tx) => {
        await checkpointLock(tx);
        const exact = await tx.msaidiziAuditCheckpoint.findUnique({
          where: { manifestSha256: dto.manifestSha256 },
        });
        if (exact) {
          if (
            exact.manifestJson !== dto.manifestJson ||
            exact.signature !== dto.signature ||
            exact.signerCertificateSha256 !== peer.certificateSha256.toLowerCase() ||
            exact.signerSubjectPublicKeySha256 !== peer.publicKeySpkiSha256?.toLowerCase()
          ) {
            throw new ConflictException('Stored audit checkpoint replay is not byte-identical');
          }
          return { accepted: true, replay: true, checkpointId: exact.id };
        }

        const checkpointIdConflict = await tx.msaidiziAuditCheckpoint.findUnique({
          where: { id: manifest.checkpointId },
          select: { manifestSha256: true },
        });
        if (checkpointIdConflict) {
          throw new ConflictException('A different audit checkpoint already uses this id');
        }
        validateManifestTime(manifest, this.config);

        const head = await tx.msaidiziAuditCheckpoint.findFirst({
          orderBy: { toCursor: 'desc' },
        });
        const previousCursor = head?.toCursor ?? 0n;
        const previousEventHash = head?.eventHeadHash ?? ZERO_SHA256;
        const previousCheckpointSha256 = head?.manifestSha256 ?? ZERO_SHA256;
        if (
          manifest.previousCheckpointSha256 !== previousCheckpointSha256 ||
          manifest.previousEventHash !== previousEventHash
        ) {
          throw new ConflictException('Audit checkpoint attempts a rollback or fork');
        }
        if (manifest.eventCount > this.config.maxSegmentEvents) {
          throw new BadRequestException('Audit checkpoint exceeds the bounded segment size');
        }

        const toCursor = BigInt(manifest.toCursor);
        const rows = await eventMaterialsThrough(
          tx,
          previousCursor,
          toCursor,
          manifest.eventCount + 1,
        );
        if (
          rows.length !== manifest.eventCount ||
          rows[0]?.cursor.toString() !== manifest.fromCursor ||
          rows.at(-1)?.cursor !== toCursor
        ) {
          throw new ConflictException('Audit checkpoint omits or invents task-event cursors');
        }
        validateEventChain(rows, previousEventHash, previousCursor);
        if (
          rows.at(-1)?.eventHash !== manifest.eventHeadHash ||
          canonicalSegmentSha256(rows.map((row) => row.canonicalMaterial)) !==
            manifest.canonicalSegmentSha256
        ) {
          throw new ConflictException('Audit checkpoint does not bind the exact canonical segment');
        }

        const checkpoint = await tx.msaidiziAuditCheckpoint.create({
          data: {
            id: manifest.checkpointId,
            schemaVersion: manifest.schemaVersion,
            signerKeyId: manifest.signerKeyId,
            fromCursor: BigInt(manifest.fromCursor),
            toCursor,
            previousEventHash: manifest.previousEventHash,
            eventHeadHash: manifest.eventHeadHash,
            eventCount: manifest.eventCount,
            canonicalSegmentSha256: manifest.canonicalSegmentSha256,
            previousCheckpointSha256: manifest.previousCheckpointSha256,
            manifestJson: dto.manifestJson,
            manifestSha256: dto.manifestSha256,
            signature: dto.signature,
            signerCertificateSha256: peer.certificateSha256.toLowerCase(),
            signerSubjectPublicKeySha256: peer.publicKeySpkiSha256!.toLowerCase(),
            issuedAt: new Date(manifest.issuedAt),
            expiresAt: new Date(manifest.expiresAt),
          },
        });
        return { accepted: true, replay: false, checkpointId: checkpoint.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

async function checkpointLock(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(${CHECKPOINT_LOCK_NAMESPACE}, ${CHECKPOINT_LOCK_KEY})
  `;
}

async function eventMaterialsAfter(
  client: DatabaseClient,
  afterCursor: bigint,
  limit: number,
): Promise<EventMaterialRow[]> {
  return client.$queryRaw<EventMaterialRow[]>`
    SELECT
      "cursor",
      "integrityVersion",
      "previousHash",
      "eventHash",
      "msaidizi_task_event_canonical_v1"(
        "previousHash",
        "cursor",
        "taskId",
        "type",
        "actorType",
        "actorId",
        "payload",
        "createdAt"
      ) AS "canonicalMaterial"
    FROM "msaidizi_task_events"
    WHERE "cursor" > ${afterCursor}
    ORDER BY "cursor" ASC
    LIMIT ${limit}
  `;
}

async function eventMaterialsThrough(
  client: DatabaseClient,
  afterCursor: bigint,
  toCursor: bigint,
  limit: number,
): Promise<EventMaterialRow[]> {
  return client.$queryRaw<EventMaterialRow[]>`
    SELECT
      "cursor",
      "integrityVersion",
      "previousHash",
      "eventHash",
      "msaidizi_task_event_canonical_v1"(
        "previousHash",
        "cursor",
        "taskId",
        "type",
        "actorType",
        "actorId",
        "payload",
        "createdAt"
      ) AS "canonicalMaterial"
    FROM "msaidizi_task_events"
    WHERE "cursor" > ${afterCursor} AND "cursor" <= ${toCursor}
    ORDER BY "cursor" ASC
    LIMIT ${limit}
  `;
}

function validateEventChain(
  rows: readonly EventMaterialRow[],
  initialHash: string,
  afterCursor: bigint,
): void {
  let previousHash = initialHash;
  let previousCursor = afterCursor;
  for (const row of rows) {
    if (
      row.integrityVersion !== 1 ||
      row.cursor <= previousCursor ||
      row.previousHash !== previousHash ||
      sha256Hex(row.canonicalMaterial) !== row.eventHash
    ) {
      throw new ConflictException('Task-event canonical chain verification failed');
    }
    previousCursor = row.cursor;
    previousHash = row.eventHash;
  }
}

function validateManifestTime(
  manifest: AuditCheckpointManifest,
  config: MsaidiziAuditSignerConfig,
): void {
  const now = Date.now();
  const issuedAt = Date.parse(manifest.issuedAt);
  const expiresAt = Date.parse(manifest.expiresAt);
  const skewMs = config.maxClockSkewSeconds * 1_000;
  const maxTtlMs = config.checkpointTtlSeconds * 1_000;
  if (
    issuedAt > now + skewMs ||
    expiresAt <= now - skewMs ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > maxTtlMs
  ) {
    throw new ConflictException('Audit checkpoint is expired or outside its bounded lifetime');
  }
}

function decodeP1363(value: string): Buffer {
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length !== 64 || decoded.toString('base64url') !== value) throw new Error();
    return decoded;
  } catch {
    throw new BadRequestException('Audit checkpoint signature is not canonical ES256 P1363');
  }
}
