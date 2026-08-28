import { ConfigService } from '@nestjs/config';
import { MsaidiziArtifactKind, MsaidiziTaskStatus, MsaidiziTaskStepStatus } from '@prisma/client';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HostActionArtifactMaterializationRequest } from '../msaidizi-tasks/msaidizi-input-bindings';
import { MsaidiziArtifactsService } from './msaidizi-artifacts.service';

const TASK_ID = '10000000-0000-4000-8000-000000000001';
const PLAN_ID = '10000000-0000-4000-8000-000000000002';
const TARGET_STEP_ID = '10000000-0000-4000-8000-000000000003';
const SOURCE_STEP_ID = '10000000-0000-4000-8000-000000000004';
const DEVICE_ID = '10000000-0000-4000-8000-000000000005';
const ARTIFACT_ID = '10000000-0000-4000-8000-000000000006';
const TARGET_ATTEMPT_ID = 'target-attempt-1';
const SOURCE_ATTEMPT_ID = 'source-attempt-1';

describe('Msaidizi host-action artifact materialization', () => {
  it('reauthorizes, charges exact task and step reads, decrypts, and returns only canonical Base64', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'msaidizi-host-artifact-'));
    const key = randomBytes(32);
    const content = Buffer.from('reviewed attachment bytes', 'utf8');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const storageKey = `${ARTIFACT_ID}.msa`;
    await fs.writeFile(path.join(root, storageKey), encryptArtifact(content, key), { flag: 'wx' });

    const target = {
      id: TARGET_STEP_ID,
      taskId: TASK_ID,
      planVersionId: PLAN_ID,
      status: MsaidiziTaskStepStatus.RUNNING,
      preconditions: { deviceId: DEVICE_ID },
      budgets: { maxLocalBytes: 1024 },
      bytesRead: 0n,
      bytesWritten: 0n,
      localIoAccountingValid: true,
      planVersion: { version: 1 },
      task: {
        activePlanVersion: 1,
        bytesRead: 0n,
        bytesWritten: 0n,
        maxLocalBytes: 1024n,
      },
    };
    const artifact = {
      id: ARTIFACT_ID,
      taskId: TASK_ID,
      stepId: SOURCE_STEP_ID,
      storageKey,
      provenance: {
        attemptId: SOURCE_ATTEMPT_ID,
        persistedSha256: sha256,
        persistedBytes: content.length,
        redactionsApplied: false,
        trustLevel: 'UNTRUSTED',
      },
      sha256,
      byteSize: BigInt(content.length),
      mimeType: 'text/plain',
      name: 'reviewed.txt',
      kind: MsaidiziArtifactKind.FILE,
      dataClass: 'Internal',
    };
    const taskCharge = jest.fn().mockResolvedValue({ count: 1 });
    const stepCharge = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      msaidiziTask: { updateMany: taskCharge },
      msaidiziTaskStep: { updateMany: stepCharge },
    };
    const prisma = {
      msaidiziTaskStep: { findFirst: jest.fn().mockResolvedValue(target) },
      msaidiziArtifact: { findFirst: jest.fn().mockResolvedValue(artifact) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const config = {
      get: jest.fn((name: string, fallback?: string) => {
        if (name === 'MSAIDIZI_AUTONOMY_ENABLED') return 'true';
        if (name === 'MSAIDIZI_ARTIFACT_ENCRYPTION_KEY') return key.toString('base64');
        if (name === 'MSAIDIZI_ARTIFACT_ROOT') return root;
        return fallback;
      }),
    };
    const service = new MsaidiziArtifactsService(
      prisma as never,
      config as unknown as ConfigService,
      {} as never,
      {} as never,
    );
    const binding: HostActionArtifactMaterializationRequest = {
      taskId: TASK_ID,
      planVersionId: PLAN_ID,
      targetStepId: TARGET_STEP_ID,
      targetAttemptId: TARGET_ATTEMPT_ID,
      deviceId: DEVICE_ID,
      sourceStepId: SOURCE_STEP_ID,
      sourceAttemptId: SOURCE_ATTEMPT_ID,
      artifactId: ARTIFACT_ID,
      sha256,
      byteSize: content.length,
      mimeType: 'text/plain',
      name: 'reviewed.txt',
      kind: 'FILE',
      dataClass: 'Internal',
    };

    try {
      await expect(service.materializeForHostAction(binding)).resolves.toEqual({
        contentBase64: content.toString('base64'),
      });
      expect(taskCharge).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: TASK_ID,
            status: MsaidiziTaskStatus.RUNNING,
            activePlanVersion: 1,
            hostExecutionAllowed: true,
            bytesRead: 0n,
            bytesWritten: 0n,
          }),
          data: expect.objectContaining({
            bytesRead: { increment: BigInt(content.length) },
          }),
        }),
      );
      expect(stepCharge).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: TARGET_STEP_ID,
            taskId: TASK_ID,
            localIoAccountingValid: true,
            bytesRead: 0n,
            bytesWritten: 0n,
          }),
          data: expect.objectContaining({
            bytesRead: { increment: BigInt(content.length) },
            bytesWritten: { increment: 0n },
          }),
        }),
      );

      const callsBeforeMismatch = prisma.$transaction.mock.calls.length;
      await expect(
        service.materializeForHostAction({
          ...binding,
          deviceId: '20000000-0000-4000-8000-000000000002',
        }),
      ).rejects.toThrow('Host artifact device scope does not match the target step');
      expect(prisma.$transaction).toHaveBeenCalledTimes(callsBeforeMismatch);

      for (const capability of ['filesystem.file.read', 'filesystem.file.disclose.ephemeral']) {
        Object.assign(artifact, {
          provenance: {
            ...artifact.provenance,
            sourceType: 'HOST_RESULT',
            capability,
          },
        });
        await expect(service.materializeForHostAction(binding)).rejects.toThrow(
          'Exact dependency artifact is unavailable for this host action',
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(callsBeforeMismatch);
      }
    } finally {
      key.fill(0);
      content.fill(0);
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

function encryptArtifact(content: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
  try {
    return Buffer.concat([Buffer.from('MSA1', 'ascii'), iv, encrypted, cipher.getAuthTag()]);
  } finally {
    iv.fill(0);
    encrypted.fill(0);
  }
}
