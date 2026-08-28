import {
  ConflictException,
  HttpStatus,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MsaidiziDeviceStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Request } from 'express';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { directMtlsPeer } from './direct-mtls-peer';
import {
  DeviceJournalReconciliationDto,
  DeviceJournalHeadDto,
  DeviceJournalRecordDto,
  MAX_JOURNAL_RECONCILIATION_ENTRIES,
} from './dto/msaidizi-device.dto';
import { MsaidiziDeviceJournalLedgerService } from './msaidizi-device-journal-ledger.service';
import { MsaidiziDeviceChannelController } from './msaidizi-devices.controller';

jest.mock('./direct-mtls-peer', () => ({ directMtlsPeer: jest.fn() }));

const deviceId = 'device-1';
const genesis = '0'.repeat(64);
const payloadSha256 = 'b'.repeat(64);
const publicKey = 'test-device-public-key';
const publicKeySha256 = createHash('sha256').update(publicKey).digest('hex').toUpperCase();
const request = {} as Request;
const entryHash = createHash('sha256')
  .update(
    JSON.stringify({
      hashVersion: 2,
      sequence: 1,
      occurredAtUnixMilliseconds: Date.parse('2026-08-27T10:00:00.000Z'),
      kind: 0,
      actionId: 'action-1',
      idempotencyKey: 'idempotency-1',
      previousHash: genesis,
      payloadSha256,
    }),
  )
  .digest('hex');

expect(entryHash).toBe('7728d40c10166f74bf729ec19ee0c3d9306017cbb69d57b6a62f7ccca445eefa');

function record(overrides: Partial<DeviceJournalRecordDto> = {}): DeviceJournalRecordDto {
  return {
    hashVersion: 2,
    sequence: 1,
    occurredAt: '2026-08-27T10:00:00.000Z',
    kind: 'Prepared',
    actionId: 'action-1',
    idempotencyKey: 'idempotency-1',
    previousHash: genesis,
    payloadSha256,
    entryHash,
    ...overrides,
  };
}

function reconciliation(
  overrides: Partial<DeviceJournalReconciliationDto> = {},
): DeviceJournalReconciliationDto {
  return {
    deviceId,
    startingPreviousSequence: 0,
    startingPreviousHash: genesis,
    entries: [record()],
    finalSequence: 1,
    finalHash: entryHash,
    localHeadSequence: 1,
    localHeadHash: entryHash,
    ...overrides,
  };
}

function harness() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn(),
  };
  const prisma = {
    msaidiziDevice: {
      findUnique: jest.fn().mockResolvedValue({
        id: deviceId,
        status: MsaidiziDeviceStatus.ACTIVE,
        certificateThumbprint: 'C'.repeat(64),
        publicKey,
      }),
    },
    $transaction: jest.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    $queryRaw: jest.fn(),
  };
  const service = new MsaidiziDeviceJournalLedgerService(
    prisma as never,
    { channelEnabled: true } as never,
  );
  return { prisma, service, tx };
}

describe('device journal startup/reconnect reconciliation', () => {
  beforeEach(() => {
    jest.mocked(directMtlsPeer).mockReturnValue({
      certificateSha256: 'C'.repeat(64),
      publicKeyPem: publicKey,
      publicKeySha256,
      validFrom: new Date('2020-01-01T00:00:00.000Z'),
      validTo: new Date('2099-01-01T00:00:00.000Z'),
      chainAuthorized: true,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('CAS-appends one contiguous digest-only range and ACKs the exact local head', async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([]) // row lock
      .mockResolvedValueOnce([{ sequence: 0, entryHash: genesis }])
      .mockResolvedValueOnce([]); // no replayed records

    await expect(service.reconcile(reconciliation(), request)).resolves.toEqual({
      accepted: true,
      deviceId,
      startingPreviousSequence: 0,
      startingPreviousHash: genesis,
      acceptedThroughSequence: 1,
      acceptedThroughHash: entryHash,
      localHeadSequence: 1,
      localHeadHash: entryHash,
      exactHead: true,
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(tx.$executeRaw.mock.calls)).not.toMatch(
      /payloadJson|arguments|credential|outputJson/i,
    );
  });

  it('idempotently accepts an identical replay without inserting another entry', async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sequence: 1, entryHash }])
      .mockResolvedValueOnce([
        {
          deviceId,
          ...record(),
          occurredAt: new Date(record().occurredAt),
        },
      ]);

    await expect(service.reconcile(reconciliation(), request)).resolves.toMatchObject({
      accepted: true,
      exactHead: true,
      acceptedThroughSequence: 1,
    });
    // Lazy head creation and reconciledAt confirmation only; no entry INSERT or head advance.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'gap',
      reconciliation({
        startingPreviousSequence: 2,
        finalSequence: 2,
        entries: [],
        finalHash: genesis,
        localHeadSequence: 2,
        localHeadHash: genesis,
      }),
    ],
    [
      'fork',
      reconciliation({
        startingPreviousHash: 'd'.repeat(64),
        entries: [record({ previousHash: 'd'.repeat(64) })],
      }),
    ],
  ])('rejects a %s without changing central history', async (_label, dto) => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sequence: 0, entryHash: genesis }]);

    await expect(service.reconcile(dto, request)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a rewrite at an existing sequence', async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sequence: 1, entryHash }])
      .mockResolvedValueOnce([
        {
          deviceId,
          ...record({ payloadSha256: 'e'.repeat(64) }),
          occurredAt: new Date(record().occurredAt),
        },
      ]);

    await expect(service.reconcile(reconciliation(), request)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('recomputes v2 entry hashes and rejects opaque device-selected values', async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sequence: 0, hashVersion: 2, entryHash: genesis }])
      .mockResolvedValueOnce([]);
    const opaque = 'a'.repeat(64);

    await expect(
      service.reconcile(
        reconciliation({
          entries: [record({ entryHash: opaque })],
          finalHash: opaque,
          localHeadHash: opaque,
        }),
        request,
      ),
    ).rejects.toThrow('does not match its digest material');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a rechained v2 to legacy-v1 downgrade before persistence', async () => {
    const { service, tx } = harness();
    const legacyHash = 'c'.repeat(64);
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sequence: 1, hashVersion: 2, entryHash }])
      .mockResolvedValueOnce([{ sequence: 1, hashVersion: 2, entryHash }]);

    await expect(
      service.reconcile(
        reconciliation({
          startingPreviousSequence: 1,
          startingPreviousHash: entryHash,
          entries: [
            record({
              hashVersion: 1,
              sequence: 2,
              previousHash: entryHash,
              entryHash: legacyHash,
            }),
          ],
          finalSequence: 2,
          finalHash: legacyHash,
          localHeadSequence: 2,
          localHeadHash: legacyHash,
        }),
        request,
      ),
    ).rejects.toThrow('cannot downgrade');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('requires the first v2 record after a legacy prefix to be ChainUpgraded', async () => {
    const { service, tx } = harness();
    const legacyHash = 'c'.repeat(64);
    const nextHash = 'd'.repeat(64);
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sequence: 1, hashVersion: 1, entryHash: legacyHash }])
      .mockResolvedValueOnce([{ sequence: 1, hashVersion: 1, entryHash: legacyHash }]);

    await expect(
      service.reconcile(
        reconciliation({
          startingPreviousSequence: 1,
          startingPreviousHash: legacyHash,
          entries: [record({ sequence: 2, previousHash: legacyHash, entryHash: nextHash })],
          finalSequence: 2,
          finalHash: nextHash,
          localHeadSequence: 2,
          localHeadHash: nextHash,
        }),
        request,
      ),
    ).rejects.toThrow('explicit v2 upgrade bridge');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a ChainUpgraded record without a legacy predecessor', async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sequence: 0, hashVersion: 2, entryHash: genesis }]);

    await expect(
      service.reconcile(reconciliation({ entries: [record({ kind: 'ChainUpgraded' })] }), request),
    ).rejects.toThrow('one-way v1 to v2 transition');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('binds the claimed device to the authenticated direct mTLS identity', async () => {
    const { service, prisma } = harness();

    await expect(
      service.reconcile(reconciliation({ deviceId: 'device-2' }), request),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns an authenticated central cursor and a canonical genesis when empty', async () => {
    const { service, prisma } = harness();
    prisma.$queryRaw.mockResolvedValueOnce([{ sequence: 0, hashVersion: 2, entryHash: genesis }]);

    await expect(service.head({ deviceId }, request)).resolves.toEqual({
      deviceId,
      sequence: 0,
      hashVersion: 0,
      entryHash: genesis,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('accepts the lowercase hashes emitted by the companion and rejects mixed-case vectors', async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sequence: 0, hashVersion: 2, entryHash: genesis }])
      .mockResolvedValueOnce([]);

    await expect(service.reconcile(reconciliation(), request)).resolves.toMatchObject({
      accepted: true,
      acceptedThroughHash: entryHash,
    });

    const second = harness();
    await expect(
      second.service.reconcile(
        reconciliation({
          startingPreviousHash: genesis.toUpperCase(),
          entries: [record({ payloadSha256: payloadSha256.toUpperCase() })],
        }),
        request,
      ),
    ).rejects.toThrow('canonical lowercase');
    expect(second.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('bounds and validates the closed reconciliation DTO', () => {
    expect(
      validateSync(plainToInstance(DeviceJournalReconciliationDto, reconciliation())),
    ).toHaveLength(0);
    const oversized = reconciliation({
      entries: Array.from({ length: MAX_JOURNAL_RECONCILIATION_ENTRIES + 1 }, (_, index) =>
        record({ sequence: index + 1 }),
      ),
    });
    expect(
      validateSync(plainToInstance(DeviceJournalReconciliationDto, oversized)).length,
    ).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(DeviceJournalHeadDto, { deviceId }))).toHaveLength(0);
  });

  it('exposes only an authenticated POST 200 channel endpoint', async () => {
    const dto = reconciliation();
    const reconcile = jest.fn().mockResolvedValue({ accepted: true });
    const controller = new MsaidiziDeviceChannelController({} as never, { reconcile } as never);
    const handler = MsaidiziDeviceChannelController.prototype.reconcileJournal;

    await expect(controller.reconcileJournal(dto, request)).resolves.toEqual({ accepted: true });
    expect(reconcile).toHaveBeenCalledWith(dto, request);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('channel/journal-reconcile');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.OK);

    const head = jest.fn().mockResolvedValue({ sequence: 0, entryHash: genesis });
    const headController = new MsaidiziDeviceChannelController(
      {} as never,
      { reconcile, head } as never,
    );
    const headHandler = MsaidiziDeviceChannelController.prototype.journalHead;
    await expect(headController.journalHead({ deviceId }, request)).resolves.toEqual({
      sequence: 0,
      entryHash: genesis,
    });
    expect(head).toHaveBeenCalledWith({ deviceId }, request);
    expect(Reflect.getMetadata(PATH_METADATA, headHandler)).toBe('channel/journal-head');
    expect(Reflect.getMetadata(METHOD_METADATA, headHandler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, headHandler)).toBe(HttpStatus.OK);
  });

  it('installs append-only database guards and stores no raw journal payload column', () => {
    const migration = readFileSync(
      '../database/prisma/migrations/20260827060000_msaidizi_device_journal_ledger/migration.sql',
      'utf8',
    );
    expect(migration).toContain('BEFORE UPDATE OR DELETE');
    expect(migration).toContain('msaidizi_device_journal_entries_append_only');
    expect(migration).not.toMatch(/payloadJson|argumentsJson|outputJson|credential/i);
  });
});
