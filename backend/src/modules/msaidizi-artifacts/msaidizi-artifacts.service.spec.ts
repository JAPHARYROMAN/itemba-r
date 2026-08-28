import { ConfigService } from '@nestjs/config';
import {
  MsaidiziArtifactKind,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTrustLevel,
  MsaidiziTrustedArtifactPurpose,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  canonicalAttestationJson,
  parseArtifactAttestation,
} from '../msaidizi-updates/msaidizi-evaluator-attestation.protocol';
import {
  GENERATED_UPDATE_POLICY_VERSION,
  GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
  proposalDataClass,
  UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
} from '../msaidizi-updates/update-candidate-proposal.port';
import {
  HostObservationMediaBinding,
  MsaidiziArtifactsService,
  ToolObservationArtifactInput,
} from './msaidizi-artifacts.service';

function toolObservationInput(
  content: Buffer,
  overrides: Partial<ToolObservationArtifactInput> = {},
): ToolObservationArtifactInput {
  return {
    taskId: '11111111-1111-4111-8111-111111111111',
    stepId: '22222222-2222-4222-8222-222222222222',
    attemptId: 'attempt-22222222-2222-4222-8222-222222222222-1',
    dataClass: 'CONFIDENTIAL',
    sourceType: 'ERP_RESULT',
    sourceSha256: 'a'.repeat(64),
    sourceBytes: content.length,
    persistedSha256: createHash('sha256').update(content).digest('hex'),
    persistedBytes: content.length,
    redactionsApplied: true,
    content,
    ...overrides,
  };
}

describe('MsaidiziArtifactsService', () => {
  let root: string;
  let uploadPath: string;
  let stored: Record<string, unknown>;
  let prisma: {
    msaidiziTask: { findFirst: jest.Mock; updateMany: jest.Mock };
    msaidiziTaskStep: { findFirst: jest.Mock; updateMany: jest.Mock };
    msaidiziToolAttempt: { findFirst: jest.Mock };
    msaidiziArtifact: { findMany: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let transactionClient: Prisma.TransactionClient;
  let transactionArtifactCreate: jest.Mock;
  let transactionEventCreate: jest.Mock;
  let transactionAdvisoryLock: jest.Mock;
  let service: MsaidiziArtifactsService;

  const user = { id: 'user-1', permissions: ['msaidizi.use'] } as AuthUser;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'msaidizi-artifact-test-'));
    uploadPath = path.join(root, 'upload.tmp');
    await fs.writeFile(uploadPath, 'credential password=do-not-persist-plaintext');
    stored = {};
    transactionArtifactCreate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      stored = data;
      return { id: 'artifact-1', ...data };
    });
    transactionEventCreate = jest.fn().mockResolvedValue({});
    transactionAdvisoryLock = jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]);
    prisma = {
      msaidiziTask: {
        findFirst: jest.fn().mockResolvedValue({
          id: '11111111-1111-4111-8111-111111111111',
          bytesRead: 0n,
          bytesWritten: 0n,
          maxLocalBytes: 10_000n,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      msaidiziTaskStep: {
        findFirst: jest.fn().mockResolvedValue({
          id: '22222222-2222-4222-8222-222222222222',
          taskId: '11111111-1111-4111-8111-111111111111',
          budgets: { maxLocalBytes: 10_000 },
          bytesRead: 0n,
          bytesWritten: 0n,
          localIoAccountingValid: true,
          status: 'READY',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      msaidiziToolAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          step: {
            id: '22222222-2222-4222-8222-222222222222',
            taskId: '11111111-1111-4111-8111-111111111111',
            budgets: { maxLocalBytes: 10_000 },
            bytesRead: 0n,
            bytesWritten: 0n,
            localIoAccountingValid: true,
            status: 'RUNNING',
          },
          task: {
            status: MsaidiziTaskStatus.RUNNING,
            bytesRead: 100n,
            bytesWritten: 0n,
            maxLocalBytes: 10_000n,
          },
        }),
      },
      msaidiziArtifact: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(async () => [
          {
            id: 'artifact-1',
            taskId: '11111111-1111-4111-8111-111111111111',
            kind: MsaidiziArtifactKind.REPORT,
            name: 'proof.txt',
            mimeType: 'text/plain',
            storageKey: stored.storageKey,
            sha256: stored.sha256,
            byteSize: stored.byteSize,
            encrypted: true,
            dataClass: 'CONFIDENTIAL',
            trustLevel: stored.trustLevel,
            provenance: stored.provenance,
            task: {
              initiatedByUserId: user.id,
              bytesRead: 0n,
              bytesWritten: 0n,
              externalEgressBytes: 0n,
              reservedExternalEgressBytes: 0n,
              maxLocalBytes: 10_000n,
              maxExternalEgressBytes: 10_000n,
            },
          },
        ]),
        findFirst: jest.fn(async () => ({
          id: 'artifact-1',
          taskId: '11111111-1111-4111-8111-111111111111',
          name: 'proof.txt',
          mimeType: 'text/plain',
          storageKey: stored.storageKey,
          sha256: stored.sha256,
          byteSize: stored.byteSize,
          encrypted: true,
          task: {
            initiatedByUserId: user.id,
            companyId: 'company-1',
            bytesRead: 0n,
            bytesWritten: 0n,
            externalEgressBytes: 0n,
            reservedExternalEgressBytes: 0n,
            maxLocalBytes: 10_000n,
            maxExternalEgressBytes: 10_000n,
          },
        })),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transactionClient),
      ),
    };
    transactionClient = {
      $queryRaw: transactionAdvisoryLock,
      msaidiziTask: { updateMany: prisma.msaidiziTask.updateMany },
      msaidiziTaskStep: { updateMany: prisma.msaidiziTaskStep.updateMany },
      msaidiziToolAttempt: { findFirst: prisma.msaidiziToolAttempt.findFirst },
      msaidiziArtifact: {
        findUnique: prisma.msaidiziArtifact.findUnique,
        create: transactionArtifactCreate,
      },
      msaidiziTaskEvent: { create: transactionEventCreate },
    } as unknown as Prisma.TransactionClient;
    const key = randomBytes(32).toString('base64');
    const config = {
      get: jest.fn((name: string, fallback?: string) => {
        if (name === 'MSAIDIZI_AUTONOMY_ENABLED') return 'true';
        if (name === 'MSAIDIZI_ARTIFACT_ENCRYPTION_KEY') return key;
        if (name === 'MSAIDIZI_ARTIFACT_ROOT') return root;
        return fallback;
      }),
    } as unknown as ConfigService;
    service = new MsaidiziArtifactsService(
      prisma as never,
      config,
      {
        verify: jest.fn(),
      } as never,
      { logStrictInTransaction: jest.fn() } as never,
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('encrypts uploads at rest and decrypts only through the scoped download path', async () => {
    const content = await fs.readFile(uploadPath);
    const result = await service.upload(
      {
        path: uploadPath,
        size: content.length,
        mimetype: 'text/plain',
      } as Express.Multer.File,
      {
        taskId: '11111111-1111-4111-8111-111111111111',
        kind: MsaidiziArtifactKind.REPORT,
        name: 'proof.txt',
        dataClass: 'CONFIDENTIAL',
        provenance: { source: 'test' },
      },
      user,
    );

    expect(result).toMatchObject({ id: 'artifact-1', encrypted: true });
    expect(stored.trustLevel).toBe(MsaidiziTrustLevel.UNTRUSTED);
    const ciphertext = await fs.readFile(path.join(root, String(stored.storageKey)));
    expect(ciphertext.subarray(0, 4).toString('ascii')).toBe('MSA1');
    expect(ciphertext.toString('utf8')).not.toContain('do-not-persist-plaintext');

    const downloaded = await service.download('artifact-1', user);
    expect((await readAll(downloaded.stream)).toString()).toBe(content.toString());
  });

  it('fails closed when the deployment encryption key is absent', async () => {
    const config = {
      get: jest.fn((name: string, fallback?: string) =>
        name === 'MSAIDIZI_AUTONOMY_ENABLED' ? 'true' : fallback,
      ),
    };
    const disabled = new MsaidiziArtifactsService(
      prisma as never,
      config as unknown as ConfigService,
      { verify: jest.fn() } as never,
      { logStrictInTransaction: jest.fn() } as never,
    );
    const content = await fs.readFile(uploadPath);
    await expect(
      disabled.upload(
        { path: uploadPath, size: content.length, mimetype: 'text/plain' } as Express.Multer.File,
        {
          taskId: '11111111-1111-4111-8111-111111111111',
          kind: MsaidiziArtifactKind.REPORT,
          name: 'proof.txt',
          dataClass: 'CONFIDENTIAL',
          provenance: { source: 'test' },
        },
        user,
      ),
    ).rejects.toThrow('Msaidizi artifact encryption is not configured');
    await expect(fs.stat(uploadPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('enforces the local I/O ceiling across reads and writes as one budget', async () => {
    prisma.msaidiziTask.findFirst.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      bytesRead: 6_000n,
      bytesWritten: 4_000n,
      maxLocalBytes: 10_000n,
    });
    const content = await fs.readFile(uploadPath);

    await expect(
      service.upload(
        { path: uploadPath, size: content.length, mimetype: 'text/plain' } as Express.Multer.File,
        {
          taskId: '11111111-1111-4111-8111-111111111111',
          kind: MsaidiziArtifactKind.REPORT,
          name: 'proof.txt',
          dataClass: 'CONFIDENTIAL',
          provenance: { source: 'test' },
        },
        user,
      ),
    ).rejects.toThrow('Task local I/O budget would be exceeded');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('prepares an opaque observation without publishing, charging, emitting, or writing a file', async () => {
    const content = Buffer.from(JSON.stringify({ rows: ['prepared-only'] }), 'utf8');
    const entriesBefore = await fs.readdir(root);
    const prepared = await service.prepareToolObservation(toolObservationInput(content));

    expect(prepared).toMatchObject({
      replay: false,
      artifact: {
        sha256: createHash('sha256').update(content).digest('hex'),
        kind: MsaidiziArtifactKind.OTHER,
        trustLevel: MsaidiziTrustLevel.UNTRUSTED,
      },
    });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.artifact)).toBe(true);
    expect(Object.keys(prepared.artifact).sort()).toEqual(
      ['id', 'kind', 'mimeType', 'sha256', 'trustLevel'].sort(),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.msaidiziTask.updateMany).not.toHaveBeenCalled();
    expect(prisma.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
    expect(transactionArtifactCreate).not.toHaveBeenCalled();
    expect(transactionEventCreate).not.toHaveBeenCalled();
    expect(await fs.readdir(root)).toEqual(entriesBefore);

    await expect(service.finishPreparedToolObservation(prepared, false)).resolves.toBeUndefined();
    await expect(service.finishPreparedToolObservation(prepared, false)).resolves.toBeUndefined();
    await expect(service.finishPreparedToolObservation(prepared, true)).rejects.toThrow(
      'finish state conflicts',
    );
    content.fill(0);
  });

  it('commits a prepared observation only through the supplied transaction and rejects reuse', async () => {
    const content = Buffer.from(JSON.stringify({ rows: ['transaction-owned'] }), 'utf8');
    const input = toolObservationInput(content);
    const prepared = await service.prepareToolObservation(input);

    await expect(
      service.commitPreparedToolObservation(transactionClient, prepared),
    ).resolves.toMatchObject({ replay: false, artifact: { id: prepared.artifact.id } });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(transactionAdvisoryLock).toHaveBeenCalledTimes(1);
    expect(prisma.msaidiziTask.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.msaidiziTaskStep.updateMany).toHaveBeenCalledTimes(1);
    expect(transactionArtifactCreate).toHaveBeenCalledTimes(1);
    expect(transactionEventCreate).toHaveBeenCalledTimes(1);
    await expect(fs.stat(path.join(root, `${prepared.artifact.id}.msa`))).resolves.toBeDefined();
    await expect(
      service.commitPreparedToolObservation(transactionClient, prepared),
    ).rejects.toThrow('already been committed');
    await expect(service.finishPreparedToolObservation(prepared, true)).resolves.toBeUndefined();
    await expect(service.finishPreparedToolObservation(prepared, true)).resolves.toBeUndefined();

    prisma.msaidiziArtifact.findUnique.mockResolvedValueOnce(stored);
    const replay = await service.prepareToolObservation(input);
    expect(replay.replay).toBe(true);
    expect(Object.keys(replay.artifact).sort()).toEqual(
      ['id', 'kind', 'mimeType', 'sha256', 'trustLevel'].sort(),
    );
    expect(JSON.stringify(replay)).not.toContain('storageKey');
    expect(JSON.stringify(replay)).not.toContain('provenance');
    prisma.msaidiziArtifact.findUnique.mockResolvedValueOnce(stored);
    await expect(
      service.commitPreparedToolObservation(transactionClient, replay),
    ).resolves.toMatchObject({ replay: true, artifact: { id: replay.artifact.id } });
    expect(transactionAdvisoryLock).toHaveBeenCalledTimes(2);
    await service.finishPreparedToolObservation(replay, true);
    content.fill(0);
  });

  it('flushes ciphertext before publishing the artifact row', async () => {
    const content = Buffer.from(JSON.stringify({ rows: ['durable-before-row'] }), 'utf8');
    const originalOpen = fs.open.bind(fs);
    let syncCalls = 0;
    const openSpy = jest.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await originalOpen(file, flags, mode);
      const originalSync = handle.sync.bind(handle);
      handle.sync = jest.fn(async () => {
        syncCalls += 1;
        await originalSync();
      });
      return handle;
    });
    transactionArtifactCreate.mockImplementationOnce(
      async ({ data }: { data: Record<string, unknown> }) => {
        expect(syncCalls).toBe(1);
        stored = data;
        return { id: 'artifact-1', ...data };
      },
    );

    try {
      const prepared = await service.prepareToolObservation(toolObservationInput(content));
      await expect(
        service.commitPreparedToolObservation(transactionClient, prepared),
      ).resolves.toMatchObject({ replay: false });
      await service.finishPreparedToolObservation(prepared, true);
    } finally {
      openSpy.mockRestore();
      content.fill(0);
    }
  });

  it('removes only its serialized ciphertext when the outer transaction rolls back', async () => {
    const content = Buffer.from(JSON.stringify({ rows: ['rolled-back'] }), 'utf8');
    const prepared = await service.prepareToolObservation(toolObservationInput(content));
    const destination = path.join(root, `${prepared.artifact.id}.msa`);

    await service.commitPreparedToolObservation(transactionClient, prepared);
    await expect(fs.stat(destination)).resolves.toBeDefined();
    await expect(service.finishPreparedToolObservation(prepared, false)).resolves.toBeUndefined();
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(transactionAdvisoryLock).toHaveBeenCalledTimes(2);
    await expect(service.finishPreparedToolObservation(prepared, false)).resolves.toBeUndefined();
    expect(transactionAdvisoryLock).toHaveBeenCalledTimes(2);
    content.fill(0);
  });

  it('repairs a serialized rowless ciphertext orphan before publishing the deterministic artifact', async () => {
    const content = Buffer.from(JSON.stringify({ rows: ['orphan-recovery'] }), 'utf8');
    const prepared = await service.prepareToolObservation(toolObservationInput(content));
    const destination = path.join(root, `${prepared.artifact.id}.msa`);
    await fs.writeFile(destination, 'crashed-writer-orphan', { flag: 'wx' });

    await expect(
      service.commitPreparedToolObservation(transactionClient, prepared),
    ).resolves.toMatchObject({ replay: false });
    const encrypted = await fs.readFile(destination);
    expect(encrypted.subarray(0, 4).toString('ascii')).toBe('MSA1');
    expect(encrypted.toString('utf8')).not.toContain('crashed-writer-orphan');
    expect(transactionAdvisoryLock).toHaveBeenCalledTimes(1);
    expect(transactionArtifactCreate).toHaveBeenCalledTimes(1);

    await service.finishPreparedToolObservation(prepared, true);
    encrypted.fill(0);
    content.fill(0);
  });

  it('rechecks replay under the serialization lock and never charges a concurrent winner', async () => {
    const content = Buffer.from(JSON.stringify({ rows: ['concurrent-winner'] }), 'utf8');
    const input = toolObservationInput(content);
    const prepared = await service.prepareToolObservation(input);
    prisma.msaidiziArtifact.findUnique.mockResolvedValueOnce({
      id: prepared.artifact.id,
      taskId: input.taskId,
      stepId: input.stepId,
      kind: MsaidiziArtifactKind.OTHER,
      name: `tool-observation-${input.stepId}.json`,
      mimeType: 'application/json',
      sha256: input.persistedSha256,
      byteSize: BigInt(content.length),
      encrypted: true,
      trustLevel: MsaidiziTrustLevel.UNTRUSTED,
      provenance: {
        attemptId: input.attemptId,
        sourceSha256: input.sourceSha256,
        sourceType: input.sourceType,
        capability: null,
        mimeType: 'application/json',
        extension: null,
        argumentsSha256: null,
        sourceIdentifierSha256: null,
        trustLevel: 'UNTRUSTED',
        accountedLocalBytesRead: '0',
        accountedLocalBytesWritten: '0',
      },
    });

    await expect(
      service.commitPreparedToolObservation(transactionClient, prepared),
    ).resolves.toMatchObject({ replay: true, artifact: { id: prepared.artifact.id } });
    expect(transactionAdvisoryLock).toHaveBeenCalledTimes(1);
    expect(prisma.msaidiziTask.updateMany).not.toHaveBeenCalled();
    expect(prisma.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
    expect(transactionArtifactCreate).not.toHaveBeenCalled();
    expect(transactionEventCreate).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(root, `${prepared.artifact.id}.msa`))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await service.finishPreparedToolObservation(prepared, true);
    content.fill(0);
  });

  it('rejects a forged preparation handle before any transaction or filesystem use', async () => {
    const forged = {
      artifact: {
        id: '44444444-4444-4444-8444-444444444444',
        sha256: 'a'.repeat(64),
        mimeType: 'application/json',
        kind: MsaidiziArtifactKind.OTHER,
        trustLevel: MsaidiziTrustLevel.UNTRUSTED,
      },
      replay: false,
    };

    await expect(service.commitPreparedToolObservation(transactionClient, forged)).rejects.toThrow(
      'handle is invalid',
    );
    expect(transactionAdvisoryLock).not.toHaveBeenCalled();
  });

  it('idempotently encrypts a redacted large tool observation and charges its write bytes', async () => {
    const content = Buffer.from(
      JSON.stringify({ rows: ['safe-observation'], accessToken: '[REDACTED_SECRET]' }),
      'utf8',
    );
    const sha256 = createHash('sha256').update(content).digest('hex');

    const result = await service.ingestToolObservation({
      taskId: '11111111-1111-4111-8111-111111111111',
      stepId: '22222222-2222-4222-8222-222222222222',
      attemptId: 'attempt-22222222-2222-4222-8222-222222222222-1',
      dataClass: 'CONFIDENTIAL',
      sourceType: 'ERP_RESULT',
      sourceSha256: 'a'.repeat(64),
      sourceBytes: content.length + 40,
      persistedSha256: sha256,
      persistedBytes: content.length,
      redactionsApplied: true,
      content,
    });

    expect(result).toMatchObject({ replay: false, artifact: { encrypted: true, sha256 } });
    expect(stored).toMatchObject({
      kind: MsaidiziArtifactKind.OTHER,
      trustLevel: MsaidiziTrustLevel.UNTRUSTED,
      byteSize: BigInt(content.length),
    });
    const ciphertext = await fs.readFile(path.join(root, String(stored.storageKey)));
    expect(ciphertext.subarray(0, 4).toString('ascii')).toBe('MSA1');
    expect(ciphertext.includes(content)).toBe(false);

    prisma.msaidiziArtifact.findUnique.mockResolvedValueOnce(stored);
    await expect(
      service.ingestToolObservation({
        taskId: '11111111-1111-4111-8111-111111111111',
        stepId: '22222222-2222-4222-8222-222222222222',
        attemptId: 'attempt-22222222-2222-4222-8222-222222222222-1',
        dataClass: 'CONFIDENTIAL',
        sourceType: 'ERP_RESULT',
        sourceSha256: 'a'.repeat(64),
        sourceBytes: content.length + 40,
        persistedSha256: sha256,
        persistedBytes: content.length,
        redactionsApplied: true,
        content,
      }),
    ).resolves.toMatchObject({ replay: true, artifact: { id: stored.id, sha256 } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.msaidiziTaskStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          localIoAccountingValid: true,
          bytesRead: 0n,
          bytesWritten: 0n,
        }),
        data: expect.objectContaining({ bytesWritten: { increment: BigInt(content.length) } }),
      }),
    );
    content.fill(0);
  });

  it('atomically accounts host-local usage with an artifact and never charges its replay twice', async () => {
    const content = Buffer.from(JSON.stringify({ rows: ['host-result'] }), 'utf8');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const input = {
      taskId: '11111111-1111-4111-8111-111111111111',
      stepId: '22222222-2222-4222-8222-222222222222',
      attemptId: 'attempt-22222222-2222-4222-8222-222222222222-1',
      dataClass: 'CONFIDENTIAL',
      sourceType: 'HOST_RESULT' as const,
      sourceSha256: 'c'.repeat(64),
      sourceBytes: content.length,
      persistedSha256: sha256,
      persistedBytes: content.length,
      redactionsApplied: false,
      content,
      accountedLocalBytesRead: 11n,
      accountedLocalBytesWritten: 13n,
    };

    await expect(service.ingestToolObservation(input)).resolves.toMatchObject({ replay: false });
    expect(prisma.msaidiziTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bytesRead: { increment: 11n },
          bytesWritten: { increment: BigInt(content.length) + 13n },
        }),
      }),
    );
    expect(prisma.msaidiziTaskStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bytesRead: { increment: 11n },
          bytesWritten: { increment: BigInt(content.length) + 13n },
        }),
      }),
    );

    prisma.msaidiziArtifact.findUnique.mockResolvedValueOnce(stored);
    await expect(service.ingestToolObservation(input)).resolves.toMatchObject({ replay: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.msaidiziTaskStep.updateMany).toHaveBeenCalledTimes(1);
    content.fill(0);
  });

  it.each([
    {
      capability: 'screen.primary.capture' as const,
      mimeType: 'image/png' as const,
      content: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=',
        'base64',
      ),
    },
    {
      capability: 'camera.photo.capture' as const,
      mimeType: 'image/jpeg' as const,
      content: Buffer.from(
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==',
        'base64',
      ),
    },
  ])(
    'encrypts $capability as binary $mimeType and exposes the image media type for reasoning',
    async ({ capability, mimeType, content }) => {
      const sha256 = createHash('sha256').update(content).digest('hex');
      const result = (await service.ingestToolObservation({
        taskId: '11111111-1111-4111-8111-111111111111',
        stepId: '22222222-2222-4222-8222-222222222222',
        attemptId: 'attempt-22222222-2222-4222-8222-222222222222-1',
        dataClass: 'RESTRICTED',
        sourceType: 'HOST_RESULT',
        sourceSha256: 'b'.repeat(64),
        sourceBytes: content.length * 2,
        persistedSha256: sha256,
        persistedBytes: content.length,
        redactionsApplied: false,
        content,
        media: { capability, mimeType } as HostObservationMediaBinding,
      })) as { artifact: { id: string } };

      expect(stored).toMatchObject({
        kind: MsaidiziArtifactKind.SCREENSHOT,
        mimeType,
        sha256,
        trustLevel: MsaidiziTrustLevel.UNTRUSTED,
        provenance: expect.objectContaining({
          capability,
          mimeType,
          trustLevel: 'UNTRUSTED',
        }),
      });
      const ciphertext = await fs.readFile(path.join(root, String(stored.storageKey)));
      expect(ciphertext.includes(content)).toBe(false);

      prisma.msaidiziArtifact.findUnique.mockResolvedValueOnce(stored);
      await expect(
        service.ingestToolObservation({
          taskId: '11111111-1111-4111-8111-111111111111',
          stepId: '22222222-2222-4222-8222-222222222222',
          attemptId: 'attempt-22222222-2222-4222-8222-222222222222-1',
          dataClass: 'RESTRICTED',
          sourceType: 'HOST_RESULT',
          sourceSha256: 'b'.repeat(64),
          sourceBytes: content.length * 2,
          persistedSha256: sha256,
          persistedBytes: content.length,
          redactionsApplied: false,
          content,
          media: { capability, mimeType } as HostObservationMediaBinding,
        }),
      ).resolves.toMatchObject({ replay: true, artifact: { id: result.artifact.id, sha256 } });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      prisma.msaidiziArtifact.findMany.mockResolvedValueOnce([
        {
          ...stored,
          id: result.artifact.id,
          taskId: '11111111-1111-4111-8111-111111111111',
          task: {
            initiatedByUserId: user.id,
            bytesRead: 0n,
            bytesWritten: BigInt(content.length),
            externalEgressBytes: 0n,
            reservedExternalEgressBytes: 0n,
            maxLocalBytes: 10_000n,
            maxExternalEgressBytes: 10_000n,
          },
        },
      ]);
      const [reasoningArtifact] = await service.readForReasoning([result.artifact.id], user);
      expect(reasoningArtifact.mimeType).toBe(mimeType);
      expect(reasoningArtifact.content.equals(content)).toBe(true);
      expect(reasoningArtifact.trustLevel).toBe('UNTRUSTED');
      reasoningArtifact.content.fill(0);
      content.fill(0);
    },
  );

  it('decrypts model artifacts ephemerally, forces untrusted semantics, and charges base64 egress', async () => {
    const content = await fs.readFile(uploadPath);
    await service.upload(
      { path: uploadPath, size: content.length, mimetype: 'text/plain' } as Express.Multer.File,
      {
        taskId: '11111111-1111-4111-8111-111111111111',
        kind: MsaidiziArtifactKind.REPORT,
        name: 'proof.txt',
        dataClass: 'CONFIDENTIAL',
        provenance: { source: 'test' },
      },
      user,
    );

    const [artifact] = await service.readForReasoning(['artifact-1'], user);

    expect(artifact.content.equals(content)).toBe(true);
    expect(artifact.trustLevel).toBe('UNTRUSTED');
    expect(prisma.msaidiziTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reservedExternalEgressBytes: 0n }),
        data: expect.objectContaining({
          bytesRead: { increment: BigInt(content.length) },
          externalEgressBytes: {
            increment: ((BigInt(content.length) + 2n) / 3n) * 4n,
          },
        }),
      }),
    );
    artifact.content.fill(0);
  });

  it('rejects a wrong-task draft artifact before budget reservation or decryption', async () => {
    prisma.msaidiziArtifact.findMany.mockResolvedValueOnce([]);

    await expect(
      service.readDraftForReasoning(
        {
          taskId: '22222222-2222-4222-8222-222222222222',
          principalId: 'principal-1',
          initiatedByUserId: user.id,
          companyId: 'company-1',
          mandateId: null,
          mode: MsaidiziTaskMode.COLLABORATIVE,
          stateVersion: 0,
        },
        ['artifact-1'],
        user,
      ),
    ).rejects.toThrow('Reasoning artifact not found');

    expect(prisma.msaidiziArtifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['artifact-1'] },
          taskId: '22222222-2222-4222-8222-222222222222',
          stepId: null,
          trustLevel: MsaidiziTrustLevel.UNTRUSTED,
          task: expect.objectContaining({
            id: '22222222-2222-4222-8222-222222222222',
            principalId: 'principal-1',
            companyId: 'company-1',
            status: MsaidiziTaskStatus.PLANNING,
            activePlanVersion: 0,
            stateVersion: 0,
          }),
        }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.msaidiziTask.updateMany).not.toHaveBeenCalled();
  });

  it('refuses decryption when the draft is promoted between lookup and reservation', async () => {
    prisma.msaidiziArtifact.findMany.mockResolvedValueOnce([
      {
        id: 'artifact-1',
        taskId: '22222222-2222-4222-8222-222222222222',
        stepId: null,
        step: null,
        kind: MsaidiziArtifactKind.DOCUMENT,
        name: 'draft.txt',
        mimeType: 'text/plain',
        storageKey: 'must-not-be-opened.msa',
        sha256: 'a'.repeat(64),
        byteSize: 16n,
        encrypted: true,
        dataClass: 'internal',
        trustLevel: MsaidiziTrustLevel.UNTRUSTED,
        provenance: { sourceType: 'USER' },
        task: {
          initiatedByUserId: user.id,
          bytesRead: 0n,
          bytesWritten: 16n,
          externalEgressBytes: 0n,
          reservedExternalEgressBytes: 0n,
          maxLocalBytes: 10_000n,
          maxExternalEgressBytes: 10_000n,
        },
      },
    ]);
    // A concurrent plan promotion changes the exact authority snapshot after
    // lookup but before the transaction can reserve any reasoning budget.
    prisma.msaidiziTask.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.readDraftForReasoning(
        {
          taskId: '22222222-2222-4222-8222-222222222222',
          principalId: 'principal-1',
          initiatedByUserId: user.id,
          companyId: 'company-1',
          mandateId: null,
          mode: MsaidiziTaskMode.COLLABORATIVE,
          stateVersion: 0,
        },
        ['artifact-1'],
        user,
      ),
    ).rejects.toThrow('Task budget changed; retry artifact reasoning');

    expect(prisma.msaidiziTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: '22222222-2222-4222-8222-222222222222',
          principalId: 'principal-1',
          companyId: 'company-1',
          mode: MsaidiziTaskMode.COLLABORATIVE,
          status: MsaidiziTaskStatus.PLANNING,
          activePlanVersion: 0,
          stateVersion: 0,
        }),
      }),
    );
  });

  it('refuses raw audio so local speech-to-text remains the only voice-to-model path', async () => {
    prisma.msaidiziArtifact.findMany.mockResolvedValueOnce([
      {
        id: 'artifact-1',
        taskId: '11111111-1111-4111-8111-111111111111',
        mimeType: 'audio/wav',
        encrypted: true,
        byteSize: 16n,
        task: {
          bytesRead: 0n,
          bytesWritten: 0n,
          externalEgressBytes: 0n,
          reservedExternalEgressBytes: 0n,
          maxLocalBytes: 10_000n,
          maxExternalEgressBytes: 10_000n,
        },
      },
    ]);

    await expect(service.readForReasoning(['artifact-1'], user)).rejects.toThrow(
      'Audio must be transcribed locally',
    );
    expect(prisma.msaidiziTask.updateMany).not.toHaveBeenCalled();
  });

  it('applies the caller current company scope to artifact lookups', async () => {
    prisma.msaidiziArtifact.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.download('artifact-1', {
        ...user,
        companyId: 'company-1',
        companyAccess: [],
        roleScopes: ['COMPANY'],
      }),
    ).rejects.toThrow('Artifact not found');

    expect(prisma.msaidiziArtifact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          task: expect.objectContaining({
            companyId: { in: ['company-1'] },
          }),
        }),
      }),
    );
  });
});

describe('MsaidiziArtifactsService signed update ingestion', () => {
  it('creates a new encrypted TRUSTED FILE plus append-only verifier evidence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'msaidizi-trusted-artifact-test-'));
    const uploadPath = path.join(root, 'verified-source.tmp');
    const content = Buffer.from('verified source archive bytes');
    await fs.writeFile(uploadPath, content);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const claims = trustedArtifactClaims(sha256, content.length);
    const attestation = parseArtifactAttestation({
      claimsJson: canonicalAttestationJson(claims),
      signature: 'A'.repeat(86),
    });
    let storedArtifact: Record<string, unknown> = {};
    let storedEvidence: Record<string, unknown> = {};
    const reviewedTask = {
      id: claims.taskId,
      principalId: trustedPrincipalId,
      initiatedByUserId: trustedUserId,
      companyId: 'company-1',
      mandateId: trustedMandateId,
      mode: MsaidiziTaskMode.AUTOPILOT,
      status: MsaidiziTaskStatus.RUNNING,
      activePlanVersion: 1,
      bytesRead: 0n,
      bytesWritten: 0n,
      maxLocalBytes: 100_000n,
      principal: { status: MsaidiziPrincipalStatus.ACTIVE },
      mandate: {
        id: trustedMandateId,
        principalId: trustedPrincipalId,
        status: 'ACTIVE',
        startsAt: new Date(0),
        expiresAt: new Date(Date.now() + 60_000),
        capabilities: [
          {
            capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
            version: '1',
            effects: ['WRITE'],
            dataClasses: [trustedDataClass],
          },
        ],
      },
    };
    const reviewedStep = {
      id: claims.stepId,
      taskId: claims.taskId,
      planVersionId: claims.planVersionId,
      target: 'SELF_IMPROVEMENT',
      capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
      capabilityVersion: '1',
      arguments: {
        name: 'Trusted adapter candidate',
        version: '1.0.0',
        rollbackVersion: '0.9.0',
        scope: 'ADAPTERS',
        sourceArtifactId: claims.artifactId,
        sourceArtifactSha256: sha256,
        rollbackArtifactId: trustedRollbackArtifactId,
        rollbackArtifactSha256: 'b'.repeat(64),
        rationale: 'Produce a bounded and recoverable adapter candidate.',
      },
      expectedEffect: 'WRITE',
      dataClass: trustedDataClass,
      idempotent: true,
      mutation: true,
      planVersion: {
        id: claims.planVersionId,
        taskId: claims.taskId,
        version: 1,
        createdByUserId: trustedUserId,
      },
    };
    const trustedDatabaseNow = new Date('2026-08-25T10:05:00.000Z');
    const tx = {
      $queryRaw: jest.fn(async (query: TemplateStringsArray | string) => {
        const sql = Array.isArray(query) ? query.join(' ') : String(query);
        if (sql.includes('msaidizi_principals')) {
          return [{ id: trustedPrincipalId, status: MsaidiziPrincipalStatus.ACTIVE }];
        }
        if (sql.includes('msaidizi_tasks')) {
          return [
            {
              id: claims.taskId,
              principalId: trustedPrincipalId,
              mandateId: trustedMandateId,
            },
          ];
        }
        if (sql.includes('msaidizi_mandates')) return [{ id: trustedMandateId }];
        if (sql.includes('msaidizi_task_steps')) return [{ id: claims.stepId }];
        if (sql.includes('clock_timestamp()')) return [{ now: trustedDatabaseNow }];
        return [];
      }),
      msaidiziTask: {
        findUnique: jest.fn().mockResolvedValue(reviewedTask),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      msaidiziTaskStep: {
        findFirst: jest.fn().mockResolvedValue({
          id: claims.stepId,
          taskId: claims.taskId,
          budgets: { maxLocalBytes: 100_000 },
          bytesRead: 0n,
          bytesWritten: 0n,
          localIoAccountingValid: true,
          status: 'RUNNING',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      msaidiziArtifact: {
        create: jest.fn(async ({ data }) => {
          storedArtifact = data;
          return { ...data };
        }),
      },
      msaidiziTrustedArtifactEvidence: {
        create: jest.fn(async ({ data }) => {
          storedEvidence = data;
          return data;
        }),
      },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      msaidiziArtifact: { findUnique: jest.fn().mockResolvedValue(null) },
      msaidiziTask: { findUnique: jest.fn().mockResolvedValue(reviewedTask) },
      msaidiziTaskStep: { findFirst: jest.fn().mockResolvedValue(reviewedStep) },
      msaidiziUpdateCandidate: { findFirst: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ now: trustedDatabaseNow }]),
      $transaction: jest.fn(async (callback: (database: typeof tx) => unknown) => callback(tx)),
    };
    const key = randomBytes(32).toString('base64');
    const audit = { logStrictInTransaction: jest.fn().mockResolvedValue(undefined) };
    const service = new MsaidiziArtifactsService(
      prisma as never,
      {
        get: jest.fn((name: string, fallback?: string) => {
          if (name === 'MSAIDIZI_AUTONOMY_ENABLED') return 'true';
          if (name === 'MSAIDIZI_ARTIFACT_ENCRYPTION_KEY') return key;
          if (name === 'MSAIDIZI_ARTIFACT_ROOT') return root;
          return fallback;
        }),
      } as unknown as ConfigService,
      { verify: jest.fn() } as never,
      audit as never,
    );

    try {
      const result = await service.ingestTrustedUpdateArtifact(
        {
          path: uploadPath,
          size: content.length,
          mimetype: 'application/zip',
        } as Express.Multer.File,
        attestation,
      );

      expect(result).toMatchObject({ replay: false, claimsDigest: attestation.claimsDigest });
      expect(storedArtifact).toMatchObject({
        id: claims.artifactId,
        kind: MsaidiziArtifactKind.FILE,
        trustLevel: MsaidiziTrustLevel.TRUSTED,
        trustedPurpose: MsaidiziTrustedArtifactPurpose.SOURCE,
        encrypted: true,
        sha256,
      });
      expect(storedEvidence).toMatchObject({
        artifactId: claims.artifactId,
        claimsDigest: attestation.claimsDigest,
        signerKeyId: claims.signerKeyId,
        candidateId: null,
      });
      expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: 'MSAIDIZI_TRUSTED_ARTIFACT_INGESTED',
          companyId: 'company-1',
          taskId: claims.taskId,
          stepId: claims.stepId,
        }),
      );
      const ciphertext = await fs.readFile(path.join(root, String(storedArtifact.storageKey)));
      expect(ciphertext.subarray(0, 4).toString('ascii')).toBe('MSA1');
      expect(ciphertext.includes(content)).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects generated evidence when the principal disables before its shared latch', async () => {
    const harness = await generatedIngestHarness({
      livePrincipalStatus: MsaidiziPrincipalStatus.DISABLED,
    });
    try {
      await expect(
        harness.service.ingestTrustedUpdateArtifact(harness.file, harness.attestation),
      ).rejects.toThrow('Trusted artifact principal is no longer active');
      expect(harness.tx.msaidiziArtifact.create).not.toHaveBeenCalled();
      expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).not.toHaveBeenCalled();
      const lockSql = harness.tx.$queryRaw.mock.calls.map(([query]) =>
        Array.isArray(query) ? query.join(' ') : String(query),
      );
      expect(lockSql[0]).toContain('msaidizi_update_candidates');
      expect(lockSql[1]).toContain('msaidizi_principals');
      expect(lockSql[1]).toContain('FOR SHARE');
    } finally {
      await harness.cleanup();
    }
  });

  it('rolls back generated evidence when expiry occurs during writes before the final CAS', async () => {
    const harness = await generatedIngestHarness({
      finalDatabaseNow: new Date(generatedDatabaseNow.getTime() + 61_000),
    });
    try {
      await expect(
        harness.service.ingestTrustedUpdateArtifact(harness.file, harness.attestation),
      ).rejects.toThrow('Generated evaluation artifact budget is unavailable');
      expect(harness.tx.msaidiziArtifact.create).toHaveBeenCalledTimes(1);
      expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).not.toHaveBeenCalled();
      expect(harness.keys.verify).toHaveBeenCalledWith(
        harness.attestation,
        'ARTIFACT_VERIFIER',
        new Date(generatedDatabaseNow.getTime() + 61_000),
      );
    } finally {
      await harness.cleanup();
    }
  });
});

describe('MsaidiziArtifactsService generated evaluation authorization', () => {
  it('rejects a rotated evaluator lease inside the locked authorization', async () => {
    const harness = generatedDownloadHarness({ liveLeaseId: 'new-lease' });
    await expect(
      harness.service.downloadForUpdateEvaluation(
        generatedRunId,
        'old-lease',
        generatedArtifactId,
        generatedArtifactSha256,
      ),
    ).rejects.toThrow('Generated evaluation artifact not found');
    expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).not.toHaveBeenCalled();
  });

  it('rejects cancellation before locking the run or returning any manifest bytes', async () => {
    const harness = generatedDownloadHarness({ candidateEligible: false });
    await expect(
      harness.service.downloadForUpdateEvaluation(
        generatedRunId,
        generatedLeaseId,
        generatedArtifactId,
        generatedArtifactSha256,
      ),
    ).rejects.toThrow('Generated evaluation artifact not found');
    expect(harness.tx.msaidiziUpdateEvaluationRun.findFirst).not.toHaveBeenCalled();
  });

  it('uses the database clock and exact live v2 grant at the final transfer CAS', async () => {
    const expired = generatedDownloadHarness({
      leaseExpiresAt: new Date(generatedDatabaseNow.getTime() - 1),
    });
    await expect(
      expired.service.downloadForUpdateEvaluation(
        generatedRunId,
        generatedLeaseId,
        generatedArtifactId,
        generatedArtifactSha256,
      ),
    ).rejects.toThrow('Generated evaluation artifact not found');

    const revoked = generatedDownloadHarness({ grantVersion: '1' });
    await expect(
      revoked.service.downloadForUpdateEvaluation(
        generatedRunId,
        generatedLeaseId,
        generatedArtifactId,
        generatedArtifactSha256,
      ),
    ).rejects.toThrow('Generated evaluation artifact not found');
    expect(revoked.tx.msaidiziUpdateEvaluationRun.updateMany).not.toHaveBeenCalled();
  });

  it('holds the global principal latch before task authority and rejects a disabled principal', async () => {
    const harness = generatedDownloadHarness({
      livePrincipalStatus: MsaidiziPrincipalStatus.DISABLED,
    });

    await expect(
      harness.service.downloadForUpdateEvaluation(
        generatedRunId,
        generatedLeaseId,
        generatedArtifactId,
        generatedArtifactSha256,
      ),
    ).rejects.toThrow('Generated evaluation artifact not found');
    expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).not.toHaveBeenCalled();
    const lockSql = harness.tx.$queryRaw.mock.calls.map(([query]) =>
      Array.isArray(query) ? query.join(' ') : String(query),
    );
    expect(lockSql.findIndex((sql) => sql.includes('msaidizi_principals'))).toBeGreaterThan(
      lockSql.findIndex((sql) => sql.includes('msaidizi_update_candidates')),
    );
    expect(lockSql.some((sql) => sql.includes('msaidizi_tasks'))).toBe(false);
  });

  it('fails closed when a lock wait consumes the lease before the final transfer CAS', async () => {
    const harness = generatedDownloadHarness({
      finalDatabaseNow: new Date(generatedDatabaseNow.getTime() + 61_000),
    });

    await expect(
      harness.service.downloadForUpdateEvaluation(
        generatedRunId,
        generatedLeaseId,
        generatedArtifactId,
        generatedArtifactSha256,
      ),
    ).rejects.toThrow('Generated evaluation artifact not found');
    expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).not.toHaveBeenCalled();
  });
});

const generatedRunId = '31111111-1111-4111-8111-111111111111';
const generatedTaskId = '32222222-2222-4222-8222-222222222222';
const generatedStepId = '33333333-3333-4333-8333-333333333333';
const generatedCandidateId = '34444444-4444-4444-8444-444444444444';
const generatedArtifactId = '35555555-5555-4555-8555-555555555555';
const generatedTrustedArtifactId = '35666666-6666-4666-8666-666666666666';
const generatedPrincipalId = '36666666-6666-4666-8666-666666666666';
const generatedMandateId = '37777777-7777-4777-8777-777777777777';
const generatedArtifactSha256 = 'd'.repeat(64);
const generatedLeaseId = 'current-lease';
const generatedDatabaseNow = new Date('2026-08-28T08:00:00.000Z');

function generatedDownloadHarness(
  options: {
    liveLeaseId?: string;
    leaseExpiresAt?: Date;
    candidateEligible?: boolean;
    grantVersion?: string;
    livePrincipalStatus?: MsaidiziPrincipalStatus;
    finalDatabaseNow?: Date;
  } = {},
) {
  const dataClass = proposalDataClass('APPLICATION');
  const step = {
    id: generatedStepId,
    capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
    capabilityVersion: '2',
    expectedEffect: 'WRITE',
    dataClass,
  };
  const liveLeaseId = options.liveLeaseId ?? generatedLeaseId;
  const run = {
    id: generatedRunId,
    candidateId: generatedCandidateId,
    taskId: generatedTaskId,
    status: 'RUNNING',
    leaseId: liveLeaseId,
    leaseGeneration: 3,
    leaseExpiresAt: options.leaseExpiresAt ?? new Date(generatedDatabaseNow.getTime() + 60_000),
    deadlineAt: new Date(generatedDatabaseNow.getTime() + 600_000),
    startedAt: new Date(generatedDatabaseNow.getTime() - 10_000),
    maxWallTimeSeconds: 600,
    usedCpuTimeSeconds: 10,
    maxCpuTimeSeconds: 600,
    usedBytesRead: 0n,
    usedBytesWritten: 0n,
    usedExternalEgressBytes: 0n,
    maxBytesRead: 10_000n,
    maxBytesWritten: 10_000n,
    maxExternalEgressBytes: 10_000n,
    usedModelTurns: 0,
    maxModelTurns: 10,
    usedModelInputTokens: 0n,
    maxModelInputTokens: 10_000n,
    usedModelOutputTokens: 0n,
    maxModelOutputTokens: 10_000n,
    usedModelCostMicrousd: 0n,
    maxModelCostMicrousd: 1_000_000n,
    generationArtifact: {
      id: generatedArtifactId,
      storageKey: `${generatedArtifactId}.msa`,
      sha256: generatedArtifactSha256,
      mimeType: 'application/json',
      name: 'generated-manifest.json',
      byteSize: 1_000n,
      encrypted: true,
      trustLevel: MsaidiziTrustLevel.UNTRUSTED,
    },
    task: {
      id: generatedTaskId,
      principalId: generatedPrincipalId,
      mandateId: generatedMandateId,
      status: MsaidiziTaskStatus.RUNNING,
      principal: {
        status: options.livePrincipalStatus ?? MsaidiziPrincipalStatus.ACTIVE,
      },
      mandate: {
        id: generatedMandateId,
        principalId: generatedPrincipalId,
        status: 'ACTIVE',
        startsAt: null,
        expiresAt: new Date(generatedDatabaseNow.getTime() + 600_000),
        capabilities: [
          {
            capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
            version: options.grantVersion ?? '2',
            effects: ['WRITE'],
            dataClasses: [dataClass],
          },
        ],
      },
    },
    step,
  };
  const tx = {
    $queryRaw: jest.fn(async (query: TemplateStringsArray | string) => {
      const sql = Array.isArray(query) ? query.join(' ') : String(query);
      if (sql.includes('msaidizi_update_candidates')) {
        return options.candidateEligible === false
          ? []
          : [
              {
                id: generatedCandidateId,
                principalId: generatedPrincipalId,
                taskId: generatedTaskId,
              },
            ];
      }
      if (sql.includes('msaidizi_principals')) {
        return [
          {
            id: generatedPrincipalId,
            status: options.livePrincipalStatus ?? MsaidiziPrincipalStatus.ACTIVE,
          },
        ];
      }
      if (sql.includes('msaidizi_tasks')) {
        return [
          {
            id: generatedTaskId,
            principalId: generatedPrincipalId,
            mandateId: generatedMandateId,
          },
        ];
      }
      if (sql.includes('msaidizi_mandates')) return [{ id: generatedMandateId }];
      if (sql.includes('msaidizi_task_steps')) return [{ id: generatedStepId }];
      if (sql.includes('msaidizi_update_evaluation_runs')) return [{ id: generatedRunId }];
      if (sql.includes('clock_timestamp()')) {
        return [{ now: options.finalDatabaseNow ?? generatedDatabaseNow }];
      }
      return [];
    }),
    msaidiziUpdateEvaluationRun: {
      findFirst: jest.fn().mockResolvedValue(run),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  };
  const service = new MsaidiziArtifactsService(
    prisma as never,
    {
      get: jest.fn((name: string, fallback?: string) => {
        if (name === 'MSAIDIZI_AUTONOMY_ENABLED') return 'true';
        if (name === 'MSAIDIZI_GLOBAL_KILL_SWITCH') return 'false';
        return fallback;
      }),
    } as unknown as ConfigService,
    {} as never,
    {} as never,
  );
  return { service, prisma, tx, run };
}

async function generatedIngestHarness(
  options: {
    livePrincipalStatus?: MsaidiziPrincipalStatus;
    finalDatabaseNow?: Date;
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'msaidizi-generated-ingest-test-'));
  const uploadPath = path.join(root, 'verified-report.tmp');
  const content = Buffer.from('{"tests":true,"staticAnalysis":true}', 'utf8');
  await fs.writeFile(uploadPath, content);
  const sha256 = createHash('sha256').update(content).digest('hex');
  const baseRevisionSha256 = '1'.repeat(64);
  const requestDigest = '2'.repeat(64);
  const dataClass = proposalDataClass('APPLICATION');
  const source = Buffer.from('export const generatedArtifactEvidence = true;\n', 'utf8');
  const step = {
    id: generatedStepId,
    taskId: generatedTaskId,
    planVersionId: trustedPlanVersionId,
    target: 'SELF_IMPROVEMENT',
    capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
    capabilityVersion: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
    arguments: {
      name: 'Generated artifact evidence candidate',
      version: '2.0.0',
      scope: 'APPLICATION',
      rollbackVersion: '1.9.0',
      rationale: 'Require signed evidence and a final authority reservation.',
      baseRevisionSha256,
      changes: [
        {
          relativePath: 'backend/src/modules/orders/generated-artifact-evidence.ts',
          operation: 'ADD',
          expectedPreSha256: null,
          contentBase64: source.toString('base64'),
          contentSha256: createHash('sha256').update(source).digest('hex'),
        },
      ],
      evaluationBudget: {
        maxWallTimeSeconds: 600,
        maxCpuTimeSeconds: 600,
        maxBytesRead: '100000',
        maxBytesWritten: '100000',
        maxExternalEgressBytes: '100000',
        maxModelTurns: 4,
        maxModelInputTokens: '10000',
        maxModelOutputTokens: '10000',
        maxModelCostMicrousd: '1000000',
      },
    },
    expectedEffect: 'WRITE',
    dataClass,
    idempotent: true,
    mutation: true,
    planVersion: {
      id: trustedPlanVersionId,
      taskId: generatedTaskId,
      version: 1,
      createdByUserId: trustedUserId,
    },
  };
  const task = {
    id: generatedTaskId,
    principalId: generatedPrincipalId,
    initiatedByUserId: trustedUserId,
    companyId: 'company-1',
    mandateId: generatedMandateId,
    mode: MsaidiziTaskMode.AUTOPILOT,
    status: MsaidiziTaskStatus.RUNNING,
    activePlanVersion: 1,
    bytesRead: 0n,
    bytesWritten: 0n,
    maxLocalBytes: 1_000_000n,
    // The advisory context can be stale; the transaction-level principal lock
    // below is the authoritative race boundary exercised by these tests.
    principal: { status: MsaidiziPrincipalStatus.ACTIVE },
    mandate: {
      id: generatedMandateId,
      principalId: generatedPrincipalId,
      status: 'ACTIVE',
      startsAt: null,
      expiresAt: new Date(generatedDatabaseNow.getTime() + 600_000),
      capabilities: [
        {
          capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
          version: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
          effects: ['WRITE'],
          dataClasses: [dataClass],
        },
      ],
    },
  };
  const generationArtifact = {
    id: generatedArtifactId,
    taskId: generatedTaskId,
    stepId: generatedStepId,
    sha256: generatedArtifactSha256,
    trustLevel: MsaidiziTrustLevel.UNTRUSTED,
  };
  const candidate = {
    id: generatedCandidateId,
    principalId: generatedPrincipalId,
    proposedByTaskId: generatedTaskId,
    status: 'EVALUATING',
  };
  const run = {
    id: generatedRunId,
    candidateId: generatedCandidateId,
    taskId: generatedTaskId,
    planVersionId: trustedPlanVersionId,
    stepId: generatedStepId,
    evaluationRunId: 'generated-evaluation-run-001',
    requestDigest,
    generationArtifactId: generatedArtifactId,
    generationArtifactSha256: generatedArtifactSha256,
    generationManifestSha256: generatedArtifactSha256,
    policyVersion: GENERATED_UPDATE_POLICY_VERSION,
    policyDigest: GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
    status: 'RUNNING',
    leaseId: generatedLeaseId,
    leaseGeneration: 3,
    leaseExpiresAt: new Date(generatedDatabaseNow.getTime() + 60_000),
    deadlineAt: new Date(generatedDatabaseNow.getTime() + 600_000),
    startedAt: new Date(generatedDatabaseNow.getTime() - 10_000),
    maxWallTimeSeconds: 600,
    maxCpuTimeSeconds: 600,
    maxBytesRead: 100_000n,
    maxBytesWritten: 100_000n,
    maxExternalEgressBytes: 100_000n,
    maxModelTurns: 4,
    maxModelInputTokens: 10_000n,
    maxModelOutputTokens: 10_000n,
    maxModelCostMicrousd: 1_000_000n,
    usedCpuTimeSeconds: 10,
    usedBytesRead: 1_000n,
    usedBytesWritten: 1_000n,
    usedExternalEgressBytes: 0n,
    usedModelTurns: 1,
    usedModelInputTokens: 100n,
    usedModelOutputTokens: 50n,
    usedModelCostMicrousd: 10_000n,
    generationArtifact,
    candidate,
    step,
  };
  const claims = {
    schemaVersion: 2,
    type: 'TRUSTED_UPDATE_ARTIFACT',
    signerKeyId: 'generated-artifact-verifier',
    artifactId: generatedTrustedArtifactId,
    artifactPurpose: 'REPORT',
    taskId: generatedTaskId,
    planVersionId: trustedPlanVersionId,
    stepId: generatedStepId,
    candidateId: generatedCandidateId,
    name: 'generated-evaluation-report.json',
    mimeType: 'application/json',
    byteSize: String(content.length),
    sha256,
    dataClass,
    evaluationRunId: run.evaluationRunId,
    cleanSnapshotId: 'windows-11-clean-generated-001',
    toolchainVersions: { dotnet: '8.0.8', node: '22.14.0' },
    provenance: {
      producer: 'ISOLATED_WINDOWS_VERIFIER',
      source: 'CLEAN_SNAPSHOT_BUILD',
    },
    issuedAt: new Date(generatedDatabaseNow.getTime() - 60_000).toISOString(),
    expiresAt: new Date(generatedDatabaseNow.getTime() + 120_000).toISOString(),
    nonce: '38888888-8888-4888-8888-888888888888',
    requestDigest,
    generationArtifactId: generatedArtifactId,
    generationArtifactSha256: generatedArtifactSha256,
    generationManifestSha256: generatedArtifactSha256,
    protectedPolicyVersion: GENERATED_UPDATE_POLICY_VERSION,
    protectedPolicySha256: GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
    baseRevisionSha256,
  };
  const attestation = parseArtifactAttestation({
    claimsJson: canonicalAttestationJson(claims),
    signature: Buffer.alloc(64, 'G', 'ascii').toString('base64url'),
  });
  let transactionClockIndex = 0;
  const tx = {
    $queryRaw: jest.fn(async (query: TemplateStringsArray | string) => {
      const sql = Array.isArray(query) ? query.join(' ') : String(query);
      if (sql.includes('msaidizi_update_candidates')) {
        return [
          {
            id: generatedCandidateId,
            principalId: generatedPrincipalId,
            taskId: generatedTaskId,
          },
        ];
      }
      if (sql.includes('msaidizi_principals')) {
        return [
          {
            id: generatedPrincipalId,
            status: options.livePrincipalStatus ?? MsaidiziPrincipalStatus.ACTIVE,
          },
        ];
      }
      if (sql.includes('msaidizi_tasks')) {
        return [
          {
            id: generatedTaskId,
            principalId: generatedPrincipalId,
            mandateId: generatedMandateId,
          },
        ];
      }
      if (sql.includes('msaidizi_mandates')) return [{ id: generatedMandateId }];
      if (sql.includes('msaidizi_task_steps')) return [{ id: generatedStepId }];
      if (sql.includes('msaidizi_update_evaluation_runs')) return [{ id: generatedRunId }];
      if (sql.includes('clock_timestamp()')) {
        const now =
          transactionClockIndex === 0
            ? generatedDatabaseNow
            : (options.finalDatabaseNow ?? generatedDatabaseNow);
        transactionClockIndex += 1;
        return [{ now }];
      }
      return [];
    }),
    msaidiziTask: { findUnique: jest.fn().mockResolvedValue(task) },
    msaidiziTaskStep: { findFirst: jest.fn(), updateMany: jest.fn() },
    msaidiziUpdateEvaluationRun: {
      findUnique: jest.fn().mockResolvedValue(run),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziArtifact: { create: jest.fn(async ({ data }) => data) },
    msaidiziTrustedArtifactEvidence: { create: jest.fn(async ({ data }) => data) },
    msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    msaidiziArtifact: { findUnique: jest.fn().mockResolvedValue(null) },
    msaidiziTask: { findUnique: jest.fn().mockResolvedValue(task) },
    msaidiziTaskStep: { findFirst: jest.fn().mockResolvedValue(step) },
    msaidiziUpdateEvaluationRun: { findFirst: jest.fn().mockResolvedValue(run) },
    msaidiziUpdateCandidate: { findFirst: jest.fn().mockResolvedValue({ id: candidate.id }) },
    $queryRaw: jest.fn().mockResolvedValue([{ now: generatedDatabaseNow }]),
    $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  };
  const keys = { verify: jest.fn() };
  const key = randomBytes(32).toString('base64');
  const service = new MsaidiziArtifactsService(
    prisma as never,
    {
      get: jest.fn((name: string, fallback?: string) => {
        if (name === 'MSAIDIZI_AUTONOMY_ENABLED') return 'true';
        if (name === 'MSAIDIZI_GLOBAL_KILL_SWITCH') return 'false';
        if (name === 'MSAIDIZI_ARTIFACT_ENCRYPTION_KEY') return key;
        if (name === 'MSAIDIZI_ARTIFACT_ROOT') return root;
        return fallback;
      }),
    } as unknown as ConfigService,
    keys as never,
    {
      logStrictInTransaction: jest.fn((client: typeof tx, input: unknown) =>
        client.auditLog.create({ data: input }),
      ),
    } as never,
  );
  return {
    service,
    prisma,
    tx,
    keys,
    attestation,
    file: {
      path: uploadPath,
      size: content.length,
      mimetype: 'application/json',
    } as Express.Multer.File,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

const trustedTaskId = '21111111-1111-4111-8111-111111111111';
const trustedPlanVersionId = '22222222-2222-4222-8222-222222222222';
const trustedStepId = '23333333-3333-4333-8333-333333333333';
const trustedArtifactId = '24444444-4444-4444-8444-444444444444';
const trustedRollbackArtifactId = '25555555-5555-4555-8555-555555555555';
const trustedPrincipalId = '26666666-6666-4666-8666-666666666666';
const trustedUserId = '27777777-7777-4777-8777-777777777777';
const trustedMandateId = '28888888-8888-4888-8888-888888888888';
const trustedDataClass = proposalDataClass('ADAPTERS');

function trustedArtifactClaims(sha256: string, byteSize: number) {
  return {
    schemaVersion: 1,
    type: 'TRUSTED_UPDATE_ARTIFACT',
    signerKeyId: 'artifact-verifier-2026-01',
    artifactId: trustedArtifactId,
    artifactPurpose: 'SOURCE',
    taskId: trustedTaskId,
    planVersionId: trustedPlanVersionId,
    stepId: trustedStepId,
    candidateId: null,
    name: 'verified-source.zip',
    mimeType: 'application/zip',
    byteSize: String(byteSize),
    sha256,
    dataClass: trustedDataClass,
    evaluationRunId: 'evaluation-run-001',
    cleanSnapshotId: 'windows-clean-snapshot-001',
    toolchainVersions: { dotnet: '8.0.8', node: '22.14.0' },
    provenance: {
      producer: 'ISOLATED_WINDOWS_VERIFIER',
      source: 'CLEAN_SNAPSHOT_BUILD',
    },
    issuedAt: '2026-08-25T10:00:00.000Z',
    expiresAt: '2026-08-25T10:10:00.000Z',
    nonce: '29999999-9999-4999-8999-999999999999',
  };
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
