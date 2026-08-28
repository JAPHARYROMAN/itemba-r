import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HostFileObservationBinding } from '../msaidizi-devices/host-file-observation';
import { REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY } from '../msaidizi-devices/host-file-ephemerality.policy';
import {
  AdaptiveReasoningFileBinding,
  MsaidiziArtifactsService,
  ToolObservationArtifactInput,
} from './msaidizi-artifacts.service';

const taskId = '11111111-1111-4111-8111-111111111111';
const planVersionId = '22222222-2222-4222-8222-222222222222';
const stepId = '33333333-3333-4333-8333-333333333333';
const attemptId = '44444444-4444-4444-8444-444444444444';
const argumentsSha256 = 'a'.repeat(64);
const sourceIdentifierHash = 'b'.repeat(64);
const knownSecret = 'msaidizi-known-secret-file-canary-2026';

describe('legacy durable host-file observation quarantine', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'msaidizi-host-file-quarantine-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([
    ['known-secret text', Buffer.from(`password=${knownSecret}`, 'utf8'), 'text/plain', '.txt'],
    [
      'PDF bytes',
      Buffer.from(`%PDF-1.7\n1 0 obj\n(${knownSecret})\nendobj\n%%EOF`, 'utf8'),
      'application/pdf',
      '.pdf',
    ],
    [
      'binary bytes',
      Buffer.concat([Buffer.from([0, 255, 3, 7]), Buffer.from(knownSecret, 'utf8')]),
      'application/octet-stream',
      '.bin',
    ],
  ])(
    'refuses %s before artifact, budget, event or filesystem persistence',
    async (_name, content, mimeType, extension) => {
      const prisma = ingestionPrisma();
      const service = artifactService(prisma, root);
      const encodedSecret = Buffer.from(knownSecret, 'utf8').toString('base64');

      try {
        await expect(
          service.ingestToolObservation(
            fileInput(content as Buffer, mimeType as string, extension as string),
          ),
        ).rejects.toThrow(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);

        expect(prisma.msaidiziArtifact.findUnique).not.toHaveBeenCalled();
        expect(prisma.msaidiziToolAttempt.findFirst).not.toHaveBeenCalled();
        expect(prisma.msaidiziTask.updateMany).not.toHaveBeenCalled();
        expect(prisma.msaidiziTaskStep.updateMany).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(await fs.readdir(root)).toEqual([]);

        const durableCalls = JSON.stringify({
          artifact: prisma.msaidiziArtifact.findUnique.mock.calls,
          attempt: prisma.msaidiziToolAttempt.findFirst.mock.calls,
          task: prisma.msaidiziTask.updateMany.mock.calls,
          step: prisma.msaidiziTaskStep.updateMany.mock.calls,
          transaction: prisma.$transaction.mock.calls,
        });
        expect(durableCalls).not.toContain(knownSecret);
        expect(durableCalls).not.toContain(encodedSecret);
      } finally {
        (content as Buffer).fill(0);
      }
    },
  );
});

describe('legacy settled host-file adaptive reopening quarantine', () => {
  it.each([
    ['text/plain', '.txt', Buffer.from(`password=${knownSecret}`, 'utf8')],
    ['application/pdf', '.pdf', Buffer.from(`%PDF-1.7\n(${knownSecret})\n%%EOF`, 'utf8')],
    [
      'application/octet-stream',
      '.bin',
      Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(knownSecret, 'utf8')]),
    ],
  ])(
    'refuses %s without opening or decrypting an artifact',
    async (mimeType, extension, content) => {
      const prisma = ingestionPrisma();
      const service = artifactService(prisma, 'unused');
      const reserve = jest.fn();
      artifactPrivate(service).reserveAndLoadReasoningArtifacts = reserve;

      try {
        await expect(
          service.readSettledFileForAdaptiveReasoning(
            adaptiveBinding(content as Buffer, mimeType as string, extension as string),
          ),
        ).rejects.toThrow(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);

        expect(prisma.msaidiziArtifact.findFirst).not.toHaveBeenCalled();
        expect(prisma.msaidiziTask.updateMany).not.toHaveBeenCalled();
        expect(reserve).not.toHaveBeenCalled();
      } finally {
        (content as Buffer).fill(0);
      }
    },
  );
});

function fileInput(
  content: Buffer,
  mimeType: string,
  extension: string,
  overrides: Partial<HostFileObservationBinding> = {},
): ToolObservationArtifactInput {
  const persistedSha256 = createHash('sha256').update(content).digest('hex');
  return {
    taskId,
    stepId,
    attemptId,
    dataClass: 'RESTRICTED',
    sourceType: 'HOST_RESULT',
    sourceSha256: 'f'.repeat(64),
    sourceBytes: content.length,
    persistedSha256,
    persistedBytes: content.length,
    redactionsApplied: false,
    content,
    accountedLocalBytesRead: BigInt(content.length),
    accountedLocalBytesWritten: 0n,
    file: {
      capability: 'filesystem.file.read',
      mimeType,
      extension,
      argumentsSha256,
      sourceIdentifierHash,
      ...overrides,
    } as HostFileObservationBinding,
  };
}

function ingestionPrisma() {
  return {
    msaidiziTask: { updateMany: jest.fn() },
    msaidiziTaskStep: { updateMany: jest.fn() },
    msaidiziToolAttempt: { findFirst: jest.fn() },
    msaidiziArtifact: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function artifactService(prisma: object, root: string): MsaidiziArtifactsService {
  return new MsaidiziArtifactsService(
    prisma as never,
    new ConfigService({
      MSAIDIZI_AUTONOMY_ENABLED: 'true',
      MSAIDIZI_ARTIFACT_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      MSAIDIZI_ARTIFACT_ROOT: root,
    }),
    {} as never,
    {} as never,
  );
}

function adaptiveBinding(
  content: Buffer,
  mimeType: string,
  extension: string,
): AdaptiveReasoningFileBinding {
  return {
    taskId,
    planVersionId,
    planVersion: 1,
    stepId,
    attemptId,
    artifactId: '55555555-5555-4555-8555-555555555555',
    capability: 'filesystem.file.read',
    mimeType,
    extension,
    sha256: createHash('sha256').update(content).digest('hex'),
    byteSize: content.length,
    dataClass: 'RESTRICTED',
    argsDigest: argumentsSha256,
    sourceIdentifierHash,
  } as AdaptiveReasoningFileBinding;
}

function artifactPrivate(service: MsaidiziArtifactsService) {
  return service as unknown as {
    reserveAndLoadReasoningArtifacts: jest.Mock;
  };
}
