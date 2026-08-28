import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { DirectMtlsPeerIdentity } from '../msaidizi-devices/direct-mtls-peer';
import {
  AuditCheckpointManifest,
  canonicalJson,
  canonicalSegmentSha256,
  sha256Hex,
  ZERO_SHA256,
} from './audit-checkpoint.protocol';
import { MsaidiziAuditSignerConfig } from './msaidizi-audit-signer.config';
import { MsaidiziAuditSignerService } from './msaidizi-audit-signer.service';

interface TestEventRow {
  cursor: bigint;
  integrityVersion: number;
  previousHash: string;
  eventHash: string;
  canonicalMaterial: string;
}

const signerKeyId = 'audit-test-key';
const certificateSha256 = 'a'.repeat(64);
const subjectPublicKeySha256 = 'b'.repeat(64);
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const peer: DirectMtlsPeerIdentity = {
  certificateSha256,
  publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  publicKeySha256: 'c'.repeat(64),
  publicKeySpkiSha256: subjectPublicKeySha256,
  validFrom: new Date(Date.now() - 60_000),
  validTo: new Date(Date.now() + 60_000),
  chainAuthorized: true,
};

describe('MsaidiziAuditSignerService', () => {
  it('accepts one exact checkpoint and idempotently replays it without a second append', async () => {
    const harness = createHarness();
    const signed = signedCheckpoint(harness.events);

    await expect(harness.service.checkpoint(signed, peer)).resolves.toEqual({
      accepted: true,
      replay: false,
      checkpointId: signed.manifest.checkpointId,
    });
    await expect(harness.service.checkpoint(signed, peer)).resolves.toEqual({
      accepted: true,
      replay: true,
      checkpointId: signed.manifest.checkpointId,
    });
    expect(harness.tx.msaidiziAuditCheckpoint.create).toHaveBeenCalledTimes(1);
  });

  it('rejects manifest, signature, and database-canonical-material tampering', async () => {
    const harness = createHarness();
    const signed = signedCheckpoint(harness.events);
    await expect(
      harness.service.checkpoint({ ...signed, manifestSha256: 'f'.repeat(64) }, peer),
    ).rejects.toBeInstanceOf(BadRequestException);
    const changedSignature = `${signed.signature[0] === 'A' ? 'B' : 'A'}${signed.signature.slice(1)}`;
    await expect(
      harness.service.checkpoint({ ...signed, signature: changedSignature }, peer),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    harness.events[0].canonicalMaterial = '{"tampered":true}';
    await expect(harness.service.checkpoint(signed, peer)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.tx.msaidiziAuditCheckpoint.create).not.toHaveBeenCalled();
  });

  it('rejects rollback, fork, and expired checkpoints before append', async () => {
    const harness = createHarness();
    const accepted = signedCheckpoint(harness.events);
    await harness.service.checkpoint(accepted, peer);

    const fork = signedCheckpoint(harness.events, {
      checkpointId: randomUUID(),
      previousCheckpointSha256: ZERO_SHA256,
      previousEventHash: ZERO_SHA256,
    });
    await expect(harness.service.checkpoint(fork, peer)).rejects.toBeInstanceOf(ConflictException);

    const expiredHarness = createHarness();
    const expired = signedCheckpoint(expiredHarness.events, {
      issuedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await expect(expiredHarness.service.checkpoint(expired, peer)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(expiredHarness.tx.msaidiziAuditCheckpoint.create).not.toHaveBeenCalled();
  });

  it('serves only the exact current checkpoint head and validates the event hash chain', async () => {
    const harness = createHarness();
    await expect(
      harness.service.segment(
        {
          afterCursor: '0',
          afterEventHash: ZERO_SHA256,
          lastCheckpointSha256: ZERO_SHA256,
          limit: 256,
        },
        peer,
      ),
    ).resolves.toMatchObject({
      checkpointHead: { cursor: '0', eventHash: ZERO_SHA256 },
      events: [{ cursor: '1', integrityVersion: 1 }],
      signerKeyId,
    });
    await expect(
      harness.service.segment(
        {
          afterCursor: '0',
          afterEventHash: 'f'.repeat(64),
          lastCheckpointSha256: ZERO_SHA256,
          limit: 256,
        },
        peer,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MsaidiziAuditSignerConfig', () => {
  it('rejects the kill switch and any non-pinned live TLS peer', () => {
    const killed = auditConfig({ MSAIDIZI_AUDIT_SIGNER_KILL_SWITCH: 'true' });
    expect(() => killed.assertPinnedPeer(peer)).toThrow(ServiceUnavailableException);

    const enabled = auditConfig();
    expect(() => enabled.assertPinnedPeer({ ...peer, chainAuthorized: false })).toThrow(
      UnauthorizedException,
    );
    expect(() => enabled.assertPinnedPeer({ ...peer, certificateSha256: 'd'.repeat(64) })).toThrow(
      UnauthorizedException,
    );
    expect(() => enabled.assertPinnedPeer(peer)).not.toThrow();
  });
});

function createHarness() {
  const material = '{"cursor":"1","payload":{"value":1}}';
  const events: TestEventRow[] = [
    {
      cursor: 1n,
      integrityVersion: 1,
      previousHash: ZERO_SHA256,
      eventHash: sha256Hex(material),
      canonicalMaterial: material,
    },
  ];
  const stored: Array<Record<string, unknown>> = [];
  const findUnique = jest.fn(async ({ where }: { where: Record<string, string> }) => {
    if (where.manifestSha256) {
      return stored.find((row) => row.manifestSha256 === where.manifestSha256) ?? null;
    }
    if (where.id) return stored.find((row) => row.id === where.id) ?? null;
    return null;
  });
  const tx = {
    $queryRaw: jest.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join('?');
      return sql.includes('pg_advisory_xact_lock') ? [] : events;
    }),
    msaidiziAuditCheckpoint: {
      findFirst: jest.fn(async () => stored.at(-1) ?? null),
      findUnique,
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, receivedAt: new Date() };
        stored.push(row);
        return row;
      }),
    },
    msaidiziTaskEvent: {
      findUnique: jest.fn(async ({ where }: { where: { cursor: bigint } }) => {
        const row = events.find((candidate) => candidate.cursor === where.cursor);
        return row ? { eventHash: row.eventHash } : null;
      }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return {
    events,
    stored,
    tx,
    service: new MsaidiziAuditSignerService(prisma as never, auditConfig()),
  };
}

function signedCheckpoint(
  events: readonly TestEventRow[],
  overrides: Partial<AuditCheckpointManifest> = {},
) {
  const issuedAt = canonicalNow(Date.now() - 1_000);
  const manifest: AuditCheckpointManifest = {
    schemaVersion: 1,
    checkpointId: randomUUID(),
    signerKeyId,
    previousCheckpointSha256: ZERO_SHA256,
    fromCursor: events[0].cursor.toString(),
    toCursor: events.at(-1)!.cursor.toString(),
    previousEventHash: events[0].previousHash,
    eventHeadHash: events.at(-1)!.eventHash,
    eventCount: events.length,
    canonicalSegmentSha256: canonicalSegmentSha256(events.map((event) => event.canonicalMaterial)),
    issuedAt,
    expiresAt: canonicalNow(Date.parse(issuedAt) + 60_000),
    ...overrides,
  };
  const manifestJson = canonicalJson(manifest);
  const signature = sign('sha256', Buffer.from(manifestJson, 'utf8'), {
    key: keys.privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return {
    manifest,
    manifestJson,
    manifestSha256: sha256Hex(manifestJson),
    signature,
  };
}

function auditConfig(overrides: Record<string, unknown> = {}): MsaidiziAuditSignerConfig {
  return new MsaidiziAuditSignerConfig(
    new ConfigService({
      MSAIDIZI_AUDIT_SIGNER_ENABLED: 'true',
      MSAIDIZI_AUDIT_SIGNER_KILL_SWITCH: 'false',
      MSAIDIZI_AUDIT_SIGNER_KEY_ID: signerKeyId,
      MSAIDIZI_AUDIT_SIGNER_CLIENT_CERT_SHA256: certificateSha256,
      MSAIDIZI_AUDIT_SIGNER_CLIENT_SPKI_SHA256: subjectPublicKeySha256,
      MSAIDIZI_AUDIT_SIGNER_MAX_SEGMENT_EVENTS: 256,
      MSAIDIZI_AUDIT_SIGNER_CHECKPOINT_TTL_SECONDS: 300,
      MSAIDIZI_AUDIT_SIGNER_MAX_CLOCK_SKEW_SECONDS: 30,
      ...overrides,
    }),
  );
}

function canonicalNow(value: number): string {
  return new Date(value).toISOString();
}
